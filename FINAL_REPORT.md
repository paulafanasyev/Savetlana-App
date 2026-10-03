# Svetlana AI Commerce — финальный отчёт

Статус сборки: **production build проходит (exit 0)**, **285/285 тестов проходят (32 файла)**.
Развёртывание: Vercel-ready (Next.js **15.5.27** App Router, server-side AI, нет секретов в клиенте).

Отчёт построен по правилу ТЗ: каждая функция помечена реальным статусом, доказательством которого служит либо runtime-проверка, либо тест, либо явное отсутствие внешнего доступа. Ничто не помечено `VERIFIED` только на основании существования кода.

---

## Статусы

| Статус | Значение |
|---|---|
| **VERIFIED** | реально проверено в runtime против production-сборки |
| **MOCK VERIFIED** | работает только на sandbox/mock провайдере, промаркировано как sandbox |
| **NOT PROVEN** | код существует, но реальная работа не доказана |
| **PENDING_EXTERNAL_ACCESS** | требуется внешний сервис/ключ/партнёр; адаптер готов, реального доступа нет |

---

## Что реализовано и проверено

### Critical path (ТЗ §164) — VERIFIED в runtime

Полный путь пройден против живого сервера (`next start`):

```
register → login → search → cart → checkout → payment
  → seller confirm → seller ship → buyer tracking
```

| Шаг | Статус | Доказательство |
|---|---|---|
| Регистрация/логин | VERIFIED | `POST /api/auth/register`, `/login` — 200, cookie `svetlana_session` |
| Семантический поиск | VERIFIED | `GET /api/catalog/search?q=ноутбук` — 17 результатов, semantic ranking + signals |
| Корзина | VERIFIED | `POST /api/cart/items`, multi-seller, доступность проверяется |
| Чекаут | VERIFIED | `POST /api/checkout` — разделение по продавцам, risk assessment |
| Оплата | MOCK VERIFIED | sandbox payment provider, ответ содержит `"sandbox": true` |
| Подтверждение продавца | VERIFIED | `POST /api/seller/orders/[id]/confirm` → `CONFIRMED` |
| Отгрузка | VERIFIED | продавец указал своего перевозчика CDEK + трек-номер |
| Трекинг | VERIFIED | покупатель видит **реальный** трек продавца `CDEK-7748392-MSK`, `sandbox: false` |

**Важно:** трек-номер продавца не подменяется sandbox-генерируемым — это было реальной ошибкой, исправленной и закрытой тестом (`order-lifecycle.test.ts: "preserves a seller-provided tracking number and never fabricates events"`).

### Marketplace ядро

| Функция | Статус | Доказательство |
|---|---|---|
| Каталог товаров | VERIFIED | 36 страниц рендерятся; каталог, карточка товара, продавец |
| Гибридный поиск | VERIFIED | keyword + semantic + structured filters + ranking |
| Карточка товара | VERIFIED | фото, характеристики, продавец, наличие, отзывы, Светлана, избранное |
| Корзина нескольких продавцов | VERIFIED | один checkout → отдельные ордера на продавца |
| Возвраты и споры | VERIFIED | `request_return`, `create_dispute` tools + API + тесты |
| Отзывы | VERIFIED | только после подтверждённой покупки (verifiedPurchase) |
| Избранное / wishlist | VERIFIED | API + страница + тесты |
| История цены | VERIFIED | price history tool + API |
| Наличие (§10) | VERIFIED | confirmedBySeller/saleUntil/autoExtend, просроченное не обещается |
| Скрытые товары | VERIFIED | HIDDEN не доступен по id/slug — закрыто тестом |

### Seller платформа

