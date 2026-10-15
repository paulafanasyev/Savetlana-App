/**
 * Резюме прямо в чате со Светланой: «Составь резюме: ищу работу водителем,
 * опыт 7 лет, хочу от 80 тыс». Здесь разбор просьбы и текст ответа. Само
 * резюме раскладывает тот же составитель, что и в форме объявления
 * (lib/domains/resume-draft.ts), а публикует человек сам: Светлана даёт
 * ссылку на форму, где его текст уже вставлен.
 */
import { describeAttrs } from "../classified-fields";
import type { VacancyDraft } from "../domains/vacancy-draft";

const COMMAND =
  /(?:^|[\s,.!?;:—–-]+)(?:пожалуйста[\s,]+)?(?:состав(?:ь|ьте)|созда(?:й|йте)|напиш(?:и|ите)|сдела(?:й|йте)|оформ(?:и|ите)|помоги(?:те)?\s+(?:составить|написать|сделать|оформить))\s+(?:мне\s+|пожалуйста\s+)?(?:моё\s+|мое\s+)?резюме(?:[\s,]+пожалуйста)?\s*[:—–-]?\s*/i;
const LEAD = /^(?:(?:привет|здравствуйте|добрый\s+(?:день|вечер)|доброе\s+утро|светлана)[\s,!.:]*)+/i;

/** Текст о себе без просьбы или null, если о резюме не просили. Пустая строка: просьба без подробностей. */
export function parseResumeCommand(message: string): string | null {
  const t = message.replace(/\r/g, "").trim();
  const m = COMMAND.exec(t);
  if (!m) return null;
  const before = t.slice(0, m.index).trim().replace(LEAD, "");
  const after = t.slice(m.index + m[0].length).trim();
  return [before, after]
    .map((part) => part.replace(/^[\s,.;:!?—–-]+|[\s,.;:!?—–-]+$/g, ""))
    .filter(Boolean)
    .join(". ");
}

export const RESUME_ASK =
  "Расскажите о себе своими словами: кем хотите работать, какой у вас опыт и что умеете, какую зарплату и график хотите. Например: «Составь резюме: ищу работу водителем, опыт 7 лет, права B и C, хочу от 80 тыс на руки, 5/2». Телефон и паспортные данные писать не нужно.";

/** Самая длинная ссылка с текстом, которую ещё удобно открыть. */
const MAX_LINK_TEXT = 800;

export function resumeFormLink(text: string): string {
  // Скобки encodeURIComponent не кодирует, а в ответе Светланы они закрывают ссылку.
  const encoded = encodeURIComponent(text).replace(/\(/g, "%28").replace(/\)/g, "%29");
  return text.length <= MAX_LINK_TEXT ? `/classifieds/new?resume=${encoded}` : "/classifieds/new";
}

/** Ответ Светланы: что она разложила по полям и как опубликовать. */
export function resumeChatReply(draft: VacancyDraft, text: string): string {
  const lines = ["Составила резюме по вашим словам:"];
  if (draft.title) lines.push(`• Должность: ${draft.title}`);
  if (draft.category && draft.category !== "Другое") lines.push(`• Раздел: ${draft.category}`);
  if (draft.salaryFrom) lines.push(`• Желаемая зарплата: ${draft.salaryFrom.toLocaleString("ru-RU")} ₽`);
  for (const row of describeAttrs("JOB", draft.attrs)) {
    if (row.label === "Компания") continue;
    lines.push(`• ${row.label}: ${row.value}`);
  }
  const missing: string[] = [];
  if (!draft.title) missing.push("должность");
  if (!draft.attrs.experience) missing.push("опыт");
  if (!draft.salaryFrom) missing.push("желаемую зарплату");
  if (!draft.attrs.schedule) missing.push("график");
  if (missing.length) lines.push(`Не нашла в тексте: ${missing.join(", ")}. Их можно дописать в форме.`);
  lines.push(
    text.length <= MAX_LINK_TEXT
      ? `Чтобы опубликовать: [Открыть форму резюме](${resumeFormLink(text)}). Там уже выбран раздел «Работа → Резюме» и вставлен ваш текст. Нажмите «Заполнить форму», проверьте поля, выберите город и опубликуйте.`
      : "Чтобы опубликовать, откройте «Подать объявление» → «Работа» → «Резюме», вставьте этот текст в блок Светланы и нажмите «Заполнить форму».",
  );
  return lines.join("\n");
}
