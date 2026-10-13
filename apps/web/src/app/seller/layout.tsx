import Link from "next/link";
import type { ReactNode } from "react";
import { requireSellerServer } from "@/lib/auth";

export const dynamic = "force-dynamic";
const NAV = [["/seller", "Главная"], ["/seller/onboarding", "Проверка продавца"], ["/seller/products", "Товары"], ["/seller/orders", "Заказы"], ["/seller/customers", "Покупатели"], ["/seller/payouts", "Выплаты"], ["/seller/disputes", "Споры"], ["/seller/documents", "Документы"], ["/seller/analytics", "Аналитика"], ["/svetlana", "Светлана"]] as const;

export default async function SellerLayout({ children }: { children: ReactNode }) {
  await requireSellerServer();
  return <div className="min-h-screen"><nav className="flex flex-wrap gap-3 border-b px-6 py-4">{NAV.map(([href, label]) => <Link href={href} key={href} className="text-sm">{label}</Link>)}</nav>{children}</div>;
}
