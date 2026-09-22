import Link from "next/link";
import { requireUserServer } from "@/lib/auth";
import { getVerifiedCircle, RELATIONSHIP_TYPES } from "@/lib/domains/relationships";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata = { title: "Мои связи" };

export default async function RelationshipsPage() {
  const session = await requireUserServer();
  const [circle, declared, users] = await Promise.all([
    getVerifiedCircle(session.user.id),
    prisma.relationship.findMany({
      where: { fromUserId: session.user.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findMany({
      where: { id: { not: session.user.id }, role: { not: "ADMIN" } },
      take: 20,
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-ink">Мои связи</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Связь становится фактом только после взаимного подтверждения. Предположения
        Светланы всегда помечаются и не используются для подарков и рекомендаций.
      </p>

      <section className="mt-8">
        <h2 className="text-base font-bold text-ink">Подтверждённый круг</h2>
        {circle.length === 0 ? (
          <p className="mt-3 card p-5 text-sm text-ink-soft">
            Подтверждённых связей пока нет. Объявите связь ниже — после
            подтверждения вторым человеком она станет фактом.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-surface-line card px-4 text-sm">
            {circle.map((c) => (
              <li key={`${c.otherUserId}-${c.type}-${c.direction}`} className="flex justify-between py-2.5">
                <span className="font-medium text-ink">{c.otherUserName ?? "Пользователь"}</span>
                <span className="text-ink-soft">
                  {c.type} · {c.direction === "outgoing" ? "исходящая" : "входящая"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-base font-bold text-ink">Объявленные связи</h2>
        {declared.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">Вы ещё не объявили ни одной связи.</p>
        ) : (
          <ul className="mt-3 divide-y divide-surface-line card px-4 text-sm">
            {declared.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2.5">
                <span className="text-ink">{r.type}</span>
                <StatusPill status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 card p-5">
        <h2 className="text-base font-bold text-ink">Добавить связь</h2>
        <form action="/api/relationships" method="POST" className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="block text-ink-soft">Человек</span>
            <select name="toUserId" required className="input mt-1">
              <option value="">Выберите пользователя</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-ink-soft">Тип связи</span>
            <select name="type" required className="input mt-1">
              {RELATIONSHIP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="btn btn-primary">Отправить запрос</button>
          </div>
        </form>
        <p className="mt-3 text-xs text-ink-faint">
          Второй человек получит запрос и должен подтвердить связь сам. Светлана
          никогда не утверждает родство или дружбу без подтверждения.
        </p>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "VERIFIED"
      ? "text-green-700"
      : status === "REJECTED"
        ? "text-red-700"
        : status === "PENDING_CONFIRMATION"
          ? "text-amber-700"
          : "text-ink-faint";
  const label =
    status === "VERIFIED"
      ? "подтверждено"
      : status === "REJECTED"
        ? "отклонено"
        : status === "PENDING_CONFIRMATION"
          ? "ожидает подтверждения"
          : status === "DECLARED"
            ? "объявлено"
            : "предположение";
  return <span className={`text-xs font-medium ${tone}`}>{label}</span>;
}
