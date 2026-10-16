/**
 * Заголовок и описание страницы объявления для поисковиков и превью в мессенджерах.
 * Примеры от площадки не индексируются: это не настоящие предложения.
 */

export interface AdMeta {
  title: string;
  description: string;
  index: boolean;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function adMeta(input: { title: string; price: string | null; cityName: string; description: string | null; demo: boolean }): AdMeta {
  const head = [input.title.trim(), input.price, input.cityName].filter(Boolean).join(" · ");
  const title = `${clip(head, 90)} | АИКО`;
  const text = (input.description ?? "").replace(/\s+/g, " ").trim();
  const description = clip(text || `${input.title.trim()} в городе ${input.cityName} на АИКО`, 160);
  return { title, description, index: !input.demo };
}
