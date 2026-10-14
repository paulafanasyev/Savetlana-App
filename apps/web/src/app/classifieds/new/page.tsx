import { getGeoTree } from "@/lib/domains/classifieds";
import { requireUserServer } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function NewClassifiedPage({ searchParams }: PageProps) {
  const ctx = await requireUserServer();
  if (!ctx) redirect("/login");

  const params = (await searchParams) ?? {};
  const error = first(params.error)?.slice(0, 400);
  const sent = first(params.sent) === "moderation";

  const tree = await getGeoTree();

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold">Разместить объявление</h1>

      {sent && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
          <b>Объявление отправлено на проверку.</b> В нём есть признаки, которые часто встречаются у мошенников, поэтому
          его сначала посмотрит модератор. Когда проверка закончится, придёт уведомление.
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      <div className="mb-4 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">
        Не пишите в объявлении номер карты и ссылки на оплату. Объявления с оплатой до просмотра, платой за обучение
        или форму для работы и с ценой сильно ниже рынка сначала проверяет модератор.
      </div>

      <form action="/api/classifieds" method="POST" className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Вертикаль</label>
          <select name="vertical" className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm">
            <option value="REAL_ESTATE">Недвижимость</option>
            <option value="AUTO">Авто</option>
            <option value="SERVICE">Услуги</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Тип сделки</label>
          <select name="dealType" className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm">
            <option value="SELL">Продажа</option>
            <option value="LONG_RENT">Аренда (длительно)</option>
            <option value="DAILY_RENT">Посуточно</option>
            <option value="BUY_REQUEST">Куплю</option>
            <option value="SERVICE_OFFER">Предлагаю услугу</option>
            <option value="SERVICE_REQUEST">Нужна услуга</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Заголовок</label>
          <input
            name="title"
            required
            minLength={5}
            placeholder="Например: 2-комнатная квартира у метро"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Категория</label>
          <input
            name="category"
            required
            placeholder="Например: Квартиры"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Описание</label>
          <textarea
            name="description"
            rows={5}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Цена, ₽</label>
          <input
            name="priceRub"
            type="number"
            min={0}
            step={100}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Город</label>
          <select name="cityId" required className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm">
            {tree.map((d) => (
              <optgroup key={d.id} label={d.name}>
                {d.regions.map((r) =>
                  r.cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({r.name})
                    </option>
                  ))
                )}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Район / населённый пункт</label>
          <input
            name="districtName"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Адрес</label>
          <input
            name="addressLine"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">
          Характеристики (комнаты, этаж, пробег, год выпуска и т.д.) можно
          указать параметрами JSON в поле <code>attrs</code> через API. UI для
          их ввода по вертикалям — в работе.
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-6 py-2 text-sm font-medium text-white"
          >
            Опубликовать
          </button>
        </div>
      </form>
    </main>
  );
}
