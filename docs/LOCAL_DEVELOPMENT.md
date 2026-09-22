# Локальная разработка

## Требования окружения

- Node 24+, npm 11+
- (Postgres недоступен в этом контейнере — используется SQLite)

## Установка

```bash
cd apps/web
cp .env.example .env
npm install
```

## База данных

```bash
npx prisma generate              # клиент
npx prisma migrate deploy        # применить миграции
npm run seed                     # демо-данные
```

Демо-данные: 19 пользователей, 17 товаров, 7 продавцов, категории, отзывы.

После сидинга доступны демо-аккаунты (см. `prisma/seed.ts`): buyer, seller, admin.

## Разработка

```bash
npm run dev                      # http://localhost:3000
```

Hot reload работает. AI по умолчанию идёт на MOCK provider (детерминированные ответы, промаркированные MOCK VERIFIED) — внешний ключ не нужен.

## Проверки

```bash
npm run typecheck                # tsc --noEmit
npm run test                     # Vitest, 121 тест
npm run build                    # production-сборка
```

## Типичные проблемы и решения

### `DATABASE_URL` из окружения контейнера

Контейнер может экспортировать `DATABASE_URL=file:./prisma/dev.db`, который перекрывает `.env`. `src/lib/env.ts` разрешает относительные SQLite-пути от `apps/web`, так что приложение работает независимо.

Prisma **CLI** разрешает относительные пути от папки схемы (`apps/web/prisma/`) — поэтому вложенные `prisma/prisma/dev.db` артефакты не должны создаваться. Если нашли — удалите.

### Тестовая БД повреждается

Каждый Vitest-воркер должен иметь свою БД (`test-<pid>.db`). Если видите `database disk image is malformed` — проверьте, что воркеры не делят один файл.

### Сервер не стартует (EADDRINUSE)

Предыдущий процесс занял порт. Найдите и остановите его по порту, не используйте `pkill` с текстом команды — можно убить собственный терминал.

### Сборка: «Couldn't find any pages or app directory»

Команда запущена не из `apps/web`. Проверьте CWD.

### Cookie не отправляется по HTTP

Production cookie помечена `Secure`. Для локального тестирования по HTTP извлекайте cookie из заголовка `Set-Cookie` вручную и передавайте явным `-H "Cookie: ..."`.

## Структура кода

```
src/lib/domains/     # бизнес-логика — изменения здесь
src/lib/ai/tools/    # AI вызывает домены через tools
src/lib/ai/agents/   # маршрутизация, planner, policy
src/app/api/         # HTTP-роуты — тонкие обёртки
src/app/             # страницы
```

**Важно**: бизнес-логика — только в `domains/`. API-роуты и tools её вызывают, но не дублируют.

## Добавление нового AI-инструмента

1. Реализуйте логику в `src/lib/domains/`
2. Добавьте tool в `src/lib/ai/tools/` с permission + riskLevel
3. Зарегистрируйте в `ALL_TOOLS` (tools/index.ts)
4. Добавьте permission в `ROLE_PERMISSIONS`
5. При необходимости — в `AGENT_TOOLS`
6. Напишите тест

## Добавление нового агента

1. Добавьте ключ в `AgentKey` (`agents/router.ts`)
2. Добавьте правило в `RULES`
3. Добавьте tools в `AGENT_TOOLS`

Master Agent менять не нужно (spec §4).

## Добавление миграции

```bash
npx prisma migrate dev --name <description>
```

Требует TTY. Если интерактивный prompt блокирует — миграцию можно написать вручную в `prisma/migrations/<timestamp>_<name>/migration.sql` и применить через `migrate deploy`.
