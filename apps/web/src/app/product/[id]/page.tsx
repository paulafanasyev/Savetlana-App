import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { rub, availabilityLabel } from "@/lib/format";
import { AddToCartButton } from "@/components/AddToCartButton";
import { FavoriteButton } from "@/components/FavoriteButton";
import { SvetlanaChat } from "@/components/SvetlanaChat";
import { summarizeReviews, listReviews } from "@/lib/domains/reviews";
import { resolveParams } from "@/lib/page-params";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProductPage({ params }: PageProps) {
  const { id } = await resolveParams(params);
  const product = await prisma.product.findFirst({
    where: { id, status: "ACTIVE" },
    include: {
      images: { orderBy: { position: "asc" } },
      variants: { orderBy: { createdAt: "asc" } },
      inventory: true,
      listing: true,
      category: true,
      sellerProfile: {
        select: {
          id: true,
          displayName: true,
          slug: true,
          description: true,
          identityStatus: true,
          businessStatus: true,
          npdStatus: true,
          createdAt: true,
        },
      },
    },
  });
  if (!product) notFound();

  const reviewSummary = await summarizeReviews(product.id);
  const recentReviews = await listReviews(product.id, 6);
  const attrs = safeJson(product.attributes);
  const outOfStock = !product.inventory || product.inventory.quantity <= 0 || product.inventory.availability === "OUT_OF_STOCK";
  const variants = product.variants.map((v) => ({ id: v.id, name: v.name, priceKopecks: product.priceKopecks + v.priceDelta }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 text-sm text-ink-soft">
        <Link href="/catalog" className="hover:text-svetlana-700">Каталог</Link>
        {" / "}
        {product.category && (
          <>
            <Link href={`/catalog?category=${product.category.slug}`} className="hover:text-svetlana-700">
              {product.category.name}
            </Link>
            {" / "}
          </>
        )}
        <span className="text-ink">{product.title}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr_360px]">
        {/* Gallery */}
        <div className="space-y-3">
          <div className="card aspect-square overflow-hidden bg-surface-muted">
            {product.images[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.images[0].url} alt={product.title} className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full items-center justify-center text-5xl">📦</div>
            )}
          </div>
          {product.images.length > 1 && (
            <div className="flex gap-2">
              {product.images.slice(1, 5).map((img) => (
                <div key={img.id} className="card h-16 w-16 overflow-hidden bg-surface-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={img.alt ?? product.title} className="h-full w-full object-contain" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Offer */}
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-ink">{product.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink-soft">
              <span>★ {product.rating.toFixed(1)}</span>
              <span>·</span>
              <span>{product.reviewsCount} отзывов</span>
              <span>·</span>
              <span>Артикул {product.sku}</span>
            </div>
          </div>

          <div className="flex items-end gap-3">
            <span className="text-3xl font-bold text-svetlana-700">{rub(product.priceKopecks)}</span>
            {product.oldPriceKopecks && product.oldPriceKopecks > product.priceKopecks && (
              <span className="text-lg text-ink-faint line-through">{rub(product.oldPriceKopecks)}</span>
            )}
          </div>

          <div className="card p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">{outOfStock ? "Нет в наличии" : availabilityLabel(product.inventory?.availability)}</span>
              {product.inventory?.confirmedBySeller ? (
                <span className="chip">подтверждено продавцом</span>
              ) : (
                <span className="chip bg-amber-50 text-amber-700">наличие не подтверждено</span>
              )}
            </div>
            {product.inventory?.confirmedAt && (
              <div className="mt-2 text-xs text-ink-soft">
                Последнее подтверждение: {new Date(product.inventory.confirmedAt).toLocaleDateString("ru-RU")}
              </div>
            )}
            {product.inventory?.quantity !== undefined && product.inventory.quantity > 0 && (
              <div className="mt-1 text-xs text-ink-soft">Остаток: {product.inventory.quantity} шт.</div>
            )}
          </div>

          <div className="flex flex-wrap items-start gap-3">
            <AddToCartButton productId={product.id} variants={variants} outOfStock={outOfStock} />
            <FavoriteButton productId={product.id} />
          </div>

          {product.description && (
            <div>
              <h2 className="mb-2 text-lg font-bold text-ink">Описание</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">{product.description}</p>
            </div>
          )}

          {Object.keys(attrs).length > 0 && (
            <div>
              <h2 className="mb-2 text-lg font-bold text-ink">Характеристики</h2>
              <dl className="card divide-y divide-surface-line text-sm">
                {Object.entries(attrs).map(([k, v]) => (
                  <div key={k} className="flex justify-between px-4 py-2.5">
                    <dt className="text-ink-soft">{k}</dt>
                    <dd className="font-medium text-ink">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        {/* Svetlana + seller */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <SvetlanaChat side="buyer" title="Спросите Светлану о товаре" />
          <div className="card p-4">
            <h3 className="text-sm font-bold text-ink">Продавец</h3>
            <Link
              href={`/sellers/${product.sellerProfile.id}`}
              className="mt-2 block text-base font-semibold text-svetlana-700 hover:underline"
            >
              {product.sellerProfile.displayName} →
            </Link>
            {product.sellerProfile.description && (
              <p className="mt-1 text-xs text-ink-soft line-clamp-3">{product.sellerProfile.description}</p>
            )}
            <div className="mt-3 space-y-1 text-xs text-ink-soft">
              <div>Личность: {statusLabel(product.sellerProfile.identityStatus)}</div>
              <div>Бизнес: {statusLabel(product.sellerProfile.businessStatus)}</div>
              <div>НПД: {statusLabel(product.sellerProfile.npdStatus)}</div>
              <div>На площадке с {new Date(product.sellerProfile.createdAt).getFullYear()}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Reviews */}
      <section className="mt-10">
        <h2 className="mb-4 text-xl font-bold text-ink">Отзывы</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card p-4">
            <div className="text-3xl font-bold text-ink">{reviewSummary.averageRating.toFixed(1)}</div>
            <div className="text-xs text-ink-soft">из {reviewSummary.count} отзывов</div>
          </div>
          {Object.entries(reviewSummary.distribution).map(([rating, count]) => (
            <div key={rating} className="card p-4 text-sm">
              <div className="text-ink-soft">{rating} ★</div>
              <div className="text-lg font-bold text-ink">{count}</div>
            </div>
          ))}
        </div>
        {reviewSummary.recurringTerms.length > 0 && (
          <div className="mt-4 card p-4">
            <h3 className="mb-2 text-sm font-bold text-ink">Что чаще всего упоминают</h3>
            <div className="flex flex-wrap gap-2">
              {reviewSummary.recurringTerms.slice(0, 10).map((t) => (
                <span key={t.term} className="chip">
                  {t.term} · {t.count} раз
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-faint">
              Общее впечатление: {reviewSummary.sentimentBasis === "live-model" ? "по текстам отзывов" : reviewSummary.sentimentBasis === "rating-derived" ? "по оценкам покупателей" : "пока мало отзывов для вывода"}
            </p>
          </div>
        )}

        {recentReviews.length > 0 ? (
          <div className="mt-6 space-y-3">
            {recentReviews.map((r) => (
              <div key={r.id} className="card p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-ink">{r.authorName}</span>
                  <span className="text-ink-soft">
                    {r.verifiedPurchase ? "✓ проверенная покупка" : "покупка не подтверждена"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-ink-faint">
                  {"★".repeat(r.rating)}
                  <span className="text-ink-faint">{"☆".repeat(5 - r.rating)}</span>
                  {" · "}
                  {new Date(r.createdAt).toLocaleDateString("ru-RU")}
                </div>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-soft">{r.body}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-soft">
            Отзывов пока нет. После получения заказа вы сможете оставить первый.
          </p>
        )}
      </section>
    </div>
  );
}

function statusLabel(s: string): string {
  switch (s) {
    case "VERIFIED":
      return "✓ подтверждено";
    case "PENDING":
      return "на проверке";
    case "REJECTED":
      return "отклонено";
    default:
      return "не проверено";
  }
}

function safeJson(raw: string | null | undefined): Record<string, unknown> {
  try {
    return typeof raw === "string" ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
