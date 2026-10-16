/**
 * Заголовок и описание страниц объявлений для поисковиков и превью в мессенджерах.
 * Примеры от площадки и истёкшие объявления не индексируются: это не действующие предложения.
 */

export interface AdMeta {
  title: string;
  description: string;
  index: boolean;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function adMeta(input: { title: string; price: string | null; cityName: string; description: string | null; demo: boolean; expired?: boolean }): AdMeta {
  const head = [input.title.trim(), input.price, input.cityName].filter(Boolean).join(" · ");
  const title = `${clip(head, 90)} | АИКО`;
  const text = (input.description ?? "").replace(/\s+/g, " ").trim();
  const description = clip(text || `${input.title.trim()} в городе ${input.cityName} на АИКО`, 160);
  return { title, description, index: !input.demo && !input.expired };
}

/**
 * Заголовок списка объявлений: раздел и город. Результаты поиска по тексту
 * не индексируем: таких страниц бесконечно много, поисковики считают их мусором.
 */
export function listMeta(input: { section?: string | null; cityName?: string | null; query?: string | null }): AdMeta {
  const section = input.section?.trim() || "Объявления";
  const city = input.cityName?.trim() || "";
  const head = city ? `${section} · ${city}` : `${section} по всей России`;
  const title = `${head} | АИКО`;
  const where = city ? `в городе ${city}` : "по всей России";
  const description = `${section} ${where}: недвижимость, авто, услуги и работа с реальной геопривязкой. Размещение бесплатно.`;
  return { title, description: clip(description, 160), index: !input.query?.trim() };
}
