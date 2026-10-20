import { countSellersWithoutApplication, listVerificationQueue } from "@/lib/domains/admin";
import { VerificationDecisionButtons } from "@/components/VerificationDecisionButtons";
import { countText, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

const PEOPLE_FORMS = ["человек", "человека", "человек"] as const;

export default async function AdminVerificationPage() {
  const [sellers, withoutApplication] = await Promise.all([listVerificationQueue(), countSellersWithoutApplication().catch(() => 0)]);
  return (
    <main className="space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Очередь проверки продавцов</h1>
        <p className="mt-2 text-ink-soft">Здесь только те, кому нужно ваше решение. Решение сохраняется как ручная проверка.</p>
        <p className="mt-1 text-sm text-ink-soft">
          Самозанятый, чей статус подтвердила ФНС, торгует сразу, но выплаты ему закрыты, пока вы не нажмёте «Одобрить».
          Перед этим убедитесь, что за аккаунтом стоит владелец ИНН.
        </p>
      </div>
      {sellers.length === 0 ? <p>Заявок на проверку пока нет.</p> : (
        <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Продавец</th><th className="p-3">Тип</th><th className="p-3">ИНН</th><th className="p-3">ОГРН</th><th className="p-3">Состояние</th><th className="p-3">Действие</th></tr></thead><tbody>{sellers.map((seller) => <tr key={seller.id} className="border-b last:border-0"><td className="p-3">{seller.displayName}{seller.submittedAt && <span className="block text-xs text-ink-faint">заявка {timeAgo(seller.submittedAt)}</span>}{seller.fnsAuto && <span className="mt-1 block w-fit rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-900">уже торгует, ждёт проверки личности</span>}</td><td className="p-3">{sellerTypeLabel(seller.sellerType)}</td><td className="p-3">{seller.inn ?? "—"}</td><td className="p-3">{seller.ogrn ?? "—"}</td><td className="p-3">личность: {statusLabel(seller.identityStatus)}; бизнес: {statusLabel(seller.businessStatus)}; НПД: {statusLabel(seller.npdStatus)}</td><td className="p-3"><VerificationDecisionButtons sellerId={seller.id} kind={seller.sellerType === "SELF_EMPLOYED" ? "npd" : "business"} /></td></tr>)}</tbody></table></div>
      )}
      {withoutApplication > 0 && (
        <p className="text-sm text-ink-soft">
          Ещё {countText(withoutApplication, PEOPLE_FORMS)} открыли кабинет продавца, но заявку не подали. Решать по ним нечего, пока они не заполнят реквизиты.
        </p>
      )}
    </main>
  );
}

function sellerTypeLabel(value: string) { return value === "SELF_EMPLOYED" ? "самозанятый" : value === "IP" ? "ИП" : value === "COMPANY" ? "ООО" : "продавец"; }
function statusLabel(value: string | null) { return value === "VERIFIED" ? "подтверждено" : value === "REJECTED" ? "отклонено" : value === "PENDING" ? "на проверке" : value === "FNS_AUTO" ? "по ИНН в ФНС, выплаты ждут вас" : "не подтверждено"; }
