import Link from "next/link";
import { requireSellerServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rub } from "@/lib/format";
import { productStatusLabel, availabilityLabel } from "@/lib/labels";
import { ensureBaseCategories } from "@/lib/domains/categories";
import { ProductDraftAssistant } from "@/components/ProductDraftAssistant";
import { ConfirmAvailabilityButton } from "@/components/ConfirmAvailabilityButton";
import { PublishProductButton } from "@/components/PublishProductButton";

export const dynamic = "force-dynamic";

export default async function SellerProductsPage() {
  const { sellerId } = await requireSellerServer();
  await ensureBaseCategories();
  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: { sellerId },
      include: { images: { take: 1, orderBy: { position: "asc" } }, inventory: true, category: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.category.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
  ]);
  const now = new Date();
  return (
    <main className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Товары</h1>
        <Link href="/seller/products" className="btn btn-ghost">Обновить</Link>
      </div>
      <ProductDraftAssistant categories={categories} />
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3">Фото</th><th className="p-3">Название</th><th className="p-3">Категория</th><th className="p-3">Цена</th>
              <th className="p-3">Остаток</th><th className="p-3">Наличие</th><th className="p-3">Статус</th><th className="p-3">Действия</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const confirmed = Boolean(product.inventory?.confirmedBySeller && product.inventory.saleUntil && product.inventory.saleUntil > now);
              return (
                <tr key={product.id} className="border-b">
                  <td className="p-3">{product.images[0] ? <img src={product.images[0].url} alt={product.title} className="h-14 w-14 rounded object-cover" /> : "—"}</td>
                  <td className="p-3 font-medium">{product.title}<div className="text-xs text-ink-faint">Код: {product.sku}</div></td>
                  <td className="p-3">{product.category?.name ?? "—"}</td>
                  <td className="p-3">{rub(product.priceKopecks)}</td>
                  <td className="p-3">{product.inventory?.quantity ?? 0}</td>
                  <td className="p-3">{availabilityLabel(product.inventory?.availability)}</td>
                  <td className="p-3">{productStatusLabel(product.status)}</td>
                  <td className="space-y-2 p-3">
                    <Link className="btn btn-ghost" href={`/seller/products/${product.id}/edit`}>Изменить</Link>
                    {product.status === "DRAFT" && <PublishProductButton productId={product.id} title={product.title} />}
                    <ConfirmAvailabilityButton productId={product.id} confirmed={confirmed} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {products.length === 0 && <p className="p-6 text-ink-faint">У вас пока нет товаров. Добавьте первый товар формой выше.</p>}
      </div>
    </main>
  );
}
