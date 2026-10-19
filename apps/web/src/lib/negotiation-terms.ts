/**
 * Торг не только о цене: срок поставки и условия оплаты.
 *
 * Продавец в правилах торга задаёт обычный срок, самый быстрый срок и наценку
 * за срочность, скидку за 100% предоплату и предельную отсрочку с наценкой за
 * каждые 30 дней. Покупатель просит срок и условия оплаты. Здесь чистая
 * арифметика: к цене, о которой договорились агенты, применяются условия, и
 * каждое изменение объясняется строкой. Просьбу сверх правил агент не
 * выполняет, а предлагает ближайшее, что разрешил продавец.
 */

export interface SellerTerms {
  /** Обычный срок поставки, дней. */
  standardLeadDays: number;
  /** Быстрее этого продавец не может, дней. */
  rushLeadDays: number;
  /** Наценка за поставку быстрее обычного срока, %. */
  rushSurchargePercent: number;
  /** Скидка за 100% предоплату, %. */
  prepayDiscountPercent: number;
  /** Предельная отсрочка платежа, дней (0 — без отсрочки). */
  maxDeferralDays: number;
  /** Наценка за каждые 30 дней отсрочки, %. */
  deferralMarkupPercent: number;
}

export type PaymentTerms = "SAFE_DEAL" | "PREPAY" | "DEFERRAL";

export interface TermsRequest {
  leadDays?: number;
  payment?: PaymentTerms;
  deferralDays?: number;
}

export interface AppliedTerms {
  unitPriceKopecks: number;
  leadDays: number;
  payment: PaymentTerms;
  deferralDays: number;
  /** Поправка к цене, % (минус — скидка). */
  adjustmentPercent: number;
  lines: string[];
  /** Покупатель просил больше, чем разрешил продавец: условия скорректированы. */
  countered: boolean;
}

export const DEFAULT_TERMS: SellerTerms = {
  standardLeadDays: 7,
  rushLeadDays: 3,
  rushSurchargePercent: 3,
  prepayDiscountPercent: 2,
  maxDeferralDays: 30,
  deferralMarkupPercent: 1.5,
};

const MAX_DAYS = 365;

function num(v: unknown, min: number, max: number, fallback: number, step = 1): number {
  const n = Number(v);
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return fallback;
  const clamped = Math.min(max, Math.max(min, n));
  return Math.round(clamped / step) * step;
}

export function normalizeTerms(input: unknown): SellerTerms {
  const p = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const standardLeadDays = num(p.standardLeadDays, 1, MAX_DAYS, DEFAULT_TERMS.standardLeadDays);
  return {
    standardLeadDays,
    rushLeadDays: num(p.rushLeadDays, 1, standardLeadDays, Math.min(DEFAULT_TERMS.rushLeadDays, standardLeadDays)),
    rushSurchargePercent: num(p.rushSurchargePercent, 0, 30, DEFAULT_TERMS.rushSurchargePercent, 0.5),
    prepayDiscountPercent: num(p.prepayDiscountPercent, 0, 15, DEFAULT_TERMS.prepayDiscountPercent, 0.5),
    maxDeferralDays: num(p.maxDeferralDays, 0, 180, DEFAULT_TERMS.maxDeferralDays),
    deferralMarkupPercent: num(p.deferralMarkupPercent, 0, 10, DEFAULT_TERMS.deferralMarkupPercent, 0.5),
  };
}

const pct = (n: number) => `${String(Math.round(n * 10) / 10).replace(".", ",")}%`;

