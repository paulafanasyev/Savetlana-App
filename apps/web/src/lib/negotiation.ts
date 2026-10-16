/**
 * B2B-переговоры двух ИИ-агентов: агент покупателя и агент продавца
 * договариваются о цене партии в рамках правил, которые задали люди.
 *
 * Чистые функции без базы и без LLM: каждое предложение объяснимо и
 * воспроизводимо, поэтому результат можно проверить тестами и показать жюри.
 *
 * Жёсткие границы (их не может обойти ни агент, ни текст покупателя):
 *   - цена никогда не ниже «пола» продавца (максимальная скидка за объём);
 *   - цена никогда не выше потолка бюджета покупателя;
 *   - не больше MAX_ROUNDS раундов;
 *   - партия не больше подтверждённого остатка;
 *   - договорённость — только проект КП: её подтверждают продавец и покупатель.
 */

export const MAX_ROUNDS = 10;
export const MAX_DISCOUNT_CAP_PERCENT = 70;

export interface VolumeTier {
  /** С какого количества штук действует скидка. */
  minQty: number;
  discountPercent: number;
}

/** Скидки за объём по умолчанию, если продавец не задал свои. */
export const DEFAULT_TIERS: VolumeTier[] = [
  { minQty: 10, discountPercent: 3 },
  { minQty: 50, discountPercent: 7 },
  { minQty: 100, discountPercent: 10 },
];

export interface SellerPolicy {
  listPriceKopecks: number;
  /** Скидки за объём, которые продавец даёт сразу. */
  volumeTiers: VolumeTier[];
  /** Сколько процентов сверх скидки за объём агент может уступить в торге. */
  negotiablePercent: number;
  /** Максимальная итоговая скидка, абсолютный предел продавца. */
  maxDiscountPercent: number;
  minOrderQty: number;
  /** Подтверждённый продавцом остаток; null — наличие не подтверждено. */
  stockQty: number | null;
  maxRounds: number;
}

export interface BuyerBrief {
  quantity: number;
  /** Желаемая цена за штуку. */
  targetPriceKopecks: number;
  /** Потолок бюджета за штуку: дороже агент покупателя не согласится. */
  maxPriceKopecks: number;
  maxRounds: number;
  /** Свободный текст покупателя. На цены не влияет никогда. */
  note?: string;
}

export type NegotiationStatus = "AGREED" | "NO_DEAL" | "NEEDS_HUMAN";

export interface NegotiationMove {
  round: number;
  from: "buyer" | "seller";
  unitPriceKopecks: number;
  action: "offer" | "accept" | "final";
  message: string;
}

export interface NegotiationResult {
  status: NegotiationStatus;
  reason: string;
  quantity: number;
  unitPriceKopecks: number | null;
  totalKopecks: number | null;
  discountPercent: number | null;
  rounds: number;
  transcript: NegotiationMove[];
  /** Кто ещё должен подтвердить, прежде чем КП станет заказом. */
  requiresConfirmation: Array<"seller" | "buyer">;
  /** В тексте покупателя были попытки командовать агентом; они проигнорированы. */
  ignoredInstructions: boolean;
  metrics: {
    /** Экономия покупателя относительно прайса, копейки на всю партию. */
    buyerSavingsKopecks: number;
    /** Запас продавца над его «полом», копейки на всю партию. */
    sellerMarginOverFloorKopecks: number;
    /** Насколько итог ближе к цели покупателя, 0..100. */
    buyerTargetAttainmentPercent: number;
    floorRespected: boolean;
    budgetRespected: boolean;
  };
}

const INJECTION = /игнорир|забудь (все |всё |)правил|ignore|system prompt|системн\S* (промпт|инструкц)|ты теперь|you are now|disregard|бесплатно|скидк\S*\s*(100|9\d)\s*%|отдай даром|override|jailbreak/i;

