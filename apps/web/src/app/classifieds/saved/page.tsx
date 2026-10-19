import Link from "next/link";
import type { Metadata } from "next";
import { requireUserServer } from "@/lib/auth";
import { listSavedSearches } from "@/lib/domains/saved-searches";
import { telegramStatus } from "@/lib/domains/telegram-link";
import { MAX_SAVED_SEARCHES } from "@/lib/saved-search";
import { resolveSearchParams } from "@/lib/page-params";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Мои поиски", robots: { index: false, follow: false } };

const NOTICE: Record<string, { tone: string; text: string }> = {
  added: { tone: "bg-emerald-50 text-emerald-800", text: "Поиск сохранён. Когда появятся новые объявления, придёт уведомление." },
  exists: { tone: "bg-zinc-100 text-zinc-700", text: "Такой поиск уже сохранён." },
  limit: { tone: "bg-amber-50 text-amber-800", text: `Можно хранить до ${MAX_SAVED_SEARCHES} поисков. Удалите лишний и сохраните снова.` },
  removed: { tone: "bg-zinc-100 text-zinc-700", text: "Поиск удалён, уведомлений по нему больше не будет." },
};

export default async function SavedSearchesPage({ searchParams }: { searchParams: Promise<{ saved?: string; removed?: string }> }) {
  const sp = await resolveSearchParams(searchParams);
  const { user } = await requireUserServer();
  const [items, telegram] = await Promise.all([
    listSavedSearches(user.id),
    telegramStatus(user.id).catch(() => null),
  ]);
  const notice = sp.removed ? NOTICE.removed : sp.saved ? NOTICE[sp.saved] : undefined;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 text-sm text-zinc-500">
        <Link href="/classifieds" className="hover:underline">Объявления</Link> / Мои поиски
      </div>
      <h1 className="text-2xl font-bold">Мои поиски</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Когда по сохранённому поиску появятся новые объявления, придёт уведомление на сайте
        {telegram?.linked ? " и в Telegram" : ""}. Проверяем раз в сутки, свои объявления не считаем.
      </p>
      {telegram && !telegram.linked && telegram.configured && (
        <p className="mt-2 text-sm text-zinc-600">
          Хотите узнавать сразу в Telegram? <Link href="/profile" className="underline">Подключите его в профиле</Link>.
        </p>
      )}

      {notice && (
        <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${notice.tone}`} role="status">
          {notice.text}
        </p>
      )}

      {items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500">
          Сохранённых поисков пока нет. Настройте фильтры в{" "}
          <Link href="/classifieds" className="underline">объявлениях</Link> и нажмите «🔔 Сохранить поиск».
        </div>
      ) : (
        <ul className="mt-6 space-y-3" data-testid="saved-searches">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4">
              <div className="min-w-0">
                <Link href={s.href} className="font-semibold hover:underline">{s.label}</Link>
                <p className="mt-1 text-xs text-zinc-500">Сохранён {new Date(s.createdAt).toLocaleDateString("ru-RU")}</p>
              </div>
              <div className="flex gap-2">
                <Link href={s.href} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm">Открыть</Link>
                <form method="post" action="/api/saved-searches">
                  <input type="hidden" name="action" value="remove" />
                  <input type="hidden" name="id" value={s.id} />
                  <button type="submit" className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-red-700">Удалить</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
