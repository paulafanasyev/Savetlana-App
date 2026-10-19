import Link from "next/link";
import { similarClassifieds } from "@/lib/domains/classified-similar";
import { priceText } from "@/lib/classified-fields";
import { rub } from "@/lib/format";
import { verticalEmoji } from "@/lib/verticals";

/** Блок «Похожие объявления» под объявлением. Ошибка поиска не ломает страницу. */
export async function SimilarAds({ id }: { id: string }) {
  const items = await similarClassifieds(id).catch(() => []);
  if (items.length === 0) return null;
  return (
    <section className="mt-10" aria-labelledby="similar-ads">
      <h2 id="similar-ads" className="mb-3 text-lg font-semibold">Похожие объявления</h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((ad) => {
          const price =
            ad.priceKopecks > 0
              ? priceText(ad.dealType, ad.attrs, rub(ad.priceKopecks))
              : ad.vertical === "JOB"
                ? "Зарплата по договорённости"
                : "Цена не указана";
          return (
            <li key={ad.id}>
              <Link href={`/classifieds/${ad.id}`} className="block rounded-xl border border-zinc-200 bg-white p-2 hover:border-zinc-400">
                {ad.coverImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ad.coverImage} alt={ad.title} loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover" />
                ) : (
                  <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-zinc-100 text-3xl">{verticalEmoji(ad.vertical)}</div>
                )}
                <p className="mt-2 line-clamp-2 text-sm font-medium">{ad.title}</p>
                <p className="text-sm font-semibold">{price}</p>
                <p className="text-xs text-zinc-500">{ad.cityName}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
