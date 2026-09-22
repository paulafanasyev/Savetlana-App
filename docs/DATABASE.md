# База данных

## Стек

- **ORM**: Prisma
- **Разработка**: SQLite (`apps/web/prisma/dev.db`)
- **Production**: PostgreSQL (через `DATABASE_URL`)

SQLite выбран для разработки, так как контейнер не реализует SysV shared memory, необходимое Postgres. Схема написана переносимо: `Json`-поля хранятся как `String` с типизированным app-слоем, enum-ы как `String` + TS-типы.

## Разрешение пути

`src/lib/env.ts` разрешает относительные SQLite-пути от корня `apps/web`, независимо от CWD процесса или унаследованного `DATABASE_URL` из окружения контейнера. Абсолютные URL (Postgres) проходят без изменений.

## Модели (56)

**Пользователи**: `User`, `Session`, `Profile`, `Address`, `Consent`, `IntegrationLink`

**Продавцы**: `SellerProfile`, `Company`, `VerificationRecord`, `SellerDocument`

**Каталог**: `Category`, `Product`, `ProductVariant`, `ProductImage`, `ProductDocument`, `ProductEmbedding`

**Наличие/размещение**: `Inventory`, `Listing`, `ListingHistory`

**Корзина**: `Cart`, `CartItem`

**Заказы**: `OrderGroup`, `Order`, `OrderItem`, `OrderHistory`

**Платежи**: `Payment`, `Refund`, `Settlement`, `Payout`

**Доставка**: `DeliveryProvider`, `DeliveryShipment`, `DeliveryEvent`

**Контент**: `Review`, `Dispute`, `CompetitorListing`

**Коллекции**: `Favorite`, `Wishlist`, `WishlistItem`, `PriceAlert`

**Социальное**: `Relationship`, `RelationshipConfirmation`, `GiftEvent`, `GiftGroup`, `GiftContribution`

**AI**: `AiConversation`, `AiMessage`, `AiToolCall`, `AiModelCall`, `AiMemory`, `AiFeedback`, `Recommendation`

**Платформа**: `Event`, `RiskEvent`, `AuditLog`, `Notification`, `WorkflowRule`

## Enum-ы (26)

Канонические значения в `src/lib/db/enums.ts` — `OrderStatus_VALUES`, `ShipmentStatus_VALUES`, `VerificationStatus_VALUES` и т.д. Домены **обязаны** использовать эти константы, а не строковые литералы. Отклонение приводило к реальным багам (см. историю коммитов: `HANDED_TO_CARRIER` vs `HANDED_OVER`).

## Миграции

```bash
npx prisma migrate deploy     # применить
npx prisma migrate dev        # создать новую (требует TTY)
npm run seed                  # демо-данные
```

Существующие миграции:

1. `20260921071757_init` — базовая схема
2. `20260921074843_add_ai_observability` — `AiModelCall`
3. `20260921075331_add_product_embeddings` — векторный слой
4. `20260921080052_add_checkout_idempotency_and_cart_price` — идемпотентность
5. `20260921081000_delivery_honesty_fields` — honest tracking-поля

Любое изменение схемы — только через миграцию. Production-БД не меняется вручную (spec §138).

## История не удаляется

`ListingHistory` хранит все изменения карточки: создание, изменение цены/фото/описания/характеристик/наличия, публикация, скрытие, продление, архивирование (spec §11). `AuditLog` хранит все административные действия. Удаление истории требует явного действия.

## Векторный слой

`ProductEmbedding` — эмбеддинги товаров для семантического поиска. Вычисляются при создании/обновлении товара, используются в hybrid search (keyword + vector + structured filters).

## Тестовая БД

Каждый Vitest-ворк получает **свою** БД (`test-<pid>.db`) — параллельные прогоны не повреждают один файл. `tests/setup.ts` управляет жизненным циклом.
