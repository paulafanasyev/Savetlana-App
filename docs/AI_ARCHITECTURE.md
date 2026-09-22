# AI-архитектура — Svetlana AI Commerce

Этот документ описывает реальную реализацию AI-слоя в `apps/web/src/lib/ai`.
Документация соответствует коду; любые изменения кода должны отражаться здесь.

## 1. Главный принцип

Пользователь всегда взаимодействует со **Светланой**. Внешний AI-провайдер —
это внутренний backend-ресурс: его название, endpoint, модель и ключи
никогда не попадают в frontend, APK, IPA, JS-бundle, логи или git-репозиторий.

```
Пользователь
   ↓
Светлана (Master Agent)
   ↓
Intent → Planner → Policy → Tool Registry → Субагент → Инструмент
   ↓
Проверка результата (VERIFIED / NOT_PROVEN)
   ↓
Светлана → Пользователь
```

## 2. Слои

| Слой | Файлы | Назначение |
|------|-------|------------|
| AI Gateway | `ai/gateway.ts`, `ai/privacy.ts`, `ai/observability.ts` | Единая точка вызова модели, privacy guard, трассировка |
| Провайдеры | `ai/providers/{external,mock,svetlana}.ts` | Адаптеры моделей |
| Master Agent | `ai/agents/master.ts` | Цикл «план → вызов → проверка → ответ» |
| Policy | `ai/agents/policy.ts` | Подтверждения, лимиты, risk-классы |
| Router | `ai/agents/router.ts` | Детерминированная маршрутизация на субагента |
| Инструменты | `ai/tools/*.ts` | Реальные действия над доменами |
| Память | `domains/memory.ts` | Session / preference / commerce / seller memory |

## 3. AI Gateway и провайдеры

`AiProvider` — единый интерфейс для всех моделей:

```ts
interface AiProvider {
  id: string;
  capabilities: { chat: boolean; vision: boolean; structured: boolean };
  chat(messages, opts): Promise<AiResponse>;
  complete(prompt, opts): Promise<AiResponse>;
  embed?(texts): Promise<number[][]>;
}
```

Подключённые провайдеры:

| Провайдер | Файл | Статус |
|-----------|------|--------|
| `mock` | `providers/mock.ts` | **VERIFIED** — детерминированный, работает без ключей; обеспечивает MOCK VERIFIED поведение всего pipeline |
| `external` | `providers/external.ts` | Реализован полностью; активируется только при наличии серверного ключа — **PENDING_EXTERNAL_ACCESS** до настройки секрета |
| `svetlana` | `providers/svetlana.ts` | Контракт собственной обученной модели (`generate`, `stream`, `tool_call`, `structured_output`). Заглушка до обучения — **NOT_PROVEN** |

Маршрутизация моделей (spec §52, §144): простой поиск → эффективная модель,
vision → vision-модель, ранжирование → ML/ranking слой (не LLM), сложное
планирование → более сильная модель. На уровне gateway это `modelHint`,
который провайдер интерпретирует.

### Privacy guard (spec §83–§85)

Перед каждым вызовом внешней модели запрос проходит:

```
User Request → Data Classification → PII Detection → Secret Detection
            → Policy Engine → Minimization/Redaction → AI Provider
```

`ai/privacy.ts` детектирует и маскирует:
- Платёжные реквизиты (номера карт, CVC, Stripe-ключи `sk_live_...`, `pk_...`)
- Bearer-токены и заголовки Authorization
- JWT и секреты
- Почты и телефоны

Каждый исходящий payload логируется (без секретов) в `AiModelCall` —
см. раздел Observability.

### Провайдер не видит всю базу

В контекст модели попадают **только данные конкретной задачи**. Для поиска
товара не передаются банковские данные, полный профиль, история всех покупок
или документы. Сборка контекста идёт в доменном слое, который отдаёт в gateway
уже минимизированный объект.

## 4. Master Agent (spec §3, §153)

Цикл работы `runAgent()`:

1. Загружает контекст диалога и память пользователя.
2. Маршрутизирует сообщение в субагента (`routeAgent`).
3. В цикле до `AGENT_LIMITS.maxSteps`:
   - запрашивает модель;
   - если модель просит вызвать инструмент — проходит Policy;
   - исполняет инструмент, проверяет результат;
   - возвращает результат в модель для следующего шага.
4. Формирует финальный ответ + `deriveVerification()`.

Лимиты (spec §145):

```ts
AGENT_LIMITS = { maxSteps: 8, maxToolCalls: 6, maxRetriesPerTool: 2, stepTimeoutMs: 45_000 }
```

Это защищает от бесконечных циклов, превышения бюджета и «залипания» на одном
инструменте.

### Verification (spec §58, §146, §148)

Каждый шаг получает один из статусов:
- `VERIFIED` — действие реально выполнено и подтверждено источником истины;
- `NOT_PROVEN` — код отработал, но результата проверить не удалось;
- `MOCK_VERIFIED` — выполнено в sandbox/mock окружении;
- `PENDING_EXTERNAL_ACCESS` — внешняя интеграция недоступна.

`deriveVerification()` сводит итог: если **хоть один** шаг не `VERIFIED`,
весь ответ помечается соответственно. Светлана **никогда** не говорит
«я оплатила заказ», пока платёжный провайдер реально не подтвердил оплату.

## 5. Policy и подтверждения (spec §45, §147)

`decide(toolRisk, confirmed)` относится к risk-классам:

