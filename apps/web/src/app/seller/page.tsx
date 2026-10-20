import Link from "next/link";
import { requireSellerServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sellerReport } from "@/lib/domains/seller-analytics";
import { getSellerVerificationStatus } from "@/lib/domains/seller-verification";
import { telegramStatus } from "@/lib/domains/telegram-link";
import { sellerTodoItems } from "@/lib/domains/seller-badges";
import { getShipCity } from "@/lib/domains/seller-ship-from";
import { allCities } from "@/lib/geo-data";
import { ruText } from "@/lib/ai/ru-text";
import { firstSteps } from "@/lib/seller-first-steps";
import { SvetlanaChat } from "@/components/SvetlanaChat";
import { TelegramConnect } from "@/components/TelegramConnect";
import { SellerTodo } from "@/components/SellerTodo";
import { ShareStore } from "@/components/ShareStore";

export const dynamic = "force-dynamic";

const SHIP_NOTICE: Record<string, { tone: string; text: string }> = {
  saved: { tone: "bg-emerald-50 text-emerald-800", text: "Город отгрузки сохранён. Покупатели из этого города увидят ваши товары в фильтре «Из моего города»." },
  cleared: { tone: "bg-zinc-100 text-zinc-700", text: "Город отгрузки убран." },
  bad: { tone: "bg-red-50 text-red-800", text: "Такого города нет в справочнике. Выберите город из подсказок." },
  noseller: { tone: "bg-red-50 text-red-800", text: "Сначала оформите профиль продавца." },
};

