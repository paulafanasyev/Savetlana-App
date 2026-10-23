# Тестирование

## Запуск

```bash
cd apps/web
npm run test              # полный набор
npx vitest run            # одноразово
npx vitest run <file>     # конкретный файл
```

## Текущее состояние

**Последний подтверждённый прогон кода: PASS — commit `71c437d9e058254c5cfe27184f740a8be897bc37`.**

- [Release pipeline #956](https://github.com/paulafanasyev/Savetlana-App/actions/runs/39903038753): `Lint & Typecheck`, `Security scan`, `PostgreSQL schema`, `Production build`, `Tests (1)`, `Tests (2)` и `Release gate` завершились успешно.
- `Tests (1)`: 90 файлов, 463 теста пройдены. `Tests (2)`: 90 файлов, 509 тестов пройдены. Всего: **180 test files, 972 tests passed**.
- [Browser E2E check #217](https://github.com/paulafanasyev/Savetlana-App/actions/runs/39903055746): браузерный smoke-сценарий завершился успешно; артефакт [browser-check](https://github.com/paulafanasyev/Savetlana-App/actions/runs/39903055746) прикреплён к запуску.
- Этот CI подтверждает конкретный SHA выше. Любое последующее изменение кода требует проверки соответствующего нового commit.
- **Runtime preview B2B для этой ветки: PENDING.** GitHub сообщает, что ветка не развёрнута. Создание preview через Vercel не удалось из-за отсутствия авторизации на командный scope `xongphavietnam-8810`. Production не изменялся.

| Файл | Тестов | Что покрывает |
|------|--------|---------------|
| `admin.test.ts` | 14 | Admin decision actions, audit trail, RBAC |
| `agent-routing.test.ts` | ~11 | Master Agent, router, confirmation flow |
| `ai-product-draft.test.ts` | 5 | AI-создание черновика + публикация (§12) |
| `availability.test.ts` | 6 | Наличие, подтверждение, скрытие (§10) |
| `integrations.test.ts` | 17 | VK, ЕСИА, Alipay адаптеры |
| `money.test.ts` | 6 | Расчёты в копейках, форматирование |
| `order-lifecycle.test.ts` | 9 | Полный цикл заказа, идемпотентность, honest tracking |
| `permissions.test.ts` | 8 | Tool permissions, role boundaries |
| `policy.test.ts` | 7 | Confirmation gates, risk levels |
| `privacy.test.ts` | 7 | PII/secret detection, redaction |
| `relationships.test.ts` | 3 | Взаимное подтверждение связей |
| `return-dispute.test.ts` | 6 | Возвраты и споры (§29, §42) |
| `reviews-collections.test.ts` | 10 | Verified-purchase отзывы, избранное, wishlist |
| `settlement.test.ts` | 4 | Settlement math, payment fee как отдельная строка |
| `state-machines.test.ts` | ~8 | Order/shipment/verification переходы |

## Изоляция тестов

Каждый Vitest-воркер получает **свою** БД (`test-<pid>.db`) — параллельные прогоны не повреждают один файл (реальный исправленный баг: общий `test.db` corruption).

`tests/setup.ts` создаёт свежую схему и сбрасывает состояние.

## Что тестируется

- ✅ Unit: доменные функции
- ✅ Integration: домен → Prisma → БД
- ✅ API: роуты через apiRoute
- ✅ Database: реальные запросы
- ✅ Authentication: register/login/session
- ✅ Authorization: RBAC, permissions
- ✅ AI tool tests: каждый инструмент
- ✅ Agent routing: маршрутизация + fallback
- ✅ Recommendation tests: ranking + explanations
- ✅ Payment state-machine
- ✅ Delivery state-machine + honest tracking
- ✅ Relationship confirmation
- ✅ Privacy tests: redaction, minimization
- ✅ Build tests: `next build` (exit 0)

## Разделение mock и реальности (spec §47, §161)

Тесты **честно** помечают, что тестируют:

- **VERIFIED** — реальный путь UI → API → БД → результат
- **MOCK VERIFIED** — sandbox-провайдер, промаркирован

Тест, проходящий на mock, **не доказывает** работу реальной интеграции. Например, `integrations.test.ts` тестирует adapter contracts — но VK/ЕСИА/Alipay остаются PENDING_EXTERNAL_ACCESS.

## Что НЕ тестируется (честно)

- ❌ Реальные внешние API (VK, ЕСИА, Alipay, платёжный провайдер, перевозчики) — нет credentials
- ❌ Vision pipeline — нет vision-модели
- ❌ E2E browser (Playwright) — нет в окружении
- ❌ Mobile device tests — нет эмулятора
- ❌ Load tests

## Runtime verification

Следующий путь приводился в предыдущей версии документа как runtime-сценарий. Он не является частью текущего CI #956 и не заменяет live-проверку RFQ и сохранённого КП:

```
register → login → search → cart → checkout (risk LOW)
→ pay (sandbox, маркирован) → seller confirm → ship (свой tracking)
→ tracking (номер сохранён) → review
```

См. [DEPLOYMENT.md](DEPLOYMENT.md).
