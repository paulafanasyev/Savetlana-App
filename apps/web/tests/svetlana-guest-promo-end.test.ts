import { describe, it, expect } from "vitest";
import { extractPromoDuration, duePromotions, promoEndsAt, promoDateText } from "../src/lib/domains/engagement-rules";
import { mergeGuestItem } from "../src/lib/guest-cart";
import { permissionsForRole } from "../src/lib/ai/tools/registry";
import { masterAgent, GUEST_CONVERSATION } from "../src/lib/ai/agents/master";

describe("Срок акции", () => {
  it("понимает «на 3 дня», «на неделю», «на месяц» и не трогает фразу без срока", () => {
    expect(extractPromoDuration("кроссовки на 3 дня")).toEqual({ rest: "кроссовки", days: 3 });
    expect(extractPromoDuration("неделю на кроссовки")).toEqual({ rest: "кроссовки", days: 7 });
    expect(extractPromoDuration("наушники на месяц")).toEqual({ rest: "наушники", days: 30 });
    expect(extractPromoDuration("кроссовки Nike")).toEqual({ rest: "кроссовки Nike" });
  });
  it("срок от 1 до 30 дней, без срока тоже можно", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    expect(promoEndsAt(undefined, now)).toBeNull();
    expect(promoDateText(promoEndsAt(7, now) as Date)).toBe("20 октября");
    expect(() => promoEndsAt(40, now)).toThrow(/от 1 до 30/);
  });
  it("заканчивает только акции с вышедшим сроком, по последнему запуску", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    const row = (productId: string, endsAt: string | null, at: string) => ({
      productId,
      sellerId: "s",
      actorId: "u",
      change: JSON.stringify({ priceFrom: 1000, priceTo: 900, promoPercent: 10, promoEndsAt: endsAt }),
      createdAt: new Date(at),
    });
    const due = duePromotions(
      [
        row("a", "2026-10-12T00:00:00Z", "2026-10-10T00:00:00Z"),
        row("b", "2026-10-20T00:00:00Z", "2026-10-10T00:00:00Z"),
        row("c", null, "2026-10-10T00:00:00Z"),
        row("d", "2026-10-11T00:00:00Z", "2026-10-01T00:00:00Z"),
        row("d", "2026-10-30T00:00:00Z", "2026-10-12T00:00:00Z"),
      ],
      now
    );
    expect(due.map((d) => d.productId)).toEqual(["a"]);
    expect(due[0].priceTo).toBe(900);
  });
});

describe("Гость", () => {
  it("корзина гостя складывает одинаковые товары", () => {
    let cart = mergeGuestItem([], { productId: "a", quantity: 1 });
    cart = mergeGuestItem(cart, { productId: "a", quantity: 2 });
    cart = mergeGuestItem(cart, { productId: "a", variantId: "v", quantity: 1 });
    expect(cart).toEqual([
      { productId: "a", quantity: 3 },
      { productId: "a", variantId: "v", quantity: 1 },
    ]);
  });
  it("гостю доступно только чтение каталога", () => {
    const perms = permissionsForRole("guest");
    expect(perms).toContain("READ_PRODUCTS");
    expect(perms).not.toContain("CART_WRITE");
    expect(perms).not.toContain("READ_ORDERS");
  });
  it("на вопрос про заказ гостю предлагает войти и ничего не сохраняет", async () => {
    const result = await masterAgent.run({ userId: "", message: "где мой заказ", role: "guest" });
    expect(result.conversationId).toBe(GUEST_CONVERSATION);
    expect(result.pendingConfirmation).toBeUndefined();
    expect(result.answer).toContain("после входа");
  });
});
