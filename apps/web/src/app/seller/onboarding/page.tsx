import { requireSellerServer } from "@/lib/auth";
import { getSellerVerificationStatus } from "@/lib/domains/seller-verification";
import { SellerOnboardingForm } from "@/components/SellerOnboardingForm";
import { NpdCheckButton } from "@/components/NpdCheckButton";
import { timeAgo } from "@/lib/format";

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
      {data.seller.sellerType === "SELF_EMPLOYED" && data.seller.inn && (
        <section className="rounded-xl border border-surface-line p-4">
          <h2 className="font-semibold">Статус самозанятого в ФНС</h2>
          <p className="mt-1 text-sm">
            {data.seller.npdStatus === "VERIFIED"
              ? "✓ ФНС подтвердила, что вы плательщик налога на профессиональный доход."
              : data.seller.npdStatus === "REJECTED"
                ? "ФНС не подтвердила статус самозанятого по вашему ИНН."
                : "Статус ещё не подтверждён ФНС."}
          </p>
          {data.npdCheck && (
            <p className="mt-1 text-xs text-ink-soft">
              Последняя проверка {timeAgo(data.npdCheck.createdAt)}{data.npdCheck.note ? `: ${data.npdCheck.note}` : ""}
            </p>
          )}
          <p className="mt-1 text-xs text-ink-soft">
            Проверяем по ИНН в официальном сервисе ФНС statusnpd.nalog.ru. Если вы только что зарегистрировались в «Мой налог», статус может появиться в течение дня.
          </p>
          <NpdCheckButton />
        </section>
      )}
      <SellerOnboardingForm initial={data.seller} disabled={data.status === "PENDING" || data.status === "APPROVED"} />
    </main>
  );
}
