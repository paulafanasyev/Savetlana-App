import { describe, expect, it } from "vitest";
import { jsonLdString, productJsonLd, siteUrl, snippet, type SeoProduct } from "../src/lib/seo";

const base: SeoProduct = {
  id: "p1",
  title: "Чайник </script> стеклянный",
  description: "<p>Объём 1,7 л.</p>   Подсветка, автоотключение.",
  sku: "KT-1",
  priceKopecks: 199_000,
  currency: "RUB",
  rating: 0,
  reviewsCount: 0,
  images: [{ url: "https://cdn.example.ru/1.jpg" }, { url: "/images/products/2.jpg" }, { url: "data:image/png;base64,xx" }],
  inventory: { quantity: 3, availability: "AVAILABLE" },
  sellerName: "Магазин Анны",
  categoryName: "Кухня",
};

describe("поиск: описание и разметка товара", () => {
  it("описание без разметки и обрезано по слову", () => {
    expect(snippet("<b>Очень</b>   длинное описание товара", 20)).toBe("Очень длинное…");
    expect(snippet(null)).toBe("");
  });

  it("цена, наличие и полные адреса фото", () => {
    const ld = productJsonLd(base) as { offers: Record<string, unknown>; image: string[]; aggregateRating?: unknown };
    expect(ld.offers).toMatchObject({ price: "1990.00", priceCurrency: "RUB", availability: "https://schema.org/InStock" });
    expect(ld.image).toEqual(["https://cdn.example.ru/1.jpg", siteUrl("/images/products/2.jpg")]);
    expect(ld.aggregateRating).toBeUndefined();
  });

  it("нет остатка: нет в наличии; есть отзывы: рейтинг", () => {
    const ld = productJsonLd({ ...base, inventory: { quantity: 0, availability: "OUT_OF_STOCK" }, rating: 4.56, reviewsCount: 12 }) as {
      offers: Record<string, unknown>;
      aggregateRating: Record<string, unknown>;
    };
    expect(ld.offers.availability).toBe("https://schema.org/OutOfStock");
    expect(ld.aggregateRating).toMatchObject({ ratingValue: "4.6", reviewCount: 12 });
  });

  it("текст товара не может закрыть тег script", () => {
    expect(jsonLdString(productJsonLd(base))).not.toContain("</script>");
  });
});
