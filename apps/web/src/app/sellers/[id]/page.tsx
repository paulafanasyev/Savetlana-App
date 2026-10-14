import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicSellerProfile, listSellerProducts } from "@/lib/domains/sellers";
import { rub, availabilityLabel } from "@/lib/format";
import { SvetlanaChat } from "@/components/SvetlanaChat";
import { resolveParams } from "@/lib/page-params";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SellerPage({ params }: PageProps) {
  const { id } = await resolveParams(params);
  const profile = await getPublicSellerProfile(id);
  if (!profile) notFound();
  const products = await listSellerProducts(profile.id);
  const { stats } = profile;
  const verifiedSeller = profile.badges.some((b) => b.key === "verified_seller");

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 text-sm text-ink-soft">
        <Link href="/catalog" className="hover:text-svetlana-700">Каталог</Link>
        {" / "}
        <span className="text-ink">Продавец</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          <div className="card p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-svetlana-100 text-2xl font-bold text-svetlana-700">
                {profile.displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold text-ink">
                  {profile.displayName}
                  {verifiedSeller && (
                    <span title="Личность и налоговый статус подтверждены" className="chip bg-green-50 text-xs font-semibold text-green-700">
                      ✓ Проверенный продавец
                    </span>
                  )}
                </h1>
                <div className="mt-1 text-xs text-ink-soft">
                  {sellerTypeLabel(profile.sellerType)} · на платформе с{" "}
                  {new Date(profile.createdAt).getFullYear()} · <span className={levelClass(stats.level)}>{stats.levelLabel}</span>
                </div>
              </div>
            </div>

            {profile.description && (
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-ink-soft">
                {profile.description}
              </p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-surface-line pt-4 text-center sm:grid-cols-4">
              <div>
                <div className="text-lg font-bold text-ink">{stats.productsPublished}</div>
                <div className="text-xs text-ink-soft">товаров</div>
              </div>
              <div>
                <div className="text-lg font-bold text-ink">
                  {stats.reviewsCount > 0 ? `★ ${stats.rating.toFixed(1)}` : "—"}
                </div>
                <div className="text-xs text-ink-soft">
                  {stats.reviewsCount > 0 ? `рейтинг, ${stats.reviewsCount} ${reviewsWord(stats.reviewsCount)}` : "пока нет отзывов"}
                </div>
              </div>
              <div>
                <div className="text-lg font-bold text-ink">{stats.completedOrders}</div>
                <div className="text-xs text-ink-soft">заказов доставлено</div>
              </div>
              <div>
                <div className="text-lg font-bold text-ink">
                  {stats.successRate === null ? "—" : `${Math.round(stats.successRate * 100)}%`}
                </div>
                <div className="text-xs text-ink-soft">
                  {stats.successRate === null ? "мало сделок для оценки" : "сделок без отмен и возвратов"}
                </div>
              </div>
            </div>

            {profile.badges.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {profile.badges
                  .filter((b) => b.key !== "verified_seller")
                  .map((b) => (
                    <span key={b.key} title={b.hint} className="chip bg-green-50 text-green-700">
                      ✓ {b.label}
                    </span>
                  ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <VerificationChip label="Личность" status={profile.identityStatus} />
              {profile.sellerType === "SELF_EMPLOYED" ? (
                <VerificationChip label="Статус самозанятого (ФНС)" status={profile.npdStatus} />
              ) : (
                <VerificationChip label={profile.sellerType === "COMPANY" ? "Организация" : "ИП"} status={profile.businessStatus} />
              )}
            </div>
            <p className="mt-2 text-xs text-ink-faint">
              Отметки ставятся только по ответу официального источника (ФНС, Госуслуги) или после проверки модератором.
              Рейтинг считается по отзывам и итогам реальных заказов, отзывы без подтверждённой покупки весят меньше.
              Документы и реквизиты продавца не показываются.
            </p>
          </div>

          <section className="mt-6">
            <h2 className="mb-3 text-lg font-bold text-ink">
              Товары продавца <span className="text-ink-faint">({products.length})</span>
            </h2>
            {products.length === 0 ? (
              <div className="card p-6 text-sm text-ink-soft">
                У этого продавца пока нет опубликованных товаров.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {products.map((p) => (
                  <Link key={p.id} href={`/product/${p.id}`} className="card flex gap-3 p-3 transition hover:shadow-md">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt={p.title} className="h-full w-full object-contain" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-2xl">📦</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{p.title}</div>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-sm font-bold text-svetlana-700">{rub(p.priceKopecks)}</span>
                        <span className="text-xs text-ink-faint">{availabilityLabel(p.availability)}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <SvetlanaChat side="buyer" title="Спросите о продавце" />
        </div>
      </div>
    </div>
  );
}

function sellerTypeLabel(s: string): string {
  switch (s) {
    case "INDIVIDUAL":
      return "Физическое лицо";
    case "SELF_EMPLOYED":
      return "Самозанятый";
    case "IP":
      return "ИП";
    case "COMPANY":
      return "Юридическое лицо";
    default:
      return "Продавец";
  }
}

function reviewsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "отзыв";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "отзыва";
  return "отзывов";
}

function levelClass(level: string): string {
  if (level === "trusted" || level === "good") return "font-semibold text-green-700";
  if (level === "complaints") return "font-semibold text-bad";
  return "text-ink-soft";
}

function VerificationChip({ label, status }: { label: string; status: string }) {
  const ok = status === "VERIFIED";
  const pending = status === "PENDING";
  const rejected = status === "REJECTED" || status === "REVOKED";
  return (
    <span
      className={`chip ${ok ? "bg-green-50 text-green-700" : pending ? "bg-amber-50 text-amber-700" : "text-ink-soft"}`}
    >
      {label}: {ok ? "✓ проверено" : pending ? "на проверке" : rejected ? "не подтверждено" : "не проверено"}
    </span>
  );
}
