/**
 * Инструменты Светланы для CRM продавца: сообщения покупателей и акции.
 *
 * Запуск и завершение скидки меняют цены, поэтому требуют подтверждения.
 * Перед подтверждением Светлана показывает, какие именно товары и цены
 * изменятся (confirmPreview), чтобы продавец подтверждал не вслепую.
 */
import { prisma } from "../../prisma";
import { getSellerOnboardingGate } from "../../domains/seller-onboarding";
import { sellerInbox, buyerInbox } from "../../domains/seller-messages";
import { startPromotion, endPromotion } from "../../domains/seller-promotions";
import { matchProducts, promoPrice, promoState, UserFacingError } from "../../domains/engagement-rules";
import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { looseObjectSchema } from "./registry";

const MAX_LINES = 5;

function rubText(kopecks: number): string {
  return `${Math.round(kopecks / 100).toLocaleString("ru-RU")} ₽`;
}

function denied(error: string): ToolResult {
  return { ok: false, error, verification: "NOT_PROVEN" };
}

function queryArg(args: Record<string, unknown>): string {
  return typeof args.query === "string" ? args.query.trim() : "";
}

function goods(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? "товар" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "товара" : "товаров";
  return `${n} ${word}`;
}

interface Row {
  id: string;
  title: string;
  priceKopecks: number;
  oldPriceKopecks: number | null;
}

async function sellerProducts(sellerId: string): Promise<Row[]> {
  return prisma.product.findMany({
    where: { sellerId, status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, title: true, priceKopecks: true, oldPriceKopecks: true },
  });
}

type Plan = { ok: true; rows: Row[]; percent?: number } | { ok: false; error: string };

async function planStart(ctx: ToolContext, args: Record<string, unknown>): Promise<Plan> {
  if (!ctx.sellerProfileId || ctx.role !== "seller") return { ok: false, error: "скидки запускаются в кабинете продавца" };
  const percent = Number(args.percent);
  const query = queryArg(args);
  const all = await sellerProducts(ctx.sellerProfileId);
  if (all.length === 0) return { ok: false, error: "у вас нет опубликованных товаров, скидку пока не на что ставить" };
  const matched = matchProducts(all, query);
  if (matched.length === 0) return { ok: false, error: `среди ваших товаров не нашла «${query}». Напишите название точнее или откройте раздел «Акции»` };
  const rows = matched.filter((p) => !promoState(p).onPromo);
  if (rows.length === 0) return { ok: false, error: "на эти товары скидка уже идёт. Сначала верните обычную цену, потом запустите новую" };
  try {
    for (const r of rows) promoPrice(r.priceKopecks, percent);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.charAt(0).toLowerCase() + e.message.slice(1) : "неверная скидка" };
  }
  return { ok: true, rows, percent };
}

async function planEnd(ctx: ToolContext, args: Record<string, unknown>): Promise<Plan> {
  if (!ctx.sellerProfileId || ctx.role !== "seller") return { ok: false, error: "скидки управляются в кабинете продавца" };
  const query = queryArg(args);
  const rows = matchProducts((await sellerProducts(ctx.sellerProfileId)).filter((p) => promoState(p).onPromo), query);
  if (rows.length === 0) return { ok: false, error: query ? `среди товаров со скидкой нет «${query}»` : "сейчас ни на один ваш товар скидка не идёт" };
  return { ok: true, rows };
}

function lines(items: string[]): string {
  const shown = items.slice(0, MAX_LINES).map((s) => `• ${s}`);
  if (items.length > MAX_LINES) shown.push(`• и ещё ${goods(items.length - MAX_LINES)}`);
  return shown.join("\n");
}

