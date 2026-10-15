/**
 * Светлана составляет резюме из того, что соискатель написал своими словами
 * («ищу работу водителем, опыт 7 лет, права B и C, хочу от 80 тыс, 5/2»).
 *
 * Правило то же, что у вакансий: ничего не выдумывать. Желаемую зарплату,
 * опыт, график и образование берём только из текста. Поля формы общие с
 * вакансией, поэтому разбор условий тот же (parseVacancyText), а сверху
 * резюме: должность из «ищу работу водителем», стаж в годах, раздельное
 * описание. Компания из текста это прежнее место работы, в поле «Компания»
 * её не ставим. Телефон, почту, мессенджеры, паспорт и СНИЛС из текста
 * убираем (lib/domains/contact-scrub.ts): резюме видят все, а работодатель
 * пишет через сообщения площадки. Черновик попадает в форму, соискатель
 * проверяет его и публикует сам.
 */
import { JOB_FIELDS } from "../classified-fields";
import { aiGateway, aiMode, newTraceId } from "../ai/gateway";
import { mergeModelDraft, parseVacancyText, type VacancyDraft } from "./vacancy-draft";
import { scrubContacts, type ContactKind } from "./contact-scrub";

export const MAX_RESUME_INPUT = 2000;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function inflect(phrase: string, rules: [RegExp, string][]): string {
  // Слова через дефис меняем по отдельности: «продавцом-консультантом».
  return phrase
    .split(/(\s+|-)/)
    .map((w) => {
      if (/^(\s+|-)$/.test(w) || w.length < 4) return w;
      for (const [re, to] of rules) if (re.test(w)) return w.replace(re, to);
      return w;
    })
    .join("");
}

/** «водителем» → «водитель», «старшим продавцом» → «старший продавец». */
export function fromInstrumental(phrase: string): string {
  const rules: [RegExp, string][] = [
    [/телем$/, "тель"], [/цом$/, "ец"], [/ицей$/, "ица"], [/кой$/, "ка"], [/ней$/, "ня"], [/рой$/, "ра"],
    [/ым$/, "ый"], [/им$/, "ий"], [/ем$/, "ь"], [/ом$/, ""],
  ];
  return inflect(phrase, rules);
}

/** «в качестве курьера», «на должность менеджера» → именительный падеж. */
function fromGenitive(phrase: string): string {
  const rules: [RegExp, string][] = [
    [/ца$/, "ец"], [/теля$/, "тель"], [/щика$/, "щик"], [/ика$/, "ик"], [/ера$/, "ер"], [/ора$/, "ор"], [/ара$/, "ар"],
    [/ира$/, "ир"], [/ента$/, "ент"], [/иста$/, "ист"], [/ого$/, "ый"], [/его$/, "ий"],
  ];
  return inflect(phrase, rules);
}

