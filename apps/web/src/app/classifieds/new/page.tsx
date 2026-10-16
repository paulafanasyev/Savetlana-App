import { getGeoTree } from "@/lib/domains/classifieds";
import { ensureGeoSeeded } from "@/lib/domains/geo";
import { requireUserServer } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ClassifiedForm, type GeoOption } from "@/components/ClassifiedForm";

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

  // Новая база без городов: заполняем справочник, иначе поле «Город» пустое.
  await ensureGeoSeeded();
  const tree = await getGeoTree();
  // В браузер передаём только названия, id и население (для порядка подсказок).
  const geo: GeoOption[] = tree.map((d) => ({
    id: d.id,
    name: d.name,
    regions: d.regions.map((r) => ({ id: r.id, name: r.name, cities: r.cities.map((c) => ({ id: c.id, name: c.name, population: c.population ?? 0 })) })),
  }));

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

      <ClassifiedForm tree={geo} />
    </main>
  );
}
