export const dynamic = "force-dynamic";

export const metadata = { title: "Оплата и доставка" };

export default function PaymentDeliveryPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold text-ink">Оплата и доставка</h1>

      <section className="card space-y-3 p-5 text-sm text-ink-soft">
        <h2 className="text-base font-bold text-ink">Способы оплаты</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Банковская карта: Мир, Visa, Mastercard.</li>
          <li>СБП: оплата по QR-коду или в приложении вашего банка, в том числе по номеру телефона через СБП.</li>
        </ul>
        <p>
          Оплата проходит на защищённой странице банка-партнёра. Данные карты вводятся
          только там и не попадают ни на площадку, ни к продавцу, ни к Светлане.
        </p>
        <p>
          Площадка не принимает переводы на личные карты. Если кто-то просит оплатить
          заказ переводом на карту, это мошенничество: сообщите в поддержку.
        </p>
      </section>

      <section className="card space-y-3 p-5 text-sm text-ink-soft">
        <h2 className="text-base font-bold text-ink">Доставка</h2>
        <p>
          Способ, срок и стоимость доставки зависят от продавца и вашего города. Точные
          условия показываются при оформлении заказа, до оплаты.
        </p>
        <p>После передачи заказа в службу доставки номер отслеживания появляется в разделе «Заказы».</p>
      </section>

      <section className="card space-y-3 p-5 text-sm text-ink-soft">
        <h2 className="text-base font-bold text-ink">Если что-то пошло не так</h2>
        <p>
          Если деньги списались, а заказ не отметился оплаченным, ничего делать не нужно:
          площадка сама сверяет платежи с банком. Двойная оплата или оплата отменённого
          заказа возвращается автоматически.
        </p>
      </section>
    </div>
  );
}
