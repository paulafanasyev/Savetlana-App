/**
 * Правила B2B-торга продавца: до какой скидки агент продавца может уступить,
 * скидки за объём, минимальная партия, срок поставки и условия оплаты.
 * Продавец задаёт их в кабинете («Торг B2B»); пока не задал, действуют
 * правила площадки по умолчанию.
 *
 * Хранятся служебной записью в памяти Светланы владельца кабинета (AiMemory,
 * ключ seller_negotiation_policy, не редактируется через «Что знает
 * Светлана»), поэтому схема базы не меняется. Каждое сохранение пишется в аудит.
 */
import { prisma } from "../prisma";
import { audit } from "./audit";
import { DEFAULT_TIERS, MAX_DISCOUNT_CAP_PERCENT, type VolumeTier } from "../negotiation";
import { DEFAULT_TERMS, normalizeTerms, type SellerTerms } from "../negotiation-terms";

export const POLICY_KEY = "seller_negotiation_policy";
const MAX_TIERS = 5;

export interface SellerNegotiationPolicy {
  /** Выключено: агент продавца не торгуется, цена только по прайсу. */
  enabled: boolean;
  maxDiscountPercent: number;
  negotiablePercent: number;
  minOrderQty: number;
  volumeTiers: VolumeTier[];
  /** Срок поставки и условия оплаты. */
  terms: SellerTerms;
  /** Правила заданы продавцом, а не взяты по умолчанию. */
  custom: boolean;
}

function envPercent(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = Number(raw);
  return raw !== undefined && Number.isFinite(n) && n >= 0 && n <= MAX_DISCOUNT_CAP_PERCENT ? Math.round(n) : fallback;
}

function int(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function defaultNegotiationPolicy(): SellerNegotiationPolicy {
  return {
    enabled: true,
    maxDiscountPercent: envPercent("NEGOTIATION_MAX_DISCOUNT_PERCENT", 15),
    negotiablePercent: envPercent("NEGOTIATION_EXTRA_PERCENT", 5),
    minOrderQty: 1,
    volumeTiers: DEFAULT_TIERS.map((t) => ({ ...t })),
    terms: { ...DEFAULT_TERMS },
    custom: false,
  };
}

/** Приводит ввод продавца к безопасным границам; мусор заменяется значениями по умолчанию. */
export function normalizeNegotiationPolicy(input: unknown): SellerNegotiationPolicy {
  const base = defaultNegotiationPolicy();
  if (!input || typeof input !== "object") return base;
  const p = input as Record<string, unknown>;
  const maxDiscountPercent = int(p.maxDiscountPercent, 0, MAX_DISCOUNT_CAP_PERCENT, base.maxDiscountPercent);
  const rawTiers: unknown[] = Array.isArray(p.volumeTiers) ? p.volumeTiers : base.volumeTiers;
  const tiers: VolumeTier[] = [];
  const seen = new Set<number>();
  for (const t of rawTiers.slice(0, MAX_TIERS)) {
    if (!t || typeof t !== "object") continue;
    const minQty = int((t as Record<string, unknown>).minQty, 1, 1_000_000, 0);
    const discountPercent = int((t as Record<string, unknown>).discountPercent, 0, maxDiscountPercent, -1);
    if (minQty < 2 || discountPercent < 0 || seen.has(minQty)) continue;
    seen.add(minQty);
    tiers.push({ minQty, discountPercent });
  }
  tiers.sort((a, b) => a.minQty - b.minQty);
  return {
    enabled: p.enabled !== false,
    maxDiscountPercent,
    negotiablePercent: int(p.negotiablePercent, 0, maxDiscountPercent, Math.min(base.negotiablePercent, maxDiscountPercent)),
    minOrderQty: int(p.minOrderQty, 1, 1_000_000, 1),
    volumeTiers: tiers,
    terms: normalizeTerms(p.terms),
    custom: true,
  };
}

export async function getSellerNegotiationPolicy(sellerProfileId: string): Promise<SellerNegotiationPolicy> {
  const seller = await prisma.sellerProfile.findUnique({ where: { id: sellerProfileId }, select: { userId: true } });
  if (!seller) return defaultNegotiationPolicy();
  const row = await prisma.aiMemory.findUnique({
    where: { userId_key: { userId: seller.userId, key: POLICY_KEY } },
    select: { value: true },
  });
  if (!row) return defaultNegotiationPolicy();
  try {
    return normalizeNegotiationPolicy(JSON.parse(row.value));
  } catch {
    return defaultNegotiationPolicy();
  }
}

export async function saveSellerNegotiationPolicy(
  sellerProfileId: string,
  actorUserId: string,
  input: unknown
): Promise<SellerNegotiationPolicy> {
  const seller = await prisma.sellerProfile.findUnique({ where: { id: sellerProfileId }, select: { userId: true } });
  if (!seller) throw new Error("кабинет продавца не найден");
  const before = await getSellerNegotiationPolicy(sellerProfileId);
  const policy = normalizeNegotiationPolicy(input);
  const value = JSON.stringify({
    enabled: policy.enabled,
    maxDiscountPercent: policy.maxDiscountPercent,
    negotiablePercent: policy.negotiablePercent,
    minOrderQty: policy.minOrderQty,
    volumeTiers: policy.volumeTiers,
    terms: policy.terms,
  });
  await prisma.aiMemory.upsert({
    where: { userId_key: { userId: seller.userId, key: POLICY_KEY } },
    create: {
      userId: seller.userId,
      type: "FACT",
      key: POLICY_KEY,
      value,
      confidence: 1,
      source: "seller_settings",
      evidence: "правила торга в кабинете продавца",
      isEditable: false,
    },
    update: { value, source: "seller_settings" },
  });
  await audit({
    action: "seller.negotiation_policy.update",
    actorId: actorUserId,
    actorRole: "seller",
    targetType: "seller_profile",
    targetId: sellerProfileId,
    before,
    after: policy,
  });
  return policy;
}
