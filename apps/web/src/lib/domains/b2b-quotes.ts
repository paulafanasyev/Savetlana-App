/**
 * Коммерческие предложения (КП) после B2B-торга агентов.
 *
 * Путь: агенты договорились → КП ждёт продавца → продавец подтверждает или
 * отклоняет → покупатель оформляет заказ по цене КП → обычная оплата и
 * безопасная сделка. Люди подтверждают дважды, агент сам ничего не продаёт.
 *
 * Хранение без новой таблицы: строка PendingAction (toolName "b2b_quote",
 * владелец — покупатель). Условия лежат в args, их отпечаток в argsHash:
 * если условия подменить в базе, КП перестаёт считаться подлинным и оплата
 * по нему блокируется (правило R5 в risk.ts). Статусы свои (AWAITING_SELLER и
 * т. д.), поэтому общий механизм подтверждений и его чистка эти строки не трогают.
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../prisma";
import { audit } from "./audit";
import { notify } from "./notifications";
import { generateOrderNumber } from "../utils";
import { computeSettlement } from "./payments";
import { UserFacingError } from "./engagement-rules";

export const QUOTE_TOOL = "b2b_quote";
export const QUOTE_KIND = "B2B_QUOTE";
export const QUOTE_DAYS = 7;

export type QuoteStatus = "AWAITING_SELLER" | "SELLER_CONFIRMED" | "DECLINED" | "ORDERED" | "EXPIRED";

export interface QuoteTerms {
  v: 1;
  productId: string;
  sellerId: string;
  sellerUserId: string;
  buyerId: string;
  title: string;
  quantity: number;
  unitPriceKopecks: number;
  listPriceKopecks: number;
  totalKopecks: number;
  discountPercent: number;
  rounds: number;
  chain: string;
}

export interface Quote extends QuoteTerms {
  id: string;
  number: string;
  status: QuoteStatus;
  createdAt: Date;
  expiresAt: Date;
}

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  AWAITING_SELLER: "ждёт подтверждения продавца",
  SELLER_CONFIRMED: "продавец подтвердил, можно оформить заказ",
  DECLINED: "продавец отклонил",
  ORDERED: "заказ оформлен",
  EXPIRED: "срок действия истёк",
};

const digest = (s: string) => createHash("sha256").update(s).digest("hex");

interface Row {
  id: string;
  args: string;
  argsHash: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
}

export const quoteNumber = (id: string) => `КП-${id.slice(-6).toUpperCase()}`;

/** Разбор строки КП. null: строка подделана или битая. */
export function parseQuote(row: Row, now = new Date()): Quote | null {
  if (digest(row.args) !== row.argsHash) return null;
  try {
    const t = JSON.parse(row.args) as QuoteTerms;
    if (t.v !== 1 || typeof t.productId !== "string" || typeof t.sellerId !== "string" || !Number.isInteger(t.unitPriceKopecks)) return null;
    let status = row.status as QuoteStatus;
    if ((status === "AWAITING_SELLER" || status === "SELLER_CONFIRMED") && row.expiresAt < now) status = "EXPIRED";
    return { ...t, id: row.id, number: quoteNumber(row.id), status, createdAt: row.createdAt, expiresAt: row.expiresAt };
  } catch {
    return null;
  }
}

const SELECT = { id: true, args: true, argsHash: true, status: true, createdAt: true, expiresAt: true, userId: true } as const;

async function loadQuote(id: string): Promise<(Quote & { ownerId: string }) | null> {
  const row = await prisma.pendingAction.findFirst({ where: { id, toolName: QUOTE_TOOL }, select: SELECT });
  if (!row) return null;
  const q = parseQuote(row);
  return q ? { ...q, ownerId: row.userId } : null;
}

