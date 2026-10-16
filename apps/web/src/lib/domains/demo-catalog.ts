/**
 * Демо-каталог: включается администратором одной кнопкой, чтобы площадку и
 * Светлану можно было проверить на живых товарах. Всё помечено как демо
 * (продавцы «Демо-магазин …», артикулы DEMO-…) и убирается второй кнопкой.
 * Вместе с ним грузятся демо-оптовики B2B с правилами торга (demo-b2b.ts).
 *
 * Демо-аккаунты получают случайный пароль, который нигде не хранится: войти
 * под ними нельзя, репозиторий публичный.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../prisma";
import { hashPassword } from "../auth";
import { B2B_CATEGORIES, B2B_POLICIES, B2B_PRODUCTS, B2B_SELLERS } from "./demo-b2b";
import { saveSellerNegotiationPolicy } from "./negotiation-policy";

export const DEMO_SKU_PREFIX = "DEMO-";
const DEMO_EMAIL_DOMAIN = "demo.svetlana.local";
const DEMO_NOTE = "Демонстрационный товар: так будет выглядеть карточка на площадке.";

export type DemoSeller = {
  slug: string;
  name: string;
  description: string;
  sellerType: "IP" | "COMPANY" | "SELF_EMPLOYED";
  /** Условные реквизиты (только у демо-оптовиков). */
  inn?: string;
  ogrn?: string;
};

export type DemoProduct = {
  sku: string;
  seller: string;
  category: string;
  title: string;
  description: string;
  price: number;
  oldPrice?: number;
  image: string;
  quantity: number;
  rating: number;
  attributes: Record<string, string>;
  keywords: string[];
  reviews?: { rating: number; body: string }[];
};

const CATEGORIES: { slug: string; name: string; parent?: string }[] = [
  { slug: "electronics", name: "Электроника" },
  { slug: "laptops", name: "Ноутбуки", parent: "electronics" },
  { slug: "phones", name: "Смартфоны", parent: "electronics" },
  { slug: "audio", name: "Аудио и наушники", parent: "electronics" },
  { slug: "e-accessories", name: "Аксессуары", parent: "electronics" },
  { slug: "home", name: "Для дома" },
  { slug: "kitchen", name: "Кухня", parent: "home" },
  { slug: "decor", name: "Декор", parent: "home" },
  { slug: "textile", name: "Текстиль", parent: "home" },
  { slug: "fashion", name: "Одежда и обувь" },
  { slug: "shoes", name: "Обувь", parent: "fashion" },
  { slug: "mens", name: "Мужская одежда", parent: "fashion" },
  { slug: "womens", name: "Женская одежда", parent: "fashion" },
  { slug: "kids", name: "Детям", parent: "fashion" },
  { slug: "tools", name: "Инструменты" },
  { slug: "hand-tools", name: "Ручной инструмент", parent: "tools" },
  { slug: "power-tools", name: "Электроинструмент", parent: "tools" },
  { slug: "services", name: "Услуги" },
  { slug: "design", name: "Дизайн", parent: "services" },
  { slug: "repair", name: "Ремонт и отделка", parent: "services" },
];

const SELLERS: DemoSeller[] = [
  { slug: "demo-tech", name: "Демо-магазин ТехноДом", description: "Демо: ноутбуки, смартфоны и аксессуары.", sellerType: "COMPANY" },
  { slug: "demo-sport", name: "Демо-магазин СпортШаг", description: "Демо: кроссовки и спортивная обувь.", sellerType: "IP" },
  { slug: "demo-home", name: "Демо-магазин Уютный дом", description: "Демо: товары для дома, кухни и декор.", sellerType: "SELF_EMPLOYED" },
  { slug: "demo-style", name: "Демо-магазин СтильЛаб", description: "Демо: одежда и детские товары.", sellerType: "IP" },
  { slug: "demo-master", name: "Демо-магазин МастерПро", description: "Демо: инструмент и услуги мастеров.", sellerType: "COMPANY" },
];

const img = (name: string) => `/images/products/${name}.svg`;

