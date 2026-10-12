# АИКО на Vercel (временно, до своего домена)

## Один раз

1. vercel.com → Add New → Project → Import `paulafanasyev/Savetlana-App`.
2. **Root Directory:** `apps/web`. **Production Branch:** `svetlana/initial-implementation` (Settings → Git).
3. Storage → Create Database → **Neon (Postgres)** → Connect to project. `DATABASE_URL` появится сам.
4. Settings → Environment Variables (каждое значение: `openssl rand -hex 32`, все разные):
   - `JWT_SECRET`
   - `PENDING_ACTION_KEY`
   - `OAUTH_STATE_KEY`
   - `CRON_SECRET`
5. Deploy.

Без этих пяти переменных сайт в production не запустится (так задумано, `src/lib/env.ts`).
`PUBLIC_APP_URL` не нужен, пока нет своего домена: берётся адрес Vercel.

## Что происходит при каждом деплое

Vercel запускает `vercel-build`: Prisma-клиент для Postgres → `prisma migrate deploy` (таблицы создаются и обновляются сами) → `next build`.
CI по-прежнему запускает обычный `build` без миграций.

## Фоновые задачи

На бесплатном тарифе Vercel (Hobby) cron разрешён только раз в сутки, при частом расписании деплой отклоняется.
Поэтому `/api/cron/jobs` идёт в 03:00 UTC (10:00 по Сайгону): сверка платежей, автоотмена неоплаченных заказов.
На VPS вернём каждые 5 минут. Пока нет настоящих оплат, этого хватает.

## Проверка после деплоя

```
https://<адрес>.vercel.app/api/health
https://<адрес>.vercel.app/
https://<адрес>.vercel.app/catalog
https://<адрес>.vercel.app/legal/offer
```
