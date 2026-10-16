import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildQuoteDocument, rubFormat, type QuoteDocKind, type QuoteDocument } from "@/lib/domains/quote-documents";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const KINDS: QuoteDocKind[] = ["contract", "invoice", "upd"];
const dateRu = (d: Date) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const blank = "________________";

function Party({ title, lines }: { title: string; lines: (string | null)[] }) {
  return (
    <div className="space-y-0.5">
      <div className="font-semibold">{title}</div>
      {lines.filter(Boolean).map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

function sellerLines(d: QuoteDocument) {
  return [`${d.seller.name} (${d.seller.kind})`, `ИНН ${d.seller.inn ?? blank}`, d.seller.ogrn ? `ОГРН/ОГРНИП ${d.seller.ogrn}` : null];
}

function buyerLines(d: QuoteDocument) {
  return [`${d.buyer.name}${d.buyer.email ? `, ${d.buyer.email}` : ""}`, `Организация, ИНН/КПП: ${blank}`, `Адрес: ${blank}`];
}

function ItemsTable({ d }: { d: QuoteDocument }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          {["№", "Товар", "Ед.", "Кол-во", "Цена", "Сумма"].map((h) => (
            <th key={h} className="border border-black px-2 py-1 text-left">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {d.lines.map((l, i) => (
          <tr key={i}>
            <td className="border border-black px-2 py-1">{i + 1}</td>
            <td className="border border-black px-2 py-1">{l.title}</td>
            <td className="border border-black px-2 py-1">{l.unit}</td>
            <td className="border border-black px-2 py-1">{l.quantity}</td>
            <td className="border border-black px-2 py-1">{rubFormat(l.priceKopecks)}</td>
            <td className="border border-black px-2 py-1">{rubFormat(l.sumKopecks)}</td>
          </tr>
        ))}
        <tr>
          <td className="border border-black px-2 py-1 text-right font-semibold" colSpan={5}>
            Итого
          </td>
          <td className="border border-black px-2 py-1 font-semibold">{rubFormat(d.totalKopecks)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function Signatures({ left, right }: { left: string; right: string }) {
  return (
    <div className="grid grid-cols-2 gap-8 pt-6 text-sm">
      <div>
        {left}: {blank} / {blank}
      </div>
      <div>
        {right}: {blank} / {blank}
      </div>
    </div>
  );
}

function Contract({ d }: { d: QuoteDocument }) {
  const q = d.quote;
  return (
    <>
      <p>
        {d.seller.name} (далее «Поставщик») и {d.buyer.name} (далее «Покупатель») заключили договор на условиях коммерческого предложения {q.number}, согласованного агентами сторон на площадке АИКО и подтверждённого Поставщиком.
      </p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Поставщик передаёт, Покупатель принимает и оплачивает товар: «{q.title}», {q.quantity} шт. по {rubFormat(q.unitPriceKopecks)} за штуку.</li>
        <li>
          Общая сумма договора: {rubFormat(d.totalKopecks)} ({d.totalInWords}). {d.vatNote}
        </li>
        <li>Условия поставки и оплаты: {d.termsNote}.</li>
        <li>Оплата производится через площадку АИКО по безопасной сделке: деньги перечисляются Поставщику после подтверждения Покупателем получения товара.</li>
        <li>Споры по качеству и количеству решаются в центре споров площадки, затем в порядке, установленном законодательством РФ.</li>
        <li>Цена действует только по этому договору и не меняет цену в каталоге Поставщика.</li>
      </ol>
      <div className="grid grid-cols-2 gap-6 text-sm">
        <Party title="Поставщик" lines={sellerLines(d)} />
        <Party title="Покупатель" lines={buyerLines(d)} />
      </div>
      <Signatures left="Поставщик" right="Покупатель" />
    </>
  );
}

function Invoice({ d }: { d: QuoteDocument }) {
  const op = d.operator;
  return (
    <>
      <div className="rounded border border-black p-3 text-sm">
        <div className="font-semibold">Получатель платежа (оператор площадки, агент Поставщика)</div>
        <div>{op.name ?? "наименование оператора не указано"}</div>
        <div>
          ИНН {op.inn ?? "не указан"}, ОГРН {op.ogrn ?? "не указан"}
        </div>
        <div>Оплата: на странице заказа {d.orderNumber ?? ""} на площадке АИКО (безопасная сделка). Переводить деньги напрямую на счёт продавца не нужно.</div>
      </div>
      <div className="grid grid-cols-2 gap-6 text-sm">
        <Party title="Поставщик" lines={sellerLines(d)} />
        <Party title="Плательщик" lines={buyerLines(d)} />
      </div>
      <ItemsTable d={d} />
      <p className="text-sm">
        Всего к оплате: <strong>{rubFormat(d.totalKopecks)}</strong> ({d.totalInWords}). {d.vatNote}
      </p>
      <p className="text-sm">Основание: договор поставки по {d.quote.number}, заказ {d.orderNumber ?? "не оформлен"}.</p>
    </>
  );
}

function Upd({ d }: { d: QuoteDocument }) {
  return (
    <>
      <p className="text-sm">Статус 2: передаточный документ (акт). Счёт-фактура в составе этого УПД не формируется, пока продавец не указал ставку НДС.</p>
      <div className="grid grid-cols-2 gap-6 text-sm">
        <Party title="Продавец" lines={sellerLines(d)} />
        <Party title="Покупатель" lines={buyerLines(d)} />
      </div>
      <ItemsTable d={d} />
      <p className="text-sm">
        Всего: {rubFormat(d.totalKopecks)} ({d.totalInWords}). Основание передачи: договор поставки по {d.quote.number}, заказ {d.orderNumber ?? "не оформлен"}.
      </p>
      <p className="text-sm">Дата отгрузки: {blank}. Товар передал: {blank}. Товар получил: {blank}.</p>
      <Signatures left="Передал (продавец)" right="Получил (покупатель)" />
    </>
  );
}

export default async function QuoteDocumentPage({ params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  if (!KINDS.includes(kind as QuoteDocKind)) notFound();
  const { user } = await requireUserServer();
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
  const res = await buildQuoteDocument(id, kind as QuoteDocKind, { userId: user.id, sellerId: seller?.id ?? null });
  if (!res.ok) {
    return (
      <main className="mx-auto max-w-2xl space-y-3 px-4 py-10">
        <h1 className="text-xl font-semibold">Документ недоступен</h1>
        <p className="text-ink-soft">{res.reason}.</p>
        <Link className="text-blue-900 underline" href="/quotes">
          К моим КП
        </Link>
      </main>
    );
  }
  const d = res.doc;
  return (
    <main className="mx-auto max-w-3xl space-y-4 bg-white px-6 py-8 text-black">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <nav className="flex gap-3 text-sm">
          {KINDS.map((k) => (
            <Link key={k} href={`/quotes/${id}/documents/${k}`} className={k === kind ? "font-semibold underline" : "underline"}>
              {k === "contract" ? "Договор" : k === "invoice" ? "Счёт" : "УПД"}
            </Link>
          ))}
        </nav>
        <PrintButton />
      </div>
      <h1 className="text-xl font-bold">
        {d.draft ? "Проект: " : ""}
        {d.title} № {d.number} от {dateRu(d.date)}
      </h1>
      {d.kind === "contract" && <Contract d={d} />}
      {d.kind === "invoice" && <Invoice d={d} />}
      {d.kind === "upd" && <Upd d={d} />}
      <p className="border-t pt-3 text-xs text-gray-600">
        Сформировано автоматически площадкой АИКО по {d.quote.number}. Отпечаток условий КП: {d.fingerprint}. Если условия КП изменить в базе, отпечаток не совпадёт и документ не сформируется. Документ не подписан: это проект для подписи сторонами на бумаге или через ЭДО.
      </p>
    </main>
  );
}
