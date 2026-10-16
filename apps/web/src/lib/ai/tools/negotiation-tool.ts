/**
 * negotiate_quote: агент покупателя и агент продавца торгуются о цене партии.
 *
 * Цену товара инструмент не меняет и ничего не продаёт. Агент продавца
 * действует строго в пределах правил торга этого продавца (кабинет →
 * «Торг B2B»); выключил торг — цена только по прайсу. Договорились —
 * сохраняется КП (b2b-quotes.ts): его подтверждает продавец, потом покупатель
 * оформляет заказ (человек в контуре).
 *
 * Два режима: с productId — торг с одним продавцом; с query — запрос цены
 * у нескольких продавцов (реверсивный аукцион), КП уходит лучшему. К цене
 * применяются условия: срок поставки, предоплата, отсрочка (negotiation-terms.ts).
 * Каждый запуск записывается в журнал аудита для дашборда эффективности.
 */
import { looseObjectSchema } from "./registry";
import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { prisma } from "../../prisma";
import { negotiate, type NegotiationResult } from "../../negotiation";
import { getSellerNegotiationPolicy } from "../../domains/negotiation-policy";
import { createQuote } from "../../domains/b2b-quotes";
import { audit } from "../../domains/audit";
import { NEGOTIATION_AUDIT, type NegotiationAuditEntry } from "../../domains/agent-effectiveness";
import { applyTerms, PAYMENT_LABEL, type AppliedTerms, type PaymentTerms, type SellerTerms, type TermsRequest } from "../../negotiation-terms";

