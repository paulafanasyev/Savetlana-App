# Платежи и расчёты

## Принцип (spec §25, §30)

Платформа **не является** платёжной организацией и не создаёт самодельных финансовых систем. Используется лицензированный платёжный партнёр.

```
BUYER → PAYMENT PROVIDER → ORDER SETTLEMENT → DELIVERY → CONFIRMATION/EXPIRATION → SELLER PAYOUT
```

Деньги покупателя проходят через платёжного партнёра, а не через arbitrary AI tool и не через «транзитный счёт платформы» в application database.

## Комиссия (spec §26, §32)

- `PLATFORM_FEE_PERCENT` = **1.5%** (configurable, не захардкожено — это бизнес-допущение, не политика)
- Комиссия платформы **не смешивается** с payment processing

Seller settlement statement:

```
Gross order
  − platform commission (1.5%)
  − payment fees
  − delivery
  − refunds/adjustments
  = Seller payout
```

Тест: `tests/settlement.test.ts` — проверяет, что payment fee идёт **отдельной** строкой (реальный исправленный баг: fee дропался из расчёта).

## Идемпотентность

`capturePayment` — повторный вызов с тем же ключом возвращает исходный результат, не списывая дважды.

## Текущий статус

| Компонент | Статус |
|-----------|--------|
| Settlement math | **VERIFIED** (тесты + runtime) |
| Payment state machine | **VERIFIED** |
| Реальный платёжный партнёр | **PENDING_EXTERNAL_ACCESS** |

При отсутствии `PAYMENT_PROVIDER_API_KEY` используется sandbox-режим, который **честно** маркирует каждый результат `sandbox: true`. Никаких fake success.

## API

| Метод | Путь | Назначение |
|-------|------|-----------|
| POST | `/api/checkout` | Создание заказа (с risk assessment) |
| POST | `/api/orders/[id]/pay` | Оплата |
| POST | `/api/orders/[id]/cancel` | Отмена |
| POST | `/api/orders/[id]/return` | Возврат |
| GET | `/api/seller/payouts` | Выплаты продавца |

## Антифрод в платежах

Risk Engine оценивает каждый заказ на checkout (см. [SECURITY.md](SECURITY.md)). Результат `LOW`/`MEDIUM`/`HIGH` показывается покупателю с объяснением.

## Международные платежи / Alipay (spec §36, §105)

`domains/international-payments.ts` — архитектурный модуль:

```
RUB CNY USD EUR → Payment/FX Partner → supported payment network
```

Alipay — отдельный provider adapter. **Не создаётся самодельный financial exchange.**

Статус: **PENDING_EXTERNAL_ACCESS** — нет реального merchant access. Adapter contract + sandbox реализованы, реальный RUB→Alipay exchange **не заявляется** как работающий.

Подробности: [INTEGRATIONS.md](INTEGRATIONS.md).

## Договорная модель (spec §31)

- Seller Agreement — продавец принимает условия
- Buyer Offer / Purchase Terms — покупатель принимает условия покупки
- Delivery Terms, Refund/Return Terms
- Consent — отдельно: персональные данные, социальные интеграции, маркетинг, AI personalization
