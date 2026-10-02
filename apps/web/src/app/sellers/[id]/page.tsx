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
                <h1 className="text-xl font-bold text-ink">{profile.displayName}</h1>
                <div className="mt-1 text-xs text-ink-soft">
                  {sellerTypeLabel(profile.sellerType)} · на платформе с{" "}
                  {new Date(profile.createdAt).getFullYear()}
                </div>
              </div>
            </div>

            {profile.description && (
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-ink-soft">
                {profile.description}
              </p>
            )}

            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-surface-line pt-4 text-center">
              <div>
                <div className="text-lg font-bold text-ink">{profile.stats.productsPublished}</div>
                <div className="text-xs text-ink-soft">товаров</div>
              </div>
              <div>
                <div className="text-lg font-bold text-ink">{profile.stats.rating.toFixed(1)}</div>
                <div className="text-xs text-ink-soft">рейтинг</div>
              </div>
              <div>
                <div className="text-lg font-bold text-ink">{profile.stats.completedOrders}</div>
                <div className="text-xs text-ink-soft">заказов доставлено</div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <VerificationChip label="Личность" status={profile.identityStatus} />
              <VerificationChip label="Бизнес" status={profile.businessStatus} />
              <VerificationChip label="НПД" status={profile.npdStatus} />
            </div>
            <p className="mt-2 text-xs text-ink-faint">
              Статус проверки показывается как факт, без раскрытия документов и реквизитов.
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

function VerificationChip({ label, status }: { label: string; status: string }) {
  const ok = status === "VERIFIED";
  const pending = status === "PENDING";
  return (
    <span
      className={`chip ${ok ? "bg-green-50 text-green-700" : pending ? "bg-amber-50 text-amber-700" : "text-ink-soft"}`}
    >
      {label}: {ok ? "✓ проверено" : pending ? "на проверке" : "не проверено"}
    </span>
  );
}
