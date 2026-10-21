/**
 * Вход продавцом для жюри: одно нажатие, и человек в кабинете временного
 * демо-магазина, где уже ждёт входящее КП. Так можно самому нажать
 * «Подтвердить» и увидеть сторону продавца (человек в контуре).
 *
 * - Каждому свой аккаунт и свой магазин demo-jury-…: бейджей проверки нет,
 *   на карточке отметка «Демо-магазин» (isDemoSeller по префиксу demo-).
 * - Товар магазина снят с размещения (isLive=false): в каталог и запросы цены он не
 *   попадает, чтобы гости не засоряли витрину. Артикул DEMO-…: убирается вместе с
 *   демо-каталогом.
 * - Входящее КП считает настоящий алгоритм торга по правилам площадки по
 *   умолчанию; закупщик демонстрационный, войти под ним нельзя.
 * - Почта на .invalid, пароль случайный и нигде не хранится, сессия на 3 дня.
 * - Лимит: 3 магазина в час с одного адреса и 100 в сутки всего. Выключается вместе
 *   с входом покупателем: JURY_DEMO=0.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../prisma";
import { ApiError, createToken, hashPassword } from "../auth";
import { negotiate, type NegotiationResult } from "../negotiation";
import { audit } from "./audit";
import { consumeRateLimit } from "./rate-limits";
import { defaultNegotiationPolicy } from "./negotiation-policy";
import { createQuote, type Quote } from "./b2b-quotes";
import { JURY_EMAIL_DOMAIN, juryGuestEnabled } from "./jury-guest";

export const JURY_SELLER_NAME = "Продавец жюри";
export const JURY_SHOP_PREFIX = "demo-jury-";
const DEMO_BUYER_EMAIL = "jury-buyer@demo.svetlana.local";
const TERMS_VERSION = "1.0";
const CONSENTS = ["PERSONAL_DATA", "COOKIES_STRICTLY_NECESSARY"] as const;
const SESSION_DAYS = 3;

/** Товар демо-магазина и запрос закупщика, по которому агенты уже поторговались. */
export const JURY_PRODUCT = {
  title: "Жилет сигнальный оранжевый, светоотражающий",
  priceKopecks: 39000,
  stock: 2000,
  request: { quantity: 100, targetKopecks: 33000, maxKopecks: 36000 },
} as const;

function chainText(r: NegotiationResult): string {
  const prices = r.transcript.filter((m) => m.action !== "accept").map((m) => Math.round(m.unitPriceKopecks / 100).toLocaleString("ru-RU"));
  if (prices.length === 0 || r.unitPriceKopecks === null) return "";
  return `Ход торга (покупатель → продавец): ${prices.join(" → ")} → ${Math.round(r.unitPriceKopecks / 100).toLocaleString("ru-RU")} ₽.`;
}

async function demoBuyer(): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_BUYER_EMAIL }, select: { id: true } });
  if (existing) return existing.id;
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  const u = await prisma.user.create({ data: { email: DEMO_BUYER_EMAIL, name: "Демо-закупщик", role: "BUYER", passwordHash } });
  return u.id;
}

export interface JurySeller {
  user: { id: string; name: string | null; email: string; role: string };
  sellerId: string;
  productId: string;
  quote: Quote | null;
  token: string;
  expiresAt: Date;
}

