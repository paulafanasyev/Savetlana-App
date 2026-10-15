import { describe, expect, it } from "vitest";
import { reviewBox } from "../src/lib/domains/review-state";

describe("блок «Ваш отзыв» на странице товара", () => {
  it("гостю и не купившему форму не показываем", () => {
    expect(reviewBox({ loggedIn: false, deliveredOrderIds: ["o1"], myReviews: [] }).kind).toBe("guest");
    expect(reviewBox({ loggedIn: true, deliveredOrderIds: [], myReviews: [] }).kind).toBe("not_bought");
  });

  it("получил заказ и ещё не писал: форма с этим заказом", () => {
    expect(reviewBox({ loggedIn: true, deliveredOrderIds: ["o1"], myReviews: [] })).toEqual({ kind: "can_review", orderId: "o1" });
  });

  it("отзыв скрыт антифродом: надпись «на проверке»", () => {
    expect(reviewBox({ loggedIn: true, deliveredOrderIds: ["o1"], myReviews: [{ orderId: "o1", isHidden: true }] }).kind).toBe("moderation");
  });

  it("отзыв опубликован: ничего лишнего", () => {
    expect(reviewBox({ loggedIn: true, deliveredOrderIds: ["o1"], myReviews: [{ orderId: "o1", isHidden: false }] }).kind).toBe("published");
  });

  it("второй полученный заказ того же товара: можно написать ещё один отзыв", () => {
    expect(reviewBox({ loggedIn: true, deliveredOrderIds: ["o2", "o1"], myReviews: [{ orderId: "o1", isHidden: true }] })).toEqual({ kind: "can_review", orderId: "o2" });
  });
});
