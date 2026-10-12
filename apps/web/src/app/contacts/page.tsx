import { LegalEntityCard } from "@/components/LegalEntityCard";

export const dynamic = "force-dynamic";

export const metadata = { title: "Контакты и реквизиты" };

export default function ContactsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-ink">Контакты и реквизиты</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Вопросы по заказу проще всего задать Светлане: она видит статус заказа и
          подскажет, что делать. Если нужен человек, напишите на почту поддержки.
        </p>
      </div>
      <LegalEntityCard />
      <section className="card p-5 text-sm text-ink-soft">
        <h2 className="text-base font-bold text-ink">Документы</h2>
        <ul className="mt-3 space-y-2">
          <li><a className="text-svetlana-700 hover:underline" href="/legal/offer">Правила площадки и публичная оферта</a></li>
          <li><a className="text-svetlana-700 hover:underline" href="/legal/payment-delivery">Оплата и доставка</a></li>
          <li><a className="text-svetlana-700 hover:underline" href="/legal/returns">Возврат и обмен</a></li>
          <li><a className="text-svetlana-700 hover:underline" href="/privacy">Конфиденциальность</a></li>
        </ul>
      </section>
    </div>
  );
}
