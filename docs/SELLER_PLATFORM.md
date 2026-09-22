# Платформа продавца — Svetlana AI Commerce

Документ описывает seller-контур платформы: кабинет, API, AI-функции и
процессы. Содержимое соответствует реальному коду в `apps/web/src`.

## 1. Регистрация и верификация (spec §19, §21)

Продавец — это пользователь с ролью `SELLER` и профилем `SellerProfile`.
Поддерживаются 4 категории (enum `SellerType`):

| Категория | Проверяемые данные |
|-----------|--------------------|
| `INDIVIDUAL` | Личные данные |
| `SELF_EMPLOYED` | ИНН + статус НПД |
| `IP` | ИНН + ОГРНИП + данные ЕГРИП |
| `COMPANY` | ИНН + ОГРН + данные ЕГРЮЛ |

Статусы верификации (enum `VerificationStatus`):
`UNVERIFIED` → `PENDING` → `VERIFIED` / `REJECTED` / `REVOKED`.

Проверка идёт через адаптеры:
- **НПД/ФНС** — реализован через официальный контур; без production-доступа
  работает sandbox, помеченный `PENDING_EXTERNAL_ACCESS`;
- **ЕСИА** — `domains/integrations/esia.ts`, официальный OIDC-протокол;
  без production-credentials — `PENDING_EXTERNAL_ACCESS`.

Верификация **не заявляется**, если API фактически не ответил `VERIFIED`.
Trust Profile (`domains/trust.ts`) агрегирует: verified identity, document
status, account age, order history, review history, fulfillment history,
dispute statistics.

## 2. Seller Cabinet

Страницы (`src/app/seller/`):

| Раздел | Страница | API |
|--------|----------|-----|
| Dashboard | `/seller` | — |
| Товары | `/seller/products` | `GET/POST /api/seller/products` |
| AI-создание товара | `/seller/products` (форма) | `POST /api/seller/products/draft` |
| Публикация | кнопка publish в таблице | `POST /api/seller/products/[id]/publish` |
| Подтверждение наличия | кнопка в таблице | `POST /api/seller/products/[id]/confirm-availability` |
| Заказы | `/seller/orders` | `GET /api/seller/orders` |
| Подтверждение заказа | кнопка в заказах | `POST /api/seller/orders/[id]/confirm` |
| Отгрузка | кнопка в заказах | `POST /api/seller/orders/[id]/ship` |
| Аналитика | `/seller/analytics` | `GET /api/seller/analytics` |
| Документы | `/seller/documents` | `GET/POST /api/seller/documents` |
| Споры | `/seller/disputes` | `GET /api/disputes`, `POST /api/seller/disputes/[id]` |
| Конкуренты и цены | `/seller/products` (PricingPanel) | `GET /api/seller/competitors`, `GET/POST /api/seller/pricing` |

**Важно (spec §112):** продавец может работать полностью вручную. AI —
ускоритель, а не обязательная зависимость. Каждое действие доступно
как прямая кнопка, без AI.

## 3. Таблица товаров (spec §9)

Колонки: фото, SKU, название, категория, цена, количество, наличие,
подтверждение продавца, срок продажи, auto-extension, статус, просмотры,
заказы, конверсия, рейтинг.

Действия: edit, hide, publish, confirm availability, extend sale,
change quantity, change price, duplicate, archive — реализованы как
inline-действия и expand-панель с AI-анализом цены.

## 4. Наличие товара (spec §10, §24)

Модель `Inventory` на каждый товар:

| Поле | Назначение |
|------|------------|
| `quantity` | Остаток |
| `confirmedBySeller` | Подтверждено ли наличие |
| `confirmedAt` | Когда подтверждено |
| `saleUntil` | Срок актуальности размещения |
| `autoExtend` | Автопродление при подтверждении |

Правила:
- Неподтверждённый товар **не обещается** покупателю как гарантированно
  доступный (availability падает до `UNKNOWN`);
- При истечении срока — предупреждение продавцу;
- Нулевой остаток — это по-прежнему жёсткий факт `OUT_OF_STOCK`
  (приоритет над неподтверждённостью);
- Вся история сохраняется в `listing_history`, удаление только явным
  действием.

Статусы availability (enum): `AVAILABLE`, `LIMITED`, `OUT_OF_STOCK`,
`PREORDER`, `MADE_TO_ORDER`, `UNKNOWN`.

## 5. История размещений (spec §11)

`ListingHistory` фиксирует: создание, изменение цены, изменение фото,
изменение описания, изменение характеристик, изменение наличия, публикацию,
скрытие, продление, архивирование. Все записи — audit trail с actor и
timestamp.

## 6. AI-функции продавца

### AI-создание карточки (spec §12)

Продавец загружает фото / описывает товар → `create_product_draft`:
название, категория, характеристики, описание, ключевые слова, SEO,
варианты, цвета, размеры, материал, комплектация, рекомендации по фото,
необходимые документы.

Черновик создаётся в статусе `DRAFT` (`PENDING_SELLER_APPROVAL` после
предпросмотра). **Публикация юридически значимых данных — только после
явного подтверждения продавца** (HIGH_RISK_WRITE).

