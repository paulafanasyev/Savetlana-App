import Link from "next/link";
import { listAdminProducts } from "@/lib/domains/admin";
import { rub, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Admin products section (spec §37). Unlike the public catalog this lists
 * *every* status, including drafts and hidden items — the platform needs to
 * see the full inventory to moderate it.
 */
export default async function AdminProductsPage() {
  const products = await listAdminProducts();

  const statusStyles: Record<string, string> = {
    ACTIVE: "bg-green-100 text-green-800",
    DRAFT: "bg-gray-100 text-gray-700",
    PENDING_SELLER_APPROVAL: "bg-amber-100 text-amber-800",
    HIDDEN: "bg-amber-100 text-amber-800",
    ARCHIVED: "bg-gray-100 text-gray-500",
  };

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line p-4">
        <h2 className="text-base font-bold text-ink">Товары</h2>
        <p className="text-xs text-ink-soft">
          Последние {products.length} записей · включая черновики и скрытые
        </p>
      </div>
      {products.length === 0 ? (
        <p className="p-6 text-sm text-ink-soft">Товаров пока нет</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-4 py-2">Товар</th>
                <th className="px-4 py-2">SKU</th>
                <th className="px-4 py-2">Цена</th>
                <th className="px-4 py-2">Продавец</th>
                <th className="px-4 py-2">Статус</th>
                <th className="px-4 py-2">Продажи</th>
                <th className="px-4 py-2">Отзывы</th>
                <th className="px-4 py-2">Создан</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2">
                    <Link
                      href={`/product/${p.id}`}
                      className="font-medium text-ink hover:text-svetlana-700"
                    >
                      {p.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-soft">{p.sku}</td>
                  <td className="px-4 py-2 text-ink">{rub(p.priceKopecks)}</td>
                  <td className="px-4 py-2 text-ink-soft">{p.sellerName}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${statusStyles[p.status] ?? "bg-gray-100 text-gray-700"}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{p.sales}</td>
                  <td className="px-4 py-2 text-ink-soft">{p.reviews}</td>
                  <td className="px-4 py-2 text-ink-faint" title={p.createdAt}>
                    {timeAgo(new Date(p.createdAt))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
