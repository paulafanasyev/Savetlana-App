# Безопасность

## Секреты (spec §38, §46)

**Никогда** не попадают в frontend, APK, JS-bundle, Git или логи:

- `AI_GATEWAY_API_KEY`
- `JWT_SECRET`
- `PAYMENT_PROVIDER_API_KEY`
- `VK_CLIENT_SECRET`
- `ESIA_CLIENT_SECRET`
- `ALIPAY_PRIVATE_KEY`
- `INTERNATIONAL_BRIDGE_API_KEY`

Все через `src/lib/env.ts` — server-side only. `.gitignore` исключает `.env` и все `*.db`. `.env.example` содержит только плейсхолдеры.

Проверено: `git-secrets`-стиль аудит staging-области перед каждым коммитом.

## Аутентификация

- HMAC токены через Web Crypto (работают и в Edge middleware, и в Node route handlers)
- Пароли — bcrypt
- Каждый токен содержит уникальный `jti` (исправляет коллизию `Session.token` при повторном логине в ту же секунду)
- `Secure` cookie в production — корректно для HTTPS

## Авторизация (RBAC)

Три роли: `BUYER`, `SELLER`, `ADMIN`.

| Защита | Где |
|--------|-----|
| API-роуты | `requireBuyer` / `requireSeller` / `requireAdmin` |
| Server components | `requireUserServer` / `requireSellerServer` / `requireAdminServer` |
| AI tools | Tool Registry permissions (26 разрешений) |

Проверено: покупатель получает 403 на admin-эндпоинты (`tests/admin.test.ts`), buyer-агент не может опубликовать товар (`tests/permissions.test.ts`).

## Подтверждение чувствительных действий (spec §45, §147)

Без подтверждения не выполняются: покупка, отмена заказа, публикация товара, изменение цены, удаление памяти, отвязка интеграций.

Уровни риска: `READ`, `LOW_RISK_WRITE`, `HIGH_RISK_WRITE`, `FINANCIAL`, `ACCOUNT_SECURITY`.

## Защита от утечки в AI (spec §83–§85)

Privacy guard перед каждым внешним вызовом: PII detection, secret detection, minimization, redaction. Запрос к модели не содержит данных, не нужных для задачи.

## Anti-fraud

`domains/risk.ts` — Risk Engine с уровнями `LOW` / `MEDIUM` / `HIGH` / `REVIEW` / `BLOCKED`. Сигналы: скорость заказов, сумма, гео, история возвратов, дубли аккаунтов.

**AI не замораживает деньги сам** — только помечает на review. Решения explainable и хранятся в `RiskEvent`.

## Защита от подделок (spec §49)

Запрещены fake payment, fake tracking, fake verification. Реальный пример исправленного бага: sandbox-перевозчик **перезаписывал** настоящий трек-номер продавца fabricated-значением. Теперь seller-provided tracking сохраняется, неизвестный перевозчик честно отказывает, а не подменяется sandbox-адаптером.

Тест: `tests/order-lifecycle.test.ts` (seller-declared carrier).

## Аудит

`domains/audit.ts` — каждое чувствительное действие: `actorId`, `actorRole`, `action`, `target`, `before`/`after` (JSON-строкой — SQLite не имеет Json-типа). Все admin-решения аудитируются (spec §140).

## Защита от типичных атак

| Угроза | Защита |
|--------|--------|
| SQL injection | Prisma parameterized queries |
| XSS | React экранирование, CSP-ready |
| CSRF | Same-site cookies, JSON-only API |
| Брутфорс | `rateLimit` на auth-эндпоинтах |
| Abuse | Rate limits: auth, search, AI, uploads, payments |
| Перехват сессии | HMAC подпись, `jti`, expiry |

## Защита загрузок (spec §81)

Content-type verification, size limits, private/public классификация, access control.

## Известные ограничения

- Нет malware scanning — помечено как NOT PROVEN
- Нет отдельного secrets manager — переменные окружения (подходит для Vercel, production hardening рекомендует внешний manager)
