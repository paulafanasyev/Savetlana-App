import { describe, expect, it } from "vitest";
import { checkNpdStatus, moscowDate, NPD_ENDPOINT } from "../src/lib/domains/npd-check";
import { computeSellerRating, sellerBadges } from "../src/lib/domains/seller-trust-display";

const NPD_INN = "500100732259";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; body: string }[] = [];
  const impl = (async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: String(init?.body ?? "") });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("проверка самозанятого в ФНС", () => {
  const now = new Date("2026-10-14T22:30:00Z");

  it("дата запроса по Москве", () => {
    expect(moscowDate(now)).toBe("2026-10-15");
  });

  it("ФНС подтвердила статус НПД", async () => {
    const f = fakeFetch(200, { status: true, message: "500100732259 является плательщиком НПД" });
    const r = await checkNpdStatus(NPD_INN, { now, fetchImpl: f.impl });
    expect(r.status).toBe("VERIFIED");
    expect(f.calls[0]?.url).toBe(NPD_ENDPOINT);
    expect(JSON.parse(f.calls[0]?.body ?? "{}")).toEqual({ inn: NPD_INN, requestDate: "2026-10-15" });
  });

  it("ФНС ответила, что не самозанятый", async () => {
    const f = fakeFetch(200, { status: false, message: "не является плательщиком НПД" });
    expect((await checkNpdStatus(NPD_INN, { now, fetchImpl: f.impl })).status).toBe("REJECTED");
  });

  it("неверный ИНН не уходит в ФНС", async () => {
    const f = fakeFetch(200, { status: true });
    const r = await checkNpdStatus("7707083893", { now, fetchImpl: f.impl });
    expect(r.status).toBe("REJECTED");
    expect(f.calls).toHaveLength(0);
  });

  it("422 от ФНС: ИНН не принят", async () => {
    const f = fakeFetch(422, { code: "validation.failed", message: "Указан некорректный ИНН" });
    expect((await checkNpdStatus(NPD_INN, { now, fetchImpl: f.impl })).status).toBe("REJECTED");
  });

  it("429 и сбой сети не ставят отметку", async () => {
    const f = fakeFetch(429, {});
    expect((await checkNpdStatus(NPD_INN, { now, fetchImpl: f.impl })).status).toBe("UNAVAILABLE");
    const broken = (async () => { throw new Error("сеть"); }) as unknown as typeof fetch;
    expect((await checkNpdStatus(NPD_INN, { now, fetchImpl: broken })).status).toBe("UNAVAILABLE");
    const odd = fakeFetch(200, { foo: 1 });
    expect((await checkNpdStatus(NPD_INN, { now, fetchImpl: odd.impl })).status).toBe("UNAVAILABLE");
  });

  it("в тестах без явного fetch в ФНС не ходит", async () => {
    expect((await checkNpdStatus(NPD_INN, { now })).status).toBe("UNAVAILABLE");
  });
});

describe("отметки продавца", () => {
  const base = { sellerType: "SELF_EMPLOYED", identityStatus: "UNVERIFIED", businessStatus: "UNVERIFIED", npdStatus: "UNVERIFIED" };

  it("без проверок отметок нет", () => {
    expect(sellerBadges(base)).toHaveLength(0);
  });

  it("только ФНС: отметка самозанятого, но не «проверенный продавец»", () => {
    const keys = sellerBadges({ ...base, npdStatus: "VERIFIED" }).map((b) => b.key);
    expect(keys).toEqual(["npd_fns"]);
  });

  it("личность и ФНС: проверенный продавец", () => {
    const keys = sellerBadges({ ...base, npdStatus: "VERIFIED", identityStatus: "VERIFIED" }).map((b) => b.key);
    expect(keys).toEqual(["verified_seller", "npd_fns", "identity"]);
  });

  it("организация подтверждена", () => {
    const labels = sellerBadges({ ...base, sellerType: "COMPANY", businessStatus: "VERIFIED" }).map((b) => b.label);
    expect(labels).toEqual(["Организация подтверждена"]);
  });

  it("на проверке и отклонено не дают отметок", () => {
    expect(sellerBadges({ ...base, npdStatus: "PENDING", identityStatus: "REJECTED" })).toHaveLength(0);
  });
});

describe("рейтинг продавца", () => {
  const zero = { verifiedSum: 0, verifiedCount: 0, otherSum: 0, otherCount: 0, completedOrders: 0, cancelledAfterPayment: 0, refundedOrders: 0, disputedOrders: 0 };

  it("новый продавец без отзывов", () => {
    const r = computeSellerRating(zero);
    expect(r.score).toBe(0);
    expect(r.level).toBe("new");
    expect(r.successRate).toBeNull();
  });

  it("один отзыв «5» не даёт сразу 5.0", () => {
    const r = computeSellerRating({ ...zero, verifiedSum: 5, verifiedCount: 1 });
    expect(r.score).toBe(4.2);
    expect(r.average).toBe(5);
  });

  it("отзывы без покупки весят меньше", () => {
    const real = computeSellerRating({ ...zero, verifiedSum: 10, verifiedCount: 10 });
    const fake = computeSellerRating({ ...zero, otherSum: 50, otherCount: 10 });
    expect(real.score).toBe(2);
    expect(fake.score).toBe(4.5);
    const both = computeSellerRating({ ...zero, verifiedSum: 10, verifiedCount: 10, otherSum: 50, otherCount: 10 });
    expect(both.score < 3).toBe(true);
  });

  it("надёжный продавец", () => {
    const r = computeSellerRating({ ...zero, verifiedSum: 4.9 * 100, verifiedCount: 100, completedOrders: 120, refundedOrders: 2 });
    expect(r.level).toBe("trusted");
    expect(r.levelLabel).toBe("Надёжный продавец");
    expect(r.successRate).toBe(0.98);
  });

  it("много отмен после оплаты: жалобы", () => {
    const r = computeSellerRating({ ...zero, verifiedSum: 48, verifiedCount: 10, completedOrders: 7, cancelledAfterPayment: 3 });
    expect(r.level).toBe("complaints");
    expect(r.successRate).toBe(0.7);
  });

  it("новичок с сорванными сделками сразу виден", () => {
    const r = computeSellerRating({ ...zero, completedOrders: 1, cancelledAfterPayment: 3 });
    expect(r.level).toBe("complaints");
    const one = computeSellerRating({ ...zero, verifiedSum: 1, verifiedCount: 1, completedOrders: 1 });
    expect(one.level).toBe("new");
  });

  it("хороший продавец", () => {
    const r = computeSellerRating({ ...zero, verifiedSum: 46, verifiedCount: 10, completedOrders: 10 });
    expect(r.level).toBe("good");
  });
});