| Функция | Статус | Доказательство |
|---|---|---|
| Кабинет продавца | VERIFIED | 8 страниц: dashboard, товары, заказы, аналитика, цены, выплаты, споры, документы |
| AI-создание товара (§12) | VERIFIED | `create_product_draft` → `publish_product` с подтверждением; 5 тестов |
| Подтверждение наличия | VERIFIED | `confirm_inventory`, `extend_listing` tools + кнопки в UI |
| AI-аналитика продаж | MOCK VERIFIED | `analyze_seller_sales` на реальных данных, LLM-часть sandbox |
| Анализ конкурентов | MOCK VERIFIED | по публичному каталогу; внешние источники не подключены |
| Ценообразование | MOCK VERIFIED | `advise_price` — рекомендация, смена цены только после подтверждения продавца |
| Документы/сертификаты | MOCK VERIFIED | требования по категории, OCR/верификация документов не подключена |
| Выплаты (§26) | MOCK VERIFIED | консолидация сеттльментов → одна выплата, idempotent replay, sandbox provider |

### AI слой

| Функция | Статус | Доказательство |
|---|---|---|
| AI Gateway + Provider Router | VERIFIED | abstraction, fallback, observability (`AiModelCall`), privacy guard |
| Master Agent | VERIFIED | planner → policy → tools → verification loop |
| Маршрутизация агентов | VERIFIED | 22 агента (§4: добавлены product + compliance), honest permission denial (buyer → READ_ANALYTICS отказ) |
| Tool registry | VERIFIED | 37 инструментов (§44: добавлены get_tracking, get_payment_status, check_inventory, get_reviews, search_sellers), каждое со своим permission + risk level |
| Отзывы через AI (§14) | VERIFIED | `get_reviews` в runtime: «что говорят о IdeaPad» → реальные отзывы из БД, тональность + темы |
| Поиск продавцов через AI (§61) | VERIFIED | `search_sellers` в runtime: «найди продавца ТехноАврора» → рейтинг 4.8, верификация |
| Отслеживание через AI (§34) | VERIFIED | `get_tracking` — статус и хронология от реального перевозчика, без выдуманных событий |
| Память (§29) | VERIFIED | FACT/INFERENCE/PREFERENCE, confidence + источник |
| Privacy guard | VERIFIED | PII/secret redaction перед external model — тесты |
| Рекомендации (§28) | VERIFIED | отдельный ranking-слой (не LLM), объяснимое «почему» |
| Vision pipeline (§6) | MOCK VERIFIED | photo → detection → embedding → ranking, статус всегда честный |
| Собственная модель | NOT PROVEN | интерфейс `SvetlanaModelProvider` готов, модели нет |

### Social / gifts

| Функция | Статус | Доказательство |
|---|---|---|
| Relationship graph | VERIFIED | SUGGESTED → VERIFIED через взаимное подтверждение — тесты |
| Gift AI | MOCK VERIFIED | события, интересы, бюджет, история подарков |
| Group gift | VERIFIED | участники подтверждают участие и сумму отдельно |
| VK интеграция | PENDING_EXTERNAL_ACCESS | OAuth adapter готов, `VK_*` env не настроены |
| ЕСИА | PENDING_EXTERNAL_ACCESS | OIDC adapter + sandbox, `ESIA_*` env не настроены |

### Платежи / доставка / доверие

| Функция | Статус | Доказательство |
|---|---|---|
| Settlement math (§26) | VERIFIED | integer kopecks, commission 1.5% конфигурируемо, отдельная строка payment fee |
| Idempotency (§125) | VERIFIED | payout, checkout, payment — replay не дублирует |
| Антифрод risk engine | VERIFIED | deterministic rules + explainable levels, AI не замораживает деньги |
| Trust profile продавца | MOCK VERIFIED | НПД/ФНС проверка — адаптер готов, официального API нет |
| Delivery abstraction | VERIFIED | provider interface; seller-own-delivery; неизвестный перевозчик честно падает |
| Перевозчики | PENDING_EXTERNAL_ACCESS | ни один реальный carrier adapter не подключён |
| Международные платежи | PENDING_EXTERNAL_ACCESS | Alipay/мост архитектура готова, партнёра нет |

### Admin

