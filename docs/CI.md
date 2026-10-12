# CI АИКО (Release pipeline)

Запускается на каждый push в `svetlana/*` и на PR в `main`.

| Проверка | Что делает |
|---|---|
| Lint & Typecheck | Prisma validate + `tsc --noEmit` |
| Tests (1), Tests (2) | vitest, две половины набора на SQLite |
| Security scan | `npm audit` (high/critical, без dev) + gitleaks |
| PostgreSQL schema | боевая схема, миграция, запрос к живому Postgres |
| Production build | `next build` + проверка, что ключи не попали в браузер |
| Release gate | зелёный, только если зелёно всё выше |

Репозиторий публичный (с 2026-10-13): минуты Actions бесплатны. Секреты только в
настройках деплоя (Vercel), в коде их нет — это проверяет gitleaks.
