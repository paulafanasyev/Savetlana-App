# Доставка

## Принцип (spec §23, §33, §36)

На первом этапе **нет собственных складов**. Товар находится у продавца.

```
Seller → self-fulfillment → carrier / courier / pickup point → Buyer
```

## Delivery Provider Abstraction

`domains/delivery.ts` — унифицированный интерфейс:

```typescript
interface DeliveryProvider {
  createShipment(params): Promise<Shipment>
  cancelShipment(trackingNumber): Promise<void>
  getTracking(trackingNumber): Promise<TrackingInfo>
  getStatus(trackingNumber): Promise<ShipmentStatus>
  getETA(trackingNumber): Promise<Date | null>
  calculatePrice(params): Promise<PriceQuote>
  getPickupPoints(address?): Promise<PickupPoint[]>
}
```

Адаптеры подключаются без изменения бизнес-логики. Поддерживается `SELLER_OWN_DELIVERY` (spec §35) — продавец указывает зону, стоимость, минимальную сумму заказа, сроки.

## Honest tracking (spec §49)

**Реальный исправленный баг**: sandbox-перевозчик перезаписывал настоящий трек-номер продавца fabricated-значением и фабриковал carrier events.

Теперь:
- Seller-provided tracking number **сохраняется**, а не перезаписывается
- Неизвестный перевозчик → **честный отказ**, а не молчаливый fallback на sandbox
- `syncTracking` не фабрикует события для seller-declared carriers

Тест: `tests/order-lifecycle.test.ts` (seller-declared carrier + sandbox carrier).

## State machine

```
CREATED → HANDED_OVER → IN_TRANSIT → DELIVERED
                     ↘ FAILED
                     ↘ RETURNED
```

Каждый переход журналируется в `DeliveryEvent`.

## Tracking

Единый объект: `shipment_id`, `carrier`, `tracking_number`, `status`, `events`, `estimated_delivery`, `proof_of_delivery`.

Светлана отвечает «где мой заказ?» на основе **реального** tracking API, а не выдуманного статуса.

## Мульти-seller заказы

Одна корзина с товарами разных продавцов разделяется на отдельные заказы с собственной доставкой и выплатами (spec §37).

## API

| Метод | Путь | Назначение |
|-------|------|-----------|
| POST | `/api/seller/orders/[id]/ship` | Seller создаёт отгрузку |
| GET | `/api/orders/[id]/tracking` | Buyer tracking screen |
| POST | `/api/seller/orders/[id]/confirm` | Seller подтверждает заказ |

## Статус

| Компонент | Статус |
|-----------|--------|
| Provider abstraction | **VERIFIED** |
| Sandbox carrier | **MOCK VERIFIED** |
| Seller own delivery | **VERIFIED** |
| Многоуровневые тарифы (3 уровня) | **VERIFIED** (логика) / уровень 1 VERIFIED, уровни 2–3 `PENDING_EXTERNAL_ACCESS` |
| Адаптер CDEK (заказ/отмена/трекинг/тариф) | **NOT PROVEN** — код реализован по документированному API v2, нет учётных данных |
| Остальные перевозчики (Boxberry, Почта России, 5Post, DPD, Ozon/WB Логистика, СберЛогистика, DHL, FedEx, UPS, Cainiao, PostNL, DPD Intl) | **PENDING_EXTERNAL_ACCESS** — тарифный вызов **не интегрирован** |

### Честность интеграции перевозчиков

`HttpCarrierAdapter` **никогда не вызывает выдуманный путь**. Раньше он обращался к
`/v1/tariff`, которого нет ни у одного перевозчика — это была бы фиктивная интеграция
(нарушение §49). Теперь:

- **CDEK** — единственный перевозчик с реально реализованным вызовом
  `POST /v2/selection`, возвращающим настоящую цену в рублях.
- **Все остальные** возвращают `kopecks: null` с честной причиной
  `API перевозчика не интегрирован (PENDING_EXTERNAL_ACCESS)`.

### Учётные данные CDEK

| Переменная | Назначение |
|------------|-----------|
| `CDEK_TOKEN` | Персональный OAuth-токен CDEK |
| `CDEK_ACCOUNT` + `CDEK_SECURE_KEY` | Альтернатива: пара аккаунт + секретный ключ |
| `CARRIER_TIMEOUT_MS` | Таймаут HTTP-вызовов к перевозчику (по умолчанию 15000) |

Без любой из этих пар адаптер отвечает `available: false`, и `createShipment`
**отказывается** создавать отправление вместо того, чтобы выдумать трек-номер.

### Поведение продавца с собственным перевозчиком

Если продавец отгружает через CDEK/Boxberry самостоятельно и приносит настоящий
трек-номер, платформа:
1. сохраняет номер **дословно** (никогда не подменяет sandbox-значением),
2. помечает отправление как `SELLER_DECLARED`,
3. **не фабрикует события трекинга** — таймлайн содержит только реально записанное.

Тест: `tests/carriers.test.ts`.

Будущее: `OUR_PICKUP_POINTS`, `OUR_WAREHOUSES`, `FULFILLMENT` — архитектура расширяема.
