/**
 * Продвижение в правой колонке: покупка, продление и подбор карточек для показа.
 * Хранится рядом с остальными служебными записями (IntegrationLink, provider
 * "sidebar-promo"), одна запись на продвигаемое объявление или товар.
 *
 * Оплата пока тестовая: деньги не списываются, запись помечена sandbox. Когда
 * подключим эквайринг, продвижение будет включаться только после оплаты.
 */
import { prisma } from "../prisma";
import { UserFacingError } from "./engagement-rules";
import { applyPlan, findPlan, isActive, parsePromotion, pickForRail, PROMO_RAIL_SIZE, type PromoKind, type Promotion } from "../promo";

const PROVIDER = "sidebar-promo";
const externalId = (kind: PromoKind, itemId: string) => `promo/${kind}/${itemId}`;

export interface RailCard {
  kind: PromoKind;
  id: string;
  title: string;
  priceKopecks: number;
  image: string | null;
  href: string;
  city: string | null;
}

export interface PromotableItem {
  kind: PromoKind;
  id: string;
  title: string;
  priceKopecks: number;
}

function cleanKind(v: unknown): PromoKind | null {
  return v === "classified" || v === "product" ? v : null;
}

async function ownsPublished(userId: string, kind: PromoKind, itemId: string): Promise<boolean> {
  if (kind === "classified") {
    return (await prisma.classified.count({ where: { id: itemId, authorId: userId, status: "PUBLISHED" } })) > 0;
  }
  return (await prisma.product.count({ where: { id: itemId, status: "ACTIVE", sellerProfile: { userId } } })) > 0;
}

/** Купить или продлить продвижение своего опубликованного объявления или товара. */
export async function buyPromotion(userId: string, input: { kind?: unknown; itemId?: unknown; planId?: unknown }): Promise<Promotion> {
  const kind = cleanKind(input.kind);
  if (!kind) throw new UserFacingError("Выберите, что продвигать", 400);
  const itemId = typeof input.itemId === "string" ? input.itemId.trim() : "";
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(itemId)) throw new UserFacingError("Выберите объявление или товар", 400);
  const plan = findPlan(input.planId);
  if (!plan) throw new UserFacingError("Выберите срок продвижения", 400);
  if (!(await ownsPublished(userId, kind, itemId))) {
    throw new UserFacingError("Продвигать можно только своё опубликованное объявление или товар", 404);
  }
  const where = { provider_externalId: { provider: PROVIDER, externalId: externalId(kind, itemId) } };
  const row = await prisma.integrationLink.findUnique({ where, select: { secretBlob: true } });
  const next = applyPlan(parsePromotion(row?.secretBlob), plan, { kind, itemId, ownerId: userId, sandbox: true }, new Date());
  const secretBlob = JSON.stringify(next);
  await prisma.integrationLink.upsert({
    where,
    create: { provider: PROVIDER, externalId: externalId(kind, itemId), secretBlob, externalScope: "[]", status: "ACTIVE" },
    update: { secretBlob, status: "ACTIVE", unlinkedAt: null },
  });
  return next;
}

async function allPromotions(): Promise<Promotion[]> {
  const rows = await prisma.integrationLink.findMany({ where: { provider: PROVIDER, status: "ACTIVE" }, select: { secretBlob: true }, take: 1000 });
  return rows.map((r) => parsePromotion(r.secretBlob)).filter((p): p is Promotion => p !== null);
}

/** Мои продвижения (и идущие, и закончившиеся), свежие сверху. */
export async function myPromotions(userId: string): Promise<Promotion[]> {
  return (await allPromotions()).filter((p) => p.ownerId === userId).sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt));
}

/** Что человек может продвинуть: свои опубликованные объявления и товары в продаже. */
export async function promotableItems(userId: string): Promise<PromotableItem[]> {
  const [ads, products] = await Promise.all([
    prisma.classified.findMany({ where: { authorId: userId, status: "PUBLISHED" }, select: { id: true, title: true, priceKopecks: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.product.findMany({ where: { status: "ACTIVE", sellerProfile: { userId } }, select: { id: true, title: true, priceKopecks: true }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return [
    ...ads.map((a) => ({ kind: "classified" as const, id: a.id, title: a.title, priceKopecks: a.priceKopecks })),
    ...products.map((p) => ({ kind: "product" as const, id: p.id, title: p.title, priceKopecks: p.priceKopecks })),
  ];
}

/** Карточки для правой колонки: случайные из идущих продвижений, у всех равный шанс. */
export async function railCards(now = new Date()): Promise<RailCard[]> {
  const active = (await allPromotions()).filter((p) => isActive(p, now));
  if (active.length === 0) return [];
  // Берём с запасом: объявление могли снять с публикации, такое пропускаем.
  const picked = pickForRail(active, PROMO_RAIL_SIZE * 2);
  const adIds = picked.filter((p) => p.kind === "classified").map((p) => p.itemId);
  const productIds = picked.filter((p) => p.kind === "product").map((p) => p.itemId);
  const [ads, products] = await Promise.all([
    adIds.length
      ? prisma.classified.findMany({
          where: { id: { in: adIds }, status: "PUBLISHED" },
          select: { id: true, title: true, priceKopecks: true, city: { select: { name: true } }, images: { select: { url: true }, orderBy: { isCover: "desc" }, take: 1 } },
        })
      : Promise.resolve([]),
    productIds.length
      ? prisma.product.findMany({
          where: { id: { in: productIds }, status: "ACTIVE" },
          select: { id: true, title: true, priceKopecks: true, images: { select: { url: true }, orderBy: [{ isPrimary: "desc" }, { position: "asc" }], take: 1 } },
        })
      : Promise.resolve([]),
  ]);
  const cards: RailCard[] = [];
  for (const p of picked) {
    if (p.kind === "classified") {
      const a = ads.find((x) => x.id === p.itemId);
      if (a) cards.push({ kind: "classified", id: a.id, title: a.title, priceKopecks: a.priceKopecks, image: a.images[0]?.url ?? null, href: `/classifieds/${a.id}`, city: a.city?.name ?? null });
    } else {
      const pr = products.find((x) => x.id === p.itemId);
      if (pr) cards.push({ kind: "product", id: pr.id, title: pr.title, priceKopecks: pr.priceKopecks, image: pr.images[0]?.url ?? null, href: `/product/${pr.id}`, city: null });
    }
    if (cards.length >= PROMO_RAIL_SIZE) break;
  }
  return cards;
}
