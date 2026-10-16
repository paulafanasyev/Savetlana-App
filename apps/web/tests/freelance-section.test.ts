import { describe, expect, it } from "vitest";
import { freelanceHref, freelanceTab, pickCategory, TAB_DEAL_TYPE } from "../src/lib/freelance-section";

describe("раздел «Фриланс»", () => {
  it("вкладки и типы объявлений", () => {
    expect(freelanceTab(undefined)).toBe("orders");
    expect(freelanceTab("offers")).toBe("offers");
    expect(freelanceTab("<script>")).toBe("orders");
    expect(TAB_DEAL_TYPE.orders).toBe("SERVICE_REQUEST");
  });

  it("берёт только существующую категорию", () => {
    expect(pickCategory("Ремонт", ["Ремонт", "Дизайн"])).toBe("Ремонт");
    expect(pickCategory("Взлом", ["Ремонт"])).toBeNull();
    expect(pickCategory(["x"], ["x"])).toBeNull();
  });

  it("ссылки", () => {
    expect(freelanceHref("orders")).toBe("/freelance");
    expect(freelanceHref("offers", "Дизайн сайтов")).toBe("/freelance?tab=offers&category=%D0%94%D0%B8%D0%B7%D0%B0%D0%B9%D0%BD+%D1%81%D0%B0%D0%B9%D1%82%D0%BE%D0%B2");
  });
});