/** Применяет условия поставки и оплаты к цене, о которой договорились. */
export function applyTerms(unitPriceKopecks: number, req: TermsRequest, terms: SellerTerms): AppliedTerms {
  const lines: string[] = [];
  let adjustment = 0;
  let countered = false;

  // Срок поставки.
  let leadDays = terms.standardLeadDays;
  const wanted = req.leadDays !== undefined && Number.isFinite(req.leadDays) && req.leadDays > 0 ? Math.round(req.leadDays) : undefined;
  if (wanted !== undefined) {
    if (wanted >= terms.standardLeadDays) {
      leadDays = wanted;
      lines.push(`срок поставки ${leadDays} дн., без доплаты`);
    } else if (wanted >= terms.rushLeadDays) {
      leadDays = wanted;
      adjustment += terms.rushSurchargePercent;
      lines.push(`срочная поставка за ${leadDays} дн. вместо ${terms.standardLeadDays}: +${pct(terms.rushSurchargePercent)}`);
    } else {
      leadDays = terms.rushLeadDays;
      adjustment += terms.rushSurchargePercent;
      countered = true;
      lines.push(`быстрее ${terms.rushLeadDays} дн. продавец не может: предлагает ${terms.rushLeadDays} дн., +${pct(terms.rushSurchargePercent)}`);
    }
  } else {
    lines.push(`обычный срок поставки ${leadDays} дн.`);
  }

  // Оплата.
  let payment: PaymentTerms = req.payment ?? "SAFE_DEAL";
  let deferralDays = 0;
  if (payment === "PREPAY") {
    if (terms.prepayDiscountPercent > 0) {
      adjustment -= terms.prepayDiscountPercent;
      lines.push(`100% предоплата: −${pct(terms.prepayDiscountPercent)}`);
    } else {
      lines.push("100% предоплата, скидки за неё продавец не даёт");
    }
  } else if (payment === "DEFERRAL") {
    const asked = Math.max(1, Math.round(req.deferralDays ?? 30));
    if (terms.maxDeferralDays <= 0) {
      payment = "SAFE_DEAL";
      countered = true;
      lines.push("отсрочку продавец не даёт: оплата через безопасную сделку");
    } else {
      deferralDays = Math.min(asked, terms.maxDeferralDays);
      if (deferralDays < asked) {
        countered = true;
        lines.push(`отсрочка не больше ${terms.maxDeferralDays} дн. (просили ${asked})`);
      }
      const markup = Math.round(((terms.deferralMarkupPercent * deferralDays) / 30) * 10) / 10;
      adjustment += markup;
      lines.push(`отсрочка платежа ${deferralDays} дн.: +${pct(markup)}`);
    }
  } else {
    lines.push("оплата через безопасную сделку: деньги у площадки до получения");
  }

  adjustment = Math.round(adjustment * 10) / 10;
  // Цена в целых рублях, как и в торге.
  const unit = Math.max(100, Math.round((unitPriceKopecks * (1 + adjustment / 100)) / 100) * 100);
  return { unitPriceKopecks: unit, leadDays, payment, deferralDays, adjustmentPercent: adjustment, lines, countered };
}

export const PAYMENT_LABEL: Record<PaymentTerms, string> = {
  SAFE_DEAL: "безопасная сделка",
  PREPAY: "100% предоплата",
  DEFERRAL: "отсрочка платежа",
};

/** «Нужно за 3 дня, с отсрочкой 30 дней» → условия из текста. Чего нет, не выдумываем. */
export function termsFromText(text: string): TermsRequest {
  const t = text.toLowerCase();
  const out: TermsRequest = {};
  const lead =
    /(?:срок\S*(?:\s+поставки)?|поставк\S*|достав\S*|привез\S*|нужно|нужны|надо)\s+(?:за|через|в течение|до)?\s*(\d{1,3})\s*(?:дн|день|дня|раб)/i.exec(t) ??
    /(?:^|\s)за\s+(\d{1,3})\s*(?:дн|день|дня)/i.exec(t);
  if (lead) out.leadDays = Number(lead[1]);
  const def = /отсрочк\S*(?:\s+(?:платежа|оплаты))?(?:\s+(?:на|в))?\s*(\d{1,3})?\s*(?:дн|день|дня)?/i.exec(t);
  if (def) {
    out.payment = "DEFERRAL";
    if (def[1]) out.deferralDays = Number(def[1]);
  } else if (/предоплат|оплат\S* вперед|оплат\S* вперёд|сразу оплачу/.test(t)) {
    out.payment = "PREPAY";
  }
  return out;
}