export async function createJurySeller(ip: string): Promise<JurySeller> {
  if (!juryGuestEnabled()) throw new ApiError(404, "Вход для жюри выключен.", "jury_disabled");
  const [perIp, global] = await Promise.all([
    consumeRateLimit(`jury-seller:ip:${ip}`, 3, 60 * 60_000),
    consumeRateLimit("jury-seller:global", 100, 24 * 60 * 60_000),
  ]);
  if (!perIp.allowed || !global.allowed) {
    throw new ApiError(429, "Слишком много демо-магазинов. Попробуйте позже.", "rate_limited");
  }
  const hex = randomBytes(6).toString("hex");
  const email = `seller-${hex}@${JURY_EMAIL_DOMAIN}`;
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  const now = new Date();
  const saleUntil = new Date(now.getTime() + 30 * 864e5);

  const created = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { name: JURY_SELLER_NAME, email, passwordHash, role: "SELLER", isBlocked: false } });
    await tx.profile.create({ data: { userId: u.id, displayName: JURY_SELLER_NAME } });
    for (const type of CONSENTS) {
      await tx.consent.create({ data: { userId: u.id, type, granted: true, source: "jury_guest", version: TERMS_VERSION, grantedAt: now } });
    }
    const shop = await tx.sellerProfile.create({
      data: {
        userId: u.id,
        slug: `${JURY_SHOP_PREFIX}${hex}`,
        displayName: "Демо-магазин жюри",
        description: "Временный демо-магазин для проверки площадки. Проверки не проводились, сделки в тестовом режиме.",
        sellerType: "IP",
        identityStatus: "VERIFIED",
        businessStatus: "VERIFIED",
        isActivated: true,
      },
    });
    const product = await tx.product.create({
      data: {
        sellerId: shop.id,
        sku: `DEMO-JURY-${hex.toUpperCase()}`,
        title: JURY_PRODUCT.title,
        description: "Жилет со светоотражающими полосами для дорожных и складских работ.\n\nДемонстрационный товар временного магазина жюри, в каталоге не показывается.",
        priceKopecks: JURY_PRODUCT.priceKopecks,
        keywords: JSON.stringify(["жилет", "сигнальный", "сиз", "демо"]),
        attributes: JSON.stringify({ color: "оранжевый", size: "52–56" }),
        status: "ACTIVE",
        inventory: { create: { quantity: JURY_PRODUCT.stock, availability: "AVAILABLE", confirmedBySeller: true, confirmedAt: now, saleUntil, autoExtend: false } },
      },
    });
    await tx.listing.create({ data: { productId: product.id, publishedAt: now, expiresAt: saleUntil, isLive: false } });
    return { user: u, sellerId: shop.id, productId: product.id };
  }, { maxWait: 15000, timeout: 15000 });

  // Входящее КП: тот же алгоритм торга, что у Светланы, по правилам площадки.
  let quote: Quote | null = null;
  const policy = defaultNegotiationPolicy();
  const r = negotiate(
    {
      listPriceKopecks: JURY_PRODUCT.priceKopecks,
      volumeTiers: policy.volumeTiers,
      maxDiscountPercent: policy.maxDiscountPercent,
      negotiablePercent: policy.negotiablePercent,
      minOrderQty: policy.minOrderQty,
      stockQty: JURY_PRODUCT.stock,
      maxRounds: 6,
    },
    { quantity: JURY_PRODUCT.request.quantity, targetPriceKopecks: JURY_PRODUCT.request.targetKopecks, maxPriceKopecks: JURY_PRODUCT.request.maxKopecks, maxRounds: 6 }
  );
  if (r.status === "AGREED" && r.unitPriceKopecks !== null) {
    const unit = r.unitPriceKopecks;
    quote = await createQuote({
      productId: created.productId,
      sellerId: created.sellerId,
      buyerId: await demoBuyer(),
      title: JURY_PRODUCT.title,
      quantity: r.quantity,
      unitPriceKopecks: unit,
      listPriceKopecks: JURY_PRODUCT.priceKopecks,
      totalKopecks: unit * r.quantity,
      discountPercent: Math.round((1 - unit / JURY_PRODUCT.priceKopecks) * 1000) / 10,
      rounds: r.rounds,
      chain: `Демо-запрос закупщика. ${chainText(r)}`,
    }).catch(() => null);
  }

  const token = await createToken({ sub: created.user.id, role: created.user.role });
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 864e5);
  await prisma.session.create({ data: { userId: created.user.id, token, expiresAt } });
  await audit({ actorId: created.user.id, actorRole: "seller", action: "auth.jury_seller", targetType: "seller_profile", targetId: created.sellerId, after: { at: now.toISOString(), quote: quote?.number ?? null } });
  return {
    user: { id: created.user.id, name: created.user.name, email: created.user.email, role: created.user.role },
    sellerId: created.sellerId,
    productId: created.productId,
    quote,
    token,
    expiresAt,
  };
}
