import Link from "next/link";
import { requireSellerServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DraftPhotoBulk } from "@/components/DraftPhotoBulk";

export const dynamic = "force-dynamic";

export default async function SellerDraftPhotosPage() {
  const { sellerId } = await requireSellerServer();
  const products = await prisma.product.findMany({
    where: { sellerId, status: "DRAFT" },
    select: { id: true, title: true, sku: true, _count: { select: { images: true } } },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  // Сначала черновики без фото: им фото нужнее всего.
  const drafts = products
    .map((p) => ({ id: p.id, title: p.title, sku: p.sku, photos: p._count.images }))
    .sort((a, b) => Number(a.photos > 0) - Number(b.photos > 0));
  return (
    <main className="space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Фото к черновикам</h1>
          <p className="text-sm text-ink-soft">Сразу много фото для многих карточек. Без фото карточку опубликовать нельзя.</p>
        </div>
        <Link href="/seller/products" className="btn btn-ghost">К товарам</Link>
      </div>
      <DraftPhotoBulk drafts={drafts} />
    </main>
  );
}
