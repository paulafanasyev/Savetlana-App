import { apiRoute } from "@/lib/api-helpers";
import { getPublicProduct } from "@/lib/domains/catalog";
import { recordEvent } from "@/lib/domains/events";
import { summarizeReviews } from "@/lib/domains/reviews";
import { resolveSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request, { params }) => {
  const product = await getPublicProduct(params.id);
  if (!product) {
    return Response.json({ error: "Товар не найден", code: "not_found" }, { status: 404 });
  }
  const { user } = await resolveSession(request);
  if (user) {
    await recordEvent({ userId: user.id, type: "PRODUCT_VIEW", productId: product.id });
  }
  const reviews = await summarizeReviews(product.id);
  return Response.json({
    id: product.id,
    title: product.title,
    slug: product.seoSlug,
    sku: product.sku,
    description: product.description,
    priceKopecks: product.priceKopecks,
    oldPriceKopecks: product.oldPriceKopecks,
    currency: product.currency,
    rating: product.rating,
    reviewsCount: product.reviewsCount,
    status: product.status,
    aiDraft: product.aiDraft,
    attributes: safeJson(product.attributes),
    keywords: safeJsonArray(product.keywords),
    images: product.images.map((i) => ({ id: i.id, url: i.url, alt: i.alt, isPrimary: i.isPrimary })),
    variants: product.variants.map((v) => ({
      id: v.id,
      name: v.name,
      priceDeltaKopecks: v.priceDelta,
      quantity: v.quantity,
    })),
    category: product.category ? { id: product.category.id, name: product.category.name, slug: product.category.slug } : null,
    seller: {
      id: product.sellerProfile.id,
      name: product.sellerProfile.displayName,
      slug: product.sellerProfile.slug,
      identityStatus: product.sellerProfile.identityStatus,
      businessStatus: product.sellerProfile.businessStatus,
    },
    inventory: product.inventory
      ? {
          quantity: product.inventory.quantity,
          availability: product.inventory.availability,
          confirmedBySeller: product.inventory.confirmedBySeller,
          confirmedAt: product.inventory.confirmedAt,
          saleUntil: product.inventory.saleUntil,
        }
      : null,
    listing: product.listing
      ? { isLive: product.listing.isLive, expiresAt: product.listing.expiresAt }
      : null,
    reviewSummary: reviews,
  });
});

function safeJson(raw: string | null): Record<string, unknown> {
  try {
    return typeof raw === "string" ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function safeJsonArray(raw: string | null): unknown[] {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
