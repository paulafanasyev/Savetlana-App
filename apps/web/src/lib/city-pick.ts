/**
 * Поиск города по тексту: для поля «Город» в объявлении и выбора своего города.
 * Без базы и браузера: чистые функции, которые легко проверить тестами.
 */

export interface PickCity {
  id: string;
  name: string;
  regionName: string;
}

export function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, "е").replace(/[\s-]+/g, " ");
}

/** «Казань, Республика Татарстан»; для Москвы и Петербурга регион не повторяем. */
export function cityLabel(c: PickCity): string {
  return c.name === c.regionName ? c.name : `${c.name}, ${c.regionName}`;
}

/** Подсказки: сначала города, начинающиеся с текста, потом те, где текст внутри. Порядок списка сохраняется. */
export function suggestCities(text: string, cities: PickCity[], limit = 8): PickCity[] {
  const q = normalize(text);
  if (!q) return cities.slice(0, limit);
  const starts: PickCity[] = [];
  const inside: PickCity[] = [];
  for (const c of cities) {
    const name = normalize(c.name);
    if (name.startsWith(q)) starts.push(c);
    else if (name.includes(q) || normalize(cityLabel(c)).includes(q)) inside.push(c);
  }
  return [...starts, ...inside].slice(0, limit);
}

/** Город, который человек имел в виду: точное название или подпись; иначе единственная подсказка. */
export function matchCity(text: string, cities: PickCity[]): PickCity | null {
  const q = normalize(text);
  if (!q) return null;
  const exact = cities.find((c) => normalize(cityLabel(c)) === q) ?? cities.find((c) => normalize(c.name) === q);
  if (exact) return exact;
  const options = suggestCities(text, cities, 2);
  return options.length === 1 ? options[0] : null;
}
