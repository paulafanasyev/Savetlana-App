/**
 * Эффективность B2B-агента для админки: сколько торгов провели агенты, чем
 * они закончились, сколько КП подтвердили продавцы и превратили в заказы,
 * сколько сэкономили покупатели и сколько попыток обмана отбили.
 *
 * Источники только реальные: журнал аудита (запуски торга, решения продавцов),
 * строки КП (PendingAction b2b_quote), события риска и вызовы модели. Чего нет
 * в данных, того нет и на дашборде.
 */
import { prisma } from "../prisma";
import { QUOTE_TOOL, parseQuote } from "./b2b-quotes";

export const NEGOTIATION_AUDIT = "b2b_negotiation.run";

export type NegotiationAuditEntry = {
  mode: "single" | "rfq";
  status: "AGREED" | "NO_DEAL" | "NEEDS_HUMAN" | "NO_NEGOTIATION";
  rounds: number;
  sellers: number;
  agreedSellers: number;
  quoteCreated: boolean;
  ignoredInstructions: boolean;
};

export type AgentEffectiveness = {
  days: number;
  negotiations: { total: number; agreed: number; noDeal: number; needsHuman: number; rfq: number; avgRounds: number; agreementRate: number; sellersAsked: number; injectionsIgnored: number };
  quotes: { total: number; awaiting: number; confirmed: number; declined: number; ordered: number; expired: number; tampered: number; sellerAcceptRate: number; orderConversion: number; avgDiscountPercent: number; medianSellerResponseMin: number | null };
  money: { orderedGmvKopecks: number; buyerSavingsKopecks: number };
  safety: { priceTamperBlocks: number; quoteTampered: number; injectionsIgnored: number };
  ai: { calls: number; successRate: number; avgLatencyMs: number };
};

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export async function getAgentEffectiveness(opts: { days?: number; now?: Date } = {}): Promise<AgentEffectiveness> {
  const days = opts.days ?? 30;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const [runs, quoteRows, decisions, tamperBlocks, aiRows] = await Promise.all([
    prisma.auditLog.findMany({ where: { action: NEGOTIATION_AUDIT, createdAt: { gte: since } }, select: { after: true }, take: 5000 }),
    prisma.pendingAction.findMany({ where: { toolName: QUOTE_TOOL, createdAt: { gte: since } }, select: { id: true, args: true, argsHash: true, status: true, createdAt: true, expiresAt: true }, take: 5000 }),
    prisma.auditLog.findMany({ where: { action: { in: ["b2b_quote.confirm", "b2b_quote.decline"] }, createdAt: { gte: since } }, select: { targetId: true, createdAt: true }, take: 5000 }),
    prisma.riskEvent.count({ where: { ruleId: "R5_price_mismatch", createdAt: { gte: since } } }),
    prisma.aiModelCall.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true }, _avg: { latencyMs: true } }),
  ]);

  // Торги.
  const n = { total: 0, agreed: 0, noDeal: 0, needsHuman: 0, rfq: 0, rounds: 0, sellersAsked: 0, injectionsIgnored: 0 };
  for (const r of runs) {
    let e: Partial<NegotiationAuditEntry>;
    try {
      e = JSON.parse(r.after ?? "{}") as Partial<NegotiationAuditEntry>;
    } catch {
      continue;
    }
    n.total += 1;
    if (e.status === "AGREED") n.agreed += 1;
    else if (e.status === "NEEDS_HUMAN") n.needsHuman += 1;
    else n.noDeal += 1;
    if (e.mode === "rfq") n.rfq += 1;
    n.rounds += Number(e.rounds) || 0;
    n.sellersAsked += Number(e.sellers) || 0;
    if (e.ignoredInstructions) n.injectionsIgnored += 1;
  }

  // КП.
  const q = { total: 0, awaiting: 0, confirmed: 0, declined: 0, ordered: 0, expired: 0, tampered: 0, discountSum: 0 };
  let gmv = 0;
  let savings = 0;
  const createdAt = new Map<string, Date>();
  for (const row of quoteRows) {
    const quote = parseQuote(row, now);
    if (!quote) {
      q.tampered += 1;
      continue;
    }
    q.total += 1;
    q.discountSum += quote.discountPercent;
    createdAt.set(quote.id, quote.createdAt);
    if (quote.status === "AWAITING_SELLER") q.awaiting += 1;
    else if (quote.status === "SELLER_CONFIRMED") q.confirmed += 1;
    else if (quote.status === "DECLINED") q.declined += 1;
    else if (quote.status === "EXPIRED") q.expired += 1;
    else if (quote.status === "ORDERED") {
      q.ordered += 1;
      gmv += quote.unitPriceKopecks * quote.quantity;
      savings += Math.max(0, quote.listPriceKopecks - quote.unitPriceKopecks) * quote.quantity;
    }
  }
  const responseMin: number[] = [];
  for (const d of decisions) {
    const c = d.targetId ? createdAt.get(d.targetId) : undefined;
    if (c) responseMin.push(Math.max(0, Math.round((d.createdAt.getTime() - c.getTime()) / 60000)));
  }
  const accepted = q.confirmed + q.ordered;

  // Модель.
  let calls = 0;
  let ok = 0;
  let latency = 0;
  for (const r of aiRows) {
    calls += r._count._all;
    if (r.status === "success") ok += r._count._all;
    latency += (r._avg.latencyMs ?? 0) * r._count._all;
  }

  return {
    days,
    negotiations: {
      total: n.total,
      agreed: n.agreed,
      noDeal: n.noDeal,
      needsHuman: n.needsHuman,
      rfq: n.rfq,
      avgRounds: n.total ? Math.round((n.rounds / n.total) * 10) / 10 : 0,
      agreementRate: pct(n.agreed, n.total),
      sellersAsked: n.sellersAsked,
      injectionsIgnored: n.injectionsIgnored,
    },
    quotes: {
      total: q.total,
      awaiting: q.awaiting,
      confirmed: q.confirmed,
      declined: q.declined,
      ordered: q.ordered,
      expired: q.expired,
      tampered: q.tampered,
      sellerAcceptRate: pct(accepted, accepted + q.declined),
      orderConversion: pct(q.ordered, accepted),
      avgDiscountPercent: q.total ? Math.round((q.discountSum / q.total) * 10) / 10 : 0,
      medianSellerResponseMin: median(responseMin),
    },
    money: { orderedGmvKopecks: gmv, buyerSavingsKopecks: savings },
    safety: { priceTamperBlocks: tamperBlocks, quoteTampered: q.tampered, injectionsIgnored: n.injectionsIgnored },
    ai: { calls, successRate: pct(ok, calls), avgLatencyMs: calls ? Math.round(latency / calls) : 0 },
  };
}
