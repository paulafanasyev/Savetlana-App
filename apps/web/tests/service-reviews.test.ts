import { describe, expect, it } from "vitest";
import { averageRating, cleanServiceReview, parseReviewBody, ratingText, reviewBody, reviewPrefix, stars } from "../src/lib/service-reviews";

describe("отзывы о работе исполнителя", () => {
  it("проверяет оценку и текст", () => {
    expect(cleanServiceReview({ rating: 6, text: "Всё сделано отлично и вовремя" }).ok).toBe(false);
    expect(cleanServiceReview({ rating: 5, text: "ок" }).ok).toBe(false);
    expect(cleanServiceReview({ rating: "4", text: "Сделал быстро, но пришлось дважды поправить" })).toEqual({ ok: true, rating: 4, text: "Сделал быстро, но пришлось дважды поправить" });
  });

  it("текст отзыва читается обратно", () => {
    const body = reviewBody("A-123", 5, "Отличная работа, рекомендую");
    expect(body.startsWith(reviewPrefix("A-123"))).toBe(true);
    expect(parseReviewBody(body)).toEqual({ orderNumber: "A-123", rating: 5, text: "Отличная работа, рекомендую" });
    expect(parseReviewBody("просто сообщение")).toBeNull();
  });

  it("средняя оценка честная", () => {
    expect(averageRating([])).toBeNull();
    expect(averageRating([5, 4, 5])).toBe(4.7);
    expect(ratingText([5, 4, 5])).toBe("Оценка 4,7 из 5 · 3 отзыва");
    expect(ratingText([5])).toBe("Оценка 5 из 5 · 1 отзыв");
    expect(ratingText([])).toBe("");
    expect(stars(4)).toBe("★★★★☆");
  });
});
