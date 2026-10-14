import { describe, expect, it } from "vitest";
import { scanReview, textSimilarity, type ReviewForScan, type RecentReview } from "../src/lib/domains/review-guard";
import { assessBuyerRisk, type BuyerHistory } from "../src/lib/domains/buyer-abuse";

const now = new Date("2026-10-14T12:00:00Z");
const base: ReviewForScan = {
  rating: 5,
  body: "Хороший чайник, кипятит быстро, пластиком не пахнет",
  verifiedPurchase: true,
  authorAgeDays: 200,
  authorOrders: 12,
  authorIsSeller: false,
  authorReviewsLast24h: 0,
};
const codes = (r: ReviewForScan, ctx = {}) => scanReview(r, { now, ...ctx }).findings.map((f) => f.code);
const recent = (over: Partial<RecentReview>): RecentReview => ({
  rating: 5,
  body: "текст отзыва другой совсем",
  verifiedPurchase: false,
  authorAgeDays: 1,
  createdAt: new Date(now.getTime() - 60 * 60 * 1000),
  ...over,
});

describe("антифрод отзывов", () => {
  it("обычный отзыв покупателя проходит", () => {
    expect(scanReview(base, { now }).verdict).toBe("ok");
  });

  it("отзыв продавца на свой товар не принимается", () => {
    const v = scanReview({ ...base, authorIsSeller: true }, { now });
    expect(v.verdict).toBe("block");
    expect(v.findings.map((f) => f.code)).toContain("SELF_REVIEW");
  });

  it("фишинговая ссылка в отзыве не принимается, контакты уходят на проверку", () => {
    expect(scanReview({ ...base, body: "Отличный магазин, оплата тут bit.ly/abc123 со скидкой" }, { now }).verdict).toBe("block");
    expect(codes({ ...base, body: "Пишите мне в телеграм @shop_best, отдам дешевле" })).toContain("CONTACTS_IN_REVIEW");
  });

  it("отзыв за кешбэк уходит на проверку", () => {
    expect(codes({ ...base, body: "Продавец вернул кешбэк за отзыв, товар нормальный" })).toContain("INCENTIVIZED");
    expect(codes({ ...base, body: "Получила товар бесплатно за отзыв, всё супер" })).toContain("INCENTIVIZED");
    expect(codes({ ...base, body: "Брала со скидкой на распродаже, доставка быстрая" })).not.toContain("INCENTIVIZED");
  });

  it("новый аккаунт без покупки и крайняя оценка без покупок", () => {
    const c = codes({ ...base, verifiedPurchase: false, authorAgeDays: 0, authorOrders: 0, rating: 1 });
    expect(c).toContain("NEW_ACCOUNT_NO_PURCHASE");
    expect(c).toContain("NO_PURCHASE_EXTREME");
    expect(codes({ ...base, verifiedPurchase: false, authorAgeDays: 400, authorOrders: 3, rating: 4 })).toHaveLength(0);
  });

  it("повтор текста", () => {
    const body = "Отличный товар всем рекомендую качество супер доставка быстрая";
    expect(codes({ ...base, body }, { recentTexts: ["Отличный товар, всем рекомендую! Качество супер, доставка быстрая."] })).toContain("DUPLICATE_TEXT");
    expect(textSimilarity("кот спит на окне весь день", "собака бегает по двору с мячом")).toBe(0);
  });

  it("волна пятёрок от новых аккаунтов", () => {
    const wave = [recent({}), recent({}), recent({}), recent({})];
    const suspect = { ...base, verifiedPurchase: false, authorAgeDays: 1, authorOrders: 1, rating: 4 };
    expect(codes(suspect, { recentOnProduct: wave })).toContain("REVIEW_BURST");
    expect(codes(suspect, { recentOnProduct: wave.slice(0, 2) })).not.toContain("REVIEW_BURST");
    // Старые подтверждённые отзывы волну не образуют.
    expect(codes(suspect, { recentOnProduct: wave.map((r) => ({ ...r, verifiedPurchase: true, authorAgeDays: 300 })) })).not.toContain("REVIEW_BURST");
    // Покупатель с подтверждённой покупкой и старым аккаунтом в волну не попадает.
    expect(codes(base, { recentOnProduct: wave })).not.toContain("REVIEW_BURST");
  });

  it("много отзывов от одного человека за сутки", () => {
    expect(codes({ ...base, authorReviewsLast24h: 6 })).toContain("AUTHOR_FLOOD");
  });
});

const calm: BuyerHistory = {
  accountAgeDays: 500,
  ordersLast90: 10,
  disputesLast90: 1,
  disputesWonLast90: 0,
  distinctSellersInDisputes: 1,
  refundsLast90: 0,
  notReceivedButDelivered: 0,
};

describe("антифрод споров и возвратов", () => {
  it("обычный покупатель: риска нет", () => {
    expect(assessBuyerRisk(calm, { reason: "ITEM_DAMAGED", orderTotalKopecks: 300000, carrierDelivered: true }).level).toBe("low");
  });

  it("«не получил», хотя перевозчик вручил: повышенный риск", () => {
    const r = assessBuyerRisk({ ...calm, notReceivedButDelivered: 1 }, { reason: "ITEM_NOT_RECEIVED", orderTotalKopecks: 300000, carrierDelivered: true });
    expect(r.level).toBe("elevated");
    expect(r.signals.map((s) => s.code)).toContain("NOT_RECEIVED_BUT_DELIVERED");
  });

  it("повторное «не получил» при вручении и серийные споры: высокий риск", () => {
    const r = assessBuyerRisk(
      { ...calm, ordersLast90: 8, disputesLast90: 5, notReceivedButDelivered: 3, disputesWonLast90: 4, distinctSellersInDisputes: 4 },
      { reason: "ITEM_NOT_RECEIVED", orderTotalKopecks: 300000, carrierDelivered: true }
    );
    expect(r.level).toBe("high");
    expect(r.signals.map((s) => s.code)).toContain("SERIAL_DISPUTES");
  });

  it("частые возвраты и новый аккаунт с дорогим заказом", () => {
    const c = assessBuyerRisk({ ...calm, accountAgeDays: 2, ordersLast90: 5, refundsLast90: 3 }, { reason: "ITEM_NOT_AS_DESCRIBED", orderTotalKopecks: 5_000_000, carrierDelivered: false }).signals.map((s) => s.code);
    expect(c).toContain("FREQUENT_REFUNDS");
    expect(c).toContain("NEW_ACCOUNT_HIGH_VALUE");
  });
});
