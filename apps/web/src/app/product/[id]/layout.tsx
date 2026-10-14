import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { rub } from "@/lib/format";
import { SITE_NAME, absoluteImage, inStock, jsonLdString, productJsonLd, snippet, type SeoProduct } from "@/lib/seo";

interface LayoutProps {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}

async function loadSeoProduct(id: string): Promise<SeoProduct | null> {
  const product = await prisma.product.findFirst({
    where: { id, status: "ACTIVE" },
    select: {
      id: true,
      title: true,
      description: true,
      sku: true,
      priceKopecks: true,
      currency: true,
      rating: true,
      reviewsCount: true,
      images: { orderBy: { position: "asc" }, take: 5, select: { url: true } },
      inventory: { select: { quantity: true, availability: true } },
      sellerProfile: { select: { displayName: true } },
      category: { select: { name: true } },
    },
  });
  if (!product) return null;
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    sku: product.sku,
    priceKopecks: product.priceKopecks,
    currency: product.currency,
    rating: product.rating,
    reviewsCount: product.reviewsCount,
    images: product.images,
    inventory: product.inventory,
    sellerName: product.sellerProfile.displayName,
    categoryName: product.category?.name ?? null,
  };
}

/** Заголовок и описание карточки для поисковиков и ссылок в мессенджерах. */
export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { id } = await params;
  const product = await loadSeoProduct(id).catch(() => null);
  if (!product) return { title: "Товар не найден", robots: { index: false } };
  const price = rub(product.priceKopecks);
  const description =
    snippet(product.description, 140) ||
    `${product.title} за ${price}${inStock(product) ? ", в наличии" : ""}. Продавец ${product.sellerName}.`;
  const image = product.images.map((i) => absoluteImage(i.url)).find(Boolean) ?? undefined;
  return {
    title: `${product.title}: купить за ${price}`,
    description,
    alternates: { canonical: `/product/${product.id}` },
    openGraph: {
      title: product.title,
      description,
      type: "website",
      siteName: SITE_NAME,
      locale: "ru_RU",
      ...(image ? { images: [{ url: image }] } : {}),
    },
  };
}

export default async function ProductLayout({ params, children }: LayoutProps) {
  const { id } = await params;
  const product = await loadSeoProduct(id).catch(() => null);
  return (
    <>
      {product && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(productJsonLd(product)) }} />
      )}
      {children}
    </>
  );
}
