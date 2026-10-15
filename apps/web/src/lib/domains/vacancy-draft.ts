/**
 * Светлана составляет вакансию из того, что работодатель написал своими
 * словами («ищу курьера на авто, 80-100к на руки, 5/2, без опыта»).
 *
 * Правило одно: ничего не выдумывать. Зарплату, график и условия берём только
 * из текста работодателя. Если подключена живая модель, она помогает
 * разложить текст по полям и оформить описание, но её ответ проверяется:
 * значения списков только из допустимых, числа в разумных пределах. Без
 * модели (или если она ошиблась) работают правила ниже. Черновик попадает в
 * форму, работодатель его правит и отправляет сам, а антифрод проверяет
 * вакансию как обычно.
 */
import { JOB_FIELDS } from "../classified-fields";
import { aiGateway, aiMode, newTraceId } from "../ai/gateway";

export const MAX_DRAFT_INPUT = 2000;

export interface VacancyDraft {
  title: string;
  category: string;
  description: string;
  salaryFrom?: number;
  /** Значения полей формы без префикса attr_: employment, schedule, salaryTo и т. д. */
  attrs: Record<string, string>;
}

const MAX_SALARY = 100_000_000;

function allowed(key: string, value: unknown): string | undefined {
  const field = JOB_FIELDS.find((f) => f.key === key);
  if (!field || typeof value !== "string") return undefined;
  if (field.type === "select") return field.options?.some((o) => o.value === value) ? value : undefined;
  if (field.type === "text") return value.replace(/\s+/g, " ").trim().slice(0, field.maxLength ?? 80) || undefined;
  return undefined;
}

function money(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[\s\u00a0]/g, "")) : NaN;
  // Меньше 100 ₽ это не зарплата, а часы («с 9 до 18») или стаж («от 1 года»).
  return Number.isFinite(n) && n >= 100 && n <= MAX_SALARY ? Math.round(n) : undefined;
}

