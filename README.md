# Svetlana AI Commerce

AI-нативная платформа, где центральным интерфейсом пользователя является **Светлана** — Master AI Agent, координирующий специализированных субагентов, инструменты и доменные сервисы.

Пользователь никогда не видит название внешнего AI-провайдера, модель или внутреннюю архитектуру — только Светлану.

## Стек

| Слой | Технология |
|------|-----------|
| Frontend / API | Next.js 14.2 (App Router), React 18, TypeScript |
| База данных | SQLite (разработка) / PostgreSQL (production) через Prisma |
| AI Gateway | Собственная абстракция: Provider Router + адаптеры |
| Тесты | Vitest (285 тестов, 32 файла) |
| Деплой | Vercel-готово (server-side AI calls) |

## Быстрый старт

```bash
cd apps/web
cp .env.example .env          # только плейсхолдеры — реальных ключей нет
npm install
npx prisma migrate deploy     # применить миграции
npm run seed                  # русская демо-данные: 19 пользователей, 17 товаров, 7 продавцов
npm run dev                   # http://localhost:3000
```

Проверка сборки и тестов:

```bash
npm run build                 # production-сборка (23 страницы, 58 API-роутов)
npm run test                  # 285 тестов
```

## Структура монорепо

```
apps/web/
├── prisma/            schema.prisma (56 моделей), миграции, seed
├── src/app/           страницы (31) + API-роуты (58)
├── src/components/    переиспользуемые UI-компоненты
├── src/lib/
│   ├── ai/            gateway, privacy guard, providers, tools, agents
│   ├── domains/       27 доменных сервисов (бизнес-логика)
│   ├── db/            Prisma-клиент, канонические enum-значения
│   └── auth.ts        HMAC-токены, RBAC, сессионные хелперы
└── tests/             15 тестовых файлов
```

## Светлана — единый AI-интерфейс

Светлана не «чат-бот внутри магазина». Это оркестратор:

```
Пользователь → Светлана (Master Agent)
                 ↓
         Intent Detection → Planner → Policy
                 ↓
         Agent Router (19 субагентов, детерминированный)
                 ↓
         Tool Registry (31 инструмент, permissions + confirmation)
                 ↓
         Domain services / Prisma / external adapters
                 ↓
         Verification → ответ пользователю
```

Подробности: [docs/AI_AGENTS.md](docs/AI_AGENTS.md).

## Статусы проверок (spec §58)

Любая функция помечается одним из:

- **VERIFIED** — реально проверена в runtime
- **MOCK VERIFIED** — работает только на sandbox/mock, промаркировано
- **NOT PROVEN** — код существует, работа не доказана
- **PENDING_EXTERNAL_ACCESS** — требуется внешний ключ/партнёр
- **BLOCKED** — технический блокер

Текущее состояние внешних интеграций: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

## Главное правило

Платформа не «магазин с чат-ботом». Она помогает:

**ПОИСКАТЬ → ПОНЯТЬ → СРАВНИТЬ → ПРОВЕРИТЬ → ВЫБРАТЬ → КУПИТЬ → ОПЛАТИТЬ → ПОЛУЧИТЬ → ВЕРНУТЬ → ПОДАРИТЬ → ПРОДАТЬ → АНАЛИЗИРОВАТЬ**

## Документация

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — системная архитектура
- [AI_AGENTS.md](docs/AI_AGENTS.md) — Master Agent, субагенты, tools
- [DATABASE.md](docs/DATABASE.md) — схема, миграции
- [API.md](docs/API.md) — контракты эндпоинтов
- [SECURITY.md](docs/SECURITY.md) — секреты, RBAC, аудит
- [PAYMENTS.md](docs/PAYMENTS.md) — платёжная архитектура, комиссия
- [DELIVERY.md](docs/DELIVERY.md) — доставка, tracking
- [INTEGRATIONS.md](docs/INTEGRATIONS.md) — VK, ЕСИА, Alipay, статусы
- [PRIVACY.md](docs/PRIVACY.md) — конфиденциальность, consent
- [SELLER_GUIDE.md](docs/SELLER_GUIDE.md) — руководство продавца
- [BUYER_GUIDE.md](docs/BUYER_GUIDE.md) — руководство покупателя
- [TESTING.md](docs/TESTING.md) — тестовая матрица
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) — Vercel, окружения
- [LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) — локальная разработка