function positiveRub(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

const rub = (k: number) => `${Math.round(k / 100).toLocaleString("ru-RU")} ₽`;

/** Запись запуска торга в журнал аудита (для дашборда админки). */
async function logNegotiation(ctx: ToolContext, targetType: string, targetId: string, entry: NegotiationAuditEntry): Promise<void> {
  await audit({ actorId: ctx.userId ?? undefined, actorRole: "buyer", action: NEGOTIATION_AUDIT, targetType, targetId: targetId.slice(0, 120), after: entry });
}

/** Условия, о которых просил покупатель: срок и оплата. Ничего не просил — null. */
export function termsRequest(args: Record<string, unknown>): TermsRequest | null {
  const out: TermsRequest = {};
  const lead = Number(args.leadDays);
  if (Number.isFinite(lead) && lead > 0) out.leadDays = Math.round(lead);
  if (args.payment === "PREPAY" || args.payment === "DEFERRAL" || args.payment === "SAFE_DEAL") out.payment = args.payment as PaymentTerms;
  const def = Number(args.deferralDays);
  if (Number.isFinite(def) && def > 0) {
    out.deferralDays = Math.round(def);
    out.payment = out.payment ?? "DEFERRAL";
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Цена после условий поставки и оплаты; без условий — цена торга как есть. */
function finalTerms(unitKopecks: number, req: TermsRequest | null, terms: SellerTerms): AppliedTerms | null {
  return req ? applyTerms(unitKopecks, req, terms) : null;
}

function termsSummary(t: AppliedTerms): string {
  return ` Условия: ${t.lines.join("; ")}.` + (t.countered ? " Часть просьб сверх правил продавца, агент предложил ближайшее возможное." : "");
}

/** «800 → 900 → 844 → … → 882 ₽»: ход торга одной строкой для чата. */
export function negotiationChain(r: NegotiationResult): string {
  const prices = r.transcript.filter((m) => m.action !== "accept").map((m) => Math.round(m.unitPriceKopecks / 100).toLocaleString("ru-RU"));
  if (prices.length === 0) return "";
  const last = r.unitPriceKopecks !== null ? ` → ${rub(r.unitPriceKopecks)}` : " ₽";
  return `Ход торга (покупатель → продавец): ${prices.join(" → ")}${last}.`;
}

export function negotiationSummary(title: string, r: NegotiationResult, listKopecks: number): string {
  const chain = negotiationChain(r);
  if (r.status === "AGREED" && r.unitPriceKopecks !== null && r.totalKopecks !== null) {
    return (
      `Агенты договорились по «${title}»: ${rub(r.unitPriceKopecks)} за штуку вместо ${rub(listKopecks)}` +
      ` (скидка ${String(r.discountPercent ?? 0).replace(".", ",")}%), партия ${r.quantity} шт., итого ${rub(r.totalKopecks)}, раундов: ${r.rounds}.` +
      (chain ? ` ${chain}` : "") +
      " Это проект КП: сначала его подтверждает продавец, потом вы. Цена в каталоге не меняется." +
      (r.ignoredInstructions ? " Команды в комментарии на цену не влияют и были проигнорированы." : "")
    );
  }
  const head = r.status === "NO_DEAL" ? "Сделки не получилось" : "Нужно решение человека";
  return `${head}: ${r.reason}.` + (chain ? ` ${chain}` : "") + (r.ignoredInstructions ? " Команды в комментарии проигнорированы." : "");
}

export const negotiateQuoteTool: ToolDefinition = {
  name: "negotiate_quote",
  description:
    "B2B-торг за партию товара: агент покупателя и агент продавца договариваются о цене за штуку в пределах правил торга продавца и бюджета покупателя, а также о сроке поставки и условиях оплаты (предоплата, отсрочка). Возвращает ход переговоров и КП, которое подтверждают люди. Если productId не указан, а указан query, агент запрашивает цену у нескольких продавцов сразу (до 5, реверсивный аукцион), торгуется с каждым и выбирает лучшее предложение. Ничего не покупает и не меняет цены.",
  permission: "READ_PRODUCTS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    productId: { type: "string", description: "id товара (торг с одним продавцом)" },
    query: { type: "string", description: "что ищем, если нужно собрать предложения у нескольких продавцов" },
    quantity: { type: "number", description: "сколько штук нужно" },
    targetPriceRub: { type: "number", description: "желаемая цена за штуку, ₽" },
    maxPriceRub: { type: "number", description: "потолок бюджета за штуку, ₽" },
    leadDays: { type: "number", description: "нужный срок поставки, дней" },
    payment: { type: "string", description: "условия оплаты: SAFE_DEAL (безопасная сделка, по умолчанию), PREPAY (100% предоплата), DEFERRAL (отсрочка)" },
    deferralDays: { type: "number", description: "отсрочка платежа, дней" },
    note: { type: "string", description: "комментарий покупателя" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const productId = typeof args.productId === "string" ? args.productId : "";
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!productId && query) return rfq(ctx, query, args);
    if (!productId) {
      return { ok: false, error: "укажите товар, по которому торговаться: найдите его в каталоге и напишите «поторгуйся за первый: 100 штук, хочу по 800 ₽» или «собери КП на перчатки, 100 штук»", verification: "NOT_PROVEN" };
    }
    const quantity = Math.round(Number(args.quantity));
    if (!Number.isFinite(quantity) || quantity < 1) {
      return { ok: false, error: "укажите, сколько штук нужно (целое число от 1)", verification: "NOT_PROVEN" };
    }
    const product = await prisma.product.findFirst({
      where: { id: productId, status: "ACTIVE" },
      select: {
        id: true,
        title: true,
        priceKopecks: true,
        sellerId: true,
        inventory: { select: { quantity: true, availability: true, confirmedBySeller: true } },
      },
    });
    if (!product) return { ok: false, error: "товар не найден или снят с продажи", verification: "NOT_PROVEN" };

    const policy = await getSellerNegotiationPolicy(product.sellerId);
    if (!policy.enabled) {
      return {
        ok: false,
        error: "этот продавец не торгуется через агента: цена только по прайсу. Можно написать продавцу и спросить про оптовую цену",
        verification: "VERIFIED",
      };
    }

    // Остаток обещаем, только если продавец его подтвердил (как в check_inventory).
    const inv = (product as unknown as { inventory?: unknown }).inventory;
    const row = (Array.isArray(inv) ? inv[0] : inv) as
      | { quantity: number; availability: string; confirmedBySeller: boolean }
      | null
      | undefined;
    const stockQty = row && row.confirmedBySeller && row.availability === "AVAILABLE" ? row.quantity : null;

    const list = product.priceKopecks;
    const result = negotiate(
      {
        listPriceKopecks: list,
        volumeTiers: policy.volumeTiers,
        maxDiscountPercent: policy.maxDiscountPercent,
        negotiablePercent: policy.negotiablePercent,
        minOrderQty: policy.minOrderQty,
        stockQty,
        maxRounds: 6,
      },
      {
        quantity,
        targetPriceKopecks: positiveRub(args.targetPriceRub) ?? Math.round(list * 0.85),
        maxPriceKopecks: positiveRub(args.maxPriceRub) ?? list,
        maxRounds: 6,
        note: typeof args.note === "string" ? args.note.slice(0, 500) : undefined,
      }
    );
    const applied = result.status === "AGREED" && result.unitPriceKopecks !== null ? finalTerms(result.unitPriceKopecks, termsRequest(args), policy.terms) : null;
    const finalUnit = applied?.unitPriceKopecks ?? result.unitPriceKopecks;
    // Договорились: сохраняем КП и отправляем продавцу на подтверждение.
    let quoteId: string | null = null;
    let quoteNote = "";
    if (result.status === "AGREED" && finalUnit !== null && result.totalKopecks !== null && ctx.userId) {
      try {
        const quote = await createQuote({
          productId: product.id,
          sellerId: product.sellerId,
          buyerId: ctx.userId,
          title: product.title,
          quantity: result.quantity,
          unitPriceKopecks: finalUnit,
          listPriceKopecks: list,
          totalKopecks: finalUnit * result.quantity,
          discountPercent: Math.round((1 - finalUnit / list) * 1000) / 10,
          rounds: result.rounds,
          chain: negotiationChain(result),
          ...(applied ? { leadDays: applied.leadDays, payment: applied.payment, deferralDays: applied.deferralDays || undefined, termsLines: applied.lines } : {}),
        });
        quoteId = quote.id;
        quoteNote = ` ${quote.number} отправлено продавцу на подтверждение, следить и оформить заказ: [Мои КП](/quotes).`;
      } catch {
        quoteNote = "";
      }
    }
    await logNegotiation(ctx, "Product", product.id, {
      mode: "single",
      status: result.status,
      rounds: result.rounds,
      sellers: 1,
      agreedSellers: result.status === "AGREED" ? 1 : 0,
      quoteCreated: quoteId !== null,
      ignoredInstructions: Boolean(result.ignoredInstructions),
    });
    return {
      ok: true,
      data: { productId: product.id, title: product.title, listPriceKopecks: list, sellerRules: policy.custom ? "seller" : "default", quoteId, ...result, terms: applied, finalUnitPriceKopecks: finalUnit },
      summary:
        negotiationSummary(product.title, result, list) +
        (applied ? `${termsSummary(applied)} Цена с условиями: ${rub(applied.unitPriceKopecks)} за штуку, итого ${rub(applied.unitPriceKopecks * result.quantity)}.` : "") +
        quoteNote,
      verification: "VERIFIED",
    };
  },
};

const MAX_RFQ_SELLERS = 5;

/** Основы слов запроса без окончаний: «каски защитные» → «каск», «защитн». */
export function rfqStems(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^a-zа-я0-9]+/i)
    .filter((w) => w.length >= 3)
    .slice(0, 4)
    .map((w) => (w.length > 5 ? w.slice(0, w.length - 2) : w.length > 4 ? w.slice(0, 4) : w));
}

