import Link from "next/link";
import { SvetlanaChat } from "@/components/SvetlanaChat";
import { prisma } from "@/lib/prisma";
import { rub } from "@/lib/format";

export const dynamic = "force-dynamic";

async function getCatalogData() {
  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: { status: "ACTIVE" },
      include: {
        images: { take: 1, orderBy: { position: "asc" } },
        sellerProfile: { select: { displayName: true } },
        inventory: { select: { availability: true, confirmedBySeller: true } },
      },
      orderBy: { rating: "desc" },
      take: 8,
    }),
    prisma.category.findMany({ take: 12, orderBy: { name: "asc" } }),
  ]);
  return { products, categories };
}

export default async function Home() {
  const { products, categories } = await getCatalogData();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:py-10">
      {/* Hero: Светлана is the centrepiece, not a decoration */}
      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="card flex flex-col justify-center gap-4 p-6 md:p-10">
          <span className="chip w-fit">AI-нативная платформа</span>
          <h1 className="text-3xl font-bold leading-tight text-ink md:text-5xl">
            Не ищите товар, <span className="text-svetlana-600">объясните задачу</span>.
          </h1>
          <p className="max-w-xl text-base text-ink-soft md:text-lg">
            Светлана понимает контекст покупки: для кого, зачем, в каком бюджете и к какому сроку.
            Она ищет, сравнивает, проверяет продавца и сопровождает заказ.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/svetlana" className="btn btn-primary">
              Поговорить со Светланой
            </Link>
            <Link href="/catalog" className="btn btn-ghost">
              Открыть каталог
            </Link>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <span className="chip">Естественный поиск</span>
            <span className="chip">Сравнение</span>
            <span className="chip">Подарки</span>
            <span className="chip">Доверие продавца</span>
          </div>
        </div>
        <SvetlanaChat className="min-h-[420px]" />
      </section>

      {categories.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold text-ink">Категории</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {categories.map((c) => (
              <Link
                key={c.id}
                href={`/catalog?category=${encodeURIComponent(c.slug)}`}
                className="card p-4 text-sm font-medium text-ink transition-shadow hover:shadow-float"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-4 text-xl font-bold text-ink">Популярные товары</h2>
        {products.length === 0 ? (
          <div className="card p-10 text-center text-ink-soft">
            Витрина пока пустая. Продавцы скоро добавят товары, а пока можно{" "}
            <Link href="/svetlana" className="text-svetlana-700 hover:underline">
              рассказать Светлане, что вы ищете
            </Link>
            .
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <Link key={p.id} href={`/product/${p.id}`} className="card overflow-hidden transition-shadow hover:shadow-float">
                <div className="aspect-square bg-surface-muted">
                  {p.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.images[0].url} alt={p.title} className="h-full w-full object-contain" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-3xl" aria-hidden="true">📦</div>
                  )}
                </div>
                <div className="space-y-1.5 p-3">
                  <div className="line-clamp-2 text-sm font-medium text-ink">{p.title}</div>
                  <div className="text-base font-bold text-svetlana-700">{rub(p.priceKopecks)}</div>
                  <div className="text-xs text-ink-soft">{p.sellerProfile.displayName}</div>
                  <div className="text-xs text-ink-faint">
                    {p.inventory?.confirmedBySeller ? "✓ наличие подтверждено" : "наличие уточняется"}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
