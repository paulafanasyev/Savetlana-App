import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdminServer } from "@/lib/auth";

export const dynamic = "force-dynamic";

const NAV: { href: string; label: string }[] = [
  { href: "/admin", label: "Обзор" },
  { href: "/admin/users", label: "Пользователи" },
  { href: "/admin/orders", label: "Заказы" },
  { href: "/admin/verification", label: "Верификация" },
  { href: "/admin/risk", label: "Риски" },
  { href: "/admin/ai", label: "AI мониторинг" },
  { href: "/admin/audit", label: "Аудит" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user } = await requireAdminServer();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Панель администратора</h1>
          <p className="text-sm text-ink-soft">{user.name} · платформа Svetlana</p>
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
