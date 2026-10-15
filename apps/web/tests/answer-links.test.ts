import { describe, expect, it } from "vitest";
import { answerWithLinks, confirmedAnswerWithLinks, linkProducts, PROMO_PAGE, promoProducts, shownProducts } from "../src/lib/ai/answer-links";
import { chatDraftReport, draftProductId } from "../src/lib/domains/chat-product-draft";
import { splitChatLinks } from "../src/lib/chat-links";

const step = (toolName: string, data: unknown, ok = true) => ({ toolName, result: { ok, data, verification: "VERIFIED" } });

describe("ссылки на карточки в ответах Светланы", () => {
  it("делает ссылкой найденный товар", () => {
    const steps = [step("search_products", { items: [{ productId: "p_kettle1", title: "Чайник Bosch TWK 3A", priceKopecks: 299000 }] })];
    const answer = answerWithLinks("Нашла: «Чайник Bosch TWK 3A» за 2 990 ₽.", steps);
    expect(answer).toBe("Нашла: «[Чайник Bosch TWK 3A](/product/p_kettle1)» за 2 990 ₽.");
    expect(splitChatLinks(answer)[1]).toEqual({ text: "Чайник Bosch TWK 3A", href: "/product/p_kettle1" });
  });

  it("ссылается только на товары из результата и только один раз", () => {
    const items = [
      { productId: "p1", title: "Чайник Bosch" },
      { productId: "p2", title: "Чайник Bosch TWK 3A" },
    ];
    expect(linkProducts("Чайник Bosch TWK 3A дешевле, чем Чайник Bosch. Чайник Bosch тоже хорош", items)).toBe(
      "[Чайник Bosch TWK 3A](/product/p2) дешевле, чем [Чайник Bosch](/product/p1). Чайник Bosch тоже хорош",
    );
    expect(linkProducts("Про утюг ничего не нашла", items)).toBe("Про утюг ничего не нашла");
    expect(linkProducts("[Открыть](/seller) Чайник Bosch", [{ productId: "bad id!", title: "Чайник Bosch" }])).toBe("[Открыть](/seller) Чайник Bosch");
  });

  it("не трогает черновики, ошибки и чужие инструменты", () => {
    expect(shownProducts([step("create_product_draft", { productId: "d1", title: "Кружка" })])).toEqual([]);
    expect(shownProducts([step("get_product", { productId: "x1", title: "Кружка" }, false)])).toEqual([]);
    expect(shownProducts([step("get_product", { productId: "x1", title: "Кружка" })])).toEqual([{ productId: "x1", title: "Кружка" }]);
  });

  it("после подтверждения публикации даёт ссылку на карточку", () => {
    const published = [step("publish_product", { productId: "p_mug", status: "ACTIVE" })];
    expect(confirmedAnswerWithLinks("Карточка «Кружка» опубликована и видна покупателям.", published)).toBe(
      "Карточка «Кружка» опубликована и видна покупателям. [Открыть карточку](/product/p_mug)",
    );
    expect(confirmedAnswerWithLinks("Не получилось", [step("publish_product", { productId: "p_mug" }, false)])).toBe("Не получилось");
    expect(confirmedAnswerWithLinks("Цена изменена.", [step("change_price", { productId: "p_mug" })])).toBe("Цена изменена.");
    const cart = [step("cart_add", { productId: "p_k", title: "Чайник Bosch" })];
    expect(confirmedAnswerWithLinks("«Чайник Bosch» в корзине", cart)).toBe("«[Чайник Bosch](/product/p_k)» в корзине");
  });

  it("черновик из чата открывается по ссылке", () => {
    expect(draftProductId({ productId: "d_123", title: "Кружка" })).toBe("d_123");
    expect(draftProductId({ productId: "../admin" })).toBeNull();
    expect(draftProductId(null)).toBeNull();
    const report = chatDraftReport({ title: "Кружка", priceRub: 300 }, null, "d_123");
    expect(report).toContain("[Открыть черновик](/seller/products/d_123/edit)");
    expect(chatDraftReport({ title: "Кружка" }, null)).toContain("раздел «Товары»");
  });
  it("в ответах про скидки названия товаров ведут на карточки", () => {
    const started = [step("start_promotion", { started: [{ id: "p_sn", title: "Кроссовки Nike", fromKopecks: 500000, toKopecks: 425000 }], skipped: [], notified: 0, endsAt: null })];
    expect(promoProducts(started)).toEqual([{ productId: "p_sn", title: "Кроссовки Nike" }]);
    expect(confirmedAnswerWithLinks("Скидка 15% запущена на 1 товар:\n• «Кроссовки Nike»: 5 000 ₽ → 4 250 ₽", started)).toBe(
      "Скидка 15% запущена на 1 товар:\n• «[Кроссовки Nike](/product/p_sn)»: 5 000 ₽ → 4 250 ₽\n[Все товары со скидкой](/seller/promotions)",
    );
    const ended = [step("end_promotion", { ended: ["Кроссовки Nike"], endedItems: [{ id: "p_sn", title: "Кроссовки Nike" }] })];
    expect(confirmedAnswerWithLinks("Обычная цена возвращена: 1 товар.\n• «Кроссовки Nike»", ended)).toBe(
      "Обычная цена возвращена: 1 товар.\n• «[Кроссовки Nike](/product/p_sn)»\n[Все товары со скидкой](/seller/promotions)",
    );
    expect(promoProducts([step("end_promotion", { ended: ["Кроссовки Nike"] })])).toEqual([]);
    expect(promoProducts([step("start_promotion", { started: [{ id: "p_sn", title: "Кроссовки Nike" }] }, false)])).toEqual([]);
    expect(confirmedAnswerWithLinks("«Кроссовки Nike»", [step("start_promotion", { started: [{ id: "../x", title: "Кроссовки Nike" }] })])).toBe("«Кроссовки Nike»\n[Все товары со скидкой](/seller/promotions)");
    expect(confirmedAnswerWithLinks("Не получилось", [step("start_promotion", {}, false)])).toBe("Не получилось");
    expect(confirmedAnswerWithLinks("Уже есть [Акции](/seller/promotions)", [step("end_promotion", {})])).toBe("Уже есть [Акции](/seller/promotions)");
    expect(confirmedAnswerWithLinks("x", [step("constructor", {})])).toBe("x");
    expect(PROMO_PAGE).toBe("/seller/promotions");
    const extended = [step("extend_promotion", { extended: [{ id: "p_sn", title: "Кроссовки Nike", endsAt: "2026-10-22T12:00:00.000Z" }], skipped: [] })];
    expect(confirmedAnswerWithLinks("Скидка продлена: 1 товар.\n• «Кроссовки Nike»: до 22 октября", extended)).toBe(
      "Скидка продлена: 1 товар.\n• «[Кроссовки Nike](/product/p_sn)»: до 22 октября\n[Все товары со скидкой](/seller/promotions)",
    );
  });
});
