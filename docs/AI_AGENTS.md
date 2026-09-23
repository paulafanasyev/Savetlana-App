# AI Architecture — Светлана

## Принцип

Для пользователя существует только **Светлана**. Название внешнего провайдера, модель, endpoint и API-ключ никогда не раскрываются клиенту (spec §2, §116).

## AI Gateway

`src/lib/ai/gateway.ts` — единая точка вызова модели. Маршрутизация, fallback, ретраи, observability.

```
AI Gateway
    ↓
Provider Router (AI_PROVIDER_ORDER)
    ↓
┌─────────────────┬──────────────┬──────────────┐
│ External Model  │ Svetlana Own │ Mock (тест)  │
└─────────────────┴──────────────┴──────────────┘
    ↓
Ответ + вердикт проверки
```

### Провайдеры

| Провайдер | Файл | Когда используется |
|-----------|------|-------------------|
| `external` | `providers/external.ts` | Есть `AI_GATEWAY_API_KEY` — production |
| `svetlana` | `providers/svetlana.ts` | Собственная модель (интерфейс готов, модели пока нет) |
| `mock` | `providers/mock.ts` | Нет ключа — детерминированные ответы, маркируются MOCK VERIFIED |

### Privacy guard (spec §83–§85)

`src/lib/ai/privacy.ts` — перед отправкой внешней модели запрос проходит:

```
Запрос → Data Classification → PII Detection → Secret Detection
       → Policy Engine → Minimization/Redaction → AI Provider
```

Обнаруживаются и редатируются: платёжные карты, Stripe-ключи (`sk_live_...`, `sk_test_...`), Bearer-токены, JWT, ключи `api_key=...`, email, паспорта, СНИЛС, ИНН.

Никогда не отправляется внешней модели больше данных, чем требует задача: для поиска товара не передаются платёжные реквизиты или полный профиль.

## Master Agent

`src/lib/ai/agents/master.ts` — цикл выполнения:

1. **Intent Detection** — определение намерения
2. **Planner** — разбиение сложной задачи на шаги
3. **Policy** — проверка разрешений и необходимости подтверждения
4. **Agent Router** — выбор субагента
5. **Tool call** — выполнение через Tool Registry
6. **Verification** — проверка реального результата
7. **Ответ** — человекочитаемое объяснение

### Confirmation gate

Чувствительные действия (spec §45, §147) требуют явного подтверждения пользователя. Master Agent ставит задачу на паузу, возвращает `pending confirmation`, и только после подтверждения выполняет tool. Тест: `tests/agent-routing.test.ts` (full confirmation flow).

### Zero hallucination policy

Светлана не говорит «я оплатила заказ», пока payment API реально не подтвердило оплату. Tool возвращает `verification`-вердикт, и ответ формируется из **фактического** состояния, а не из намерения.

## Agent Router

`src/lib/ai/agents/router.ts` — **детерминированная** маршрутизация (регулярки, не LLM). Это делает routing explainable, тестируемым и свободным от галлюцинаций при делегировании.

19 субагентов:

| Agent | Сторона | Назначение |
|-------|---------|-----------|
| `buyer` | buyer | Помощь покупателю |
| `seller` | seller | AI-сотрудник продавца |
| `search` | buyer | Семантический поиск |
| `vision` | buyer | Поиск по фотографии |
| `recommendation` | buyer | Персональные рекомендации |
| `gift` | buyer | Подарки |
| `relationship` | buyer | Связи |
| `order` | both | Заказы |
| `delivery` | buyer | Доставка |
| `payment` | buyer | Оплата |
| `risk` | both | Антифрод |
| `trust` | both | Верификация |
| `review` | both | Отзывы |
| `competitor` | seller | Конкуренты |
| `pricing` | seller | Цены |
| `analytics` | seller | Аналитика продаж |
| `document` | seller | Документы |
| `memory` | both | Память |
| `notification` | seller | Автоматизация |
| `support` | buyer | Поддержка |

Новые агенты добавляются в `RULES` + `AGENT_TOOLS` без изменения Master Agent (spec §4).

## Tool Registry

`src/lib/ai/tools/` — 31 инструмент. Каждый имеет:

- `permission` — какое разрешение требуется
- `riskLevel` — `READ` / `LOW_RISK_WRITE` / `HIGH_RISK_WRITE` / `FINANCIAL` / `ACCOUNT_SECURITY`
- `needsConfirmation` — требуется ли явное подтверждение
- `parameters` — JSON-схема
- `execute` — вызов доменного сервиса
- `verification` — как проверен результат

### Инструменты

