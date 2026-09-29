import { getGeoTree } from "@/lib/domains/classifieds";
import { requireUserServer } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function NewClassifiedPage() {
  const ctx = await requireUserServer();
  if (!ctx) redirect("/login");

  const tree = await getGeoTree();

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold">Разместить объявление</h1>

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
