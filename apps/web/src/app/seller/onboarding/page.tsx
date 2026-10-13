import { requireSellerServer } from "@/lib/auth";
import { getSellerVerificationStatus } from "@/lib/domains/seller-verification";
import { SellerOnboardingForm } from "@/components/SellerOnboardingForm";

export const dynamic = "force-dynamic";

export default async function SellerOnboardingPage() {
  const { sellerId } = await requireSellerServer();
  const data = await getSellerVerificationStatus(sellerId);
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Проверка продавца</h1>
        <p className="mt-2 text-ink-soft">Заполните реквизиты магазина. После проверки вы сможете публиковать товары.</p>
      </div>
      {data.status === "PENDING" && <div className="rounded-xl bg-amber-50 p-4 text-amber-900">Заявка на проверке</div>}
      {data.status === "APPROVED" && <div className="rounded-xl bg-green-50 p-4 text-green-900">Проверка пройдена. Магазин активирован.</div>}
      {data.status === "REJECTED" && (
        <div className="rounded-xl bg-red-50 p-4 text-red-900">
          <strong>Заявка отклонена.</strong>{data.latest?.note ? ` Причина: ${data.latest.note}` : " Исправьте данные и отправьте заявку повторно."}
        </div>
      )}
      <SellerOnboardingForm initial={data.seller} disabled={data.status === "PENDING" || data.status === "APPROVED"} />
    </main>
  );
}
