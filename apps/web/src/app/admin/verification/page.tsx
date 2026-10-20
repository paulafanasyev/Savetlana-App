import { listVerificationQueue } from "@/lib/domains/admin";
import { VerificationDecisionButtons } from "@/components/VerificationDecisionButtons";

export const dynamic = "force-dynamic";

export default async function AdminVerificationPage() {
  const sellers = await listVerificationQueue();
  return (
    <main className="space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Очередь проверки продавцов</h1>
        <p className="mt-2 text-ink-soft">Решение администратора сохраняется как ручная проверка.</p>
        <p className="mt-1 text-sm text-ink-soft">
          Самозанятый, чей статус подтвердила ФНС, торгует сразу («личность: по ИНН в ФНС»), но выплаты ему закрыты, пока вы
          не нажмёте «Одобрить». Перед этим убедитесь, что за аккаунтом стоит владелец ИНН.
        </p>
      </div>
      {sellers.length === 0 ? <p>Заявок на проверку пока нет.</p> : (
        <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Продавец</th><th className="p-3">Тип</th><th className="p-3">ИНН</th><th className="p-3">ОГРН</th><th className="p-3">Состояние</th><th className="p-3">Действие</th></tr></thead><tbody>{sellers.map((seller) => <tr key={seller.id} className="border-b last:border-0"><td className="p-3">{seller.displayName}</td><td className="p-3">{sellerTypeLabel(seller.sellerType)}</td><td className="p-3">{seller.inn ?? "—"}</td><td className="p-3">{seller.ogrn ?? "—"}</td><td className="p-3">личность: {statusLabel(seller.identityStatus)}; бизнес: {statusLabel(seller.businessStatus)}; НПД: {statusLabel(seller.npdStatus)}</td><td className="p-3"><VerificationDecisionButtons sellerId={seller.id} kind={seller.sellerType === "SELF_EMPLOYED" ? "npd" : "business"} /></td></tr>)}</tbody></table></div>
      )}
    </main>
  );
}

function sellerTypeLabel(value: string) { return value === "SELF_EMPLOYED" ? "самозанятый" : value === "IP" ? "ИП" : value === "COMPANY" ? "ООО" : "продавец"; }
function statusLabel(value: string | null) { return value === "VERIFIED" ? "подтверждено" : value === "REJECTED" ? "отклонено" : value === "PENDING" ? "на проверке" : value === "FNS_AUTO" ? "по ИНН в ФНС, выплаты ждут вас" : "не подтверждено"; }
