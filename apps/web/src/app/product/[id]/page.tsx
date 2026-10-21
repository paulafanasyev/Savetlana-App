import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { rub, availabilityLabel, countText, plural, REVIEW_FORMS } from "@/lib/format";
import { AddToCartButton } from "@/components/AddToCartButton";
import { FavoriteButton } from "@/components/FavoriteButton";
import { SvetlanaChat } from "@/components/SvetlanaChat";
import { summarizeReviews, listReviews } from "@/lib/domains/reviews";
import { shipCitiesBySeller } from "@/lib/domains/seller-ship-from";
import { checkStatusLabel, isDemoSeller, sellerBadges, shownStatus, taxCheck } from "@/lib/domains/seller-trust-display";
import { attrRows } from "@/lib/product-attrs";
import { resolveParams } from "@/lib/page-params";
import { resolveSession, serverRequest } from "@/lib/auth";
import { loadReviewBox } from "@/lib/domains/review-state";
import { ReviewForm } from "@/components/ReviewForm";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

const SELLER_TYPE: Record<string, string> = {
  INDIVIDUAL: "Физическое лицо",
  SELF_EMPLOYED: "Самозанятый",
  IP: "ИП",
  COMPANY: "Юридическое лицо",
};

/** Услуга, а не товар: у неё нет остатка в штуках и самовывоза. */
function isServiceProduct(title: string, categoryName: string | null | undefined): boolean {
  return /^услуга[:\s]/i.test(title.trim()) || /услуг/i.test(categoryName ?? "");
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
          sellerType: true,
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
  const { user: viewer } = await resolveSession(await serverRequest()).catch(() => ({ user: null }));
  const myReview = await loadReviewBox(viewer?.id ?? null, product.id).catch(() => null);
  // Откуда продавец отправляет товар (и где самовывоз). Ошибка не ломает страницу.
  const shipCity = (await shipCitiesBySeller([product.sellerProfile.id]).catch(() => new Map<string, string>())).get(product.sellerProfile.id) ?? null;
  // Характеристики с русскими подписями (ключи в базе бывают английскими).
  const attrs = attrRows(safeJson(product.attributes));
  // Те же правила проверки, что и на странице продавца: налоговый статус по типу.
  const tax = taxCheck(product.sellerProfile);
  const verifiedSeller = sellerBadges(product.sellerProfile).some((b) => b.key === "verified_seller");
  const demoSeller = isDemoSeller(product.sellerProfile);
  const service = isServiceProduct(product.title, product.category?.name);
  const outOfStock = !product.inventory || product.inventory.quantity <= 0 || product.inventory.availability === "OUT_OF_STOCK";
  const variants = product.variants.map((v) => ({ id: v.id, name: v.name, priceKopecks: product.priceKopecks + v.priceDelta }));
  const availabilityText = service
    ? outOfStock ? "Сейчас не принимает заказы" : "Можно заказать"
    : outOfStock ? "Нет в наличии" : availabilityLabel(product.inventory?.availability);

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
              <div className="flex h-full items-center justify-center text-5xl">{service ? "🛠️" : "📦"}</div>
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
              {product.reviewsCount > 0 ? (
                <>
                  <span>★ {product.rating.toFixed(1)}</span>
                  <span>·</span>
                  <span>{countText(product.reviewsCount, REVIEW_FORMS)}</span>
                </>
              ) : (
                <span>пока без отзывов</span>
              )}
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
              <span className="font-medium text-ink">{availabilityText}</span>
              {product.inventory?.confirmedBySeller ? (
                <span className="chip">подтверждено продавцом</span>
              ) : (
                <span className="chip bg-amber-50 text-amber-700">{service ? "не подтверждено" : "наличие не подтверждено"}</span>
              )}
            </div>
            {product.inventory?.confirmedAt && (
              <div className="mt-2 text-xs text-ink-soft">
                Последнее подтверждение: {new Date(product.inventory.confirmedAt).toLocaleDateString("ru-RU")}
              </div>
            )}
            {!service && product.inventory?.quantity !== undefined && product.inventory.quantity > 0 && (
              <div className="mt-1 text-xs text-ink-soft">Остаток: {product.inventory.quantity} шт.</div>
            )}
            {shipCity && (
              <div className="mt-2 text-xs text-ink-soft">
                {service ? `📍 Исполнитель в г. ${shipCity}` : `📍 Отправка из г. ${shipCity}, там же самовывоз`}
              </div>
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

          {attrs.length > 0 && (
            <div>
              <h2 className="mb-2 text-lg font-bold text-ink">Характеристики</h2>
              <dl className="card divide-y divide-surface-line text-sm">
                {attrs.map((row) => (
                  <div key={row.key} className="flex justify-between gap-4 px-4 py-2.5">
                    <dt className="text-ink-soft">{row.label}</dt>
                    <dd className="text-right font-medium text-ink">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        {/* Svetlana + seller */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <SvetlanaChat side="buyer" title={service ? "Спросите Светлану об услуге" : "Спросите Светлану о товаре"} />
          <div className="card p-4">
            <h3 className="text-sm font-bold text-ink">{service ? "Исполнитель" : "Продавец"}</h3>
            <Link
              href={`/sellers/${product.sellerProfile.id}`}
              className="mt-2 block text-base font-semibold text-svetlana-700 hover:underline"
            >
              {product.sellerProfile.displayName} →
            </Link>
            {verifiedSeller && (
              <span className="chip mt-2 bg-green-50 text-xs font-semibold text-green-700" title="Личность и налоговый статус подтверждены">✓ Проверенный продавец</span>
            )}
            {demoSeller && (
              <span className="chip mt-2 bg-amber-50 text-xs font-semibold text-amber-800" title="Магазин для демонстрации площадки: проверки не проводились">Демо-магазин: отметки условные</span>
            )}
            {product.sellerProfile.description && (
              <p className="mt-1 text-xs text-ink-soft line-clamp-3">{product.sellerProfile.description}</p>
            )}
            <div className="mt-3 space-y-1 text-xs text-ink-soft">
              <div>{SELLER_TYPE[product.sellerProfile.sellerType] ?? "Продавец"}</div>
              {shipCity && <div>{service ? "Город" : "Город отгрузки"}: {shipCity}</div>}
              <div>Личность: {checkStatusLabel(shownStatus(product.sellerProfile, product.sellerProfile.identityStatus))}</div>
              {tax && <div>{tax.label}: {checkStatusLabel(shownStatus(product.sellerProfile, tax.status))}</div>}
              <div>На площадке с {new Date(product.sellerProfile.createdAt).getFullYear()}</div>
            </div>
            <Link
              href={`/messages/${product.sellerProfile.id}?about=${product.id}`}
              className="btn btn-ghost mt-3 w-full justify-center text-sm"
            >
              {service ? "Задать вопрос исполнителю" : "Задать вопрос продавцу"}
            </Link>
          </div>
        </div>
      </div>

      {/* Reviews */}
      <section className="mt-10">
        <h2 className="mb-4 text-xl font-bold text-ink">Отзывы</h2>
        {reviewSummary.count > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card p-4">
              <div className="text-3xl font-bold text-ink">{reviewSummary.averageRating.toFixed(1)}</div>
              <div className="text-xs text-ink-soft">средняя оценка, {countText(reviewSummary.count, REVIEW_FORMS)}</div>
            </div>
            {Object.entries(reviewSummary.distribution).map(([rating, count]) => (
              <div key={rating} className="card p-4 text-sm">
                <div className="text-ink-soft">{rating} ★</div>
                <div className="text-lg font-bold text-ink">{count}</div>
              </div>
            ))}
          </div>
        )}
        {reviewSummary.recurringTerms.length > 0 && (
          <div className="mt-4 card p-4">
            <h3 className="mb-2 text-sm font-bold text-ink">Что чаще всего упоминают</h3>
            <div className="flex flex-wrap gap-2">
              {reviewSummary.recurringTerms.slice(0, 10).map((t) => (
                <span key={t.term} className="chip">
                  {t.term} · {t.count} {plural(t.count, ["раз", "раза", "раз"])}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-faint">
              Общее впечатление: {reviewSummary.sentimentBasis === "live-model" ? "по текстам отзывов" : reviewSummary.sentimentBasis === "rating-derived" ? "по оценкам покупателей" : "пока мало отзывов для вывода"}
            </p>
          </div>
        )}

        {myReview?.kind === "can_review" && (
          <div className="mt-6 card p-4">
            <h3 className="mb-3 text-sm font-bold text-ink">{service ? "Ваш отзыв об услуге" : "Ваш отзыв о товаре"}</h3>
            <ReviewForm productId={product.id} orderId={myReview.orderId} />
          </div>
        )}
        {myReview?.kind === "moderation" && (
          <div className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            Ваш отзыв на проверке у модератора. Другие покупатели увидят его после проверки, обычно в течение суток.
            Писать его заново не нужно.
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
            Отзывов пока нет. {service ? "После выполнения заказа" : "После получения заказа"} вы сможете оставить первый.
          </p>
        )}
      </section>
    </div>
  );
}

function safeJson(raw: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
