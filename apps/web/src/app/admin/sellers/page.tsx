import { listAdminSellers } from "@/lib/domains/admin";
import { rub, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Admin sellers section (spec §37). Revenue is the sum of actually-collected
 * orders only — never counted from carts, drafts or cancelled orders.
 */
export default async function AdminSellersPage() {
  const sellers = await listAdminSellers();

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line p-4">
        <h2 className="text-base font-bold text-ink">Продавцы</h2>
        <p className="text-xs text-ink-soft">Последние {sellers.length} записей</p>
      </div>
      {sellers.length === 0 ? (
        <p className="p-6 text-sm text-ink-soft">Продавцов пока нет</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-4 py-2">Продавец</th>
                <th className="px-4 py-2">Тип</th>
                <th className="px-4 py-2">Товары</th>
                <th className="px-4 py-2">Заказы</th>
                <th className="px-4 py-2">Оборот</th>
                <th className="px-4 py-2">Верификация</th>
                <th className="px-4 py-2">Статус</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sellers.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2">
                    <div className="font-medium text-ink">{s.displayName}</div>
                    <div className="text-xs text-ink-faint">{s.email}</div>
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{s.sellerType}</td>
                  <td className="px-4 py-2 text-ink-soft">{s.products}</td>
                  <td className="px-4 py-2 text-ink-soft">{s.orders}</td>
                  <td className="px-4 py-2 font-medium text-ink">{rub(s.revenueKopecks)}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-col gap-0.5 text-xs">
                      <span className={s.identityStatus === "VERIFIED" ? "text-green-700" : "text-amber-700"}>
                        личность: {s.identityStatus}
                      </span>
                      <span className="text-ink-faint">бизнес: {s.businessStatus}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {s.isBlocked ? (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">заблокирован</span>
                    ) : s.isActivated ? (
                      <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">активен</span>
                    ) : (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">не активирован</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <a
                      href={`/sellers/${s.id}`}
                      className="text-xs text-svetlana-700 hover:underline"
                    >
                      профиль →
                    </a>
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