/** Сохраняет КП после успешного торга и сообщает продавцу. */
export async function createQuote(input: Omit<QuoteTerms, "v" | "sellerUserId">): Promise<Quote> {
  const seller = await prisma.sellerProfile.findUnique({ where: { id: input.sellerId }, select: { userId: true } });
  if (!seller) throw new UserFacingError("Продавец не найден", 404);
  if (seller.userId === input.buyerId) throw new UserFacingError("Нельзя оформить КП самому себе", 400);
  const terms: QuoteTerms = { v: 1, ...input, sellerUserId: seller.userId, chain: input.chain.slice(0, 600), title: input.title.slice(0, 200) };
  const args = JSON.stringify(terms);
  const row = await prisma.pendingAction.create({
    data: {
      userId: input.buyerId,
      toolName: QUOTE_TOOL,
      args,
      argsHash: digest(args),
      nonce: randomBytes(24).toString("hex"),
      status: "AWAITING_SELLER",
      riskLevel: "WRITE",
      expiresAt: new Date(Date.now() + QUOTE_DAYS * 24 * 60 * 60 * 1000),
    },
    select: SELECT,
  });
  const quote = parseQuote(row)!;
  await audit({ action: "b2b_quote.create", actorId: input.buyerId, actorRole: "buyer", targetType: "b2b_quote", targetId: row.id, after: terms });
  const rub = (k: number) => `${Math.round(k / 100).toLocaleString("ru-RU")} ₽`;
  await notify({
    userId: seller.userId,
    kind: "order_status",
    title: `Новое КП ${quote.number}: «${terms.title}»`,
    body: `Агенты договорились: ${terms.quantity} шт. по ${rub(terms.unitPriceKopecks)} (прайс ${rub(terms.listPriceKopecks)}), итого ${rub(terms.totalKopecks)}. Подтвердите или отклоните в кабинете.`,
    url: "/seller/quotes",
  }).catch(() => undefined);
  return quote;
}

export async function listBuyerQuotes(buyerId: string): Promise<Quote[]> {
  const rows = await prisma.pendingAction.findMany({ where: { userId: buyerId, toolName: QUOTE_TOOL }, orderBy: { createdAt: "desc" }, take: 50, select: SELECT });
  return rows.map((r) => parseQuote(r)).filter((q): q is Quote => q !== null);
}

