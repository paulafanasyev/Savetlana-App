import Link from "next/link";
import { requireSellerServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSellerOnboardingGate } from "@/lib/domains/seller-onboarding";
import { BULK_MAX_ITEMS } from "@/lib/domains/bulk-rules";
import { BulkEditor } from "@/components/BulkEditor";

export const dynamic = "force-dynamic";

export default async function SellerBulkEditPage() {
  const { sellerId } = await requireSellerServer();
  const [products, gate] = await Promise.all([
    prisma.product.findMany({
      where: { sellerId, status: { not: "ARCHIVED" } },
      select: { id: true, sku: true, title: true, status: true, priceKopecks: true, oldPriceKopecks: true, inventory: { select: { quantity: true } } },
      orderBy: { updatedAt: "desc" },
      take: BULK_MAX_ITEMS,
    }),
    getSellerOnboardingGate(sellerId),
  ]);
  const rows = products.map((p) => ({ id: p.id, sku: p.sku, title: p.title, status: String(p.status), priceKopecks: p.priceKopecks, oldPriceKopecks: p.oldPriceKopecks, quantity: p.inventory?.quantity ?? 0 }));
  return (
    <main className="space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Массовое редактирование</h1>
          <p className="text-sm text-ink-soft">Цены и остатки сразу для многих товаров. До {BULK_MAX_ITEMS} товаров за раз.</p>
        </div>
        <Link href="/seller/products" className="btn btn-ghost">К товарам</Link>
      </div>
      <BulkEditor rows={rows} verified={gate.active} />
    </main>
  );
}
