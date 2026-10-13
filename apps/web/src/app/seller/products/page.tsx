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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Товары</h1>
        <div className="flex flex-wrap gap-2">
          {products.length > 0 && <Link href="/seller/products/new" className="btn btn-primary">Добавить товар</Link>}
          {products.length > 0 && <Link href="/seller/products/bulk" className="btn btn-ghost">Массовое редактирование</Link>}
          <Link href="/seller/products" className="btn btn-ghost">Обновить</Link>
        </div>
      </div>
      {products.length === 0 && (
        <div className="rounded-xl border border-svetlana-200 bg-svetlana-50 p-5 text-sm text-ink-soft">
          <div className="text-base font-semibold text-ink">Добавьте первый товар</div>
          <p className="mt-1">Заполните форму ниже: название, описание, цену и фото. Светлана создаст черновик, вы проверите его и опубликуете. Можно и проще: напишите Светлане «создай карточку чайник за 1990».</p>
        </div>
      )}
      <ProductDraftAssistant categories={categories} />
      {products.length > 0 && <div className="card overflow-x-auto">
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
                  <td className="p-3"><Link href={`/seller/products/${product.id}/edit`} aria-label={`Изменить «${product.title}»`}>{product.images[0] ? <img src={product.images[0].url} alt="" className="h-14 w-14 rounded object-cover" /> : <span className="flex h-14 w-14 items-center justify-center rounded bg-surface-muted text-xs text-ink-faint">нет фото</span>}</Link></td>
                  <td className="p-3 font-medium"><Link href={`/seller/products/${product.id}/edit`} className="hover:text-svetlana-700">{product.title}</Link><div className="text-xs text-ink-faint">Код: {product.sku}</div></td>
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
      </div>}
    </main>
  );
}
