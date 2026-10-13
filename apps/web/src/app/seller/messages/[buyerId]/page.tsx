import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSellerServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadThread, sellerCanWrite } from "@/lib/domains/seller-messages";
import { resolveParams } from "@/lib/page-params";
import { rub, timeAgo, orderStatusLabel } from "@/lib/format";
import { MessageForm } from "@/components/MessageForm";
import { MessageThread } from "@/components/MessageThread";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ buyerId: string }>;
}

export default async function SellerThreadPage({ params }: PageProps) {
  const { sellerId, user } = await requireSellerServer();
  const { buyerId } = await resolveParams(params);
  const buyer = await prisma.user.findUnique({ where: { id: buyerId }, select: { id: true, name: true } });
  if (!buyer) notFound();
  const [canWrite, orders, messages] = await Promise.all([
    sellerCanWrite(sellerId, user.id, buyer.id),
    prisma.order.findMany({
      where: { sellerId, buyerId: buyer.id },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { id: true, number: true, status: true, totalKopecks: true, createdAt: true },
    }),
    loadThread(sellerId, buyer.id, "seller"),
  ]);
  return (
    <main className="space-y-5 p-6">
      <div>
        <Link href="/seller/messages" className="text-sm text-ink-soft hover:text-svetlana-700">← Все сообщения</Link>
        <h1 className="mt-1 text-2xl font-semibold">{buyer.name?.trim() || "Покупатель"}</h1>
      </div>
      {orders.length > 0 && (
        <section className="card p-4 text-sm">
          <h2 className="font-semibold">Заказы этого покупателя у вас</h2>
          <ul className="mt-2 space-y-1">
            {orders.map((o) => (
              <li key={o.id}>{o.number} · {orderStatusLabel(o.status)} · {rub(o.totalKopecks)} · {timeAgo(o.createdAt)}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="card p-4">
        <MessageThread messages={messages} emptyText="Сообщений пока нет." />
      </section>
      {canWrite ? (
        <MessageForm to="buyer" buyerId={buyer.id} placeholder="Ваш ответ покупателю" />
      ) : (
        <p className="text-sm text-ink-faint">Написать можно покупателю, который у вас заказывал или сам вам написал.</p>
      )}
    </main>
  );
}
