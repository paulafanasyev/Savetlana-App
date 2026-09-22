import Link from "next/link";
import { requireUserServer } from "@/lib/auth";
import { getGiftContext, upcomingGiftEvents } from "@/lib/domains/gifts";
import { rub, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Подарки" };

export default async function GiftsPage() {
  const session = await requireUserServer();
  const [ctx, upcoming] = await Promise.all([
    getGiftContext(session.user.id),
    upcomingGiftEvents(session.user.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Подарки</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Светлана напоминает о важных датах и помогает выбрать подарок. Режим
            «скрытность» включён по умолчанию — получатель ничего не увидит.
          </p>
        </div>
        <Link href="/svetlana" className="btn btn-ghost text-sm">
          Спросить Светлану
        </Link>
      </div>

      <section className="mt-8">
        <h2 className="text-base font-bold text-ink">Ближайшие события</h2>
        {upcoming.length === 0 ? (
          <p className="mt-3 card p-5 text-sm text-ink-soft">
            На ближайшие 14 дней событий нет. Создайте событие, и Светлана
            напомнит о нём и предложит идеи подарка.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {upcoming.map((ev) => (
              <li key={ev.id} className="card flex items-center justify-between gap-3 p-4">
                <div>
                  <div className="font-medium text-ink">
                    {ev.recipientName} · {ev.occasion}
                  </div>
                  <div className="text-sm text-ink-soft">
                    {new Date(ev.eventDate).toLocaleDateString("ru-RU")} ·
                    бюджет {ev.budgetKopecks ? rub(ev.budgetKopecks / 100) : "не указан"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/api/gifts/events/${ev.id}/suggest`}
                    className="btn btn-ghost text-xs"
                  >
                    Идеи подарка
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 card p-5">
        <h2 className="text-base font-bold text-ink">Создать событие</h2>
        <form action="/api/gifts/events" method="POST" className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="block text-ink-soft">Кому</span>
            <input name="recipientName" required className="input mt-1" placeholder="Имя получателя" />
          </label>
          <label className="text-sm">
            <span className="block text-ink-soft">Повод</span>
            <select name="occasion" className="input mt-1">
              <option value="birthday">День рождения</option>
              <option value="anniversary">Годовщина</option>
              <option value="holiday">Праздник</option>
              <option value="custom">Другое</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-ink-soft">Дата</span>
            <input name="eventDate" type="date" required className="input mt-1" />
          </label>
          <label className="text-sm">
            <span className="block text-ink-soft">Бюджет, ₽</span>
            <input name="budgetRubles" type="number" min="0" className="input mt-1" />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="block text-ink-soft">Интересы (через запятую)</span>
            <input name="interests" className="input mt-1" placeholder="путешествия, книги, техника" />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="btn btn-primary">Сохранить событие</button>
          </div>
        </form>
      </section>

      <section className="mt-8 card p-5">
        <h2 className="text-base font-bold text-ink">Мой круг</h2>
        <p className="mt-1 text-xs text-ink-soft">{ctx.note}</p>
        {ctx.verifiedCircle.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">
            Подтверждённых связей пока нет. Добавьте людей на странице{" "}
            <Link href="/profile/relationships" className="underline">связей</Link>.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-surface-line text-sm">
            {ctx.verifiedCircle.map((c) => (
              <li key={`${c.otherUserId}-${c.type}`} className="flex justify-between py-2">
                <span className="text-ink">{c.otherUserName ?? "Пользователь"}</span>
                <span className="text-ink-soft">{c.type}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
