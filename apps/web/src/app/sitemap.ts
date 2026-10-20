import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { siteUrl } from "@/lib/seo";
import { DEMO_AUTHOR_EMAIL } from "@/lib/demo-classifieds";
import { activeAdClause } from "@/lib/ad-active";

export const dynamic = "force-dynamic";

const STATIC_PAGES: { path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" }[] = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/catalog", priority: 0.9, changeFrequency: "daily" },
  { path: "/classifieds", priority: 0.7, changeFrequency: "daily" },
  { path: "/freelance", priority: 0.6, changeFrequency: "daily" },
  { path: "/city", priority: 0.3, changeFrequency: "monthly" },
  { path: "/svetlana", priority: 0.5, changeFrequency: "monthly" },
  { path: "/contacts", priority: 0.3, changeFrequency: "monthly" },
  { path: "/legal/offer", priority: 0.2, changeFrequency: "monthly" },
  { path: "/legal/returns", priority: 0.2, changeFrequency: "monthly" },
  { path: "/legal/payment-delivery", priority: 0.2, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.2, changeFrequency: "monthly" },
];

/** Демо-магазины площадки (slug demo-…, как в isDemoSeller). */
const NOT_DEMO_SELLER = { NOT: { slug: { startsWith: "demo-" } } };

/**
 * Карта сайта для Яндекс.Вебмастера и Google: страницы, опубликованные товары, их продавцы
 * и действующие объявления. Примеры от площадки (демо-магазины и демо-объявления) и истёкшие
 * объявления сюда не попадают: покупатель из поиска должен попадать на настоящий товар.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = STATIC_PAGES.map((p) => ({
    url: siteUrl(p.path),
    lastModified: now,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
  try {
    const [products, sellers, ads] = await Promise.all([
      prisma.product.findMany({
        where: { status: "ACTIVE", sellerProfile: NOT_DEMO_SELLER },
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 5000,
      }),
      prisma.sellerProfile.findMany({
        where: { ...NOT_DEMO_SELLER, products: { some: { status: "ACTIVE" } } },
        select: { id: true, updatedAt: true },
        take: 1000,
      }),
      prisma.classified.findMany({
        where: { status: "PUBLISHED", author: { email: { not: DEMO_AUTHOR_EMAIL } }, AND: [activeAdClause(now)] },
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 5000,
      }),
    ]);
    for (const p of products) {
      entries.push({ url: siteUrl(`/product/${p.id}`), lastModified: p.updatedAt, changeFrequency: "weekly", priority: 0.8 });
    }
    for (const s of sellers) {
      entries.push({ url: siteUrl(`/sellers/${s.id}`), lastModified: s.updatedAt, changeFrequency: "weekly", priority: 0.5 });
    }
    for (const a of ads) {
      entries.push({ url: siteUrl(`/classifieds/${a.id}`), lastModified: a.updatedAt, changeFrequency: "weekly", priority: 0.6 });
    }
  } catch {
    // База недоступна: отдаём хотя бы основные страницы, а не ошибку.
  }
  return entries;
}
