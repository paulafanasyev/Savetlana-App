import Link from "next/link";
import { requireSellerServer } from "@/lib/auth";
import { sellerReport } from "@/lib/domains/seller-analytics";
import { getSellerVerificationStatus } from "@/lib/domains/seller-verification";
import { telegramStatus } from "@/lib/domains/telegram-link";
import { sellerBadges } from "@/lib/domains/seller-badges";
import { sellerTodo } from "@/lib/seller-todo";
import { ruText } from "@/lib/ai/ru-text";
import { SvetlanaChat } from "@/components/SvetlanaChat";
import { TelegramConnect } from "@/components/TelegramConnect";

export const dynamic = "force-dynamic";

export default async function SellerDashboard() {
  const { sellerId, user } = await requireSellerServer();
  const [report, verification, telegram, badges] = await Promise.all([sellerReport(sellerId), getSellerVerificationStatus(sellerId), telegramStatus(user.id), sellerBadges(sellerId, user.id)]);
  const active = verification.status === "APPROVED";
  const todo = sellerTodo(badges);
  return <main className="space-y-6 px-6 py-8"><div><h1 className="text-2xl font-semibold">Кабинет продавца</h1><p className="text-ink-soft">{user.name ?? "Продавец"} · управление магазином</p></div>
    {!active && <Link href="/seller/onboarding" className="block rounded-xl border-2 border-amber-300 bg-amber-50 p-5 text-amber-950"><strong>Завершите оформление продавца</strong><span className="mt-1 block">{verification.status === "REJECTED" ? "Заявка отклонена, исправьте данные и отправьте её снова." : verification.status === "PENDING" ? "Заявка на проверке." : "Заполните реквизиты, чтобы публиковать товары."}</span></Link>}
    <section className={`rounded-xl border p-5 ${todo.length > 0 ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}`}><h2 className="font-semibold">Что сделать сегодня</h2>{todo.length > 0 ? <ul className="mt-2 space-y-1">{todo.map((item) => <li key={item.kind}><Link href={item.href} className="font-medium text-ink underline underline-offset-2 hover:text-svetlana-700">{item.text}</Link></li>)}</ul> : <p className="mt-1 text-sm text-ink-soft">Срочных дел нет. Новые заказы, сообщения покупателей и споры появятся здесь.</p>}</section>
    <nav className="flex flex-wrap gap-3">{[["/seller/products", "Товары"], ["/seller/orders", "Заказы"], ["/seller/customers", "Покупатели"], ["/seller/messages", "Сообщения"], ["/seller/promotions", "Акции"], ["/seller/analytics", "Аналитика"], ["/seller/payouts", "Выплаты"], ["/seller/disputes", "Споры"], ["/seller/documents", "Документы"]].map(([href, label]) => <Link className="rounded border px-4 py-2" href={href} key={href}>{label}</Link>)}</nav>
    {(telegram.configured || telegram.linked) && <TelegramConnect configured={telegram.configured} linked={telegram.linked} />}
    {report.lowStock?.length > 0 && <section className="rounded-xl border border-amber-300 bg-amber-50 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Заканчивается наличие</h2><Link href="/seller/products/bulk" className="btn btn-ghost">Пополнить остатки</Link></div><ul className="mt-2 space-y-1">{report.lowStock.map((item) => <li key={item.productId}>{item.title}, {item.quantity === 0 ? "закончился" : `осталось ${item.quantity} шт.`}</li>)}</ul></section>}
    {report.salesDropCauses?.length > 0 && <section className="rounded-xl border p-5"><h2 className="font-semibold">Диагностика продаж</h2><ul className="mt-2 list-disc pl-5">{report.salesDropCauses.map((cause, index) => <li key={index}>{ruText(cause)}</li>)}</ul></section>}
    {report.recommendations?.length > 0 && <section className="rounded-xl border p-5"><h2 className="font-semibold">Рекомендации Светланы</h2><ul className="mt-2 space-y-2">{report.recommendations.map((item, index) => <li key={index}>{ruText(item.text)}<span className="block text-sm text-ink-soft">Основание: {ruText(item.evidence)}</span></li>)}</ul></section>}
    <SvetlanaChat side="seller" />
  </main>;
}
