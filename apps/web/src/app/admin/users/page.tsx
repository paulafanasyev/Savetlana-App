import { listAdminUsers } from "@/lib/domains/admin";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const users = await listAdminUsers();

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line p-4">
        <h2 className="text-base font-bold text-ink">Пользователи</h2>
        <p className="text-xs text-ink-soft">Последние {users.length} записей</p>
      </div>
      {users.length === 0 ? (
        <p className="p-6 text-sm text-ink-soft">Пользователей пока нет</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-4 py-2">Имя</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Роль</th>
                <th className="px-4 py-2">Продавец</th>
                <th className="px-4 py-2">Статус</th>
                <th className="px-4 py-2">Создан</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2 font-medium text-ink">{u.name}</td>
                  <td className="px-4 py-2 text-ink-soft">{u.email}</td>
                  <td className="px-4 py-2">
                    <span className="rounded bg-surface px-2 py-0.5 text-xs">{u.role}</span>
                  </td>
                  <td className="px-4 py-2 text-ink-soft">
                    {u.seller ? (
                      <span>
                        {u.seller.displayName}
                        <span className="ml-1 text-xs text-ink-faint">{u.seller.identityStatus}</span>
                      </span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {u.isBlocked ? (
                      <span className="font-medium text-red-700">заблокирован</span>
                    ) : (
                      <span className="text-green-700">активен</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{timeAgo(u.createdAt)}</td>
                  <td className="px-4 py-2 text-right">
                    {u.role === "ADMIN" ? (
                      <span className="text-xs text-ink-faint">админ</span>
                    ) : (
                      <form
                        action={`/api/admin/users/${u.id}/${u.isBlocked ? "unblock" : "block"}`}
                        method="POST"
                      >
                        <input type="hidden" name="confirm" value="true" />
                        <button
                          type="submit"
                          className={`btn text-xs ${u.isBlocked ? "btn-ghost" : "btn-danger"}`}
                        >
                          {u.isBlocked ? "Разблокировать" : "Заблокировать"}
                        </button>
                      </form>
                    )}
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