| Класс | Пример инструмента | Требует подтверждения |
|-------|--------------------|-----------------------|
| `READ` | `search_products`, `get_product`, `recall_memory` | Нет |
| `LOW_RISK_WRITE` | `cart_add`, `wishlist_add`, `remember_preference` | Нет |
| `HIGH_RISK_WRITE` | `publish_product`, `change_price`, `extend_listing` | **Да** |
| `FINANCIAL` | `create_order`, `request_return` | **Да** |

При необходимости подтверждения Master Agent не выполняет действие, а
возвращает пользователю запрос на подтверждение с полным описанием.
После подтверждения (`/api/ai/confirm`) действие выполняется и проверяется.

`assertKnown(value, field)` — guard: если данных нет, генерируется
NOT_AVAILABLE, а не выдуманное значение (zero-hallucination policy, spec §148).

## 6. Router и субагенты (spec §4, §6)

Маршрутизация — **детерминированная** (регулярные выражения), а не LLM-вызов.
Это сделано осознанно: routing explainable, тестируемый и не подвержен
галлюцинациям при делегировании. Добавление нового агента = новое правило
в `RULES` + запись в `AGENT_TOOLS`, Master Agent не меняется.

Агенты (`AgentKey`): buyer, seller, search, vision, recommendation, gift,
relationship, order, delivery, payment, risk, trust, review, competitor,
pricing, analytics, document, memory, notification, support — 20 агентов.

Router различает сторону диалога (`buyer` | `seller`): одна и та же фраза
в кабинетах продавца и покупателя маршрутизируется по-разному, с кросс-сторон
fallback для buyer-интентов.

## 7. Tool Registry (spec §44)

Каждый инструмент имеет:
- `name`, `description`, JSON-схему аргументов;
- `permissions` — список необходимых разрешений;
- `riskLevel` — для Policy;
- `execute()` — вызов реального доменного сервиса;
- аудит-логирование каждого вызова (`logToolCall`).

Авторизация: `authorize(tool, user)` проверяет роль и разрешения пользователя.
AI **никогда** не получает неограниченный доступ к БД — только через инструменты
с явно прописанными разрешениями (spec §39).

Реализовано 31 инструентов в `ai/tools/`:

- **Каталог**: `search_products`, `search_cheaper`, `compare_products`, `get_product`, `price_history`
- **Buyer**: `cart_add`, `create_order`, `get_order`, `cancel_order`, `request_return`, `create_dispute`, `wishlist_add`
- **Seller**: `analyze_seller_sales`, `product_health`, `advise_price`, `change_price`, `confirm_inventory`, `extend_listing`, `create_product_draft`, `publish_product`, `find_competitors`, `document_requirements`, `create_workflow_rule`
- **Social/gift**: `plan_gift`, `upcoming_events`, `gift_context`, `declare_relationship`, `verified_circle`
- **Memory**: `remember_preference`, `recall_memory`
- **Risk**: `assess_order_risk`

## 8. Память (spec §10, §29)

Разделена на 4 категории, каждая с confidence и источником:
`FACT` / `INFERENCE` / `PREFERENCE` / `TEMPORARY_CONTEXT`.

Пользователь видит и управляет памятью через Privacy Center
(`/profile`, `/api/memory`). Каждая запись редактируема и удаляема.
CRM-секреты и приватные данные **не превращаются в веса модели** (spec §22).

## 9. Observability (spec §51, §87)

Каждый вызов модели и инструмента логируется в таблицу `AiModelCall`:

- `traceId` — сквозной идентификатор AI-сессии;
- `agent`, `tool`, `provider`, `model`;
- `latencyMs`, `tokensIn` / `tokensOut` (где доступно);
- `status`, `errorMessage`;
- результат verification.

В логи **не попадают** секреты и лишние sensitive-данные — privacy guard
маскирует их до отправки. Админ-панеля показывает эту телеметрию в разделе
`/admin/ai`.

## 10. Fallback и degraded mode (spec §88–§90)

```
Atria → Fallback provider → Own model → Safe degraded mode
```

Если AI полностью недоступен, площадка продолжает работать как обычный
маркетплейс: каталог, поиск, корзина, заказы, доставка, профиль (spec §89).
AI не является единственной точкой отказа.

Ошибка инструмента: detect → classify → retry (до `maxRetriesPerTool`) →
альтернативный инструмент/провайдер → verify → report. Бесконечных повторов
одного и того же неработающего вызова нет.

## 11. Собственная модель Светланы (spec §9, §21, §53)

Интерфейс `SvetlanaModelProvider` уже определён (`providers/svetlana.ts`):
`generate`, `stream`, `tool_call`, `structured_output`. Подключение обученной
модели = новый adapter + регистрация в gateway, **без изменения frontend
и бизнес-логики**.

Mutable business facts (цены, наличие, документы, статусы заказов) никогда
не зашиваются в веса — они приходят из БД, RAG и инструментов (spec §122,
§123). Источник истины для каждой категории данных определён явно:
Order → Order DB, Payment → Payment Provider, Shipment → Carrier,
Inventory → Inventory DB, Product → Product DB. AI source of truth не является.

### Evaluation suite (spec §53)

Тесты в `src/lib/ai/**/*.test.ts` и доменные тесты покрывают:
buyer tasks, seller tasks, tool calling, uncertainty, recovery, privacy,
hallucinated execution, recommendation explanation, routing, confirmation.

Переключение на собственную модель не происходит автоматически — только
после прохождения regression suite (spec §52).
