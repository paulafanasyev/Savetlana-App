import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUserServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadThread } from "@/lib/domains/seller-messages";
import { resolveParams } from "@/lib/page-params";
import { MessageForm } from "@/components/MessageForm";
import { MessageThread } from "@/components/MessageThread";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ sellerId: string }>;
  searchParams: Promise<{ about?: string }>;
}

export default async function BuyerThreadPage({ params, searchParams }: PageProps) {
  const { user } = await requireUserServer();
  const { sellerId } = await resolveParams(params);
  const { about } = await searchParams;
  const seller = await prisma.sellerProfile.findUnique({ where: { id: sellerId }, select: { id: true, userId: true, displayName: true } });
  if (!seller) notFound();
  if (seller.userId === user.id) redirect("/seller/messages");
  const product = about ? await prisma.product.findFirst({ where: { id: about, sellerId: seller.id }, select: { title: true } }) : null;
  const messages = await loadThread(seller.id, user.id, "buyer");
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div>
        <Link href="/messages" className="text-sm text-ink-soft hover:text-svetlana-700">← Все сообщения</Link>
        <h1 className="mt-1 text-2xl font-semibold">{seller.displayName}</h1>
        <p className="text-sm text-ink-soft">
          Не переводите деньги продавцу напрямую: оплата через сайт защищена, а при проблеме можно открыть спор.
        </p>
      </div>
      <section className="card p-4">
        <MessageThread messages={messages} emptyText="Задайте вопрос: о наличии, размере, доставке. Продавцу придёт уведомление." />
      </section>
      <MessageForm to="seller" sellerId={seller.id} initialText={product && messages.length === 0 ? `Здравствуйте! Вопрос по товару «${product.title}»: ` : ""} placeholder="Ваш вопрос продавцу" />
    </main>
  );
}
