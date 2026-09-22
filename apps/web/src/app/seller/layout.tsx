import Link from "next/link";
import type { ReactNode } from "react";
import { requireSellerServer } from "@/lib/auth";

export const dynamic = "force-dynamic";

const NAV: { href: string; label: string }[] = [
  { href: "/seller", label: "Главная" },
  { href: "/seller/products", label: "Товары" },
  { href: "/seller/orders", label: "Заказы" },
  { href: "/seller/disputes", label: "Споры" },
  { href: "/seller/documents", label: "Документы" },
  { href: "/seller/analytics", label: "Аналитика" },
  { href: "/svetlana", label: "Светлана" },
];

export default async function SellerLayout({ children }: { children: ReactNode }) {
  // Every seller page requires an activated seller profile.
  await requireSellerServer();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
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