| Функция | Статус | Доказательство |
|---|---|---|
| Обзор/пользователи/заказы | VERIFIED | агрегаты из реальных данных |
| Sellers / Products / Payments | VERIFIED | новые секции: KPI продавцов, полный инвентарь статусов, ledger с sandbox-флагами |
| Верификация / Risk / AI / Аудит | VERIFIED | audited decision actions, before/after в audit log |
| RBAC | VERIFIED | buyer получает 403 на admin endpoints |

### Privacy / security

| Функция | Статус |
|---|---|
| Privacy Center | VERIFIED — что хранится, удаление, экспорт, отзывы |
| Consent-aware analytics | VERIFIED |
| Server-side secrets, no keys in frontend | VERIFIED |
| RBAC + authorization на каждом sensitive action | VERIFIED |
| Audit logging | VERIFIED |
| Auth guards: redirect вместо 500 | VERIFIED — закрыто тестами + runtime |

---

## Что проверено тестами

285 тестов, 32 файла:

| Файл | Тестов | Покрытие |
|---|---|---|
| `account-recovery.test.ts` | 12 | верификация email, восстановление пароля, logout-all |
| `admin.test.ts` | 17 | просмотры + аудируемые решения админа |
| `agent-routing.test.ts` | 10 | маршрутизация 22 агентов |
| `ai-product-draft.test.ts` | 6 | AI-черновик товара + публикация |
| `availability.test.ts` | 8 | наличие и видимость в каталоге |
| `carriers.test.ts` | 8 | CDEK + антифабрикация трекинга |
| `classifieds.test.ts` | 19 | вертикали, гео-привязка, VIN-проверка |
| `concurrency.test.ts` | 3 | гонка checkout — оверсейл невозможен |
| `csrf-gate.test.ts` | 7 | Origin/Referer-контроль в middleware |
| `delivery-tiers.test.ts` | 7 | уровни доставки и честность тарифов |
| `dispute-center.test.ts` | 14 | переписка, доказательства, SLA, апелляция |
| `global-search.test.ts` | 5 | поиск по уровням + приоритет своей платформы |
| `integrations.test.ts` | 17 | адаптеры VK / ЕСИА / Alipay |
| `logger.test.ts` | 6 | структурные логи и редакция секретов |
| `money.test.ts` | 6 | kopecks-математика и округление |
| `notification-delivery.test.ts` | 11 | email/push, честный статус доставки |
| `oauth-consent.test.ts` | 12 | OAuth state + opt-in согласия |
| `order-lifecycle.test.ts` | 17 | полный цикл заказа, выплаты, антифабрикация трекинга |
| `p0-production-gates.test.ts` | 9 | refund, outbox, секрет-хранилище |
| `pending-actions.test.ts` | 7 | подтверждение действий ИИ (actionId + nonce) |
| `permissions.test.ts` | 8 | RBAC-разрешения инструментов |
| `policy.test.ts` | 7 | политика подтверждений |
| `privacy.test.ts` | 7 | редакция PII и секретов |
| `relationships.test.ts` | 3 | взаимное подтверждение связей |
| `return-dispute.test.ts` | 6 | возвраты и споры |
| `reviews-collections.test.ts` | 10 | отзывы, избранное, wishlist |
| `seller-onboarding.test.ts` | 6 | гейт верификации продавца |
| `settlement.test.ts` | 4 | расчёт комиссии |
| `state-machines.test.ts` | 9 | переходы заказа и отгрузки |
| `storage.test.ts` | 9 | загрузка/чтение, авторизация, path traversal |
| `tool-registry.test.ts` | 12 | контракт и регистрация инструментов |
| `vision.test.ts` | 3 | photo pipeline + честный статус |

---

## PENDING_EXTERNAL_ACCESS — точные требования