const POSITION_END = /[,.;!?\n(]|\s\d|\s(?:опыт|стаж|без опыта|хочу|желаем|зарплат|з\/?п|от\s+\d|график|готов|рассмотрю|в городе|в г\.|удал[её]нн|можно|есть|права)/i;

function cut(rest: string): string {
  const end = POSITION_END.exec(rest);
  const phrase = (end ? rest.slice(0, end.index) : rest).trim().split(/\s+/).slice(0, 5).join(" ");
  return phrase.replace(/[«»"]/g, "").trim();
}

/** Желаемая должность из текста соискателя или пустая строка. */
export function resumeTitle(text: string): string {
  const t = text.replace(/\r/g, "").trim();
  const quality = /(?:в качестве|на должность|на позицию|на вакансию)\s+([^\n]+)/i.exec(t);
  if (quality) {
    const p = cut(quality[1]);
    if (p.length >= 3) return cap(fromGenitive(p.toLowerCase()));
  }
  const instr = /(?:ищу работу|ищу подработку|хочу работать|готова? работать|могу работать|работаю|работал[аи]?)\s+([а-яё][^\n]*)/i.exec(t);
  if (instr) {
    const p = cut(instr[1]).replace(/^(?:в|на|по)\s.*$/i, "");
    if (p.length >= 3) return cap(fromInstrumental(p.toLowerCase()));
  }
  const labeled = /(?:резюме|должность|специальность|профессия)\s*[:—–-]\s*([^\n]+)/i.exec(t);
  if (labeled) {
    const p = cut(labeled[1]);
    if (p.length >= 3) return cap(p);
  }
  return "";
}

/** Стаж: «опыт 7 лет», «5 лет опыта», «стаж 2 года», «нет опыта». */
export function resumeExperience(text: string): string | undefined {
  const t = text.toLowerCase().replace(/ё/g, "е");
  if (/без опыта|нет опыта|опыта нет|опыта работы нет/.test(t)) return "none";
  const m = /(?:опыт\S*|стаж\S*)\D{0,25}?(\d{1,2})(?:[.,]5)?\s*(?:год|года|лет)/.exec(t) ?? /(\d{1,2})(?:[.,]5)?\s*(?:год|года|лет)\s+(?:опыт|стаж)/.exec(t);
  if (!m) return undefined;
  const years = Number(m[1]);
  if (years < 1) return "none";
  if (years < 3) return "1-3";
  if (years < 6) return "3-6";
  return "6+";
}

/** Правила без модели: только то, что есть в тексте. */
export function parseResumeText(raw: string): VacancyDraft {
  const text = scrubContacts(raw.replace(/\r/g, "").trim().slice(0, MAX_RESUME_INPUT)).text;
  const base = parseVacancyText(text);
  const attrs = { ...base.attrs };
  delete attrs.companyName;
  const experience = resumeExperience(text);
  if (experience) attrs.experience = experience;
  // «Научим» и «обучим» пишут работодатели: у соискателя опыт только из его слов о стаже.
  else delete attrs.experience;
  const title = resumeTitle(text) || (base.category !== "Другое" ? `Ищу работу: ${base.category.toLowerCase()}` : "");
  return {
    title,
    category: base.category,
    description: text,
    salaryFrom: base.salaryFrom,
    attrs,
  };
}

function optionList(): string {
  return JOB_FIELDS.filter((f) => f.type === "select")
    .map((f) => `${f.key}: ${f.options?.map((o) => o.value).join(" | ")}`)
    .join("\n");
}

export async function draftResume(input: string): Promise<{ draft: VacancyDraft; source: "model" | "rules"; removed: ContactKind[] }> {
  // Контакты не уходят ни в объявление, ни внешней модели.
  const { text: raw, removed } = scrubContacts(input.replace(/\r/g, "").trim().slice(0, MAX_RESUME_INPUT));
  const base = parseResumeText(raw);
  if (aiMode().mode !== "LIVE") return { draft: base, source: "rules", removed };
  try {
    const result = await aiGateway.complete({
      taskClass: "conversation",
      traceId: newTraceId("resume"),
      jsonMode: true,
      maxTokens: 1200,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "Ты Светлана, помощница площадки АИКО. Соискатель описал себя своими словами. Оформи его резюме для объявления.",
            "Главное правило: ничего не выдумывай. Должность, опыт, навыки, образование, желаемую зарплату и график бери только из текста. Чего нет в тексте, того нет в ответе.",
            "Не добавляй навыков, достижений, сертификатов и качеств («ответственный», «стрессоустойчивый»), если их нет в тексте. Не пиши телефон, паспортные данные и адрес.",
            "title: желаемая должность, коротко. description: текст на русском с разделами «Опыт», «Навыки», «Что ищу», только из фактов текста. Без эмодзи.",
            "companyName всегда null. salaryFrom: желаемая зарплата, только если сумма есть в тексте.",
            "Ответ строго JSON: {\"title\": string, \"category\": string, \"description\": string, \"salaryFrom\": number|null, \"salaryTo\": number|null, \"companyName\": null, и поля списков}.",
            "Значения полей списков (только из этих, иначе null):",
            optionList(),
          ].join("\n"),
        },
        { role: "user", content: raw.slice(0, MAX_RESUME_INPUT) },
      ],
    });
    if (result.response.sandbox) return { draft: base, source: "rules", removed };
    const parsed = JSON.parse(result.response.content) as Record<string, unknown>;
    const merged = mergeModelDraft(base, { ...parsed, companyName: null });
    // Стаж только из текста: модель не может его придумать.
    if (base.attrs.experience) merged.attrs.experience = base.attrs.experience;
    else delete merged.attrs.experience;
    delete merged.attrs.companyName;
    // Модель могла вернуть контакт в описании: чистим и её текст.
    merged.description = scrubContacts(merged.description).text;
    return { draft: merged, source: "model", removed };
  } catch {
    return { draft: base, source: "rules", removed };
  }
}
