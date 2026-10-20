import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { env, integrationStatus } from "@/lib/env";
import { ACCEPT_DAYS } from "@/lib/safe-deal";
import { countText } from "@/lib/format";

export const dynamic = "force-dynamic";

const DAY_FORMS = ["день", "дня", "дней"] as const;

/** Комиссия по-русски: 1,5 а не 1.5. */
function feeText(): string {
  return String(env.platformFeePercent).replace(".", ",");
}

export function generateMetadata(): Metadata {
  return {
    title: "Продавать на АИКО",
    description: `Откройте магазин на АИКО: комиссия ${feeText()}% с продажи, самозанятых одобряем по данным ФНС, карточки товаров помогает составить ИИ-помощник Светлана.`,
    alternates: { canonical: "/sell" },
  };
}

const START = "/register?role=seller";

/**
 * Страница для продавцов из поиска и рекламы. Только то, что уже работает в коде:
 * комиссия берётся из настройки площадки (как в оферте), срок автоприёмки из правил
 * безопасной сделки. Пока банк для приёма оплаты не подключён, честно пишем об этом.
 */
export default function SellPage() {
  const fee = feeText();
  const paymentsReady = integrationStatus.payment === "READY";
  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-10">
      <section className="card p-8 text-center sm:p-12">
        <h1 className="text-3xl font-bold text-ink sm:text-4xl">Продавайте на АИКО</h1>
        <p className="mx-auto mt-3 max-w-2xl text-lg text-ink-soft">
          Комиссия {fee}% с продажи. Самозанятых одобряем автоматически, как только ФНС подтвердит статус.
          Карточки товаров помогает составить ИИ-помощник Светлана.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href={START} className="btn btn-primary px-6 py-3 text-base" data-testid="sell-start">Открыть магазин</Link>
          <Link href="/login?next=%2Fseller" className="btn btn-ghost px-6 py-3 text-base">У меня уже есть аккаунт</Link>
        </div>
        {!paymentsReady && (
          <p className="mx-auto mt-5 max-w-2xl rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900" role="note">
            Приём оплаты картой сейчас подключается. Уже можно открыть магазин, пройти проверку и подготовить товары:
            к запуску оплаты ваш каталог будет готов.
          </p>
        )}
      </section>

      <section aria-labelledby="why" className="space-y-4">
        <h2 id="why" className="text-2xl font-bold text-ink">Почему АИКО</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card title={`Комиссия ${fee}%`}>
            Только с продажи, сумма видна в каждом расчёте в кабинете. Условия в <Link href="/legal/offer" className="underline">оферте</Link>.
          </Card>
          <Card title="Старт за минуты">
            Самозанятый указывает ИНН, мы проверяем статус в ФНС, и магазин одобряется сам. ИП и организации проверяет
            администратор, о решении придёт уведомление.
          </Card>
          <Card title="Карточки со Светланой">
            Светлана помогает составить название, описание и характеристики. Вы проверяете и публикуете: без вашего
            подтверждения ничего не выходит.
          </Card>
          <Card title="Перенос каталога">
            Загрузите файл из Яндекс Маркета, Ozon, Wildberries, 1С или фид YML: товары появятся черновиками,
            останется проверить и опубликовать их одной кнопкой.
          </Card>
          <Card title="Безопасная сделка">
            Деньги покупателя лежат на счёте площадки, пока он не примет заказ. Если покупатель молчит, заказ
            примется сам через {countText(ACCEPT_DAYS, DAY_FORMS)} после доставки, и деньги станут доступны к выплате.
          </Card>
          <Card title="Заказы в Telegram">
            Новые заказы, сообщения покупателей и напоминания об остатках приходят в Telegram, если подключить его
            в кабинете.
          </Card>
        </div>
      </section>

      <section aria-labelledby="steps" className="card space-y-4 p-6">
        <h2 id="steps" className="text-2xl font-bold text-ink">Как начать</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          <Step n={1} title="Регистрация">Имя, почта и пароль.</Step>
          <Step n={2} title="Реквизиты">Тип (самозанятый, ИП или организация), название магазина и ИНН.</Step>
          <Step n={3} title="Первый товар">Сами, со Светланой или файлом с другой площадки.</Step>
        </ol>
        <div className="pt-2">
          <Link href={START} className="btn btn-primary">Открыть магазин</Link>
        </div>
      </section>

      <section aria-labelledby="faq" className="space-y-3">
        <h2 id="faq" className="text-2xl font-bold text-ink">Частые вопросы</h2>
        <Faq q="Когда приходят деньги?">
          После того, как покупатель примет заказ (или через {countText(ACCEPT_DAYS, DAY_FORMS)} после доставки, если он не открыл спор),
          сумма за вычетом комиссии становится доступна к выплате в разделе «Выплаты».
          Самозанятым, одобренным автоматически, перед первой выплатой администратор проверяет личность.
        </Faq>
        <Faq q="Нужно ли быть ИП?">
          Нет, можно продавать самозанятым. Статус проверяем в официальном сервисе ФНС по ИНН. Если вы только что
          зарегистрировались в «Мой налог», статус может появиться в течение дня.
        </Faq>
        <Faq q="Что видит покупатель о моём магазине?">
          Отметки только по фактам («Самозанятый, подтверждено ФНС», «ИП подтверждён», «Личность подтверждена») и рейтинг
          по настоящим заказам и отзывам.
        </Faq>
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card p-5">
      <h3 className="font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-sm text-ink-soft">{children}</p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="rounded-xl bg-surface-muted p-4">
      <div className="text-sm font-semibold text-svetlana-700">Шаг {n}</div>
      <div className="mt-1 font-semibold text-ink">{title}</div>
      <p className="mt-1 text-sm text-ink-soft">{children}</p>
    </li>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="card p-4">
      <summary className="cursor-pointer font-medium text-ink">{q}</summary>
      <p className="mt-2 text-sm text-ink-soft">{children}</p>
    </details>
  );
}