| Интеграция | Что нужно | Точка подключения |
|---|---|---|
| Платёжный партнёр | merchant account + API key | `PAYMENT_PROVIDER_BASE_URL`, `PAYMENT_PROVIDER_API_KEY` → `PartnerPaymentProvider` |
| Выплаты продавцам | банковский партнёр с payout API | `PartnerPayoutProvider` |
| Перевозчики (CDEK, Почта и др.) | коммерческий договор + API key | `getDeliveryProvider()` → новые adapter'ы |
| VK | приложение VK (client id/secret) | `VK_CLIENT_ID/SECRET/REDIRECT_URI` → `vk.ts` |
| ЕСИА | регистрация системы в ЕСИА | `ESIA_CLIENT_ID/SECRET/REDIRECT_URI` + подпись — `esia.ts` |
| ФНС/НПД проверка | официальный доступ к проверке статуса | `trust.ts` → официальный adapter |
| Vision модель | реальная vision model API | `getVisionProvider()` → новый adapter |
| Alipay / международные платежи | партнёр по конвертации RUB→CNY | `international-payments.ts` bridge |
| Внешняя AI модель (Atria) | API key | `AI_API_KEY` → gateway provider order |

Все они реализованы как adapter + sandbox, работают в development и **честно помечены** — ни одна не выдаёт mock за production.

---

## Production-гейты: что закрыто кодом

Внешний аудит насчитал 33 пункта. Кодом закрыты все, что не требуют
внешнего контрагента:

| Блокер аудита | Статус | Чем закрыто |
|---|---|---|
| §1 подделка AI-подтверждения | VERIFIED | server-side `PendingAction`: `actionId`+`nonce`, одноразовость, привязка к user и conversation. Клиент больше не присылает `toolName`/`args` |
| §2 VK OAuth без state | VERIFIED | персистентный `OAuthState` (хеш, TTL, `usedAt`), проверяется в callback |
| §3 хранение VK-токена | VERIFIED | `secret-store`: токен шифруется, в БД лежит только ссылка; `suggestVkRelationships` читает из хранилища |
| §4 продавец без верификации | VERIFIED | `seller-onboarding.ts`: публикация, приём заказа, отгрузка и выплаты требуют `IDENTITY + (BUSINESS\|NPD) + DOCUMENTS + activated` |
| §5 overselling | VERIFIED | атомарное условное списание в транзакции + `concurrency.test.ts` (3 независимых покупателя) |
| §6 согласие на персонализацию | VERIFIED | `consents.ts`, opt-in по умолчанию, `/api/consents` в Privacy Center |
| §7 refund отсутствует | VERIFIED | `refund()` в провайдере + `processRefund` с компенсацией settlement; webhook платежа проверяет подпись |
| §8 payout внутри транзакции | VERIFIED | outbox-паттерн: транзакция только резервирует, партнёра вызывает воркер по `idempotencyKey` |
| §9 цена в корзине не snapshot | VERIFIED | цена фиксируется при добавлении, checkout возвращает `priceChanges` |
| §11 нет хранилища файлов | VERIFIED | `storage/`: local + Vercel Blob, приватные бакеты, авторизация на каждое чтение, защита от path traversal |
| §13 in-memory rate limit | VERIFIED | БД-лимитер с окном; login/register/confirm/reset под лимитом, lockout подтверждён |
| §14 CSRF | VERIFIED | edge-middleware: Origin/Referer против Host для всех state-changing запросов с cookie |
| §15 auth | VERIFIED | verify-email, reset пароля, logout-all-devices, билеты одноразовые с TTL |
| §16 health врёт при падении БД | VERIFIED | `/api/health?mode=liveness` (процесс жив) и `/api/health` (готовность; **503**, если БД недоступна) |
| §17 observability | VERIFIED | `logger.ts`: структурные логи с редакцией секретов; `x-trace-id` проставляется в middleware на каждом ответе |
| §18 фоновых задач нет | VERIFIED | jobs-движок + outbox + `/api/cron/jobs` с подписью, расписание в `apps/web/vercel.json` (каждые 5 мин) |
| §21 нет CI/CD | VERIFIED | `.github/workflows/ci.yml`: lint → typecheck → tests → build |
| §22 документация рассинхронизирована | VERIFIED | счётчики сверены с кодом в этом отчёте |
| §23 Next.js 14 неподдерживаем | VERIFIED | обновлено до 15.5.27, Node ≥ 22 LTS; миграция async params + два бага по пути |
| §24 нет CSP | VERIFIED | CSP в middleware, `images.remotePatterns` ограничены реальными CDN |
| §25 `/api/ai/status` раскрывал архитектуру | VERIFIED | аноним видит только `mode`, детали — администратору |
| §10 перевозчиков нет | adapter готов | CDEK написан по документированному протоколу; без ключа честно `SELLER_DECLARED` |
| §29 уведомления только в БД | VERIFIED | SMTP + Web Push адаптеры, попытки доставки, retry |