export const startPromotionTool: ToolDefinition = {
  name: "start_promotion",
  description: "Запустить скидку в процентах (5–70%) на товары продавца: по названию (query) или на все товары. Требует подтверждения продавца.",
  permission: "CHANGE_PRICE",
  riskLevel: "FINANCIAL",
  needsConfirmation: true,
  parameters: looseObjectSchema({ percent: { type: "number" }, query: { type: "string" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const plan = await planStart(ctx, args);
    if (!plan.ok) return denied(plan.error);
    const gate = await getSellerOnboardingGate(ctx.sellerProfileId as string);
    if (!gate.active) return denied(`нельзя запускать акции: ${gate.blockers.join(", ")}`);
    try {
      const result = await startPromotion({ sellerId: ctx.sellerProfileId as string, actorId: ctx.userId, productIds: plan.rows.map((r) => r.id), percent: plan.percent });
      return {
        ok: true,
        data: result,
        summary:
          `Скидка ${plan.percent}% запущена на ${goods(result.started.length)}:\n` +
          lines(result.started.map((s) => `«${s.title}»: ${rubText(s.fromKopecks)} → ${rubText(s.toKopecks)}`)) +
          (result.notified ? `\nУведомила покупателей, которые ждали эти товары: ${result.notified}.` : "") +
          "\nВернуть обычную цену можно в разделе «Акции» или попросите меня.",
        verification: "VERIFIED",
      };
    } catch (e) {
      return denied(e instanceof UserFacingError ? e.message : "не удалось запустить скидку");
    }
  },
};

export const endPromotionTool: ToolDefinition = {
  name: "end_promotion",
  description: "Завершить скидку и вернуть обычную цену: на товары по названию (query) или на все товары со скидкой. Требует подтверждения.",
  permission: "CHANGE_PRICE",
  riskLevel: "FINANCIAL",
  needsConfirmation: true,
  parameters: looseObjectSchema({ query: { type: "string" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const plan = await planEnd(ctx, args);
    if (!plan.ok) return denied(plan.error);
    try {
      const result = await endPromotion({ sellerId: ctx.sellerProfileId as string, actorId: ctx.userId, productIds: plan.rows.map((r) => r.id) });
      return { ok: true, data: result, summary: `Обычная цена возвращена: ${goods(result.ended.length)}.\n${lines(result.ended.map((t) => `«${t}»`))}`, verification: "VERIFIED" };
    } catch (e) {
      return denied(e instanceof UserFacingError ? e.message : "не удалось вернуть обычную цену");
    }
  },
};

export const sellerMessagesTool: ToolDefinition = {
  name: "seller_messages",
  description: "Сообщения: продавцу вопросы покупателей и непрочитанные, покупателю переписка с магазинами.",
  permission: "READ_ORDERS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({}),
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const asSeller = ctx.role === "seller" && Boolean(ctx.sellerProfileId);
    const threads = asSeller ? await sellerInbox(ctx.sellerProfileId as string) : await buyerInbox(ctx.userId);
    const where = asSeller ? "разделе «Сообщения» кабинета" : "разделе «Сообщения» (меню профиля)";
    if (threads.length === 0) {
      return {
        ok: true,
        data: { threads: [] },
        summary: asSeller
          ? "Сообщений от покупателей пока нет. Они пишут со страницы товара, кнопкой «Задать вопрос продавцу»."
          : "Переписки с магазинами пока нет. Задать вопрос продавцу можно на странице товара.",
        verification: "VERIFIED",
      };
    }
    const unread = threads.reduce((s, t) => s + t.unread, 0);
    const head = unread > 0 ? (asSeller ? `Ждут вашего ответа: ${unread}.` : `Новых сообщений: ${unread}.`) : "Все сообщения прочитаны.";
    const list = lines(threads.map((t) => `${t.name}: ${t.lastIncoming ? "" : "вы: "}${t.lastBody.replace(/\s+/g, " ").slice(0, 80)}${t.unread > 0 ? " (новое)" : ""}`));
    return {
      ok: true,
      data: { threads: threads.map((t) => ({ name: t.name, unread: t.unread, lastAt: t.lastAt })) },
      summary: `${head}\n${list}\nОтветить можно в ${where}.`,
      verification: "VERIFIED",
    };
  },
};

/**
 * Что Светлана покажет перед кнопкой «Подтвердить действие». Если действие
 * выполнить нельзя (нет таких товаров, неверная скидка), подтверждение
 * не создаётся, а продавец сразу видит причину.
 */
export async function confirmPreview(
  toolName: string,
  ctx: ToolContext,
  args: Record<string, unknown>
): Promise<{ ok: true; text: string } | { ok: false; error: string } | null> {
  if (toolName === "start_promotion") {
    const plan = await planStart(ctx, args);
    if (!plan.ok) return plan;
    const percent = plan.percent as number;
    return {
      ok: true,
      text:
        `Запущу скидку ${percent}% на ${goods(plan.rows.length)}:\n` +
        lines(plan.rows.map((r) => `«${r.title}»: ${rubText(r.priceKopecks)} → ${rubText(promoPrice(r.priceKopecks, percent))}`)) +
        "\nЗачёркнутой будет настоящая прежняя цена. Тем, у кого товар в избранном, придёт уведомление.",
    };
  }
  if (toolName === "end_promotion") {
    const plan = await planEnd(ctx, args);
    if (!plan.ok) return plan;
    return {
      ok: true,
      text: `Верну обычную цену у ${goods(plan.rows.length)}:\n` + lines(plan.rows.map((r) => `«${r.title}»: ${rubText(r.priceKopecks)} → ${rubText(r.oldPriceKopecks ?? r.priceKopecks)}`)),
    };
  }
  return null;
}
