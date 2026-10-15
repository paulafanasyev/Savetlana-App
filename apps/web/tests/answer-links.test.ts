import { describe, expect, it } from "vitest";
import { answerWithLinks, linkProducts, shownProducts } from "../src/lib/ai/answer-links";
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

  it("черновик из чата открывается по ссылке", () => {
    expect(draftProductId({ productId: "d_123", title: "Кружка" })).toBe("d_123");
    expect(draftProductId({ productId: "../admin" })).toBeNull();
    expect(draftProductId(null)).toBeNull();
    const report = chatDraftReport({ title: "Кружка", priceRub: 300 }, null, "d_123");
    expect(report).toContain("[Открыть черновик](/seller/products/d_123/edit)");
    expect(chatDraftReport({ title: "Кружка" }, null)).toContain("раздел «Товары»");
  });
});