export async function listSellerQuotes(sellerId: string): Promise<Quote[]> {
  const rows = await prisma.pendingAction.findMany({
    where: { toolName: QUOTE_TOOL, args: { contains: `"sellerId":${JSON.stringify(sellerId)}` } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: SELECT,
  });
  return rows.map((r) => parseQuote(r)).filter((q): q is Quote => q !== null && q.sellerId === sellerId);
}

/** Продавец подтверждает или отклоняет КП. */
export async function decideQuote(quoteId: string, sellerId: string, actorUserId: string, accept: boolean): Promise<Quote> {
  const q = await loadQuote(quoteId);
  if (!q || q.sellerId !== sellerId) throw new UserFacingError("КП не найдено", 404);
  if (q.status === "EXPIRED") throw new UserFacingError("Срок действия КП истёк", 409);
  if (q.status !== "AWAITING_SELLER") throw new UserFacingError("По этому КП решение уже принято", 409);
  const to: QuoteStatus = accept ? "SELLER_CONFIRMED" : "DECLINED";
  const res = await prisma.pendingAction.updateMany({ where: { id: quoteId, status: "AWAITING_SELLER" }, data: { status: to } });
  if (res.count !== 1) throw new UserFacingError("Статус КП уже изменился, обновите страницу", 409);
  await audit({ action: accept ? "b2b_quote.confirm" : "b2b_quote.decline", actorId: actorUserId, actorRole: "seller", targetType: "b2b_quote", targetId: quoteId, before: { status: q.status }, after: { status: to } });
  await notify({
    userId: q.buyerId,
    kind: "order_status",
    title: accept ? `Продавец подтвердил ${q.number}` : `Продавец отклонил ${q.number}`,
    body: accept ? `«${q.title}»: ${q.quantity} шт. Оформите заказ по цене КП в разделе «Мои КП».` : `«${q.title}»: продавец не готов на эти условия. Можно поторговаться ещё раз или написать продавцу.`,
    url: "/quotes",
  }).catch(() => undefined);
  return { ...q, status: to };
}

/**
 * Покупатель оформляет заказ по подтверждённому КП. Атомарно: КП помечается
 * «заказ оформлен», остаток резервируется, создаётся заказ на оплату. Не
 * хватило остатка — ничего не создаётся и КП остаётся подтверждённым.
 */
export async function acceptQuote(quoteId: string, buyerId: string): Promise<{ orderId: string; number: string; groupId: string }> {
  const q = await loadQuote(quoteId);
  if (!q || q.ownerId !== buyerId || q.buyerId !== buyerId) throw new UserFacingError("КП не найдено", 404);
  if (q.status === "EXPIRED") throw new UserFacingError("Срок действия КП истёк: поторгуйтесь заново", 409);
  if (q.status === "ORDERED") throw new UserFacingError("Заказ по этому КП уже оформлен", 409);
  if (q.status !== "SELLER_CONFIRMED") throw new UserFacingError("КП ещё не подтверждено продавцом", 409);
  const product = await prisma.product.findFirst({ where: { id: q.productId, sellerId: q.sellerId, status: "ACTIVE" }, select: { id: true } });
  if (!product) throw new UserFacingError("Товар снят с продажи", 409);

  const total = q.unitPriceKopecks * q.quantity;
  const settlement = computeSettlement({ grossKopecks: total });
  const order = await prisma.$transaction(async (tx) => {
    const claimed = await tx.pendingAction.updateMany({ where: { id: quoteId, status: "SELLER_CONFIRMED" }, data: { status: "ORDERED", consumedAt: new Date() } });
    if (claimed.count !== 1) throw new UserFacingError("Заказ по этому КП уже оформляется", 409);
    const stock = await tx.inventory.updateMany({ where: { productId: q.productId, quantity: { gte: q.quantity } }, data: { quantity: { decrement: q.quantity } } });
    if (stock.count !== 1) throw new UserFacingError(`У продавца не хватает остатка на ${q.quantity} шт.`, 409);
    const group = await tx.orderGroup.create({ data: { buyerId, idempotencyKey: `quote_${quoteId}`, totalKopecks: total } });
    const created = await tx.order.create({
      data: {
        groupId: group.id,
        buyerId,
        sellerId: q.sellerId,
        number: generateOrderNumber(),
        status: "CREATED",
        subtotalKopecks: total,
        deliveryKopecks: 0,
        platformFeeKopecks: settlement.platformFeeKopecks,
        paymentFeeKopecks: settlement.paymentFeeKopecks,
        totalKopecks: total,
        deliveryAddress: JSON.stringify({ kind: QUOTE_KIND, quoteId, deliveryMethod: "PICKUP" }),
        note: `${q.number}: ${q.quantity} шт. по цене КП`,
      },
      select: { id: true, number: true },
    });
    await tx.orderItem.create({
      data: { orderId: created.id, productId: q.productId, titleSnapshot: q.title, priceKopecks: q.unitPriceKopecks, quantity: q.quantity },
    });
    await tx.orderHistory.create({ data: { orderId: created.id, toStatus: "CREATED", reason: `заказ по ${q.number}`, actorId: buyerId } });
    await tx.order.update({ where: { id: created.id }, data: { status: "PAYMENT_PENDING" } });
    await tx.orderHistory.create({ data: { orderId: created.id, fromStatus: "CREATED", toStatus: "PAYMENT_PENDING", reason: "ждём оплату", actorId: buyerId } });
    return { orderId: created.id, number: created.number, groupId: group.id };
  });
  await audit({ action: "b2b_quote.order", actorId: buyerId, actorRole: "buyer", targetType: "b2b_quote", targetId: quoteId, after: { orderId: order.orderId, totalKopecks: total } });
  await notify({
    userId: q.sellerUserId,
    kind: "order_status",
    title: `Заказ ${order.number} по ${q.number}`,
    body: `Покупатель оформил заказ по КП: ${q.quantity} шт. «${q.title}». После оплаты заказ появится в работе.`,
    url: "/seller/orders",
  }).catch(() => undefined);
  return order;
}

/** Заказ по КП → id заказа (для ссылки «Перейти к заказу»). */
export async function ordersForQuotes(quoteIds: string[]): Promise<Record<string, string>> {
  if (quoteIds.length === 0) return {};
  const groups = await prisma.orderGroup.findMany({
    where: { idempotencyKey: { in: quoteIds.map((id) => `quote_${id}`) } },
    select: { idempotencyKey: true, orders: { take: 1, select: { id: true } } },
  });
  const out: Record<string, string> = {};
  for (const g of groups) if (g.idempotencyKey && g.orders[0]) out[g.idempotencyKey.replace(/^quote_/, "")] = g.orders[0].id;
  return out;
}

/**
 * Для риск-движка: подлинное КП, по которому оформлен этот заказ. Подлинное —
 * оформлено, отпечаток условий совпадает, покупатель тот же.
 */
export async function verifiedQuoteForOrder(
  deliveryAddress: string | null | undefined,
  buyerId: string
): Promise<{ id: string; productId: string; unitPriceKopecks: number; quantity: number } | null> {
  let quoteId: unknown;
  try {
    const meta = JSON.parse(deliveryAddress ?? "{}") as { kind?: unknown; quoteId?: unknown };
    if (meta.kind !== QUOTE_KIND) return null;
    quoteId = meta.quoteId;
  } catch {
    return null;
  }
  if (typeof quoteId !== "string") return null;
  const row = await prisma.pendingAction.findFirst({ where: { id: quoteId, toolName: QUOTE_TOOL, status: "ORDERED", userId: buyerId }, select: SELECT });
  if (!row) return null;
  const q = parseQuote(row);
  if (!q || q.buyerId !== buyerId) return null;
  return { id: q.id, productId: q.productId, unitPriceKopecks: q.unitPriceKopecks, quantity: q.quantity };
}
