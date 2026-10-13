import Link from "next/link";
import type { ReactNode } from "react";
import { requireUserServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BecomeSellerButton } from "@/components/BecomeSellerButton";

export const dynamic = "force-dynamic";
const NAV = [
  ["/seller", "Главная"],
  ["/seller/products", "Товары"],
  ["/seller/orders", "Заказы"],
  ["/seller/messages", "Сообщения"],
  ["/seller/customers", "Покупатели"],
  ["/seller/promotions", "Акции"],
  ["/seller/pricing", "Цены"],
  ["/seller/competitors", "Конкуренты"],
  ["/seller/analytics", "Аналитика"],
  ["/seller/payouts", "Выплаты"],
  ["/seller/disputes", "Споры"],
  ["/seller/documents", "Документы"],
  ["/seller/onboarding", "Проверка продавца"],
  ["/svetlana?side=seller", "Светлана"],
] as const;

export default async function SellerLayout({ children }: { children: ReactNode }) {
  const { user } = await requireUserServer();
  const seller = await prisma.sellerProfile.findFirst({ where: { userId: user.id }, select: { id: true } });
  // У человека ещё нет кабинета: предлагаем открыть его, а не показываем ошибку.
  if (!seller) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <div className="card space-y-3 p-6">
          <h1 className="text-xl font-bold text-ink">Кабинет продавца</h1>
          <p className="text-sm text-ink-soft">
            У аккаунта {user.email} пока нет кабинета продавца. Откройте его одной кнопкой, покупки и заказы останутся на месте.
          </p>
          <BecomeSellerButton />
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen">
      {/* На телефоне меню листается вбок, а не растягивается на несколько строк. */}
      <nav aria-label="Кабинет продавца" className="sticky top-[61px] z-30 border-b border-surface-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto whitespace-nowrap px-4 py-2">
          {NAV.map(([href, label]) => (
            <Link href={href} key={href} className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface-muted hover:text-ink">
              {label}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </div>
  );
}
