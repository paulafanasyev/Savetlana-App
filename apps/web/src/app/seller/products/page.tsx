import { requireSellerServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rub } from "@/lib/format";
import { ConfirmAvailabilityButton } from "@/components/ConfirmAvailabilityButton";

export const dynamic = "force-dynamic";

export default async function SellerProductsPage() {
  const { sellerId } = await requireSellerServer();
  const products = await prisma.product.findMany({
    where: { sellerId },
    include: {
      images: { take: 1, orderBy: { position: "asc" } },
      inventory: true,
      listing: true,
      category: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold text-ink">Товары</h1>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-surface-line bg-surface-muted text-left text-xs uppercase text-ink-faint">
            <tr>
              <th className="px-4 py-3">Фото</th>
              <th className="px-4 py-3">Название</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Категория</th>
              <th className="px-4 py-3">Цена</th>
              <th className="px-4 py-3">Остаток</th>
              <th className="px-4 py-3">Наличие</th>
              <th className="px-4 py-3">Просмотры</th>
              <th className="px-4 py-3">Конверсия</th>
              <th className="px-4 py-3">Статус</th>
              <th className="px-4 py-3">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-line">
            {products.map((p) => {
              const conversion = p.views > 0 ? (p.ordersCount / p.views) * 100 : 0;
              const expired = p.inventory?.saleUntil
                ? p.inventory.saleUntil < new Date()
                : true;
              return (
                <tr key={p.id} className="align-middle">
                  <td className="px-4 py-3">
                    {p.images[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.images[0].url} alt="" className="h-12 w-12 rounded-lg object-contain" />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-muted">📦</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <a href={`/product/${p.id}`} className="line-clamp-2 font-medium text-ink hover:text-svetlana-700">
                      {p.title}
                    </a>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-soft">{p.sku}</td>
                  <td className="px-4 py-3 text-ink-soft">{p.category?.name ?? "—"}</td>
                  <td className="px-4 py-3 font-semibold text-ink">{rub(p.priceKopecks)}</td>
                  <td className="px-4 py-3 text-ink">{p.inventory?.quantity ?? 0}</td>
                  <td className="px-4 py-3">
                    {p.inventory?.confirmedBySeller && !expired ? (
                      <span className="chip">✓ подтверждено</span>
                    ) : (
                      <span className="chip bg-amber-50 text-amber-700">требует подтверждения</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{p.views}</td>
                  <td className="px-4 py-3 text-ink-soft">{conversion.toFixed(1)}%</td>
                  <td className="px-4 py-3">
                    <span className="chip">{p.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <ConfirmAvailabilityButton
                      productId={p.id}
                      confirmed={Boolean(p.inventory?.confirmedBySeller && !expired)}
                    />
                  </td>
                </tr>
              );
            })}
            {products.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-ink-soft">
                  У вас пока нет товаров. Попросите Светлану: «Создай карточку товара».
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
