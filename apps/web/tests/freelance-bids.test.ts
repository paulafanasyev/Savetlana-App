import { describe, expect, it } from "vitest";
import { bidBody, isBidAd, latestBids, parseBidBody, parseBidInput, sortBids } from "../src/lib/freelance-bids";

describe("предложения исполнителей", () => {
  it("принимаются только по заказам на услуги", () => {
    expect(isBidAd({ vertical: "SERVICE", dealType: "SERVICE_REQUEST" })).toBe(true);
    expect(isBidAd({ vertical: "SERVICE", dealType: "SERVICE_OFFER" })).toBe(false);
    expect(isBidAd({ vertical: "JOB", dealType: "VACANCY" })).toBe(false);
  });

  it("проверяет цену, срок и описание", () => {
    const ok = parseBidInput({ price: "15 000", days: "5", text: "Сделаю сайт на Next.js с адаптивом" });
    expect(ok.ok && ok.bid.priceKopecks).toBe(1_500_000);
    expect(parseBidInput({ price: "50", days: 5, text: "Сделаю быстро и аккуратно" }).ok).toBe(false);
    expect(parseBidInput({ price: 5000, days: 0, text: "Сделаю быстро и аккуратно" }).ok).toBe(false);
    expect(parseBidInput({ price: 5000, days: 3, text: "коротко" }).ok).toBe(false);
    expect(parseBidInput({ price: "абв", days: 3, text: "Сделаю быстро и аккуратно" }).ok).toBe(false);
  });

  it("текст отклика разбирается обратно", () => {
    const body = bidBody({ priceKopecks: 1_250_000, days: 3, text: "Опыт 5 лет, портфолио по ссылке" });
    expect(body.startsWith("💼 Предложение: 12 500 ₽ · срок 3 дня")).toBe(true);
    expect(parseBidBody(body)).toEqual({ priceKopecks: 1_250_000, days: 3, text: "Опыт 5 лет, портфолио по ссылке" });
    expect(parseBidBody("Здравствуйте, а когда нужно?")).toBeNull();
  });

  it("берёт последнее предложение исполнителя и сортирует", () => {
    const t = (h: number) => new Date(Date.UTC(2026, 9, 16, h));
    const bids = latestBids([
      { applicantId: "a", body: bidBody({ priceKopecks: 900_000, days: 10, text: "первое предложение" }), createdAt: t(1) },
      { applicantId: "a", body: bidBody({ priceKopecks: 700_000, days: 8, text: "снизил цену, срок тот же" }), createdAt: t(3) },
      { applicantId: "a", body: "а можно вопрос?", createdAt: t(4) },
      { applicantId: "b", body: bidBody({ priceKopecks: 800_000, days: 2, text: "сделаю за два дня" }), createdAt: t(2) },
    ]);
    expect(bids.length).toBe(2);
    expect(sortBids(bids, "price").map((b) => b.applicantId)).toEqual(["a", "b"]);
    expect(sortBids(bids, "days").map((b) => b.applicantId)).toEqual(["b", "a"]);
    expect(sortBids(bids, "price")[0]?.priceKopecks).toBe(700_000);
  });
});
