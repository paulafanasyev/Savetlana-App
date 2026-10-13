import Link from "next/link";
import type { ReactNode } from "react";
import { requireUserServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BecomeSellerButton } from "@/components/BecomeSellerButton";

export const dynamic = "force-dynamic";
const NAV = [["/seller", "Главная"], ["/seller/onboarding", "Проверка продавца"], ["/seller/products", "Товары"], ["/seller/orders", "Заказы"], ["/seller/customers", "Покупатели"], ["/seller/messages", "Сообщения"], ["/seller/promotions", "Акции"], ["/seller/payouts", "Выплаты"], ["/seller/disputes", "Споры"], ["/seller/documents", "Документы"], ["/seller/analytics", "Аналитика"], ["/svetlana", "Светлана"]] as const;

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
  return <div className="min-h-screen"><nav className="flex flex-wrap gap-3 border-b px-6 py-4">{NAV.map(([href, label]) => <Link href={href} key={href} className="text-sm">{label}</Link>)}</nav>{children}</div>;
}
