import { requireSellerServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { promoState } from "@/lib/domains/engagement-rules";
import { expirePromotions, promotionEndDates } from "@/lib/domains/seller-promotions";
import { PromotionsForm } from "./PromotionsForm";

export const dynamic = "force-dynamic";

export default async function SellerPromotionsPage() {
  const { sellerId } = await requireSellerServer();
  // Акции с вышедшим сроком заканчиваем сразу, не дожидаясь фоновой задачи.
  await expirePromotions({ sellerId }).catch(() => 0);
  const products = await prisma.product.findMany({
    where: { sellerId, status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, title: true, priceKopecks: true, oldPriceKopecks: true, views: true },
  });
  const states = products.map((p) => ({ ...p, ...promoState(p) }));
  const ends = await promotionEndDates(states.filter((r) => r.onPromo).map((r) => r.id));
  const rows = states.map((r) => ({ ...r, endsAt: r.onPromo ? ends.get(r.id)?.toISOString() ?? null : null }));
  const onPromo = rows.filter((r) => r.onPromo).length;
  return (
    <main className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Акции и скидки</h1>
        <p className="text-ink-soft">
          Выберите товары и размер скидки. Покупатели увидят зачёркнутую цену, а те, кто добавил товар в избранное, получат уведомление.
          Зачёркнутая цена всегда равна настоящей цене до скидки. Можно задать срок: когда он выйдет, обычная цена вернётся сама. {onPromo > 0 ? `Сейчас со скидкой: ${onPromo}.` : ""}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-ink-faint">Опубликованных товаров пока нет. Скидку можно запустить после публикации.</p>
      ) : (
        <PromotionsForm products={rows} />
      )}
    </main>
  );
}