export function detectInstructions(note: string | undefined): boolean {
  return Boolean(note && INJECTION.test(note));
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Скидка за объём для партии: берём лучший подходящий уровень. */
export function tierDiscount(tiers: VolumeTier[], qty: number): number {
  let best = 0;
  for (const t of tiers) {
    if (qty >= t.minQty && t.discountPercent > best) best = t.discountPercent;
  }
  return best;
}

export function normalizePolicy(p: Partial<SellerPolicy> & { listPriceKopecks: number }): SellerPolicy {
  const maxDiscountPercent = clampInt(p.maxDiscountPercent ?? 15, 0, MAX_DISCOUNT_CAP_PERCENT, 15);
  const tiers = (p.volumeTiers ?? DEFAULT_TIERS)
    .filter((t) => Number.isFinite(t.minQty) && Number.isFinite(t.discountPercent))
    .map((t) => ({ minQty: clampInt(t.minQty, 1, 1_000_000, 1), discountPercent: clampInt(t.discountPercent, 0, maxDiscountPercent, 0) }))
    .sort((a, b) => a.minQty - b.minQty);
  return {
    listPriceKopecks: clampInt(p.listPriceKopecks, 1, 100_000_000_000, 1),
    volumeTiers: tiers,
    negotiablePercent: clampInt(p.negotiablePercent ?? 5, 0, maxDiscountPercent, 5),
    maxDiscountPercent,
    minOrderQty: clampInt(p.minOrderQty ?? 1, 1, 1_000_000, 1),
    stockQty: p.stockQty === null || p.stockQty === undefined ? null : clampInt(p.stockQty, 0, 10_000_000, 0),
    maxRounds: clampInt(p.maxRounds ?? 6, 1, MAX_ROUNDS, 6),
  };
}

/** Цена, с которой продавец открывает торг, и его «пол» для этой партии. */
export function sellerBounds(policy: SellerPolicy, qty: number): { openKopecks: number; floorKopecks: number; openDiscount: number; maxDiscount: number } {
  const openDiscount = Math.min(tierDiscount(policy.volumeTiers, qty), policy.maxDiscountPercent);
  const maxDiscount = Math.min(openDiscount + policy.negotiablePercent, policy.maxDiscountPercent);
  const list = policy.listPriceKopecks;
  // Обе цены в целых рублях; «пол» округляем вверх, и открытие никогда не ниже пола.
  const floorKopecks = Math.min(list, Math.ceil((list * (100 - maxDiscount)) / 10000) * 100);
  const openKopecks = Math.min(list, Math.max(floorKopecks, Math.round((list * (100 - openDiscount)) / 10000) * 100));
  return { openDiscount, maxDiscount, openKopecks, floorKopecks };
}

const rub = (k: number) => `${(k / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₽`;

/**
 * Переговоры по очереди: покупатель предлагает, продавец отвечает.
 * Продавец уступает поздно и мало (стратегия Боулвера), покупатель — плавно.
 * Каждая сторона принимает встречное предложение, если оно не хуже её
 * собственного следующего шага.
 */
export function negotiate(rawPolicy: Partial<SellerPolicy> & { listPriceKopecks: number }, rawBrief: BuyerBrief): NegotiationResult {
  const policy = normalizePolicy(rawPolicy);
  const quantity = clampInt(rawBrief.quantity, 1, 10_000_000, 1);
  const budget = clampInt(rawBrief.maxPriceKopecks, 1, 100_000_000_000, 1);
  const ignoredInstructions = detectInstructions(rawBrief.note);
  const rounds = Math.min(policy.maxRounds, clampInt(rawBrief.maxRounds ?? MAX_ROUNDS, 1, MAX_ROUNDS, MAX_ROUNDS));
  const { openKopecks, floorKopecks, openDiscount } = sellerBounds(policy, quantity);
  const list = policy.listPriceKopecks;
  // Платить больше, чем продавец просит сам, агент покупателя не станет.
  const maxPrice = Math.min(budget, openKopecks);
  const target = Math.min(clampInt(rawBrief.targetPriceKopecks, 1, 100_000_000_000, 1), maxPrice);
  const transcript: NegotiationMove[] = [];

  const finish = (status: NegotiationStatus, reason: string, unit: number | null, roundsUsed: number): NegotiationResult => {
    const total = unit === null ? null : unit * quantity;
    const floorRespected = unit === null || unit >= floorKopecks;
    const budgetRespected = unit === null || unit <= maxPrice;
    const span = list - target;
    return {
      status,
      reason,
      quantity,
      unitPriceKopecks: unit,
      totalKopecks: total,
      discountPercent: unit === null ? null : Math.round(((list - unit) / list) * 1000) / 10,
      rounds: roundsUsed,
      transcript,
      requiresConfirmation: status === "AGREED" ? ["seller", "buyer"] : [],
      ignoredInstructions,
      metrics: {
        buyerSavingsKopecks: unit === null ? 0 : Math.max(0, (list - unit) * quantity),
        sellerMarginOverFloorKopecks: unit === null ? 0 : Math.max(0, (unit - floorKopecks) * quantity),
        buyerTargetAttainmentPercent: unit === null ? 0 : span <= 0 ? 100 : Math.round(Math.min(1, Math.max(0, (list - unit) / span)) * 100),
        floorRespected,
        budgetRespected,
      },
    };
  };

  if (quantity < policy.minOrderQty) {
    return finish("NO_DEAL", `минимальная партия у продавца ${policy.minOrderQty} шт., запрошено ${quantity}`, null, 0);
  }
  if (policy.stockQty === null) {
    return finish("NEEDS_HUMAN", "продавец не подтвердил наличие: агент не может обещать партию, нужен ответ продавца", null, 0);
  }
  if (quantity > policy.stockQty) {
    return finish("NEEDS_HUMAN", `в наличии ${policy.stockQty} шт., запрошено ${quantity}: срок и объём допоставки согласует продавец`, null, 0);
  }

  // Покупатель открывает торг своей целевой ценой, но не ниже 30% прайса: заведомо абсурдные заявки не шлём.
  let buyerOffer = Math.max(target, Math.round(list * 0.3));
  let sellerOffer = openKopecks;
  // Шаг t от 0 (первое предложение) до 1 (последнее). Цены в целых рублях:
  // продавец округляет вверх, покупатель вниз, пределы при этом не нарушаются.
  const progress = (r: number) => (rounds <= 1 ? 1 : (r - 1) / (rounds - 1));
  const buyerNext = (r: number) => Math.min(maxPrice, Math.floor((target + (maxPrice - target) * Math.sqrt(progress(r))) / 100) * 100);
  const sellerNext = (r: number) => Math.max(floorKopecks, Math.ceil((openKopecks - (openKopecks - floorKopecks) * Math.pow(progress(r), 2)) / 100) * 100);

  for (let r = 1; r <= rounds; r++) {
    buyerOffer = Math.min(Math.max(buyerOffer, buyerNext(r)), maxPrice);
    if (buyerOffer >= sellerOffer && r > 1) {
      transcript.push({ round: r, from: "buyer", unitPriceKopecks: sellerOffer, action: "accept", message: `Принимаем ${rub(sellerOffer)} за штуку` });
      return finish("AGREED", "покупатель принял предложение продавца", sellerOffer, r);
    }
    transcript.push({
      round: r,
      from: "buyer",
      unitPriceKopecks: buyerOffer,
      action: "offer",
      message: r === 1 ? `Партия ${quantity} шт. Предлагаем ${rub(buyerOffer)} за штуку` : `Можем подняться до ${rub(buyerOffer)}`,
    });

    const sellerPlan = r === 1 ? openKopecks : sellerNext(r);
    if (buyerOffer >= sellerPlan) {
      const deal = Math.max(buyerOffer, floorKopecks);
      transcript.push({ round: r, from: "seller", unitPriceKopecks: deal, action: "accept", message: `Согласны на ${rub(deal)} за штуку` });
      return finish("AGREED", "продавец принял предложение покупателя", deal, r);
    }
    sellerOffer = sellerPlan;
    const last = r === rounds;
    transcript.push({
      round: r,
      from: "seller",
      unitPriceKopecks: sellerOffer,
      action: last ? "final" : "offer",
      message: r === 1
        ? `Прайс ${rub(list)}, за партию ${quantity} шт.${openDiscount > 0 ? ` скидка ${openDiscount}%` : ""}: ${rub(sellerOffer)}`
        : last ? `Последнее предложение: ${rub(sellerOffer)}` : `Можем ${rub(sellerOffer)} за штуку`,
    });
    if (last && sellerOffer <= maxPrice) {
      transcript.push({ round: r, from: "buyer", unitPriceKopecks: sellerOffer, action: "accept", message: `Укладывается в бюджет, принимаем ${rub(sellerOffer)}` });
      return finish("AGREED", "последнее предложение продавца в пределах бюджета", sellerOffer, r);
    }
  }

  if (floorKopecks > maxPrice) {
    return finish("NO_DEAL", `бюджет покупателя ${rub(budget)} ниже минимальной цены продавца для этой партии; агенты не уступят за свои пределы`, null, rounds);
  }
  return finish("NEEDS_HUMAN", "агенты не сошлись за отведённые раунды; разница небольшая, решение за людьми", null, rounds);
}
