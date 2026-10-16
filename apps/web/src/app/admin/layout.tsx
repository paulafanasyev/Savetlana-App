import Link from "next/link";
import type { ReactNode } from "react";
import { requireUserServer } from "@/lib/auth";

export const dynamic = "force-dynamic";

const NAV: { href: string; label: string }[] = [
  { href: "/admin", label: "Обзор" },
  { href: "/admin/users", label: "Пользователи" },
  { href: "/admin/sellers", label: "Продавцы" },
  { href: "/admin/receipts", label: "Чеки и ИНН" },
  { href: "/admin/products", label: "Товары" },
  { href: "/admin/classifieds", label: "Объявления на проверке" },
  { href: "/admin/reviews", label: "Отзывы на проверке" },
  { href: "/admin/orders", label: "Заказы" },
  { href: "/admin/disputes", label: "Споры" },
  { href: "/admin/payments", label: "Платежи" },
  { href: "/admin/payouts", label: "Выплаты" },
  { href: "/admin/verification", label: "Верификация" },
  { href: "/admin/risk", label: "Риски" },
  { href: "/admin/agents", label: "Эффективность агента" },
  { href: "/admin/ai", label: "AI мониторинг" },
  { href: "/admin/audit", label: "Аудит" },
];

const ROLE_LABEL: Record<string, string> = { BUYER: "покупатель", SELLER: "продавец", ADMIN: "администратор" };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user } = await requireUserServer();

  // Не администратору объясняем, в чём дело, вместо страницы «Что-то пошло не так».
  if (user.role !== "ADMIN") {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <div className="card space-y-3 p-6">
          <h1 className="text-xl font-bold text-ink">Нет прав администратора</h1>
          <p className="text-sm text-ink-soft">
            Вы вошли как <b>{user.email}</b>, роль: {ROLE_LABEL[user.role] ?? user.role}.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
            <li>В Vercel добавьте эту почту в переменную ADMIN_EMAILS (несколько почт через запятую).</li>
            <li>Сделайте Redeploy, иначе сайт не увидит новую переменную.</li>
            <li>Выйдите и войдите снова: права выдаются при входе.</li>
          </ol>
          <div className="flex gap-2 pt-1">
            <Link href="/login" className="btn btn-primary">Войти заново</Link>
            <Link href="/" className="btn btn-ghost">На главную</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Панель администратора</h1>
          <p className="text-sm text-ink-soft">{user.name} · площадка АИКО</p>
        </div>
        <Link href="/" className="btn btn-ghost">
          На главную
        </Link>
      </div>

      <nav className="mb-6 flex flex-wrap gap-2">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className="btn btn-ghost text-sm">
            {item.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
