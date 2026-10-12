import { LegalEntityCard } from "@/components/LegalEntityCard";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export const metadata = { title: "Правила площадки и оферта" };

export default function OfferPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-ink">Правила площадки и публичная оферта</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Черновик для согласования с юристом и банком-эквайером. Оформляя заказ,
          покупатель принимает эти условия.
        </p>
      </div>

      <section className="card space-y-3 p-5 text-sm text-ink-soft">
        <h2 className="text-base font-bold text-ink">1. Кто есть кто</h2>
        <p>
          АИКО: площадка (агрегатор), на которой независимые продавцы размещают товары.
          Договор купли-продажи заключается между покупателем и продавцом. Площадка
          предоставляет каталог, помощника Светлану, приём оплаты через банк-партнёр и
          разбор споров.
        </p>
        <p>
          По запросу покупателя площадка сообщает сведения о продавце: наименование, ИНН,
          ОГРН (ОГРНИП) и адрес.
        </p>
      </section>

      <section className="card space-y-3 p-5 text-sm text-ink-soft">
        <h2 className="text-base font-bold text-ink">2. Заказ и оплата</h2>
        <p>Цена товара указана на его странице в рублях и фиксируется в момент оформления заказа.</p>
        <p>
          Заказ, не оплаченный в течение 24 часов, отменяется автоматически. Если оплата
          прошла дважды или после отмены заказа, лишняя сумма возвращается автоматически.
        </p>
        <p>Комиссия площадки с продавца не скрыта и сейчас составляет {env.platformFeePercent}%.</p>
      </section>

      <section className="card space-y-3 p-5 text-sm text-ink-soft">
        <h2 className="text-base font-bold text-ink">3. Доставка, возврат, споры</h2>
        <p>
          Условия доставки и возврата описаны на страницах{" "}
          <a className="text-svetlana-700 hover:underline" href="/legal/payment-delivery">«Оплата и доставка»</a> и{" "}
          <a className="text-svetlana-700 hover:underline" href="/legal/returns">«Возврат и обмен»</a>.
        </p>
        <p>
          Если с продавцом не удалось договориться, покупатель открывает спор в разделе
          заказа. Площадка рассматривает его и принимает решение, в том числе о возврате денег.
        </p>
      </section>

      <section className="card space-y-3 p-5 text-sm text-ink-soft">
        <h2 className="text-base font-bold text-ink">4. Персональные данные</h2>
        <p>
          Данные обрабатываются по 152-ФЗ только для исполнения заказа. Подробности и
          управление памятью Светланы на странице{" "}
          <a className="text-svetlana-700 hover:underline" href="/privacy">«Конфиденциальность»</a>.
        </p>
      </section>

      <LegalEntityCard />
    </div>
  );
}
