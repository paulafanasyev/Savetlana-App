/**
 * Светлана продлевает скидку: тот же расчёт, что и кнопка «Продлить» в
 * разделе «Акции». Цены не меняются, сдвигается только дата окончания.
 * Перед подтверждением продавец видит, до какого числа скидка идёт сейчас
 * и до какого будет идти. С ending: true продлеваются только скидки, которые
 * закончатся в течение суток (без срока на неделю).
 */
import { prisma } from "../../prisma";
import { extendPromotion } from "../../domains/promo-extend";
import { extendReasonText, extendedEnd } from "../../domains/promo-extend-rules";
import { extractPromoDuration, matchProducts, promoDateText, promoMark, promoState, UserFacingError } from "../../domains/engagement-rules";
import type { ToolContext, ToolDefinition, ToolResult } from "./registry";
import { looseObjectSchema } from "./registry";
import { sellerEndingPromoIds } from "../../domains/seller-badges";
import { PROMO_EXTEND_DAYS } from "../../seller-todo";

const MAX_LINES = 5;

function goods(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? "товар" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "товара" : "товаров";
  return `${n} ${word}`;
}

function daysText(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? "день" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "дня" : "дней";
  return `${n} ${word}`;
}

function lines(items: string[]): string {
  const shown = items.slice(0, MAX_LINES).map((s) => `• ${s}`);
  if (items.length > MAX_LINES) shown.push(`• и ещё ${goods(items.length - MAX_LINES)}`);
  return shown.join("\n");
}

function lower(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

interface Planned {
  id: string;
  title: string;
  from: Date;
  to: Date;
}

type Plan = { ok: true; days: number; rows: Planned[]; skipped: string[] } | { ok: false; error: string };

async function planExtend(ctx: ToolContext, args: Record<string, unknown>): Promise<Plan> {
  if (!ctx.sellerProfileId || ctx.role !== "seller") return { ok: false, error: "скидки управляются в кабинете продавца" };
  const parsed = extractPromoDuration(typeof args.query === "string" ? args.query.trim() : "");
  const query = parsed.rest.replace(/^(?:для|на|с|со)\s+/i, "").trim();
  const ending = args.ending === true;
  const days = Number(args.days ?? parsed.days ?? (ending ? PROMO_EXTEND_DAYS : undefined));
  if (!Number.isInteger(days) || days < 1) {
    return { ok: false, error: "не поняла, на сколько дней продлить. Напишите, например: «продли скидку на кроссовки на 7 дней»" };
  }
  // «Всё, что заканчивается»: ровно те товары, что и в блоке «Что сделать сегодня».
  const endingIds = ending ? await sellerEndingPromoIds(ctx.sellerProfileId) : null;
  if (endingIds && endingIds.length === 0) return { ok: false, error: "скидок, которые закончатся в течение суток, сейчас нет" };
  const products = await prisma.product.findMany({
    where: { sellerId: ctx.sellerProfileId, status: "ACTIVE", oldPriceKopecks: { not: null }, ...(endingIds ? { id: { in: endingIds } } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, title: true, priceKopecks: true, oldPriceKopecks: true },
  });
  const onPromo = matchProducts(products.filter((p) => promoState(p).onPromo), query);
  if (onPromo.length === 0) {
    return { ok: false, error: query ? `среди товаров со скидкой нет «${query}»` : "сейчас ни на один ваш товар скидка не идёт" };
  }
  const rows: Planned[] = [];
  const skipped: string[] = [];
  for (const p of onPromo) {
    const row = await prisma.listingHistory.findFirst({
      where: { productId: p.id, action: "PRICE_CHANGED" },
      orderBy: { createdAt: "desc" },
      select: { change: true, createdAt: true },
    });
    const mark = row ? promoMark(row) : null;
    if (!row || !mark || mark.priceTo !== p.priceKopecks) {
      skipped.push(`«${p.title}»: не нашла запуск скидки в истории цен`);
      continue;
    }
    const result = extendedEnd({ startedAt: row.createdAt, endsAt: mark.endsAt, days });
    if (!result.ok || !mark.endsAt) {
      skipped.push(`«${p.title}»: ${lower(extendReasonText(result.ok ? "no_end" : result.reason))}`);
      continue;
    }
    rows.push({ id: p.id, title: p.title, from: mark.endsAt, to: result.endsAt });
  }
  if (rows.length === 0) {
    const reason = skipped[0]?.replace(/^«[^»]*»:\s*/, "") ?? "продлить нечего";
    return { ok: false, error: skipped.length === 1 ? reason : `ни одну скидку продлить нельзя: ${reason}` };
  }
  return { ok: true, days, rows, skipped };
}

function skippedNote(skipped: string[]): string {
  return skipped.length ? `\nНе продлю: ${goods(skipped.length)}.\n${lines(skipped)}` : "";
}

/** Текст перед кнопкой «Подтвердить действие». null: это не продление. */
export async function extendPromotionPreview(
  toolName: string,
  ctx: ToolContext,
  args: Record<string, unknown>
): Promise<{ ok: true; text: string } | { ok: false; error: string } | null> {
  if (toolName !== "extend_promotion") return null;
  const plan = await planExtend(ctx, args);
  if (!plan.ok) return plan;
  return {
    ok: true,
    text:
      `Продлю скидку на ${daysText(plan.days)} у ${goods(plan.rows.length)}:\n` +
      lines(plan.rows.map((r) => `«${r.title}»: до ${promoDateText(r.from)} → до ${promoDateText(r.to)}`)) +
      "\nЦены не изменятся, сдвинется только дата окончания." +
      skippedNote(plan.skipped),
  };
}

export const extendPromotionTool: ToolDefinition = {
  name: "extend_promotion",
  description: "Продлить идущую скидку со сроком на несколько дней (days, 1–30): на товары по названию (query), на все товары со скидкой или (ending: true) только на те, что закончатся в течение суток. Цены не меняются. Вся акция не дольше 30 дней с запуска. Требует подтверждения.",
  permission: "CHANGE_PRICE",
  riskLevel: "FINANCIAL",
  needsConfirmation: true,
  parameters: looseObjectSchema({ query: { type: "string" }, days: { type: "number", description: "на сколько дней продлить, 1–30" }, ending: { type: "boolean", description: "только скидки, которые закончатся в течение суток" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const plan = await planExtend(ctx, args);
    if (!plan.ok) return { ok: false, error: plan.error, verification: "NOT_PROVEN" };
    try {
      const result = await extendPromotion({ sellerId: ctx.sellerProfileId as string, productIds: plan.rows.map((r) => r.id), days: plan.days });
      return {
        ok: true,
        data: result,
        summary:
          `Скидка продлена: ${goods(result.extended.length)}.\n` +
          lines(result.extended.map((e) => `«${e.title}»: до ${promoDateText(new Date(e.endsAt))}`)) +
          "\nВ новую дату обычная цена вернётся сама." +
          skippedNote(result.skipped.map((s) => `«${s.title}»: ${lower(s.reason)}`)),
        verification: "VERIFIED",
      };
    } catch (e) {
      return { ok: false, error: e instanceof UserFacingError ? lower(e.message) : "не удалось продлить скидку", verification: "NOT_PROVEN" };
    }
  },
};
