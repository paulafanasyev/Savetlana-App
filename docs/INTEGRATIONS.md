# Интеграции

## Статус-реестр

`src/lib/env.ts` экспортирует `integrationStatus` — каждый интегратор **готов** только при наличии credentials. Иначе — `PENDING_EXTERNAL_ACCESS`, и это никогда не скрывается.

| Интеграция | Статус | Что требуется |
|------------|--------|---------------|
| External AI | PENDING_EXTERNAL_ACCESS (sandbox) | `AI_GATEWAY_API_KEY` |
| Payment provider | PENDING_EXTERNAL_ACCESS | `PAYMENT_PROVIDER_API_KEY` |
| Delivery carriers | PENDING_EXTERNAL_ACCESS | `DELIVERY_PROVIDER_API_KEY` |
| VK | PENDING_EXTERNAL_ACCESS | `VK_APP_ID` + `VK_CLIENT_SECRET` |
| ЕСИА | PENDING_EXTERNAL_ACCESS | `ESIA_CLIENT_ID` + `ESIA_CLIENT_SECRET` + `ESIA_REDIRECT_URI` |
| Alipay | PENDING_EXTERNAL_ACCESS | `ALIPAY_MERCHANT_ID` + `ALIPAY_PRIVATE_KEY` |
| International FX bridge | PENDING_EXTERNAL_ACCESS | `INTERNATIONAL_BRIDGE_*` |
| Собственная модель Светланы | NOT PROVEN | Обученная модель + adapter |

## Классификация (spec §47, §58)

- **VERIFIED** — реально проверено
- **MOCK VERIFIED** — sandbox, промаркировано
- **NOT PROVEN** — код есть, работы не доказано
- **PENDING_EXTERNAL_ACCESS** — нужен внешний доступ
- **BLOCKED** — технический блокер

## VK (spec §17, §19)

`domains/vk.ts` — официальный OAuth adapter.

Поддерживает: регистрацию/логин через VK, привязку аккаунта, разрешённые социальные данные, suggestions социальных связей в допустимых пределах, приглашение подтвердить связь.

**Не используется** как скрытый источник персональных данных. Нет скрытого наблюдения. Собираются только данные, нужные для заявленной функции.

Credentials — server-side only. Учитываются token expiration и revocation.

Реализовано: adapter contract + sandbox. Production — PENDING_EXTERNAL_ACCESS.

API: `/api/integrations/vk` (connect, callback, unlink, suggestions).

## ЕСИА / Госуслуги (spec §18)

`domains/esia.ts` — официальный OIDC adapter.

```
VK ID → ACCOUNT
ЕСИА → VERIFIED IDENTITY
```

Статусы: `UNVERIFIED` → `PENDING` → `VERIFIED` / `REVOKED`.

Используется **только** официально доступные протоколы. Хранится минимум данных. Не делается фиктивная проверка.

Adapter подключён к `domains/trust.ts` — верификация продавца идёт через живой адаптер, когда есть credentials; иначе честный sandbox.

API: `/api/integrations/esia` (connect, callback).

## Alipay / международные платежи (spec §36, §105)

`domains/international-payments.ts`:

```
CurrencyService → PaymentBridge → ExternalWalletProvider
```

Alipay — отдельный provider adapter. **Не создаётся самодельный financial exchange.**

Реальный RUB→Alipay exchange **не заявляется** как работающий до реального интеграционного теста. Статус: PENDING_EXTERNAL_ACCESS.

## Собственная модель (spec §9, §21, §53)

`providers/svetlana.ts` реализует `SvetlanaModelProvider`:
- `generate`
- `stream`
- `tool_call`
- `structured_output`

Подключение обученной модели — новый adapter, без переписывания frontend и бизнес-логики.

Подготовлена evaluation suite: buyer tasks, seller tasks, tool calling, uncertainty, recovery, privacy, hallucinated execution, recommendation explanation.

**Не делается** автоматический переход на собственную модель только потому, что она существует.

## Feature flags (spec §94)

Все крупные функции — за флагами:

`FEATURE_AI_SEARCH`, `FEATURE_PHOTO_SEARCH`, `FEATURE_GIFT_AI`, `FEATURE_VK_LOGIN`, `FEATURE_ESIA_VERIFICATION`, `FEATURE_SELLER_AI`, `FEATURE_PRICE_ALERTS`, `FEATURE_COLLECTIVE_GIFTS`, `FEATURE_INTERNATIONAL_PAYMENTS`.

## Изоляция окружений (spec §134)

`development` / `staging` / `production` — разные БД, API-ключи, OAuth credentials, домены.