const PRODUCTS: DemoProduct[] = [
  { sku: "DEMO-SH-001", seller: "demo-sport", category: "shoes", title: "Кроссовки Nike Air Zoom Pegasus 41, мужские", description: "Беговые кроссовки на каждый день: мягкая амортизация, дышащий верх.", price: 12990, oldPrice: 14990, image: img("sneakers"), quantity: 14, rating: 4.8, attributes: { brand: "Nike", size: "40–46", purpose: "бег" }, keywords: ["кроссовки", "nike", "найк", "беговые", "обувь"], reviews: [{ rating: 5, body: "Очень удобные, бегаю каждый день." }, { rating: 4, body: "Хорошие, но маломерят на полразмера." }] },
  { sku: "DEMO-SH-002", seller: "demo-sport", category: "shoes", title: "Кроссовки Nike Revolution 7, женские", description: "Лёгкие кроссовки для прогулок и тренировок.", price: 6490, image: img("sneakers"), quantity: 22, rating: 4.6, attributes: { brand: "Nike", size: "36–41", purpose: "тренировки" }, keywords: ["кроссовки", "nike", "найк", "женские", "обувь"], reviews: [{ rating: 5, body: "Лёгкие и красивые, за свои деньги отлично." }] },
  { sku: "DEMO-SH-003", seller: "demo-sport", category: "shoes", title: "Кроссовки Adidas Runfalcon 3.0", description: "Недорогие беговые кроссовки с прочной подошвой.", price: 5290, image: img("sneakers"), quantity: 30, rating: 4.5, attributes: { brand: "Adidas", size: "39–45" }, keywords: ["кроссовки", "adidas", "адидас", "беговые", "обувь"] },
  { sku: "DEMO-SH-004", seller: "demo-sport", category: "shoes", title: "Кроссовки New Balance 574 классические", description: "Классика на каждый день, замша и сетка.", price: 9990, image: img("sneakers"), quantity: 8, rating: 4.7, attributes: { brand: "New Balance", size: "38–45" }, keywords: ["кроссовки", "new balance", "нью баланс", "обувь"] },
  { sku: "DEMO-NB-001", seller: "demo-tech", category: "laptops", title: "Ноутбук Aurora 14, Core i5, 16 ГБ, SSD 512 ГБ", description: "Лёгкий ноутбук для учёбы и работы, алюминиевый корпус.", price: 74990, oldPrice: 82990, image: img("laptop"), quantity: 7, rating: 4.7, attributes: { screen: "14\"", ram: "16 ГБ", ssd: "512 ГБ" }, keywords: ["ноутбук", "для учёбы", "для работы"], reviews: [{ rating: 5, body: "Быстрый и лёгкий, батареи хватает на день." }] },
  { sku: "DEMO-NB-002", seller: "demo-tech", category: "laptops", title: "Игровой ноутбук Titan 15, Core i7, RTX 4060", description: "Тянет современные игры на высоких настройках.", price: 129900, image: img("laptop"), quantity: 3, rating: 4.6, attributes: { screen: "15.6\"", ram: "32 ГБ", gpu: "RTX 4060" }, keywords: ["ноутбук", "игровой", "для игр"] },
  { sku: "DEMO-PH-001", seller: "demo-tech", category: "phones", title: "Смартфон Vega 9, 128 ГБ", description: "Хорошая камера и батарея на весь день.", price: 29990, oldPrice: 34990, image: img("phone"), quantity: 25, rating: 4.6, attributes: { memory: "128 ГБ", battery: "5000 мАч" }, keywords: ["смартфон", "телефон", "недорогой"], reviews: [{ rating: 5, body: "Камера удивила, за эти деньги отлично." }] },
  { sku: "DEMO-PH-002", seller: "demo-tech", category: "phones", title: "Смартфон Vega 9 Pro, 256 ГБ", description: "Флагманская камера и быстрая зарядка 67 Вт.", price: 44990, image: img("phone"), quantity: 12, rating: 4.8, attributes: { memory: "256 ГБ", charge: "67 Вт" }, keywords: ["смартфон", "телефон", "камера"] },
  { sku: "DEMO-AU-001", seller: "demo-tech", category: "audio", title: "Беспроводные наушники Harmonia Pro с шумоподавлением", description: "Активное шумоподавление и 24 часа работы с кейсом.", price: 11990, image: img("headphones"), quantity: 40, rating: 4.8, attributes: { anc: "да", autonomy: "24 ч" }, keywords: ["наушники", "беспроводные", "шумоподавление", "bluetooth"], reviews: [{ rating: 5, body: "В метро тишина, звук отличный." }] },
  { sku: "DEMO-AU-002", seller: "demo-tech", category: "audio", title: "Наушники Harmonia Lite", description: "Недорогие беспроводные наушники для звонков и музыки.", price: 2990, image: img("headphones"), quantity: 60, rating: 4.3, attributes: { autonomy: "18 ч" }, keywords: ["наушники", "беспроводные", "недорогие"] },
  { sku: "DEMO-AC-001", seller: "demo-tech", category: "e-accessories", title: "Зарядка 65 Вт GaN, 3 порта", description: "Заряжает ноутбук, телефон и наушники одновременно.", price: 3990, image: img("charger"), quantity: 50, rating: 4.5, attributes: { power: "65 Вт", ports: "3" }, keywords: ["зарядка", "блок питания", "gan"] },
  { sku: "DEMO-KI-001", seller: "demo-home", category: "kitchen", title: "Набор ножей из дамасской стали, 5 предметов", description: "Острые ножи с деревянными рукоятями, отличный подарок.", price: 8490, oldPrice: 10990, image: img("knives"), quantity: 18, rating: 4.9, attributes: { items: "5", material: "дамасская сталь" }, keywords: ["ножи", "кухня", "подарок"], reviews: [{ rating: 5, body: "Подарила маме, она в восторге." }] },
  { sku: "DEMO-DC-001", seller: "demo-home", category: "decor", title: "Керамическая ваза «Утренний свет», 42 см", description: "Напольная ваза ручной работы для гостиной.", price: 6490, image: img("vase"), quantity: 9, rating: 4.7, attributes: { height: "42 см", material: "керамика" }, keywords: ["ваза", "декор", "подарок", "интерьер"] },
  { sku: "DEMO-TX-001", seller: "demo-home", category: "textile", title: "Постельное бельё, хлопок 100%, 2-спальное", description: "Плотный натуральный хлопок, не линяет после стирки.", price: 4990, image: img("bedlinen"), quantity: 20, rating: 4.5, attributes: { material: "хлопок", size: "2-спальное" }, keywords: ["постельное бельё", "хлопок", "текстиль"] },
  { sku: "DEMO-WM-001", seller: "demo-style", category: "mens", title: "Куртка демисезонная мужская, мембрана", description: "Не промокает и не продувается, лёгкая.", price: 10990, image: img("jacket"), quantity: 15, rating: 4.6, attributes: { season: "демисезон", waterproof: "5000 мм" }, keywords: ["куртка", "мужская", "демисезон"] },
  { sku: "DEMO-WW-001", seller: "demo-style", category: "womens", title: "Платье трикотажное, футляр", description: "На каждый день и в офис, мягкий трикотаж.", price: 5990, oldPrice: 7490, image: img("dress"), quantity: 21, rating: 4.8, attributes: { material: "трикотаж" }, keywords: ["платье", "женское", "офис"], reviews: [{ rating: 5, body: "Село идеально, ношу постоянно." }] },
  { sku: "DEMO-KD-001", seller: "demo-style", category: "kids", title: "Конструктор «Город», 480 деталей", description: "Развивающий конструктор для детей от 6 лет.", price: 2990, image: img("constructor"), quantity: 35, rating: 4.7, attributes: { details: "480", age: "6+" }, keywords: ["конструктор", "игрушка", "подарок ребёнку"] },
  { sku: "DEMO-HT-001", seller: "demo-master", category: "hand-tools", title: "Набор отвёрток Precision, 32 бита", description: "Для ремонта электроники и бытовой техники.", price: 2490, image: img("screwdrivers"), quantity: 40, rating: 4.6, attributes: { bits: "32" }, keywords: ["отвёртки", "набор", "инструмент"] },
  { sku: "DEMO-PT-001", seller: "demo-master", category: "power-tools", title: "Шуруповёрт аккумуляторный 18 В, 2 АКБ", description: "Две батареи и зарядка в комплекте.", price: 8990, oldPrice: 10490, image: img("drill"), quantity: 12, rating: 4.7, attributes: { voltage: "18 В", batteries: "2" }, keywords: ["шуруповёрт", "дрель", "инструмент"], reviews: [{ rating: 5, body: "Мощный, весь ремонт сделал им." }] },
  { sku: "DEMO-PT-002", seller: "demo-master", category: "power-tools", title: "Болгарка (УШМ) 125 мм, 800 Вт", description: "Резка металла и камня, лёгкая.", price: 4990, image: img("grinder"), quantity: 10, rating: 4.4, attributes: { power: "800 Вт", disc: "125 мм" }, keywords: ["болгарка", "ушм", "инструмент"] },
  { sku: "DEMO-SV-001", seller: "demo-master", category: "design", title: "Услуга: дизайн-проект комнаты", description: "Планировка, 3D-визуализация и подбор материалов.", price: 25000, image: img("design-service"), quantity: 10, rating: 4.9, attributes: { format: "удалённо", terms: "от 7 дней" }, keywords: ["дизайн интерьера", "дизайнер", "услуга"] },
  { sku: "DEMO-SV-002", seller: "demo-master", category: "repair", title: "Услуга: ремонт квартиры под ключ, за м²", description: "Черновой и чистовой ремонт с гарантией.", price: 6900, image: img("repair-service"), quantity: 5, rating: 4.8, attributes: { unit: "за м²" }, keywords: ["ремонт", "отделка", "мастер", "услуга"] },
];

