/**
 * Что человек ищет в объявлениях: «найди мне работу водителем в Казани»,
 * «нужен мастер по ремонту ванной», «ищу заказы на дизайн». Чистый модуль:
 * раздел и тип сделки по словам, основы слов для поиска по заголовку и
 * описанию (поиск в базе точный, поэтому «водителем» ищем как «водител»).
 */

export type ClassifiedVertical = "REAL_ESTATE" | "AUTO" | "SERVICE" | "JOB";

export interface ClassifiedIntent {
  vertical?: ClassifiedVertical;
  dealType?: string;
}

const VERTICAL_ALIASES: [RegExp, ClassifiedVertical][] = [
  [/^(?:job|jobs|work|vacanc\w*|resume|работ\S*|ваканси\S*|резюме)$/i, "JOB"],
  [/^(?:service|services|freelance\w*|услуг\S*|фриланс\S*)$/i, "SERVICE"],
  [/^(?:auto|car|cars|авто\S*|машин\S*)$/i, "AUTO"],
  [/^(?:real_estate|realty|estate|недвижим\S*|жиль\S*|квартир\S*)$/i, "REAL_ESTATE"],
];

/** «job», «работа», «JOB» → JOB. Неизвестное: undefined. */
export function normalizeVertical(value: unknown): ClassifiedVertical | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const v = value.trim();
  if (/^(REAL_ESTATE|AUTO|SERVICE|JOB)$/.test(v.toUpperCase())) return v.toUpperCase() as ClassifiedVertical;
  return VERTICAL_ALIASES.find(([re]) => re.test(v))?.[1];
}

const DEAL_TYPES = ["SELL", "RENT", "LONG_RENT", "DAILY_RENT", "BUY_REQUEST", "SERVICE_OFFER", "SERVICE_REQUEST", "VACANCY", "RESUME"];

export function normalizeDealType(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toUpperCase();
  return DEAL_TYPES.includes(v) ? v : undefined;
}

/** Раздел и тип сделки по словам человека. */
export function classifiedIntent(text: string): ClassifiedIntent {
  const t = text.toLowerCase().replace(/ё/g, "е");
  // Работодатель ищет людей: смотрим резюме.
  if (/(ищу|ищем|нужен|нужна|нужны|найди|найти|подбери)\s+(?:\S+\s+){0,2}(сотрудник|работник|соискател|кандидат)|резюме\s+(водител|курьер|продав|повар|бухгалтер|программист)|(посмотреть|покажи|найди)\s+резюме/.test(t)) {
    return { vertical: "JOB", dealType: "RESUME" };
  }
  if (/ваканси|работу(?![а-я])|работы(?![а-я])|работа(?![а-я])|подработ|трудоустро|устроиться|кем работать/.test(t)) {
    return { vertical: "JOB", dealType: "VACANCY" };
  }
  // Исполнитель ищет заказы.
  if (/(ищу|найди|найти|есть ли|покажи)\s+(?:\S+\s+){0,2}(заказ[ыов]*|клиент\S*|проект\S*)\s+(?:на|по|для)\s/.test(t) && !/заказ\S* (товар|на сайте|мой)/.test(t)) {
    return { vertical: "SERVICE", dealType: "SERVICE_REQUEST" };
  }
  if (/фриланс|исполнител|мастер(?:а|ов)?\s+(?:на|по|для)|услуг|репетитор|сантехник|электрик|ремонт\S* (?:квартир|ванн|кухн|под ключ)|дизайнер|фотограф|юрист|бухгалтер на|уборк|клининг|няня|сиделк|грузчик\S* на/.test(t)) {
    return { vertical: "SERVICE", dealType: "SERVICE_OFFER" };
  }
  return {};
}

const STOP = new Set([
  "работа", "работу", "работы", "работе", "работой", "подработка", "подработку", "подработки", "вакансия", "вакансии", "вакансию", "вакансий",
  "резюме", "услуга", "услуги", "услугу", "услуг", "фриланс", "фрилансер", "фрилансера", "исполнитель", "исполнителя", "исполнителей",
  "заказ", "заказы", "заказов", "ищу", "ищем", "найди", "найдите", "найти", "нужен", "нужна", "нужно", "нужны", "хочу", "мне", "меня",
  "для", "на", "по", "в", "во", "с", "со", "от", "до", "из", "и", "или", "как", "кем", "есть", "ли", "покажи", "подбери", "какие", "какая",
  "тыс", "руб", "рублей", "город", "городе", "г", "любая", "любую", "мастер", "мастера", "сотрудник", "сотрудника", "сотрудников",
  "кандидат", "кандидата", "соискатель", "соискателя", "клиентов", "проекты", "пожалуйста", "срочно", "работать",
]);

/** «работу водителем в Казани» → ["водител"]: основы значимых слов, не больше трёх. */
export function classifiedSearchStems(query: string, skip: readonly string[] = []): string[] {
  const skipSet = new Set(skip.map((s) => s.toLowerCase().replace(/ё/g, "е")));
  const words = query
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^a-zа-я0-9-]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+к?$/.test(w));
  const stems: string[] = [];
  for (const w of words) {
    if ([...skipSet].some((s) => s && (w.startsWith(s.slice(0, Math.max(3, s.length - 2)))))) continue;
    const stem = w.length >= 6 ? w.replace(/(?:ами|ями|ием|ией|ого|его|ому|ему|ыми|ими|ем|ом|ой|ей|ам|ям|ах|ях|ов|ев|ы|и|а|я|у|ю|е|ь)$/, "") : w;
    const s = stem.length >= 4 ? stem : w;
    if (!stems.includes(s)) stems.push(s);
    if (stems.length >= 3) break;
  }
  return stems;
}
