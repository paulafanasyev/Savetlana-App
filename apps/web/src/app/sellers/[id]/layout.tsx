import type { Metadata } from "next";
import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { isDemoSeller } from "@/lib/domains/seller-trust-display";
import { SITE_NAME, absoluteImage, snippet } from "@/lib/seo";

interface LayoutProps {
  params: Promise<{ id: string }>;
  children: ReactNode;
}

/**
 * Заголовок, описание и картинка страницы магазина для поисковиков и ссылок в мессенджерах:
 * продавец делится ссылкой из кабинета. Картинка: логотип или фото свежего товара.
 * Демо-магазин не индексируется.
 */
export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { id } = await params;
  const seller = await prisma.sellerProfile
    .findFirst({
      where: { OR: [{ id }, { slug: id }], isActivated: true },
      select: {
        id: true,
        slug: true,
        displayName: true,
        description: true,
        logoUrl: true,
        products: {
          where: { status: "ACTIVE" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { images: { orderBy: { position: "asc" }, take: 1, select: { url: true } } },
        },
        _count: { select: { products: { where: { status: "ACTIVE" } } } },
      },
    })
    .catch(() => null);
  if (!seller) return { title: "Магазин не найден", robots: { index: false } };
  const count = seller._count.products;
  const description =
    snippet(seller.description ?? "", 140) ||
    `Магазин «${seller.displayName}» на ${SITE_NAME}: ${count > 0 ? `${count} товар(ов) в продаже` : "скоро появятся товары"}, безопасная сделка.`;
  const raw = seller.logoUrl ?? seller.products[0]?.images[0]?.url ?? null;
  const image = raw ? absoluteImage(raw) : null;
  const title = `${seller.displayName}: магазин на ${SITE_NAME}`;
  return {
    title,
    description,
    alternates: { canonical: `/sellers/${seller.id}` },
    ...(isDemoSeller(seller) ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title,
      description,
      type: "website",
      siteName: SITE_NAME,
      locale: "ru_RU",
      ...(image ? { images: [{ url: image }] } : {}),
    },
  };
}

export default function SellerPublicLayout({ children }: LayoutProps) {
  return children;
}
