import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { rub, timeAgo } from "@/lib/format";
import { readCityCookie } from "@/lib/my-city";
import { FREELANCE_TABS, TAB_DEAL_TYPE, freelanceFormHref, freelanceHref, freelanceTab, pickCategory, type FreelanceTab } from "@/lib/freelance-section";

export const dynamic = "force-dynamic";

/**
 * Заголовок по вкладке и категории. Категорию из ссылки берём, только если такие
 * объявления реально есть: иначе в заголовок можно было бы подставить любой текст.
 */
export async function generateMetadata({ searchParams }: { searchParams?: Promise<{ tab?: string; category?: string; near?: string }> }): Promise<Metadata> {
  const sp = (await searchParams) ?? {};
  const tab = freelanceTab(sp.tab);
  const raw = typeof sp.category === "string" ? sp.category.trim().slice(0, 80) : "";
  const known = raw
    ? (await prisma.classified.count({ where: { vertical: "SERVICE", dealType: TAB_DEAL_TYPE[tab], status: "PUBLISHED", category: raw } }).catch(() => 0)) > 0
    : false;
  const section = tab === "orders" ? "Заказы на услуги" : "Услуги исполнителей";
  const title = known ? `${section}: ${raw} | Фриланс АИКО` : `${section} | Фриланс АИКО`;
  const description =
    tab === "orders"
      ? "Заказы на услуги: исполнители предлагают цену и срок, деньги хранятся у площадки до приёмки работы."
      : "Услуги исполнителей с портфолио: деньги хранятся у площадки и приходят исполнителю после приёмки.";
  // Фильтр «только мой город» зависит от cookie и не должен попадать в выдачу.
  const noindex = sp.near === "1" || (raw !== "" && !known);
  return { title: { absolute: title }, description, robots: noindex ? { index: false, follow: true } : undefined };
}

/** Добавляет к ссылке фильтр «только мой город». */
function nearHref(href: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}near=1`;
}

/**
 * Раздел «Фриланс»: заказы на услуги (исполнители предлагают цену и срок) и
 * услуги исполнителей, с фильтром по категориям. Оплата через безопасную сделку.
 *
 * Многое делается удалённо, поэтому по умолчанию показываем всё. Если человек выбрал
 * свой город, можно оставить только его (?near=1): ремонт, уборка, фотосъёмка.
 */
export default async function FreelancePage({ searchParams }: { searchParams?: Promise<{ tab?: string; category?: string; near?: string }> }) {
  const sp = (await searchParams) ?? {};
  const tab = freelanceTab(sp.tab);
  const myCity = readCityCookie((await headers()).get("cookie"));
  const near = sp.near === "1" && myCity !== null;
  const keep = (href: string) => (near ? nearHref(href) : href);
  const now = new Date();
  const base: Prisma.ClassifiedWhereInput = {
    vertical: "SERVICE",
    dealType: TAB_DEAL_TYPE[tab],
    status: "PUBLISHED",
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    ...(near && myCity ? { city: { name: myCity } } : {}),
  };
  const groups = await prisma.classified.groupBy({ by: ["category"], where: base, _count: { _all: true } });
  const categories = groups
    .map((g) => ({ name: g.category, count: g._count._all }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"));
  const category = pickCategory(sp.category, categories.map((c) => c.name));
  const ads = await prisma.classified.findMany({
    where: category ? { ...base, category } : base,
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, title: true, priceKopecks: true, createdAt: true, category: true, authorId: true, city: { select: { name: true } } },
  });
  const total = categories.reduce((s, c) => s + c.count, 0);
  const what = tab === "orders" ? "заказов" : "услуг";
  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Фриланс</h1>
          <p className="text-sm text-ink-soft">🛡 Деньги за работу хранятся у площадки и приходят исполнителю только после приёмки.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === "offers" && <Link href="/profile/portfolio" className="btn btn-ghost">Моё портфолио</Link>}
          <Link href={freelanceFormHref(tab)} className="btn btn-primary">{tab === "orders" ? "Разместить заказ" : "Предложить услугу"}</Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex gap-2" aria-label="Вкладки раздела">
          {(Object.keys(FREELANCE_TABS) as FreelanceTab[]).map((t) => (
            <Link key={t} href={keep(freelanceHref(t))} className={t === tab ? "btn btn-primary px-3 py-2 text-sm" : "btn btn-ghost px-3 py-2 text-sm"} aria-current={t === tab ? "page" : undefined}>
              {FREELANCE_TABS[t]}
            </Link>
          ))}
        </nav>
        {myCity ? (
          <nav className="flex gap-1 text-sm" aria-label="Где искать">
            <Link href={freelanceHref(tab, category ?? undefined)} className={!near ? "chip bg-svetlana-600 text-white" : "chip"} aria-current={!near ? "true" : undefined}>
              Везде
            </Link>
            <Link href={nearHref(freelanceHref(tab, category ?? undefined))} className={near ? "chip bg-svetlana-600 text-white" : "chip"} aria-current={near ? "true" : undefined}>
              Только {myCity}
            </Link>
          </nav>
        ) : (
          <Link href="/city" className="text-xs text-ink-soft underline">Выбрать свой город</Link>
        )}
      </div>

      {categories.length > 0 && (
        <nav className="flex flex-wrap gap-2 text-sm" aria-label="Категории">
          <Link href={keep(freelanceHref(tab))} className={!category ? "chip bg-svetlana-600 text-white" : "chip"}>Все · {total}</Link>
          {categories.map((c) => (
            <Link key={c.name} href={keep(freelanceHref(tab, c.name))} className={c.name === category ? "chip bg-svetlana-600 text-white" : "chip"}>
              {c.name} · {c.count}
            </Link>
          ))}
        </nav>
      )}

      {ads.length === 0 ? (
        <p className="card p-6 text-sm text-ink-soft">
          {near ? (
            <>
              В городе {myCity} {what} пока нет.{" "}
              <Link href={freelanceHref(tab)} className="underline">Посмотреть везде</Link>
            </>
          ) : tab === "orders" ? (
            "Заказов пока нет. Разместите свой: исполнители предложат цену и срок."
          ) : (
            "Услуг пока нет."
          )}
        </p>
      ) : (
        <ul className="card divide-y divide-surface-line">
          {ads.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <Link href={`/classifieds/${a.id}`} className="font-medium text-ink hover:text-svetlana-700 hover:underline">{a.title}</Link>
                <p className="text-xs text-ink-faint">
                  {a.category}{a.city?.name ? ` · ${a.city.name}` : ""} · {timeAgo(a.createdAt)}
                  {tab === "offers" && (
                    <>
                      {" · "}
                      <Link href={`/performers/${a.authorId}`} className="underline">профиль исполнителя</Link>
                    </>
                  )}
                </p>
              </div>
              <div className="shrink-0 text-right text-sm">
                <p className="font-semibold">{a.priceKopecks > 0 ? rub(a.priceKopecks) : "цена договорная"}</p>
                <p className="text-xs text-ink-soft">{tab === "orders" ? "бюджет" : "стоимость"}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
