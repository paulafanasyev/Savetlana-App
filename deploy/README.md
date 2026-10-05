# Продакшен на российском VPS

Рекомендация: **Selectel VDS 2-2-40** (2 vCPU, 2 ГБ, 40 ГБ NVMe, IP и защита от DDoS включены) за **400 ₽/мес**. Минимум: VDS 1-2-25 за 250 ₽/мес. Альтернатива: Timeweb Cloud 2/4/50 за 1 080 ₽/мес.

Состав: `docker-compose.yml` (Postgres 16, миграции, приложение, Caddy с автоматическим HTTPS, cron фоновых задач, ночные бэкапы), `Caddyfile`, `install.sh` (Docker, swap, firewall, пользователь deploy, секреты), корневой `Dockerfile`.

## Шаги
1. Создать VDS на Ubuntu 24.04, направить A-запись домена на IP.
2. `curl -fsSL https://raw.githubusercontent.com/paulafanasyev/Savetlana-App/svetlana/initial-implementation/deploy/install.sh | sudo bash -s -- shop.example.ru you@mail.ru`
3. **Перенести** `deploy/github-workflows/*.yml` в `.github/workflows/` (у бота нет права создавать workflow-файлы).
4. Секреты репо: `VPS_HOST`, `VPS_USER=deploy`, `VPS_SSH_KEY`. Запустить workflow «Deploy to VPS».
5. Первый админ: `cd /opt/svetlana && docker compose run --rm migrate npx tsx scripts/create-admin.ts you@mail.ru "Имя"`.

Важно: на Selectel VDS закрыты почтовые порты, для писем используйте почтовый сервис по HTTP-API или попросите поддержку открыть SMTP.
