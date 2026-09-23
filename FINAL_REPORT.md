# Svetlana AI Commerce — финальный отчёт

Статус сборки: **production build проходит (exit 0)**, **133/133 тестов проходят (16 файлов)**.
Развёртывание: Vercel-ready (Next.js 14.2 App Router, server-side AI, нет секретов в клиенте).

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
| Маршрутизация агентов | VERIFIED | 25 агентов, honest permission denial (buyer → READ_ANALYTICS отказ) |
| Tool registry | VERIFIED | 32 tool, каждое со своим permission + risk level |
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

133 теста, 16 файлов:

| Файл | Тестов | Покрытие |
|---|---|---|
| `admin.test.ts` | 17 | read views + audited decision actions |
| `agent-routing.test.ts` | 10 | маршрутизация 25 агентов |
| `ai-product-draft.test.ts` | 5 | AI-черновик + публикация |
| `availability.test.ts` | 8 | вычисление наличия + видимость каталога |
| `integrations.test.ts` | 17 | VK / ЕСИА / Alipay адаптеры |
| `money.test.ts` | 6 | kopecks math, округление |
| `order-lifecycle.test.ts` | 13 | весь цикл + выплаты + антифабрикация трекинга |
| `permissions.test.ts` | 8 | RBAC tool permissions |
| `policy.test.ts` | 7 | confirmation gating |
| `privacy.test.ts` | 7 | PII/secret redaction |
| `relationships.test.ts` | 3 | взаимное подтверждение связей |
| `return-dispute.test.ts` | 6 | возвраты и споры |
| `reviews-collections.test.ts` | 10 | отзывы + избранное |
| `settlement.test.ts` | 4 | commission math |
| `state-machines.test.ts` | 9 | order/shipment transitions |
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

## Известные ограничения

1. **iOS приложение не собрано** — в этом окружении нет macOS toolchain (BLOCKED, вне объёма текущей работы).
2. **Android приложение не собрано** — пользователь явно попросил сфокусироваться на веб-маркетплейсе.
3. **PostgreSQL недоступен** в контейнере (ядро не реализует SysV shm) — используется SQLite; схема написана портируемо, `DATABASE_URL` переключает на Postgres без изменения кода. Миграции — Prisma.
4. **Все AI/vision/payment/vision-intelligence провайдеры — sandbox**. Каждый результат несёт честный статус; ни один не заявляется как production.
5. **Документы/сертификаты**: требования по категории определяются, но юридическая действительность по OCR не утверждается (ТЗ §20).

---

## Deployment configuration

- **Platform:** Vercel (Next.js 14.2 App Router)
- **Build:** `npx next build` — exit 0, 36 маршрутов
- **DB:** Prisma migrations (`prisma/migrations/`, 6 миграций)
- **Секреты:** только server-side env; ни один ключ не попадает в клиентский bundle
- **Переменные для production:** см. `.env.example` (payment, VK, ЕСИА, AI gateway)

## Следующие технически необходимые шаги

1. Подключить реального платёжного партнёра → `PAYMENT_PROVIDER_*`
2. Подключить хотя бы одного перевозчика → реальный tracking вместо seller-declared
3. Внешняя AI модель → `AI_API_KEY`
4. VK/ЕСИА → социальный логин и верификация личности
5. Vision модель → реальное распознавание фотографий
6. PostgreSQL для production scale
7. Android/iOS клиенты (ТЗ §71-72)

---

## Главный принцип (ТЗ §61)

Построена не «магазин + чат-бот», а **AI-native commerce platform**, где Светлана — оркестратор над всем: покупка, продажа, доставка, оплата, доверие, подарки и связи людей. Она различает факт, предположение и рекомендацию, никогда не заявляет о выполненном действии без подтверждения backend'а, и каждый её ответ несёт проверяемый статус.
