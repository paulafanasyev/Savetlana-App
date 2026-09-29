# Безопасность

## Секреты (spec §38, §46)

**Никогда** не попадают в frontend, APK, JS-bundle, Git или логи:

- `AI_GATEWAY_API_KEY`
- `JWT_SECRET`
- `PAYMENT_PROVIDER_API_KEY`
- `PAYMENT_WEBHOOK_SECRET`
- `VK_CLIENT_SECRET`
- `ESIA_CLIENT_SECRET`
- `ALIPAY_PRIVATE_KEY`
- `INTERNATIONAL_BRIDGE_API_KEY`
- `PENDING_ACTION_KEY` — ключ целостности аргументов AI-подтверждений
- `OAUTH_STATE_KEY` — подпись OAuth state
- `CRON_SECRET` — подпись cron-вызовов
- `SECRET_STORE_KEY` — шифрование OAuth-токенов

Все через `src/lib/env.ts` — server-side only. `.gitignore` исключает `.env` и все `*.db`. `.env.example` содержит только плейсхолдеры.

Проверено: `git-secrets`-стиль аудит staging-области перед каждым коммитом.

## Аутентификация

- HMAC токены через Web Crypto (работают и в Edge middleware, и в Node route handlers)
- Пароли — bcrypt
- Каждый токен содержит уникальный `jti` (исправляет коллизию `Session.token` при повторном логине в ту же секунду)
- `Secure` cookie в production — корректно для HTTPS

### Защита от брутфорса (P0-15)

`domains/rate-limits.ts` — распределённый лимитер на БД (`AuthAttempt`), работает в serverless/multi-instance:

- Login: 5 попыток / 15 минут на email+IP
- Register: 3 попытки / час на IP
- AI confirm: 20 запросов / час на пользователя (защита от перебора actionId/nonce)
- Блокировка учётки: 5 неудачных попыток → аккаунт заблокирован до разблокировки

In-memory limiter оставлен только для non-critical read-путей.

## Авторизация (RBAC)

Три роли: `BUYER`, `SELLER`, `ADMIN`.

| Защита | Где |
|--------|-----|
| API-роуты | `requireBuyer` / `requireSeller` / `requireAdmin` |
| Server components | `requireUserServer` / `requireSellerServer` / `requireAdminServer` |
| AI tools | Tool Registry permissions |
| Origin/Host | `src/middleware.ts` на каждом state-changing запросе |

Проверено: покупатель получает 403 на admin-эндпоинты (`tests/admin.test.ts`), buyer-агент не может опубликовать товар (`tests/permissions.test.ts`).

## Seller onboarding gate (P0-4)

Регистрация продавца больше не даёт права торговать. `domains/onboarding-gate.ts` проверяет завершённость машины:

```
REGISTERED → IDENTITY_VERIFIED → BUSINESS/NPD_VERIFIED → DOCUMENTS_VERIFIED → APPROVED
```

Только `APPROVED` может: публиковать товары, подтверждать заказы, создавать отгрузки, запрашивать выплаты.

Проверено: `tests/p0-production-gates.test.ts` — неактивированный продавец отклоняется на publish/confirm/ship/payout.

## Подтверждение AI-действий (spec §45, §147) — P0-1

**Проблема аудита:** confirm-эндпоут принимал `toolName`+`args` от клиента и исполнял их — без доказательства, что именно эта пара была предложена Светланой.

**Решение:** server-side `PendingAction` (`domains/pending-actions.ts`):

- Master Agent persist'ит предложенное действие: `userId`, `conversationId`, `toolName`, `argsHash`, `nonce`, `expiresAt`
- Фронтенд получает непрозрачный `actionId` — аргументы ему не видны
- Confirm принимает **только** `actionId` + `nonce`
- HMAC целостности: аргументы нечитаемы и не могут быть подделаны
- Одноразовость: `CONSUMED` после первого исполнения
- Replay-защита: actionId привязан к conversation и пользователю

Проверено: forged confirm, cross-user confirm, replay, tampering, expiry — все отклоняются (`tests/p0-production-gates.test.ts`).

## Защита от утечки в AI (spec §83–§85)

Privacy guard перед каждым внешним вызовом: PII detection, secret detection, minimization, redaction. Запрос к модели не содержит данных, не нужных для задачи.

## Anti-fraud

`domains/risk.ts` — Risk Engine с уровнями `LOW` / `MEDIUM` / `HIGH` / `REVIEW` / `BLOCKED`. Сигналы: скорость заказов, сумма, гео, история возвратов, дубли аккаунтов.

**AI не замораживает деньги сам** — только помечает на review. Решения explainable и хранятся в `RiskEvent`.

## Защита от подделок (spec §49)

Запрещены fake payment, fake tracking, fake verification. Реальный пример исправленного бага: sandbox-перевозчик **перезаписывал** настоящий трек-номер продавца fabricated-значением. Теперь seller-provided tracking сохраняется, неизвестный перевозчик честно отказывает, а не подменяется sandbox-адаптером.

Тест: `tests/order-lifecycle.test.ts` (seller-declared carrier).

## Инвентарь и overselling (P0-6)

**Проблема аудита:** checkout проверял сток вне транзакции — два конкурирующих checkout могли продать один товар дважды.

**Решение:** `reserveStock()` — условный атомарный decrement внутри транзакции (`UPDATE ... WHERE quantity >= n`). При отмене/возврате — освобождение.