export default async function SellerDashboard({ searchParams }: { searchParams?: Promise<{ ship?: string }> }) {
  const sp = (await searchParams) ?? {};
  const { sellerId, user } = await requireSellerServer();
  const [report, verification, telegram, todo, shipCity, activeProducts, draftProducts] = await Promise.all([
    sellerReport(sellerId),
    getSellerVerificationStatus(sellerId),
    telegramStatus(user.id),
    sellerTodoItems(sellerId, user.id),
    getShipCity(user.id).catch(() => null),
    prisma.product.count({ where: { sellerId, status: "ACTIVE" } }).catch(() => 0),
    prisma.product.count({ where: { sellerId, status: "DRAFT" } }).catch(() => 0),
  ]);
  const active = verification.status === "APPROVED";
  const shipNotice = sp.ship ? SHIP_NOTICE[sp.ship] : undefined;
  const steps = firstSteps({
    verification: verification.status,
    activeProducts,
    draftProducts,
    shipCity: shipCity ?? null,
    telegramLinked: telegram.linked,
    telegramConfigured: telegram.configured,
  });
  const doneCount = steps?.filter((s) => s.done).length ?? 0;
  return <main className="space-y-6 px-6 py-8"><div><h1 className="text-2xl font-semibold">Кабинет продавца</h1><p className="text-ink-soft">{user.name ?? "Продавец"} · управление магазином</p></div>
    {steps && (
      <section className="rounded-xl border-2 border-svetlana-200 bg-svetlana-50 p-5" aria-labelledby="first-steps" data-testid="seller-first-steps">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="first-steps" className="font-semibold text-ink">Первые шаги до первой продажи</h2>
          <span className="text-sm text-ink-soft">готово {doneCount} из {steps.length}</span>
        </div>
        <ol className="mt-3 space-y-2">
          {steps.map((step, index) => (
            <li key={step.key} className="flex gap-3 rounded-lg bg-white p-3">
              <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${step.done ? "bg-emerald-600 text-white" : "border border-svetlana-300 text-svetlana-700"}`}>{step.done ? "✓" : index + 1}</span>
              <div className="min-w-0">
                <Link href={step.href} className={`font-medium ${step.done ? "text-ink-soft" : "text-svetlana-700 hover:underline"}`}>{step.title}</Link>
                <span className="sr-only">{step.done ? ": сделано" : ": не сделано"}</span>
                <p className="text-sm text-ink-soft">{step.hint}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    )}
    {!active && !steps && <Link href="/seller/onboarding" className="block rounded-xl border-2 border-amber-300 bg-amber-50 p-5 text-amber-950"><strong>Завершите оформление продавца</strong><span className="mt-1 block">{verification.status === "REJECTED" ? "Заявка отклонена, исправьте данные и отправьте её снова." : verification.status === "PENDING" ? "Заявка на проверке." : "Заполните реквизиты, чтобы публиковать товары."}</span></Link>}
    <SellerTodo initial={todo} />
    {active && <ShareStore sellerId={sellerId} name={verification.seller.displayName} hasProducts={activeProducts > 0} />}
    <nav className="flex flex-wrap gap-3">{[["/seller/products", "Товары"], ["/seller/orders", "Заказы"], ["/seller/customers", "Покупатели"], ["/seller/messages", "Сообщения"], ["/seller/promotions", "Акции"], ["/seller/analytics", "Аналитика"], ["/seller/payouts", "Выплаты"], ["/seller/disputes", "Споры"], ["/seller/documents", "Документы"]].map(([href, label]) => <Link className="rounded border px-4 py-2" href={href} key={href}>{label}</Link>)}</nav>
    <section className="rounded-xl border p-5" aria-labelledby="ship-city">
      <h2 id="ship-city" className="font-semibold">Город отгрузки</h2>
      <p className="mt-1 text-sm text-ink-soft">Откуда вы отправляете товары. Покупатели увидят «Отправка из г. …» на карточке и найдут вас фильтром «Из моего города».</p>
      {shipNotice && <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${shipNotice.tone}`} role={sp.ship === "bad" || sp.ship === "noseller" ? "alert" : "status"}>{shipNotice.text}</p>}
      <form action="/api/seller/ship-city" method="POST" className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block text-sm"><span className="mb-1 block font-medium">Город</span><input name="city" list="ship-city-options" defaultValue={shipCity ?? ""} placeholder="Например: Казань" maxLength={80} className="input w-64" /></label>
        <datalist id="ship-city-options">{allCities().map((c) => <option key={`${c.name}-${c.regionName}`} value={c.name}>{c.regionName}</option>)}</datalist>
        <button type="submit" className="btn btn-primary">Сохранить</button>
      </form>
      {shipCity ? <p className="mt-2 text-xs text-ink-soft">Сейчас: {shipCity}. Чтобы убрать город, очистите поле и нажмите «Сохранить».</p> : <p className="mt-2 text-xs text-amber-800">Город не указан: в фильтре «Из моего города» ваших товаров не будет.</p>}
    </section>
    {(telegram.configured || telegram.linked) && <div id="telegram"><TelegramConnect configured={telegram.configured} linked={telegram.linked} /></div>}
    {report.lowStock?.length > 0 && <section className="rounded-xl border border-amber-300 bg-amber-50 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Заканчивается наличие</h2><Link href="/seller/products/bulk" className="btn btn-ghost">Пополнить остатки</Link></div><ul className="mt-2 space-y-1">{report.lowStock.map((item) => <li key={item.productId}>{item.title}, {item.quantity === 0 ? "закончился" : `осталось ${item.quantity} шт.`}</li>)}</ul></section>}
    {report.salesDropCauses?.length > 0 && <section className="rounded-xl border p-5"><h2 className="font-semibold">Диагностика продаж</h2><ul className="mt-2 list-disc pl-5">{report.salesDropCauses.map((cause, index) => <li key={index}>{ruText(cause)}</li>)}</ul></section>}
    {report.recommendations?.length > 0 && <section className="rounded-xl border p-5"><h2 className="font-semibold">Рекомендации Светланы</h2><ul className="mt-2 space-y-2">{report.recommendations.map((item, index) => <li key={index}>{ruText(item.text)}<span className="block text-sm text-ink-soft">Основание: {ruText(item.evidence)}</span></li>)}</ul></section>}
    <SvetlanaChat side="seller" />
  </main>;
}