function demoEmail(slug: string): string {
  return `${slug}@${DEMO_EMAIL_DOMAIN}`;
}

async function demoUser(email: string, name: string, role: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  // Случайный пароль, который никто не знает: под демо-аккаунтом не войти.
  const passwordHash = await hashPassword(randomBytes(24).toString("hex"));
  return prisma.user.create({ data: { email, name, role, passwordHash } });
}

export interface DemoStatus {
  loaded: boolean;
  products: number;
  sellers: number;
}

export async function demoCatalogStatus(): Promise<DemoStatus> {
  const [products, sellers] = await Promise.all([
    prisma.product.count({ where: { sku: { startsWith: DEMO_SKU_PREFIX }, status: "ACTIVE" } }),
    prisma.sellerProfile.count({ where: { slug: { startsWith: "demo-" } } }),
  ]);
  return { loaded: products > 0, products, sellers };
}

/** Идемпотентно: повторный запуск обновляет цены и остатки, но не плодит копии. */
export async function loadDemoCatalog(): Promise<DemoStatus> {
  for (const cat of [...CATEGORIES, ...B2B_CATEGORIES]) {
    const parent = cat.parent ? await prisma.category.findUnique({ where: { slug: cat.parent } }) : null;
    await prisma.category.upsert({
      where: { slug: cat.slug },
      create: { slug: cat.slug, name: cat.name, parentId: parent?.id ?? null },
      update: {},
    });
  }

  const sellerIds = new Map<string, string>();
  const sellerUsers = new Map<string, string>();
  for (const s of [...SELLERS, ...B2B_SELLERS]) {
    const user = await demoUser(demoEmail(s.slug), s.name, "SELLER");
    const requisites = s.inn ? { inn: s.inn, ogrn: s.ogrn ?? null } : {};
    const profile = await prisma.sellerProfile.upsert({
      where: { slug: s.slug },
      create: {
        userId: user.id,
        slug: s.slug,
        displayName: s.name,
        description: s.description,
        sellerType: s.sellerType,
        identityStatus: "VERIFIED",
        businessStatus: "VERIFIED",
        isActivated: true,
        ...requisites,
      },
      update: { displayName: s.name, description: s.description, isActivated: true, ...requisites },
    });
    sellerIds.set(s.slug, profile.id);
    sellerUsers.set(s.slug, profile.userId);
  }

  const reviewer = await demoUser(`reviewer@${DEMO_EMAIL_DOMAIN}`, "Демо-покупатель", "BUYER");
  const saleUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  for (const p of [...PRODUCTS, ...B2B_PRODUCTS]) {
    const sellerId = sellerIds.get(p.seller);
    if (!sellerId) continue;
    const category = await prisma.category.findUnique({ where: { slug: p.category } });
    const data = {
      title: p.title,
      description: `${p.description}\n\n${DEMO_NOTE}`,
      priceKopecks: p.price * 100,
      oldPriceKopecks: p.oldPrice ? p.oldPrice * 100 : null,
      attributes: JSON.stringify(p.attributes),
      keywords: JSON.stringify(p.keywords),
      categoryId: category?.id ?? null,
      status: "ACTIVE",
    };
    const existing = await prisma.product.findUnique({ where: { sku: p.sku } });
    const product = existing
      ? await prisma.product.update({ where: { id: existing.id }, data })
      : await prisma.product.create({
          data: { ...data, sku: p.sku, sellerId, seoSlug: p.sku.toLowerCase(), rating: p.rating, views: 0 },
        });

    if (!existing) {
      await prisma.productImage.create({ data: { productId: product.id, url: p.image, alt: p.title, isPrimary: true, position: 0 } });
    }
    await prisma.inventory.upsert({
      where: { productId: product.id },
      create: { productId: product.id, quantity: p.quantity, availability: "AVAILABLE", confirmedBySeller: true, confirmedAt: new Date(), saleUntil, autoExtend: true },
      update: { quantity: p.quantity, availability: "AVAILABLE", confirmedBySeller: true, confirmedAt: new Date(), saleUntil },
    });
    await prisma.listing.upsert({
      where: { productId: product.id },
      create: { productId: product.id, publishedAt: new Date(), expiresAt: saleUntil, isLive: true },
      update: { isLive: true, expiresAt: saleUntil },
    });

    if (!existing && p.reviews?.length) {
      for (const r of p.reviews) {
        await prisma.review.create({ data: { productId: product.id, authorId: reviewer.id, rating: r.rating, body: r.body } });
      }
    }
    const agg = await prisma.review.aggregate({ where: { productId: product.id }, _avg: { rating: true }, _count: true });
    await prisma.product.update({
      where: { id: product.id },
      data: agg._count > 0
        ? { rating: Math.round((agg._avg.rating ?? 0) * 10) / 10, reviewsCount: agg._count }
        : { rating: 0, reviewsCount: 0 },
    });
  }

  // Правила торга демо-оптовиков (так же, как их сохранил бы продавец в кабинете).
  for (const [slug, policy] of Object.entries(B2B_POLICIES)) {
    const id = sellerIds.get(slug);
    const uid = sellerUsers.get(slug);
    if (id && uid) await saveSellerNegotiationPolicy(id, uid, policy);
  }
  return demoCatalogStatus();
}

/** Снимает демо-товары с продажи. Уже заказанные остаются в истории заказов. */
export async function removeDemoCatalog(): Promise<DemoStatus> {
  const products = await prisma.product.findMany({
    where: { sku: { startsWith: DEMO_SKU_PREFIX } },
    select: { id: true, _count: { select: { orderItems: true } } },
  });
  for (const p of products) {
    if (p._count.orderItems > 0) {
      await prisma.product.update({ where: { id: p.id }, data: { status: "ARCHIVED" } });
      await prisma.listing.updateMany({ where: { productId: p.id }, data: { isLive: false } });
      await prisma.cartItem.deleteMany({ where: { productId: p.id } });
    } else {
      try {
        await prisma.product.delete({ where: { id: p.id } });
      } catch {
        // Есть связанные записи (просмотры, рекомендации): просто снимаем с продажи.
        await prisma.product.update({ where: { id: p.id }, data: { status: "ARCHIVED" } });
        await prisma.listing.updateMany({ where: { productId: p.id }, data: { isLive: false } });
        await prisma.cartItem.deleteMany({ where: { productId: p.id } });
      }
    }
  }
  return demoCatalogStatus();
}