Проверено: `tests/p0-production-gates.test.ts` — конкуренция за последний товар, повторная продажа отклонена.

## Платежи и выплаты (P0-7, P0-8)

### Webhooks

`/api/webhooks/payment` — приём событий от платёжного партнёра с проверкой подписи (`PAYMENT_WEBHOOK_SECRET`). Идемпотентен по `providerRef`+`eventType`.

### Возвраты

`processRefund()` в `domains/payments.ts` — реальный вызов `provider.refund()` + компенсация settlement. Возврат денег выполняется провайдером, не отметкой в БД.

### Payouts через outbox

**Проблема аудита:** внешний HTTP-вызов payout выполнялся **внутри** `prisma.$transaction` — при таймауте после акцепта партнёром транзакция откатывалась, и повтор создавал двойную выплату.

**Решение:** outbox-паттерн. Транзакция только фиксирует `OutboxMessage`; воркер (`domains/jobs.ts`) вызывает партнёра с идемпотентным ключом и подтверждает результат. Внешнего HTTP внутри DB-транзакции больше нет.

## OAuth (VK, ЕСИА) — P0-2, P0-5

**Проблема аудита:** `state` генерировался, но callback его не проверял (CSRF); VK access-токен хранился как opaque-ссылка, а в адаптер передавалась сама эта ссылка, а не токен.

**Решение:**

- `domains/oauth-states.ts` — persist-able state: проверяется существование, принадлежность сессии, срок, одноразовость
- `domains/secret-store.ts` — шифрованное хранение токенов (`SECRET_STORE_KEY`); адаптер получает расшифрованный токен, в БД лежит только blob
- Отвязка интеграции стирает секрет

Проверено: `tests/p0-production-gates.test.ts` — state из другой сессии, истёкший, повторно использованный — все отклоняются.

## Consent (P0-12)

**Проблема аудита:** recommendation engine искал `type: "personalization"`, а enum использует `AI_PERSONALIZATION`, и при отсутствии записи default был `true` — персонализация работала без opt-in.

**Решение:** `domains/consents.ts` — корректный enum, opt-in по умолчанию (`granted ?? false`), API `/api/consents` для Privacy Center.

## Health и диагностика (P0-16, P0-25)

- `/api/health` — раздельные liveness (процесс жив) и readiness (БД+зависимости). При неготовности — **503**, не 200
- `/api/ai/status` — полная информация (tools, permissions, provider) только для ADMIN. Публичный ответ минимален: Светлана работает / нет

## CSRF / Origin (P0-14)

`src/middleware.ts` — на каждом state-changing запросе (POST/PUT/PATCH/DELETE):

- `Origin`/`Host` совпадают с приложением
- `Sec-Fetch-Site` не `cross-site` (когда заголовок есть)
- Read-запросы и cron/webhook (подписанные) пропускаются

Проверено: `tests/csrf-gate.test.ts` — cross-origin POST отклоняется.

## Аудит

`domains/audit.ts` — каждое чувствительное действие: `actorId`, `actorRole`, `action`, `target`, `before`/`after` (JSON-строкой — SQLite не имеет Json-типа). Все admin-решения аудитируются (spec §140).

## Фоновые задачи (P0-18)

`domains/jobs.ts` + `/api/cron/process` (подпись `CRON_SECRET`):

- Outbox processing (payouts, внешние вызовы)
- Inventory freshness — устаревшие подтверждения наличия
- Listing expiry — автопродление/снятие
- Document expiry
- Tracking sync
- Notification dispatch

Vercel Cron конфигурация — `vercel.json`.

## Observability (P0-17)

`src/lib/logger.ts` — структурированное логирование single-line JSON:

- `traceId` прокидывается middleware через `x-trace-id` — edge, API-роуты и фоновые задачи коррелируются
- `redact()` рекурсивно вычищает секреты (password, token, apiKey, authorization, cookie) и ключи, содержащие их подстроки
- Oversized-строки усекаются (JWT/изображения не затапливают лог)
- Глубокие массивы коллапсируются
- `traced()` измеряет латентность и warns на >2s

Проверено: `tests/logger.test.ts` — redaction против реальных форм данных, включая циклические ссылки.

## Защита от типичных атак

| Угроза | Защита |
|--------|--------|
| SQL injection | Prisma parameterized queries |
| XSS | React экранирование + strict CSP |
| CSRF | Same-site cookies + Origin/Host middleware |
| Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options: DENY` |
| AI confirm forgery | Server-side PendingAction + nonce + HMAC |
| Брутфорс | DB-backed rate limits на auth/confirm |
| Перехват сессии | HMAC подпись, `jti`, expiry, `Secure` cookie |
| Exfiltration при XSS | `connect-src 'self'` в CSP |
| OAuth CSRF | Persisted, signed, one-time state |
| Double-spend payout | Outbox + provider idempotency key |
| Overselling | Atomic conditional decrement |
| Secret leak in AI | Privacy guard, redaction |
| Secret leak in logs | `redact()` на каждом log-вызове |

## Защита загрузок (spec §81)

Content-type verification, size limits, private/public классификация, access control.

## Известные ограничения

- Нет malware scanning — помечено как NOT PROVEN
- Storage layer (S3/Blob) для документов отсутствует — PENDING_EXTERNAL_ACCESS
- Внешние интеграции (платёжный партнёр, CDEK, VK, ЕСИА) — sandbox-адаптеры готовы, production credentials требуются