/** «80», «80к», «80 тыс», «80 000» в рубли. */
function amount(num: string, suffix: string | undefined): number | undefined {
  const n = Number(num.replace(/[\s\u00a0]/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const k = suffix && /^(к|k|тыс)/i.test(suffix) ? 1000 : 1;
  return money(n * k);
}

const NUM = String.raw`(\d{1,3}(?:[\s\u00a0]\d{3})+|\d+(?:[.,]\d+)?)\s*(к|k|тыс\.?|т\.р\.?)?`;

function parseSalary(text: string): { from?: number; to?: number } {
  const t = text.toLowerCase();
  const range = new RegExp(`${NUM}\\s*(?:-|–|—|до)\\s*${NUM}`, "i").exec(t);
  if (range) {
    const suffix = range[4] ?? range[2];
    const from = amount(range[1], range[2] ?? suffix);
    const to = amount(range[3], suffix);
    if (from && to && to >= from) return { from, to };
  }
  const fromM = new RegExp(`от\\s*${NUM}`, "i").exec(t);
  const toM = new RegExp(`(?:^|[^о])до\\s*${NUM}`, "i").exec(t);
  const from = fromM ? amount(fromM[1], fromM[2]) : undefined;
  const to = toM ? amount(toM[1], toM[2]) : undefined;
  if (from || to) return { from, to: to && from && to < from ? undefined : to };
  const single = new RegExp(`(?:зарплат\\w*|з/?п|оплат\\w*|доход\\w*)[^\\d]{0,20}${NUM}`, "i").exec(t);
  if (single) return { from: amount(single[1], single[2]) };
  const withRub = new RegExp(`${NUM}\\s*(?:руб|₽|р\\.|(?:в|за)\\s*(?:смену|час|месяц|день))`, "i").exec(t);
  return withRub ? { from: amount(withRub[1], withRub[2]) } : {};
}

const CATEGORIES: [RegExp, string][] = [
  [/курьер|доставк/, "Доставка"],
  [/водител|таксист|экспедитор/, "Транспорт"],
  [/продав|кассир|консультант|менеджер по продаж/, "Продажи"],
  [/склад|грузчик|кладовщик|комплектовщик|сборщик заказ/, "Склад"],
  [/повар|официант|бариста|бармен|пекар|кондитер/, "Общепит"],
  [/программист|разработчик|тестировщик|devops|аналитик данных|frontend|backend/, "IT"],
  [/бухгалтер|экономист|финанс/, "Финансы"],
  [/уборщ|клининг|горничн/, "Клининг"],
  [/строител|монтажник|электрик|сварщик|сантехник|отделочник|маляр/, "Строительство и ремонт"],
  [/оператор колл|колл-центр|call-центр|оператор на телефон/, "Колл-центр"],
  [/охранник|охрана/, "Охрана"],
  [/медсестр|врач|фармацевт|санитар/, "Медицина"],
  [/учител|преподавател|воспитател|репетитор/, "Образование"],
  [/администратор|секретар|офис-менеджер/, "Офис и администрирование"],
];

function firstSentence(text: string): string {
  const line = text.split(/\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return (line.split(/(?<=[.!?])\s/)[0] ?? line).replace(/[.!?]+$/, "");
}

/** «ищем курьера» → «Курьер»: первое слово из винительного падежа, только частые окончания. */
function nominative(word: string): string {
  const rules: [RegExp, string][] = [[/ца$/, "ец"], [/теля$/, "тель"], [/щика$/, "щик"], [/ика$/, "ик"], [/ера$/, "ер"], [/ора$/, "ор"], [/ара$/, "ар"], [/ира$/, "ир"], [/ента$/, "ент"], [/иста$/, "ист"]];
  for (const [re, to] of rules) if (re.test(word)) return word.replace(re, to);
  return word;
}

function makeTitle(text: string): string {
  const sentence = firstSentence(text);
  const accusative = /^(срочно\s*[,:!]?\s*)?(ищу|ищем|приглашаем|набираем|в поиске)\s+/i.test(sentence);
  let t = sentence
    .replace(/^(срочно\s*[,:!]?\s*)?(ищу|ищем|требуется|требуются|нужен|нужна|нужны|приглашаем|набираем|в поиске)\s+/i, "")
    .trim();
  // Условия после запятой в заголовок не тянем: они уйдут в поля формы.
  const head = t.split(/\s*[,;]\s*/)[0] ?? t;
  if (head.length >= 5) t = head;
  if (accusative) t = t.replace(/^[А-Яа-яЁё-]+/, (w) => nominative(w.toLowerCase()));
  t = t.trim();
  if (t.length > 120) t = `${t.slice(0, 117).replace(/\s+\S*$/, "")}…`;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.length >= 5 ? t : "";
}

/** Правила без модели: только то, что есть в тексте. */
export function parseVacancyText(raw: string): VacancyDraft {
  const text = raw.replace(/\r/g, "").trim().slice(0, MAX_DRAFT_INPUT);
  const t = text.toLowerCase().replace(/ё/g, "е");
  const attrs: Record<string, string> = {};
  const set = (key: string, value: string | undefined) => {
    const ok = allowed(key, value);
    if (ok) attrs[key] = ok;
  };

  if (/вахт/.test(t)) set("employment", "rotation");
  else if (/стажир/.test(t)) set("employment", "internship");
  else if (/частичн|подработ|неполн/.test(t)) set("employment", "part");
  else if (/проектн/.test(t)) set("employment", "project");
  else if (/полн(ая|ый|ую) (занят|день)/.test(t)) set("employment", "full");

  if (/\b5\s*\/\s*2\b/.test(t)) set("schedule", "5/2");
  else if (/\b2\s*\/\s*2\b/.test(t)) set("schedule", "2/2");
  else if (/ночн/.test(t)) set("schedule", "night");
  else if (/гибк|свободн(ый|ым) график/.test(t)) set("schedule", "flexible");
  else if (/сменн|посменн/.test(t)) set("schedule", "shift");

  if (/удален|удаленн|из дома|remote/.test(t)) set("workFormat", "remote");
  else if (/гибрид/.test(t)) set("workFormat", "hybrid");
  else if (/разъездн/.test(t)) set("workFormat", "travel");

  if (/без опыта|опыт не (нужен|требуется|обязателен)|научим|обучим/.test(t)) set("experience", "none");
  else if (/опыт\D{0,15}(от\s*)?(6|шест|более 6|больше 6)/.test(t)) set("experience", "6+");
  else if (/опыт\D{0,15}(от\s*)?(3|тр[её]х)/.test(t)) set("experience", "3-6");
  else if (/опыт\D{0,15}(от\s*)?(1|года|одного)/.test(t)) set("experience", "1-3");

  if (/(^|[^а-я])тк([^а-я]|$)|трудов(ой|ому) (договор|кодекс)|официальн(ое|ым|о) трудоустр/.test(t)) set("contract", "tk");
  else if (/(^|[^а-я])гпх([^а-я]|$)/.test(t)) set("contract", "gph");
  else if (/самозанят/.test(t)) set("contract", "self");

  if (/высш(ее|его) образ/.test(t)) set("education", "higher");
  else if (/средн(ее|его)[- ]?(специальн|профессиональн)|(^|[^а-я])спо([^а-я]|$)|колледж|техникум/.test(t)) set("education", "vocational");

  if (/на руки|чистыми/.test(t)) set("salaryTax", "net");
  else if (/до вычета|до налог|gross|грязными/.test(t)) set("salaryTax", "gross");

  const salary = parseSalary(t);
  if (salary.to) attrs.salaryTo = String(salary.to);
  if (salary.from || salary.to) {
    if (/(в|за)\s*смену|\/\s*смен/.test(t)) set("salaryPeriod", "shift");
    else if (/(в|за)\s*час|\/\s*час|руб\.?\s*\/\s*ч\b/.test(t)) set("salaryPeriod", "hour");
    else if (/сдельн/.test(t)) set("salaryPeriod", "piece");
    else set("salaryPeriod", "month");
  }

  const company = /(?:компани[яи]|в компанию|ооо|ип)\s+[«"]([^»"]{2,60})[»"]/i.exec(text);
  if (company) set("companyName", company[1]);

  const category = CATEGORIES.find(([re]) => re.test(t))?.[1] ?? "Другое";
  return {
    title: makeTitle(text),
    category,
    description: text,
    salaryFrom: salary.from,
    attrs,
  };
}

function optionList(): string {
  return JOB_FIELDS.filter((f) => f.type === "select")
    .map((f) => `${f.key}: ${f.options?.map((o) => o.value).join(" | ")}`)
    .join("\n");
}

/** Ответ модели поверх правил: берём только проверенные значения. */
export function mergeModelDraft(base: VacancyDraft, model: Record<string, unknown>): VacancyDraft {
  const attrs = { ...base.attrs };
  // Если в тексте нет ни одной суммы, зарплату от модели не берём: это была бы выдумка.
  const textHasSalary = Boolean(base.salaryFrom || base.attrs.salaryTo);
  for (const f of JOB_FIELDS) {
    if (f.key === "salaryTo") continue;
    if (!textHasSalary && (f.key === "salaryPeriod" || f.key === "salaryTax")) continue;
    const v = allowed(f.key, model[f.key]);
    if (v) attrs[f.key] = v;
  }
  const salaryFrom = textHasSalary ? money(model.salaryFrom) ?? base.salaryFrom : undefined;
  const salaryTo = textHasSalary ? money(model.salaryTo) : undefined;
  if (salaryTo && (!salaryFrom || salaryTo >= salaryFrom)) attrs.salaryTo = String(salaryTo);
  const title = typeof model.title === "string" ? model.title.replace(/\s+/g, " ").trim() : "";
  const category = typeof model.category === "string" ? model.category.replace(/\s+/g, " ").trim() : "";
  const description = typeof model.description === "string" ? model.description.trim() : "";
  return {
    title: title.length >= 5 && title.length <= 120 ? title : base.title,
    category: category.length >= 2 && category.length <= 80 ? category : base.category,
    description: description.length >= 20 && description.length <= 5000 ? description : base.description,
    salaryFrom,
    attrs,
  };
}

export async function draftVacancy(raw: string): Promise<{ draft: VacancyDraft; source: "model" | "rules" }> {
  const base = parseVacancyText(raw);
  if (aiMode().mode !== "LIVE") return { draft: base, source: "rules" };
  try {
    const result = await aiGateway.complete({
      taskClass: "conversation",
      traceId: newTraceId("vacancy"),
      jsonMode: true,
      maxTokens: 1200,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "Ты Светлана, помощница площадки АИКО. Работодатель описал вакансию своими словами. Оформи её для объявления.",
            "Главное правило: ничего не выдумывай. Зарплату, график, условия, требования и название компании бери только из текста. Чего нет в тексте, того нет в ответе.",
            "Не добавляй обещаний, бонусов, соцпакета, если их нет в тексте. Не проси документы и предоплату.",
            "description: аккуратный текст на русском с разделами «Чем заниматься», «Что нужно», «Условия», только из фактов текста. Без эмодзи.",
            "Ответ строго JSON: {\"title\": string, \"category\": string, \"description\": string, \"salaryFrom\": number|null, \"salaryTo\": number|null, \"companyName\": string|null, и поля списков}.",
            "Значения полей списков (только из этих, иначе null):",
            optionList(),
          ].join("\n"),
        },
        { role: "user", content: raw.slice(0, MAX_DRAFT_INPUT) },
      ],
    });
    if (result.response.sandbox) return { draft: base, source: "rules" };
    const parsed = JSON.parse(result.response.content) as Record<string, unknown>;
    return { draft: mergeModelDraft(base, parsed), source: "model" };
  } catch {
    return { draft: base, source: "rules" };
  }
}
