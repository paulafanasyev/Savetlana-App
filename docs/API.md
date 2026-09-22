# API

58 эндпоинтов. Все API-роуты используют `apiRoute` (структурные ошибки, rate limiting, `force-dynamic`), JSON-контракты, и требуют auth там, где это имеет смысл.

## Аутентификация

| Метод | Путь | Назначение |
|-------|------|-----------|
| POST | `/api/auth/register` | Регистрация |
| POST | `/api/auth/login` | Логин (HMAC токен, `Secure` cookie) |
| POST | `/api/auth/logout` | Выход |
| GET | `/api/auth/me` | Текущий пользователь |

## Каталог и поиск

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET | `/api/catalog/search` | Hybrid search (keyword + vector + filters) |
| GET | `/api/catalog/products/[id]` | Карточка товара |
| GET | `/api/products/[id]/reviews` | Отзывы |
| GET | `/api/products/[id]/price-history` | История цены (spec §54) |
| GET | `/api/recommendations` | Персональные рекомендации |
| GET | `/api/sellers/[id]` | Публичный профиль продавца |

## Корзина и заказы

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET/POST | `/api/cart` / `/api/cart/items` | Корзина |
| DELETE | `/api/cart/items/[id]` | Удаление позиции |
| POST | `/api/checkout` | Чекаут (risk assessment, идемпотентный) |
| GET | `/api/orders` | Заказы покупателя |
| POST | `/api/orders/[id]/pay` | Оплата |
| POST | `/api/orders/[id]/cancel` | Отмена |
| POST | `/api/orders/[id]/return` | Возврат |
| POST | `/api/orders/[id]/dispute` | Спор |
| GET | `/api/orders/[id]/tracking` | Отслеживание доставки |

## Коллекции

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET/POST | `/api/favorites` | Избранное |
| GET/POST | `/api/wishlists` | Wishlist + items |

## Светлана (AI)

| Метод | Путь | Назначение |
|-------|------|-----------|
| POST | `/api/ai/chat` | Диалог со Светланой |
| POST | `/api/ai/confirm` | Подтверждение pending action |
| GET | `/api/ai/status` | Статус AI-провайдеров |

## Память и приватность

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET | `/api/memory` | Что Светлана помнит |
| DELETE | `/api/memory/[id]` | Удалить запись памяти |

## Связи и подарки

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET/POST | `/api/relationships` | Связи + объявление |
| POST | `/api/relationships/confirm` | Взаимное подтверждение |
| GET | `/api/gifts/events` | События подарков |
| GET | `/api/gifts/events/[id]/suggest` | AI-подбор подарка |
| POST | `/api/gifts/events/[id]/group` | Коллективный подарок |
| POST | `/api/gifts/group/[id]/contribute` | Участие (с подтверждением суммы) |
| POST | `/api/gifts/group/[id]/confirm` | Подтверждение участия |

## Интеграции

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET | `/api/integrations` | Статус подключений |
| POST | `/api/integrations/vk/connect` | VK OAuth start |
| GET | `/api/integrations/vk/callback` | VK callback |
| DELETE | `/api/integrations/vk` | Отвязать VK |
| POST | `/api/integrations/esia/connect` | ЕСИА OIDC start |
| GET | `/api/integrations/esia/callback` | ЕСИА callback |

## Продавец

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET/POST | `/api/seller/products` | Товары |
| POST | `/api/seller/products/draft` | AI-черновик (spec §12) |
| POST | `/api/seller/products/[id]/publish` | Публикация (requires confirmation) |
| POST | `/api/seller/products/[id]/confirm-availability` | Подтвердить наличие (spec §10) |
| GET | `/api/seller/orders` | Заказы продавца |
| POST | `/api/seller/orders/[id]/confirm` | Подтвердить заказ |
| POST | `/api/seller/orders/[id]/ship` | Создать отгрузку |
| POST | `/api/seller/disputes/[id]` | Ответить в споре |
| GET | `/api/seller/analytics` | AI-аналитика |
| GET | `/api/seller/competitors` | Конкуренты |
| GET | `/api/seller/pricing` | Ценовые рекомендации |
| GET/POST | `/api/seller/documents` | Документы |

## Уведомления

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET | `/api/notifications` | Центр уведомлений |
| POST | `/api/notifications/mark-read` | Отметить прочитанным |

## Админ

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET | `/api/admin/overview` | Сводка по платформе |
| GET | `/api/admin/users` | Пользователи |
| POST | `/api/admin/users/[id]/block` | Блокировка (audited) |
| POST | `/api/admin/users/[id]/unblock` | Разблокировка (audited) |
| GET | `/api/admin/orders` | Все заказы |
| GET | `/api/admin/verification` | Очередь верификации |
| POST | `/api/admin/verification/[id]` | Решение по верификации |
| GET | `/api/admin/risk` | Risk events |
| POST | `/api/admin/risk/[id]` | Review решения |
| GET | `/api/admin/ai` | AI monitoring |
| GET | `/api/admin/audit` | Audit log |

## Health

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET | `/api/health` | Health check + integration status |

## Контракты

- Запросы: JSON (HTML-формы для admin actions — роуты парсят form-data)
- Ответы: JSON, ошибки — `{ error, code }` на русском
- Auth: cookie `svetlana_session` (HMAC)
- Rate limiting: на auth, search, AI, uploads, payments
- Idempotency: `Idempotency-Key` header для критических операций

## API versioning

Роуты сгруппированы по домену. Production-версионирование рекомендуется через prefix (`/api/v2/...`) при breaking changes.
