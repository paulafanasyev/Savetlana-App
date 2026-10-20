import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { rub } from "@/lib/format";
import { isDemoSeller } from "@/lib/domains/seller-trust-display";
import { SITE_NAME, absoluteImage, inStock, jsonLdString, productJsonLd, snippet, type SeoProduct } from "@/lib/seo";

interface LayoutProps {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}

/** Товар для поисковиков плюс признак демо-магазина. */
type LoadedProduct = SeoProduct & { demo: boolean };

async function loadSeoProduct(id: string): Promise<LoadedProduct | null> {
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
      sellerProfile: { select: { displayName: true, slug: true } },
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
    demo: isDemoSeller({ slug: product.sellerProfile.slug }),
  };
}

/**
 * Заголовок и описание карточки для поисковиков и ссылок в мессенджерах.
 * Товар демо-магазина не индексируется: купить его по-настоящему нельзя, и в выдаче Яндекса
 * или ChatGPT он вводил бы в заблуждение.
 */
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
    ...(product.demo ? { robots: { index: false, follow: true } } : {}),
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
      {product && !product.demo && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(productJsonLd(product)) }} />
      )}
      {children}
    </>
  );
}
