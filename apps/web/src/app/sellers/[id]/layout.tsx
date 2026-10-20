import type { Metadata } from "next";
import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { isDemoSeller } from "@/lib/domains/seller-trust-display";
import { isSvgUrl } from "@/lib/og-font";
import { SITE_NAME, absoluteImage, siteUrl, snippet } from "@/lib/seo";

interface LayoutProps {
  params: Promise<{ id: string }>;
  children: ReactNode;
}

/**
 * Заголовок, описание и картинка страницы магазина для поисковиков и ссылок в мессенджерах:
 * продавец делится ссылкой из кабинета. Картинка: логотип или фото свежего товара;
 * если фото в SVG, берём PNG-превью этого товара. Демо-магазин не индексируется.
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
          select: { id: true, images: { orderBy: { position: "asc" }, take: 1, select: { url: true } } },
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
  const latest = seller.products[0];
  const logo = seller.logoUrl && !isSvgUrl(seller.logoUrl) ? absoluteImage(seller.logoUrl) : null;
  const photoRaw = latest?.images[0]?.url ?? null;
  const photo = photoRaw ? absoluteImage(photoRaw) : null;
  const image = logo ?? (photo && !isSvgUrl(photo) ? photo : latest ? siteUrl(`/og/product/${latest.id}`) : null);
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