**Каталог/поиск**: `search_products`, `search_cheaper`, `compare_products`, `get_product`, `price_history`

**Коммерция**: `cart_add`, `create_order`, `get_order`, `cancel_order`, `request_return`, `create_dispute`, `wishlist_add`

**Продавец**: `create_product_draft`, `publish_product`, `confirm_inventory`, `extend_listing`, `change_price`, `advise_price`, `analyze_seller_sales`, `product_health`, `find_competitors`, `document_requirements`, `create_workflow_rule`

**Социальное**: `plan_gift`, `upcoming_events`, `gift_context`, `declare_relationship`, `verified_circle`

**Память/риск**: `remember_preference`, `recall_memory`, `assess_order_risk`

### Разрешения (26)

`READ_PRODUCTS`, `READ_REVIEWS`, `READ_SELLERS`, `READ_ORDERS`, `READ_TRACKING`, `READ_PROFILE`, `READ_ANALYTICS`, `READ_RISK`, `CART_WRITE`, `WISHLIST_WRITE`, `CREATE_ORDER`, `CANCEL_ORDER`, `REQUEST_RETURN`, `CREATE_DISPUTE`, `CREATE_PRODUCT_DRAFT`, `EDIT_PRODUCT_DRAFT`, `PUBLISH_PRODUCT`, `CHANGE_PRICE`, `CONFIRM_INVENTORY`, `EXTEND_LISTING`, `WRITE_MEMORY`, `READ_MEMORY`, `REQUEST_PAYOUT`, `CREATE_SHIPMENT`, `GIFT_WRITE`, `RELATIONSHIP_WRITE`

Роли: buyer никогда не получит `PUBLISH_PRODUCT`, как бы он ни спросил. Тест: `tests/permissions.test.ts`.

### Самоинициализация

`registerAllTools()` вызывается автоматически при импорте `tools/index.ts` — регистрация не зависит от того, кто первым обратился к registry.

## Model routing (spec §52, §144)

`AI_PROVIDER_ORDER` задаёт порядок провайдеров. Простые задачи не обязаны использовать самую дорогую модель. Маршрутизация:

- Простой поиск → лёгкая модель/tool
- Сложное планирование → более сильная модель
- Vision → vision-модель
- Ranking → отдельный ranking-слой (не LLM)

## Vision pipeline (spec §6, §10)

`domains/vision.ts` + `POST /api/vision/search`:

```
photo upload (type allowlist + 10MB cap)
  → object detection
  → attribute + category mapping
  → visual embedding
  → vector search over cached product embeddings
  → ranking (exact / similar / related)
  → explainable candidates
```

**Статус распознавания всегда честный:**

| Статус | Значение |
|---|---|
| `VERIFIED` | реальная vision-модель распознала изображение |
| `MOCK_VERIFIED` | sandbox-провайдер; результата нет, это не настоящее распознавание |
| `NOT_PROVEN` | провайдер не смог обработать фото; пользователь перенаправляется на текстовый поиск |

Сейчас подключён только sandbox-провайдер, поэтому все результаты — `MOCK_VERIFIED`. Подключение реальной vision-моделью не требует изменения API или UI — достаточно добавить adapter в `getVisionProvider()`. Тест: `tests/vision.test.ts`.

Инструмент `vision_search` даёт Светлане тот же векторный слой из чата.

## Recommendation Engine (spec §28)

**Не LLM.** `domains/recommendations.ts` — отдельный ranking-слой:

```
candidate generation → ranking (signals) → safety/compliance → explanation
```

Сигналы: предпочтения, история покупок, просмотры, wishlist, атрибуты товара, продавец, цена, наличие, отзывы, доставка, контекст.

Каждая рекомендация несёт `reason` + `signals` — объяснимое «почему рекомендую».

## Обучение (spec §22, §31)

**Запрещено** отправлять в обучение: пароли, платёжные реквизиты, секреты, токены, персональные данные без правового основания, закрытые документы, приватные сообщения.

Стратегия: EXTERNAL AI + STRUCTURED MEMORY + RECOMMENDATION LEARNING + USER FEEDBACK. Агент не может менять собственные веса.

## Будущая собственная модель

`providers/svetlana.ts` реализует интерфейс `SvetlanaModelProvider` (`generate`, `stream`, `tool_call`, `structured_output`). Подключение обученной модели — новый adapter, без переписывания frontend и бизнес-логики (spec §21, §9).

Подготовлена evaluation suite: buyer tasks, seller tasks, tool calling, uncertainty, recovery, privacy, hallucinated execution, recommendation explanation (spec §53). Модель не считается готовой только потому, что inference запускается.