### AI-аналитика продаж (spec §50, §27)

`analyze_seller_sales` строит отчёт по: продажи, трафик, конверсия, цена,
наличие, отзывы, конкуренты, доставка — и формирует список возможных причин
на основе данных, а не догадок.

### Product Health (spec §51)

`product_health` — технический отчёт карточки: качество фото, полнота
характеристик, читаемость описания, поисковая пригодность, наличие, цена,
отзывы, доставка, документы. Показывает «что исправить», без скрытого
«магического» рейтинга.

### Pricing Intelligence (spec §19, §54)

`advise_price` анализирует цену конкурентов, спрос, остаток, историю цены,
сезонность, доставку, комиссии — и отвечает фактом:
«При текущей цене товар выше большинства сопоставимых предложений».

`change_price` — **только после подтверждения продавца** (существенное
коммерческое действие). `price_history` показывает текущую/предыдущую цену
и изменение — без создания ложного ощущения скидки.

### Competitor AI (spec §13)

`find_competitors` — по публичным данным и собственному каталогу: цена,
фотографии, характеристики, отзывы, рейтинг, наличие, позиционирование,
доставка. **Закрытые данные чужих кабинетов не используются.**

### Документы и сертификаты (spec §20)

`document_requirements` — какие документы нужны для категории.
Статусы документов: `UPLOADED`, `PROCESSING`, `VERIFIED`, `REJECTED`,
`EXPIRED`, `PENDING_REVIEW`.

**Юридическая действительность документа не утверждается только на основании
OCR** — требуется верификация администратором или официальным источником.

### Бизнес-память (spec §158)

«Запомни, что этот товар я продаю только под заказ» → `remember_preference`
сохраняет это как структурированную бизнес-настройку продавца.

### Автоматизация (spec §113–§114)

`create_workflow_rule` — правило из естественного языка:
«Если цена конкурентов станет ниже нашей — сообщай мне»
→ структурированное правило + напоминание.

## 7. Заказы и выполнение (spec §29)

Order state machine: `CREATED` → `PAYMENT_PENDING` → `PAID` → `CONFIRMED`
→ `PROCESSING` → `READY` → `HANDED_TO_CARRIER` → `IN_TRANSIT`
→ `DELIVERED` → `COMPLETED`. Возвраты: `RETURN_REQUESTED` → `RETURNING`
→ `REFUNDED`. Спор: `DISPUTED`.

Каждый переход журналируется в `OrderHistory` с reason и actor.
Нелегальные переходы отклоняются (spec §124).

### Подтверждение и отгрузка

1. Заказ `PAID` → появляется в `/seller/orders`;
2. Продавец подтверждает (`confirm`) → `CONFIRMED`;
3. Продавец отгружает (`ship`) → указывает своего перевозчика и
   **свой реальный трек-номер**;

**Важно (spec §35, §49):** если продавец указал своего перевозчика и
трек-номер, они **сохраняются как есть** — sandbox никогда не подменяет
реальный трек fabricated-значением. Неизвестный перевозчик честно
отклоняется, а не молча становится «sandbox».

## 8. Выплаты и комиссия (spec §26)

Комиссия платформы — **конфигурируемый параметр** (`platform_fee_percent`),
бизнес-допущение 1.5%. Не зашито в код.

Seller settlement statement:
```
Gross order
  − platform commission
  − payment fees
  − delivery
  − refunds/adjustments
  = Seller payout
```

Платформенная комиссия **не смешивается** с платёжной себестоимостью — это
отдельные строки. Поддержаны консолидированные выплаты (`Payout`).

Подробнее — в [PAYMENTS.md](PAYMENTS.md).

## 9. Доставка (spec §33, §35)

Продавец может использовать собственную доставку (`SELLER_OWN_DELIVERY`):
зона, стоимость, минимальная сумма заказа, сроки, часы, ограничения.

Единый интерфейс `DeliveryProvider`:
`createShipment`, `cancelShipment`, `getTracking`, `getStatus`, `getETA`,
`calculatePrice`, `getPickupPoints`.

Подробнее — в [DELIVERY.md](DELIVERY.md).

## 10. Споры (spec §42)

Seller видит споры по своим заказам, может ответить и эскалировать.
Светлана собирает доказательства (timeline, статусы, трекинг), но
**окончательный вердикт по юридически значимому спору выносит человек**
или уполномоченная сторона.

## 11. Интеграции

| Интеграция | Статус |
|------------|--------|
| Платёжный провайдер | adapter + sandbox — `MOCK VERIFIED`, production `PENDING_EXTERNAL_ACCESS` |
| ЕСИА (идентификация) | OIDC adapter — `PENDING_EXTERNAL_ACCESS` |
| НПД/ФНС (проверка продавца) | adapter — `PENDING_EXTERNAL_ACCESS` |
| Перевозчики (CDEK и др.) | adapter + sandbox carrier |
| VK | OAuth adapter — `PENDING_EXTERNAL_ACCESS` |
| Alipay / международные платежи | adapter — `PENDING_EXTERNAL_ACCESS` |

Подробнее — в [INTEGRATIONS.md](INTEGRATIONS.md).
