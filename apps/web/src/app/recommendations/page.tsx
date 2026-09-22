import Link from "next/link";
import { requireUserServer } from "@/lib/auth";
import { recommendForUser } from "@/lib/domains/recommendations";
import { rub } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata = { title: "Рекомендации" };

export default async function RecommendationsPage() {
  const session = await requireUserServer();
  const { items, basis } = await recommendForUser(session.user.id, { limit: 12 });

  // The ranking layer returns ids + signals only; product display fields are
  // resolved here so the ranking engine stays free of presentation concerns.
  const products = items.length
    ? await prisma.product.findMany({
        where: { id: { in: items.map((i) => i.productId) } },
        select: { id: true, title: true, priceKopecks: true, status: true },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Рекомендации</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Отдельный ranking-движок, не только LLM. Каждая рекомендация объяснима.
          </p>
        </div>
        <Link href="/privacy" className="btn btn-ghost text-sm">
          Управлять персонализацией
        </Link>
      </div>

      <p className="mt-4 card p-4 text-xs text-ink-soft">
        <span className="font-medium text-ink">Основа ранжирования: </span>
        {basis}
      </p>

      {items.length === 0 ? (
        <p className="mt-6 card p-6 text-sm text-ink-soft">
          Пока недостаточно данных для персональных рекомендаций. Посмотрите
          каталог или добавьте товары в избранное — и рекомендации появятся.
        </p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const product = byId.get(item.productId);
            if (!product) return null;
            return (
              <article key={item.productId} className="card overflow-hidden">
                <div className="p-4">
                  <Link
                    href={`/product/${item.productId}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {product.title}
                  </Link>
                  <div className="mt-1 text-sm text-ink">{rub(product.priceKopecks / 100)}</div>
                  <p className="mt-2 text-xs text-ink-soft">
                    <span className="font-medium text-ink">Почему это: </span>
                    {item.reason}
                  </p>
                  {item.signals.length > 1 && (
                    <p className="mt-1 text-xs text-ink-faint">
                      сигналы: {item.signals.join(", ")}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1">
                    {(["useful", "not_useful", "too_expensive", "already_have"] as const).map(
                      (signal) => (
                        <form key={signal} action="/api/recommendations" method="POST">
                          <input type="hidden" name="productId" value={item.productId} />
                          <input type="hidden" name="signal" value={signal} />
                          <button className="btn btn-ghost px-2 py-0.5 text-xs" type="submit">
                            {signal === "useful"
                              ? "👍"
                              : signal === "not_useful"
                                ? "👎"
                                : signal === "too_expensive"
                                  ? "дорого"
                                  : "уже есть"}
                          </button>
                        </form>
                      )
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
