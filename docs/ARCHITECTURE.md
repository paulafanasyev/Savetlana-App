# Архитектура

## Принцип

AI — это **отдельный оркестрационный слой**, а не разрозненные запросы к LLM. Бизнес-логика живет в доменных сервисах, AI только вызывает её через инструменты с проверкой результатов.

```
Web (Next.js App Router)
        ↓
API Gateway (58 роутов, rate limiting, auth)
        ↓
Authentication (HMAC токены, RBAC: BUYER / SELLER / ADMIN)
        ↓
Доменные сервисы (27 модулей) — единственный источник бизнес-правил
   ├── catalog, cart, orders, payments, settlement
   ├── delivery, inventory, reviews, collections
   ├── recommendations, pricing, competitors
   ├── trust, risk, disputes, documents
   ├── gifts, relationships, memory, notifications
   └── audit, events, sellers, admin, vk, esia
        ↓
Prisma ORM → SQLite (dev) / PostgreSQL (prod)
        ↓
AI Orchestrator (вызывает домены через Tool Registry, не в обход)
```

## Разделение ответственности

| Слой | За что отвечает | Не делает |
|------|----------------|-----------|
| `src/app/api` | HTTP, валидация, auth, rate limit | бизнес-логики |
| `src/lib/domains` | бизнес-правила, транзакции, state machines | HTTP-обработки |
| `src/lib/ai/tools` | вызов доменов от имени AI, permissions | дублирования логики |
| `src/lib/ai/agents` | планирование, маршрутизация, verification | прямого доступа к БД |
| `src/lib/ai/gateway` | выбор провайдера, fallback, ретраи | знания о бизнесе |

## AI никогда не является source of truth

Mutable-факты (цены, наличие, статусы заказов) всегда читаются из БД через инструменты. AI не может вернуть выдуманную цену — инструмент `search_products` выбирает реальные строки из БД.

## State machines

Жизненные циклы реализованы как явные конечные автоматы с журналированием каждого перехода:

- **Order** (`orders.ts`): `CREATED → PAYMENT_PENDING → PAID → CONFIRMED → PROCESSING → HANDED_TO_CARRIER → DELIVERED → COMPLETED`, плюс `CANCELLED`, `RETURN_REQUESTED`, `RETURNING`, `REFUNDED`, `DISPUTED`
- **Shipment** (`delivery.ts`): `CREATED → HANDED_OVER → IN_TRANSIT → DELIVERED` / `FAILED` / `RETURNED`
- **Verification** (`trust.ts`): `UNVERIFIED → PENDING → VERIFIED` / `REJECTED` / `REVOKED`
- **Документы** (`documents.ts`): `UPLOADED → PROCESSING → VERIFIED` / `REJECTED` / `EXPIRED` / `PENDING_REVIEW`

Тесты: `tests/state-machines.test.ts`, `tests/order-lifecycle.test.ts`.

## Idempotency

Критические операции идемпотентны:

- `createOrdersFromCart` — проверка `idempotencyKey` **до** очистки корзины
- `capturePayment` — повторный вызов с тем же payment idempotency key возвращает исходный результат
- `createShipment` — одна отгрузка на заказ

Тест: `tests/order-lifecycle.test.ts` (checkout idempotency).

## Отказоустойчивость (spec §89)

AI не является единственной точкой отказа. При недоступности AI Gateway платформа работает как обычный маркетплейс: каталог, поиск, корзина, заказы, доставка, профиль остаются полностью функциональны.

## Observability

- Каждый AI-вызов логируется в `AiModelCall` (traceId, provider, токены, latency, статус)
- Каждое tool-выполнение — в `AiToolCall`
- Каждое чувствительное действие — в `AuditLog` (actor, action, old/new state)
- Тесты: `tests/admin.test.ts` проверяют audit trail

## Мульти-платформенность

Web, Android и iOS работают с **единым backend** и единой моделью данных. Бизнес-логика не дублируется на клиентах — весь commerce flow серверный.

- Android: готов к сборке (см. [docs/DEPLOYMENT.md](DEPLOYMENT.md))
- iOS: **BLOCKED** в текущем окружении (нет macOS toolchain)
