# Развёртывание

## Vercel (spec §46)

Проект готов к деплою на Vercel.

**Безопасность**: server-side AI calls. Frontend получает только безопасные результаты backend. Никаких API-ключей в клиентском bundle.

Переменные, которые **никогда** не exposed:
- `AI_GATEWAY_API_KEY`
- `JWT_SECRET`
- `PAYMENT_PROVIDER_API_KEY`
- `VK_CLIENT_SECRET`
- `ЕСИА` secrets
- delivery secrets

## Настройка

1. Импортируйте репо в Vercel
2. Root directory: `apps/web`
3. Build command: `npm run build` (Vercel по умолчанию)
4. Environment variables (см. `.env.example`):

```env
DATABASE_URL=postgresql://...     # Postgres в production
JWT_SECRET=<strong-random>
AI_GATEWAY_BASE_URL=<server gateway>
AI_GATEWAY_API_KEY=<if available>  # иначе MOCK VERIFIED
AI_PROVIDER_ORDER=external,mock
PUBLIC_APP_URL=https://your-domain
PLATFORM_FEE_PERCENT=1.5
```

5. Deploy

## Smoke test после деплоя (spec §131)

```bash
curl https://your-domain/api/health     # 200
curl https://your-domain/               # главная рендерится
curl https://your-domain/catalog        # каталог
curl https://your-domain/svetlana       # AI-страница
```

Проверить: HTTP status, frontend rendering, API health, authentication, critical user flows, AI provider connectivity.

## Окружения (spec §134)

| Окружение | БД | Ключи | Домен |
|-----------|----|----|-------|
| development | SQLite | .env (плейсхолдеры) | localhost:3000 |
| staging | Postgres | staging secrets | staging.domain |
| production | Postgres | production secrets | domain |

Никаких хардкод-URL, ключей, commission или feature-конфигов (spec §135).

## Локальная разработка

См. [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).

## Android

Сборка APK доступна в окружении (JDK 17, Android SDK 36, Gradle 8.14.3, ARM64).

```bash
cd android
./gradlew assembleRelease
```

## iOS

**BLOCKED** — в текущем окружении нет macOS toolchain / Xcode. Код iOS-клиента работает с тем же backend, но сборка невозможна здесь.

## Ограничения окружения (честно)

- **Postgres недоступен** в контейнере: ядро не реализует SysV shared memory и нет `/dev/shm`. Используется SQLite (переносимая схема, `DATABASE_URL` переключает на Postgres в production).
- **Нет Docker**.
- **Нет macOS** → iOS build BLOCKED.
- **Внешние интеграции** — PENDING_EXTERNAL_ACCESS (см. [INTEGRATIONS.md](INTEGRATIONS.md)).

## CI/CD (spec §132)

Рекомендуемый pipeline:

```
Lint → Typecheck → Unit Tests → Integration Tests
→ Security → Build → E2E → Artifact → Deploy → Smoke Tests → Release Verification
```

Текущий локальный эквивалент:

```bash
npm run typecheck && npm run test && npm run build
```
