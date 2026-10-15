/**
 * Город из текста объявления: «живу в Казани», «г. Екатеринбург», «из Нижнего
 * Новгорода», «Город: Тула». Ищем только среди городов справочника площадки и
 * только рядом со словами «в», «из», «г.», «город»: просто совпадение слова
 * («мирно», «орёл на гербе») городом не считается. «Готов к переезду в Москву»
 * это не текущий город, его пропускаем. Ничего не нашли: undefined, город
 * человек выберет сам.
 */

export interface CityOption {
  id: string;
  name: string;
}

/** Как ещё называют крупные города. */
const ALIASES: Record<string, string[]> = {
  "москва": ["мск"],
  "санкт-петербург": ["спб", "питер", "петербург"],
  "екатеринбург": ["екб"],
  "нижний новгород": ["нижний", "н. новгород"],
};

function norm(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** «Казань» → «казан[а-я]{0,3}»: основа слова и любое падежное окончание. */
function wordPattern(word: string): string {
  const stem = word.replace(/(?:ий|ый|ой|ая|ое|ые|ь|а|я|о|е|ы|и|й)$/, "");
  // Короткие названия («Уфа» → «уф») тоже склоняются; окончание не длиннее трёх букв.
  return `${escape(stem.length >= 2 ? stem : word)}[а-я]{0,3}`;
}

function namePattern(name: string): string {
  return norm(name)
    .split(/(\s+|-)/)
    .filter((part) => part.trim() !== "")
    .map((part) => (part === "-" ? "-" : /^[а-я]+$/.test(part) ? wordPattern(part) : escape(part)))
    .join("\\s*")
    .replace(/\\s\*-\\s\*/g, "-");
}

const BEFORE = String.raw`(?:^|[^а-я])(?:(?:в|во|из|живу|проживаю)\s+|(?:г|гор)\.\s*|(?:г|гор)\s+|город[а-я]*\s*:?\s*)`;
const AFTER = String.raw`(?![а-я])`;
/** Перед этим городом говорится про переезд или командировки: это не место жительства. */
const NOT_HOME = /(?:переезд\S*|переехать|перееду|командировк\S*|вахт\S*)\s+(?:\S+\s+){0,3}$/;

export function cityFromText(text: string, cities: readonly CityOption[]): CityOption | undefined {
  const t = norm(text);
  let best: { city: CityOption; index: number; length: number } | undefined;
  for (const city of cities) {
    const forms = [namePattern(city.name), ...(ALIASES[norm(city.name)] ?? []).map(namePattern)];
    for (const form of forms) {
      const re = new RegExp(`${BEFORE}(${form})${AFTER}`, "g");
      for (let m = re.exec(t); m; m = re.exec(t)) {
        const index = m.index + m[0].length - m[1].length;
        if (NOT_HOME.test(t.slice(Math.max(0, index - 60), index))) continue;
        // Первое упоминание в тексте; на одном месте побеждает более длинное название.
        if (!best || index < best.index || (index === best.index && m[1].length > best.length)) {
          best = { city, index, length: m[1].length };
        }
        break;
      }
    }
  }
  return best?.city;
}