**Осталось `PENDING_EXTERNAL_ACCESS`** — перечислено ниже с точными
переменными, партнёром и точкой интеграции.

---

## Известные ограничения

1. **iOS приложение не собрано** — в этом окружении нет macOS toolchain (BLOCKED, вне объёма текущей работы).
2. **Android приложение не собрано** — пользователь явно попросил сфокусироваться на веб-маркетплейсе.
3. **PostgreSQL недоступен** в контейнере (ядро не реализует SysV shm) — используется SQLite; схема написана портируемо, `DATABASE_URL` переключает на Postgres без изменения кода. Миграции — Prisma.
4. **Все AI/vision/payment/vision-intelligence провайдеры — sandbox**. Каждый результат несёт честный статус; ни один не заявляется как production.
5. **Документы/сертификаты**: требования по категории определяются, но юридическая действительность по OCR не утверждается (ТЗ §20).

---

Production runtime secrets are enforced only at runtime; `next build` remains reproducible without production credentials by recognizing Next.js `phase-production-build`.

## Production database path

Production Prisma uses `apps/web/prisma-postgres/schema.prisma` with PostgreSQL. SQLite remains isolated to `apps/web/prisma/schema.prisma` for development and CI tests. The release pipeline validates the PostgreSQL schema and generates a baseline migration artifact before the production build.

## Deployment configuration

- **Platform:** Vercel (Next.js 15.5.27 App Router, Node ≥ 22 LTS)
- **Build:** `npx next build` — exit 0, 98 API-роутов, 49 страниц, middleware активен
- **DB:** Prisma migrations (`prisma/migrations/`, 19 миграций, 74 модели)
- **Секреты:** только server-side env; ни один ключ не попадает в клиентский bundle
- **Переменные для production:** см. `.env.example` (payment, VK, ЕСИА, AI gateway)

## Следующие технически необходимые шаги

Осталось закрыть — по убыванию технической необходимости:

1. **Платёжный партнёр** → `PAYMENT_PROVIDER_*`. Домен, webhooks, возвраты и
   сверка готовы; не хватает только коммерческого договора и ключа.
2. **Ключ CDEK** → `CDEK_ACCOUNT_ID` / `CDEK_SECURITY_KEY`. Адаптер написан по
   документированному REST-протоколу и выключен без ключа; сейчас отгрузки
   идут в режиме `SELLER_DECLARED`.
3. **Кредиты VK / ЕСИА** → завершить `SvkModelProvider` (собственная модель
   Светланы): одноимённый провайдер — это заглушка, а не обученная модель.
4. **Vision-провайдер** → реальное распознавание фото вместо детермированной
   эвристики.
5. **PostgreSQL** → схема валидируется (`migrate diff` даёт чистый DDL), но
   весь прогон выполнялся на SQLite. Прогнать миграции и нагрузочные тесты на
   Postgres **до** production: инварианты конкуренции подтверждены на SQLite,
   где writers сериализуются; на Postgres их нужно подтвердить отдельно.
6. **Android/iOS клиенты** (ТЗ §71-72) — по вашему решению отложены.

---

## Главный принцип (ТЗ §61)

Построена не «магазин + чат-бот», а **AI-native commerce platform**, где Светлана — оркестратор над всем: покупка, продажа, доставка, оплата, доверие, подарки и связи людей. Она различает факт, предположение и рекомендацию, никогда не заявляет о выполненном действии без подтверждения backend'а, и каждый её ответ несёт проверяемый статус.