interface RfqOffer {
  productId: string;
  title: string;
  seller: string;
  sellerId: string;
  listPriceKopecks: number;
  /** Цена по итогам торга с учётом условий; если не договорились, цена прайса. */
  priceKopecks: number;
  status: "AGREED" | "NO_DEAL" | "NEEDS_HUMAN" | "NO_NEGOTIATION";
  rounds: number;
  reason: string;
  terms: AppliedTerms | null;
}

/**
 * Запрос цены у нескольких продавцов (реверсивный аукцион): находим товар у
 * разных продавцов, агент покупателя торгуется с агентом каждого в пределах
 * его правил, лучшее предложение становится КП. Остальные видны для сравнения.
 */
async function rfq(ctx: ToolContext, query: string, args: Record<string, unknown>): Promise<ToolResult> {
  const quantity = Math.round(Number(args.quantity));
  if (!Number.isFinite(quantity) || quantity < 1) {
    return { ok: false, error: "укажите, сколько штук нужно (целое число от 1)", verification: "NOT_PROVEN" };
  }
  const stems = rfqStems(query);
  if (stems.length === 0) {
    return { ok: false, error: "уточните, какой товар нужен: например, «собери КП на перчатки рабочие, 100 штук»", verification: "NOT_PROVEN" };
  }
  // Только опубликованные товары; снятые с размещения (isLive=false) не берём.
  const candidates = await prisma.product.findMany({
    where: { status: "ACTIVE", NOT: { listing: { isLive: false } } },
    orderBy: [{ rating: "desc" }, { updatedAt: "desc" }],
    take: 500,
    select: {
      id: true,
      title: true,
      keywords: true,
      priceKopecks: true,
      sellerProfile: { select: { id: true, displayName: true, userId: true } },
      inventory: { select: { quantity: true, availability: true, confirmedBySeller: true } },
    },
  });
  const picked: typeof candidates = [];
  const seen = new Set<string>();
  for (const p of candidates) {
    if (seen.has(p.sellerProfile.id) || p.sellerProfile.userId === ctx.userId) continue;
    const hay = `${p.title} ${p.keywords}`.toLowerCase().replace(/ё/g, "е");
    if (!stems.every((st) => hay.includes(st))) continue;
    seen.add(p.sellerProfile.id);
    picked.push(p);
    if (picked.length >= MAX_RFQ_SELLERS) break;
  }
  if (picked.length === 0) {
    return { ok: false, error: `не нашла «${query}» у продавцов площадки. Уточните название`, verification: "NOT_PROVEN" };
  }

  const offers: RfqOffer[] = [];
  const deals = new Map<string, NegotiationResult>();
  for (const p of picked) {
    const base = { productId: p.id, title: p.title, seller: p.sellerProfile.displayName, sellerId: p.sellerProfile.id, listPriceKopecks: p.priceKopecks };
    const policy = await getSellerNegotiationPolicy(p.sellerProfile.id);
    if (!policy.enabled) {
      offers.push({ ...base, priceKopecks: p.priceKopecks, status: "NO_NEGOTIATION", rounds: 0, reason: "продавец не торгуется, цена по прайсу", terms: null });
      continue;
    }
    const invRaw = (p as unknown as { inventory?: unknown }).inventory;
    const inv = (Array.isArray(invRaw) ? invRaw[0] : invRaw) as { quantity: number; availability: string; confirmedBySeller: boolean } | null | undefined;
    const stockQty = inv && inv.confirmedBySeller && inv.availability === "AVAILABLE" ? inv.quantity : null;
    const result = negotiate(
      {
        listPriceKopecks: p.priceKopecks,
        volumeTiers: policy.volumeTiers,
        maxDiscountPercent: policy.maxDiscountPercent,
        negotiablePercent: policy.negotiablePercent,
        minOrderQty: policy.minOrderQty,
        stockQty,
        maxRounds: 6,
      },
      {
        quantity,
        targetPriceKopecks: positiveRub(args.targetPriceRub) ?? Math.round(p.priceKopecks * 0.85),
        maxPriceKopecks: positiveRub(args.maxPriceRub) ?? p.priceKopecks,
        maxRounds: 6,
        note: typeof args.note === "string" ? args.note.slice(0, 500) : undefined,
      }
    );
    deals.set(p.id, result);
    const applied = result.status === "AGREED" && result.unitPriceKopecks !== null ? finalTerms(result.unitPriceKopecks, termsRequest(args), policy.terms) : null;
    offers.push({
      ...base,
      priceKopecks: result.status === "AGREED" && result.unitPriceKopecks !== null ? applied?.unitPriceKopecks ?? result.unitPriceKopecks : p.priceKopecks,
      status: result.status,
      rounds: result.rounds,
      reason:
        result.status === "AGREED"
          ? `договорились за ${result.rounds} раунд.${applied ? `, поставка ${applied.leadDays} дн., ${applied.payment === "DEFERRAL" ? `отсрочка ${applied.deferralDays} дн.` : PAYMENT_LABEL[applied.payment]}` : ""}`
          : result.reason,
      terms: applied,
    });
  }

  const agreed = offers.filter((o) => o.status === "AGREED").sort((a, b) => a.priceKopecks - b.priceKopecks);
  const rest = offers.filter((o) => o.status !== "AGREED");
  const ranked = [...agreed, ...rest];
  const winner = agreed[0] ?? null;

  let quoteId: string | null = null;
  let quoteNote = "";
  if (winner && ctx.userId) {
    const deal = deals.get(winner.productId)!;
    try {
      const quote = await createQuote({
        productId: winner.productId,
        sellerId: winner.sellerId,
        buyerId: ctx.userId,
        title: winner.title,
        quantity: deal.quantity,
        unitPriceKopecks: winner.priceKopecks,
        listPriceKopecks: winner.listPriceKopecks,
        totalKopecks: winner.priceKopecks * deal.quantity,
        discountPercent: Math.round((1 - winner.priceKopecks / winner.listPriceKopecks) * 1000) / 10,
        rounds: deal.rounds,
        chain: `Лучшее из ${offers.length} предложений. ${negotiationChain(deal)}`,
        ...(winner.terms ? { leadDays: winner.terms.leadDays, payment: winner.terms.payment, deferralDays: winner.terms.deferralDays || undefined, termsLines: winner.terms.lines } : {}),
      });
      quoteId = quote.id;
      quoteNote = ` ${quote.number} с лучшим продавцом отправлено ему на подтверждение: [Мои КП](/quotes).`;
    } catch {
      quoteNote = "";
    }
  }

  await logNegotiation(ctx, "b2b_rfq", query, {
    mode: "rfq",
    status: winner ? "AGREED" : offers.some((o) => o.status === "NEEDS_HUMAN") ? "NEEDS_HUMAN" : "NO_DEAL",
    rounds: offers.reduce((sum, o) => sum + o.rounds, 0),
    sellers: offers.length,
    agreedSellers: agreed.length,
    quoteCreated: quoteId !== null,
    ignoredInstructions: [...deals.values()].some((d) => Boolean(d.ignoredInstructions)),
  });

  const lines = ranked.map((o, i) => {
    const price = o.status === "AGREED" ? `${rub(o.priceKopecks)} за шт. (прайс ${rub(o.listPriceKopecks)})` : `${rub(o.listPriceKopecks)} по прайсу`;
    return `${i + 1}) ${o.seller}, «${o.title}»: ${price}, ${o.reason}${o === winner ? " ← лучшее" : ""}`;
  });
  const head = winner
    ? `Запросила цену у ${offers.length} продавцов на ${quantity} шт. Лучшее: ${winner.seller}, ${rub(winner.priceKopecks)} за штуку, итого ${rub(winner.priceKopecks * quantity)}.`
    : `Запросила цену у ${offers.length} продавцов на ${quantity} шт., но ни с кем не договорились в пределах бюджета.`;
  return {
    ok: true,
    data: { mode: "rfq", query, quantity, offers: ranked, winnerProductId: winner?.productId ?? null, quoteId },
    summary: `${head}\n${lines.join("\n")}${quoteNote}`,
    verification: "VERIFIED",
  };
}
