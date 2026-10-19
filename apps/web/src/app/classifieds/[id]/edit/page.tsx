import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readObject } from "@/lib/db/json";
import { resolveParams } from "@/lib/page-params";
import { ATTR_PREFIX, fieldsFor, priceLabel } from "@/lib/classified-fields";
import { canEdit } from "@/lib/ad-edit";
import { dealTypeLabel, verticalLabel } from "@/lib/verticals";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Редактирование объявления | АИКО" }, robots: { index: false } };

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm";

/** Правка своего объявления: заголовок, описание, цена и характеристики. */
export default async function EditClassifiedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const { id } = await resolveParams(params);
  const sp = (await searchParams) ?? {};
  const { user } = await requireUserServer();
  const ad = await prisma.classified.findUnique({
    where: { id },
    select: { id: true, authorId: true, status: true, vertical: true, dealType: true, title: true, description: true, priceKopecks: true, attrs: true, city: { select: { name: true } } },
  });
  // Чужое объявление для редактора не существует: не подсказываем, что оно есть.
  if (!ad || ad.authorId !== user.id) notFound();
  const attrs = readObject(ad.attrs);
  const editable = canEdit(ad.status);
  const fields = fieldsFor(ad.vertical);
  const error = typeof sp.error === "string" ? sp.error.slice(0, 300) : "";

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/classifieds/my" className="mb-4 inline-block text-sm text-zinc-600 hover:underline">← Мои объявления</Link>
      <h1 className="mb-1 text-2xl font-bold">Редактирование объявления</h1>
      <p className="mb-4 text-sm text-zinc-600">{verticalLabel(ad.vertical)} · {dealTypeLabel(ad.dealType)} · {ad.city.name}</p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</div>
      )}

      {!editable ? (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
          Это объявление сейчас нельзя изменить: редактировать можно опубликованное или ожидающее проверки. Снятое
          объявление сначала верните в поиск.
        </p>
      ) : (
        <form action={`/api/classifieds/${ad.id}/edit`} method="POST" className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Заголовок</span>
            <input name="title" defaultValue={ad.title} required minLength={5} maxLength={200} className={input} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{priceLabel(ad.dealType)}</span>
            <input name="priceRub" inputMode="decimal" defaultValue={ad.priceKopecks > 0 ? String(ad.priceKopecks / 100) : ""} placeholder="Оставьте пустым, если цена договорная" className={input} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Описание</span>
            <textarea name="description" defaultValue={ad.description ?? ""} rows={6} maxLength={5000} className={input} />
          </label>

          {fields.length > 0 && (
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-medium">Характеристики</legend>
              {fields.map((f) => {
                const value = attrs[f.key];
                const current = value === undefined || value === null ? "" : String(value);
                return (
                  <label key={f.key} className="block text-sm">
                    <span className="mb-1 block text-zinc-700">{f.label}{f.unit ? `, ${f.unit}` : ""}</span>
                    {f.type === "select" ? (
                      <select name={ATTR_PREFIX + f.key} defaultValue={current} className={input}>
                        <option value="">Не указано</option>
                        {f.options?.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        name={ATTR_PREFIX + f.key}
                        defaultValue={current}
                        inputMode={f.type === "number" ? "decimal" : undefined}
                        maxLength={f.maxLength}
                        placeholder={f.placeholder}
                        className={input}
                      />
                    )}
                  </label>
                );
              })}
            </fieldset>
          )}

          <p className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">
            Раздел, тип сделки, город и фото здесь не меняются: для этого снимите объявление и разместите
            новое. Изменённое объявление снова проходит проверку: если в нём появятся признаки мошенничества,
            его сначала посмотрит модератор.
          </p>

          <div className="flex flex-wrap gap-2">
            <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Сохранить</button>
            <Link href="/classifieds/my" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium">Отмена</Link>
          </div>
        </form>
      )}
    </main>
  );
}
