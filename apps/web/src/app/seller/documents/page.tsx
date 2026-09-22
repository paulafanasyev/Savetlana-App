import { requireSellerServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requirementsForSeller } from "@/lib/domains/documents";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  UPLOADED: "bg-slate-100 text-slate-700",
  PROCESSING: "bg-sky-50 text-sky-700",
  VERIFIED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-700",
  EXPIRED: "bg-slate-100 text-slate-500",
  PENDING_REVIEW: "bg-amber-50 text-amber-700",
};
const STATUS_LABEL: Record<string, string> = {
  UPLOADED: "Загружен",
  PROCESSING: "Обрабатывается",
  VERIFIED: "Проверен",
  REJECTED: "Отклонён",
  EXPIRED: "Истёк",
  PENDING_REVIEW: "На ручной проверке",
};
const KIND_LABEL: Record<string, string> = {
  company_doc: "Документы компании",
  certificate: "Сертификат",
  declaration: "Декларация",
  license: "Лицензия",
  product_doc: "Документ на товар",
};

export default async function SellerDocumentsPage() {
  const { sellerId } = await requireSellerServer();
  const [documents, requirements] = await Promise.all([
    prisma.sellerDocument.findMany({
      where: { sellerId },
      orderBy: { createdAt: "desc" },
    }),
    requirementsForSeller(sellerId),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Документы и сертификаты</h1>

      <section className="card p-5">
        <h2 className="mb-3 text-lg font-semibold text-ink">Требуется для ваших категорий</h2>
        {requirements.missing.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-amber-700">
              Не хватает: {requirements.missing.map((k) => KIND_LABEL[k] ?? k).join(", ")}
            </p>
            <p className="text-xs text-ink-faint">
              Отсутствие документа не блокирует публикацию, но снижает доверие покупателей.
              Проверка юридической действительности выполняется человеком, не по OCR.
            </p>
          </div>
        ) : (
          <p className="text-sm text-green-700">Все обязательные документы загружены.</p>
        )}
        {requirements.optional.length > 0 && (
          <p className="mt-2 text-xs text-ink-faint">
            Дополнительно: {requirements.optional.map((k) => KIND_LABEL[k] ?? k).join(", ")}
          </p>
        )}
      </section>

      <section className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-surface-line bg-surface-muted text-left text-xs uppercase text-ink-faint">
            <tr>
              <th className="px-4 py-3">Документ</th>
              <th className="px-4 py-3">Тип</th>
              <th className="px-4 py-3">Статус</th>
              <th className="px-4 py-3">Загружен</th>
              <th className="px-4 py-3">Действителен до</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-line">
            {documents.map((doc) => (
              <tr key={doc.id} className="align-middle">
                <td className="px-4 py-3">
                  <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="font-medium text-ink hover:text-svetlana-700">
                    {doc.title}
                  </a>
                </td>
                <td className="px-4 py-3 text-ink-soft">{KIND_LABEL[doc.kind] ?? doc.kind}</td>
                <td className="px-4 py-3">
                  <span className={`chip ${STATUS_STYLES[doc.status] ?? ""}`}>
                    {STATUS_LABEL[doc.status] ?? doc.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-ink-faint">
                  {new Date(doc.createdAt).toLocaleDateString("ru-RU")}
                </td>
                <td className="px-4 py-3 text-xs text-ink-faint">
                  {doc.expiresAt ? new Date(doc.expiresAt).toLocaleDateString("ru-RU") : "—"}
                </td>
              </tr>
            ))}
            {documents.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-soft">
                  Документы ещё не загружены.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
