import { REFUND_DAYS, RETURN_DAYS_GOOD_QUALITY, RETURN_MONTHS_NO_NOTICE } from "@/lib/legal";

export const dynamic = "force-dynamic";

export const metadata = { title: "Возврат и обмен" };

export default function ReturnsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold text-ink">Возврат и обмен</h1>

      <section className="card space-y-3 p-5 text-sm text-ink-soft">
        <h2 className="text-base font-bold text-ink">Товар надлежащего качества</h2>
        <p>
          Отказаться от товара можно в любое время до получения и в течение{" "}
          {RETURN_DAYS_GOOD_QUALITY} дней после получения (ст. 26.1 Закона о защите прав
          потребителей). Если правила возврата не были выданы вам письменно при доставке,
          срок продлевается до {RETURN_MONTHS_NO_NOTICE} месяцев.
        </p>
        <p>
          Нужно сохранить товарный вид и потребительские свойства товара. Стоимость обратной
          доставки может быть удержана, стоимость доставки к вам возвращается не всегда.
        </p>
        <p>
          Нельзя вернуть товар надлежащего качества с индивидуальными свойствами, сделанный
          по вашему заказу, а также товары из перечня, утверждённого Правительством РФ.
        </p>
      </section>

      <section className="card space-y-3 p-5 text-sm text-ink-soft">
        <h2 className="text-base font-bold text-ink">Товар с недостатком</h2>
        <p>
          Если товар оказался с браком или не соответствует описанию, вы вправе потребовать
          замену, ремонт, уменьшение цены или возврат денег (ст. 18 Закона о защите прав
          потребителей).
        </p>
      </section>

      <section className="card space-y-3 p-5 text-sm text-ink-soft">
        <h2 className="text-base font-bold text-ink">Как вернуть</h2>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>Откройте заказ в разделе «Заказы» и оформите возврат или попросите об этом Светлану.</li>
          <li>Укажите причину и приложите фото, если товар с недостатком.</li>
          <li>Если продавец не отвечает или отказывает, откройте спор: площадка рассмотрит его.</li>
        </ol>
        <p>
          Деньги возвращаются тем же способом, каким была оплата, не позднее {REFUND_DAYS}{" "}
          дней со дня требования.
        </p>
      </section>
    </div>
  );
}
