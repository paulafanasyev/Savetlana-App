/**
 * Поиск (Яндекс, Google): адрес сайта, описание товара для сниппета и
 * разметка schema.org Product, по которой поисковик показывает цену и наличие.
 */
import { env } from "./env";

export const SITE_NAME = "АИКО";
export const SITE_TAGLINE = "Маркетплейс с ИИ-помощником Светланой";

export function siteUrl(path = "/"): string {
  return `${env.publicAppUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Одна строка без лишних пробелов, не длиннее limit символов, обрезка по слову. */
export function snippet(text: string | null | undefined, limit = 160): string {
  const plain = (text ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (plain.length <= limit) return plain;
  const cut = plain.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

export interface SeoProduct {
  id: string;
  title: string;
  description: string | null;
  sku: string;
  priceKopecks: number;
  currency: string;
  rating: number;
  reviewsCount: number;
  images: { url: string }[];
  inventory: { quantity: number; availability: string } | null;
  sellerName: string;
  categoryName?: string | null;
}

export function inStock(product: Pick<SeoProduct, "inventory">): boolean {
  const inv = product.inventory;
  return Boolean(inv && inv.quantity > 0 && inv.availability !== "OUT_OF_STOCK");
}

/** Абсолютная ссылка на фото: поисковикам нужен полный адрес. */
export function absoluteImage(url: string): string | null {
  if (/^https:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return siteUrl(url);
  return null;
}

export function productJsonLd(product: SeoProduct): Record<string, unknown> {
  const url = siteUrl(`/product/${product.id}`);
  const images = product.images.map((i) => absoluteImage(i.url)).filter((u): u is string => Boolean(u)).slice(0, 5);
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    sku: product.sku,
    url,
    offers: {
      "@type": "Offer",
      url,
      price: (product.priceKopecks / 100).toFixed(2),
      priceCurrency: product.currency || "RUB",
      availability: inStock(product) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      seller: { "@type": "Organization", name: product.sellerName },
    },
  };
  const description = snippet(product.description, 500);
  if (description) data.description = description;
  if (images.length) data.image = images;
  if (product.categoryName) data.category = product.categoryName;
  if (product.reviewsCount > 0 && product.rating > 0) {
    data.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: product.rating.toFixed(1),
      reviewCount: product.reviewsCount,
    };
  }
  return data;
}

/** JSON для тега <script type="application/ld+json">: «<» экранируется, чтобы текст товара не закрыл тег. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
