# АИКО · Светлана

ИИ-маркетплейс, где агенты покупателя и продавца сами договариваются о цене, сроке и оплате, а люди только подтверждают решения. Центральный интерфейс — **Светлана**, собственная обученная модель и мастер-агент над 22 профильными агентами.

**Автор и разработчик:** Афанасьев Павел Петрович, технический директор (CTO), руководитель направления ИИ-разработок и внедрения АНО ЦПС «Мир Самозанятых» · xongphavietnam@gmail.com

| | |
|---|---|
| Сайт | https://savetlana-app-web.vercel.app |
| Торг агентов без входа | https://savetlana-app-web.vercel.app/b2b/negotiation |
| Книга проекта (RLT.Startup, A4 альбомная) | https://savetlana-app-web.vercel.app/checkpoint/aiko-book.html |
| Презентация | https://savetlana-app-web.vercel.app/checkpoint/aiko-deck.html |
| Функционал, безопасность, преимущества | https://savetlana-app-web.vercel.app/checkpoint/aiko-features.html |
| Подробное описание для чек-поинта | [docs/checkpoint-rlt/AIKO_checkpoint.md](docs/checkpoint-rlt/AIKO_checkpoint.md) |

## В цифрах

| | |
|---|---|
| ИИ-агенты | Мастер-агент «Светлана» и профильная маршрутизация; точное число доступных ролей определяется реестром |
| Инструменты агентов | Общий реестр инструментов с разрешениями и уровнями риска |
| Кабинеты | покупатель (35 разделов), продавец (20), площадка (16) |
| Данные | 74 модели, PostgreSQL (прод) / SQLite (тесты) через Prisma |
| Качество | 145 файлов автотестов, 8 проверок CI на каждый релиз |
| Торг агентов | 0 нарушений пределов в 3 000 случайных переговорах (автотест) |

## Стек

Next.js 15 (App Router), React, TypeScript, Prisma, Tailwind, Vitest, Playwright, Vercel. ИИ-ядро: AI Gateway с подключаемыми провайдерами и резервным детерминированным движком. Интерфейс собственного провайдера подготовлен, но наличие отдельно обученной production-модели в этом репозитории не подтверждено. Платежи: ЮKassa, Т-Банк, Сбер, Альфа; чеки 54-ФЗ; СДЭК; ФНС; DaData; Яндекс Маркет; Telegram.

## Статус B2B-переговоров для RLT.Startup

Инструмент `negotiate_quote` ищет активные предложения, применяет детерминированные правила покупателя и продавца и при успешном результате сохраняет КП для человеческого подтверждения. Публичная страница `/b2b/negotiation` также содержит локальный sandbox; sandbox сам по себе не доказывает работу каталога или сохранение КП. См. `docs/checkpoint-rlt/PROTOTYPE_EVIDENCE.md`.

## Как работает Светлана

```
Пользователь → Светлана (мастер-агент)
  → намерение → планировщик → политика безопасности
  → маршрутизатор (22 агента, детерминированно)
  → инструмент из белого списка (50, права + подтверждение)
  → серверная бизнес-логика → проверка результата → ответ
```

Модель понимает задачу, а цены, торг, скидки и проверки считает серверный код. Деньги и обязательства двигает только человек после явного подтверждения. Подробно: [docs/AI_AGENTS.md](docs/AI_AGENTS.md), [docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md).

## Безопасность сайта

- **Агенты:** белый список инструментов по ролям, подтверждение с хешем аргументов и одноразовым ключом, защита от инъекций, отпечаток КП (sha256), сверка оплаты с банком, антифрод (6 правил), анти-«Мамонт».
- **Данные:** ПДн вычищаются до модели, реквизиты зашифрованы AES-256-GCM, bcrypt, подписанные токены в httpOnly/Secure-cookie.
- **Веб:** CSP с запретом сторонних скриптов и отправки данных на чужие серверы; CSRF-проверка Origin/Referer; HSTS (preload); встраивание во фреймы только с собственного домена (защита от clickjacking); Cross-Origin-Opener-Policy, Origin-Agent-Cluster, строгий Permissions-Policy (нет доступа к USB, Bluetooth, датчикам), лимиты запросов.
- **Код:** CI из 8 проверок (линт, типы, тесты, схема БД, сборка, браузерная проверка, npm audit, Gitleaks), Dependabot.

Подробно: [docs/SECURITY.md](docs/SECURITY.md).

## Защита от копирования

- Программы, которые скачивают сайт целиком (HTTrack, Teleport, Offline Explorer, wget-зеркало, Scrapy и др.), получают отказ (`apps/web/src/lib/copy-guard.ts`).
- Сборщикам данных для обучения ИИ сайт закрыт в robots.txt; все страницы отдают `X-Robots-Tag: noarchive, noai, noimageai`, материалы чек-поинта ещё и `noindex`.
- Картинки, аватар Светланы и материалы чек-поинта нельзя вставить на чужой сайт (`Cross-Origin-Resource-Policy: same-origin`), а сам сайт нельзя встроить в чужой фрейм.
- На страницах к скопированному длинному тексту добавляется источник и авторство, картинки не сохраняются правой кнопкой и перетаскиванием (`apps/web/public/copy-guard.js`). Поля ввода и короткие фрагменты (номер заказа, трек) копируются как обычно.
- Код и материалы защищены проприетарной лицензией: [LICENSE](LICENSE).

## Быстрый старт

```bash
npm ci
cd apps/web
cp .env.example .env          # только плейсхолдеры, реальных ключей нет
npx prisma migrate deploy
npm run seed                  # демо-данные
npm run dev                   # http://localhost:3000
```

Проверка: `npm run build`, `npm run test`. Все изменения вливаются только при зелёном CI (8 проверок), ветка `svetlana/initial-implementation` автоматически деплоится на Vercel.

## Документация

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — системная архитектура
- [AI_AGENTS.md](docs/AI_AGENTS.md) — мастер-агент, субагенты, инструменты
- [SECURITY.md](docs/SECURITY.md) — секреты, RBAC, аудит
- [PAYMENTS.md](docs/PAYMENTS.md), [PAYMENTS_RU.md](docs/PAYMENTS_RU.md) — платежи и комиссия
- [DELIVERY.md](docs/DELIVERY.md) — доставка и трекинг
- [INTEGRATIONS.md](docs/INTEGRATIONS.md) — интеграции и статусы
- [SELLER_PLATFORM.md](docs/SELLER_PLATFORM.md), [SELLER_GUIDE.md](docs/SELLER_GUIDE.md), [BUYER_GUIDE.md](docs/BUYER_GUIDE.md)
- [DATABASE.md](docs/DATABASE.md), [API.md](docs/API.md), [TESTING.md](docs/TESTING.md), [DEPLOYMENT.md](docs/DEPLOYMENT.md), [LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md)

## Лицензия

© 2026 Афанасьев Павел Петрович. Все права защищены. Это не open source: просмотр для оценки разрешён, использование, копирование и обучение моделей на материалах — только с письменного разрешения. См. [LICENSE](LICENSE).
