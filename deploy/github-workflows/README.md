Перенесите эти файлы в `.github/workflows/` (GitHub → Add file → Create new file → имя `.github/workflows/deploy-vps.yml`, вставить содержимое). У бота нет права `workflow`, поэтому они лежат здесь.

- `deploy-vps.yml`: собирает образы в GHCR и выкатывает на VPS по SSH. Секреты: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`.
- `docker-smoke.yml`: в CI поднимает продакшен-стек (Postgres + миграции + приложение) и проверяет health, страницы, cron и создание админа.
