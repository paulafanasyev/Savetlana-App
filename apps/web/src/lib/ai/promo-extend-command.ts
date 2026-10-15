/**
 * «Продли скидку на кроссовки на 7 дней»: разбор просьбы продлить скидку для
 * встроенной Светланы. Внешняя модель вызывает тот же инструмент сама.
 * «Продли всё, что заканчивается»: только скидки, которые закончатся в
 * течение суток, и без срока на неделю, как кнопка в блоке «Что сделать сегодня».
 */
import { extractPromoDuration } from "../domains/engagement-rules";

const EXTEND_VERB = /(?:^|\s)(?:продли|продлите|продлить|продлим|продлевай|продлеваем)(?=\s|,|$)/i;
const ENDING = /(?:заканчива|скоро\s+законч|истека)/i;
/** «Продли размещение, которое заканчивается» про объявление, а не про скидку. */
const NOT_PROMO = /(?:размещени|объявлени|карточк|подписк)/i;
const EXTEND = /(?:^|\s)(?:продли|продлите|продлить|продлим|продлевай|продлеваем)\s+(?:все\s+|мои\s+|эту\s+|эти\s+)?(?:акци|скидк|распродаж)\S*/i;

export interface PromoExtendCommand {
  /** Какие товары: «кроссовки». Пусто: все товары со скидкой. */
  query: string;
  /** На сколько дней продлить, если сказано. */
  days?: number;
  /** Только скидки, которые закончатся в течение суток. */
  ending?: true;
}

/** Товары из остатка фразы: «на кроссовки на 3 дня» → «кроссовки», 3 дня. */
function targetAndDays(rest: string): { query: string; days?: number } {
  const parsed = extractPromoDuration(rest.replace(/[?!.,;:«»"]+/g, " "));
  const query = parsed.rest.replace(/^(?:для|на|с|со)\s+/i, "").replace(/\s+/g, " ").trim();
  return parsed.days ? { query, days: parsed.days } : { query };
}

/** Убирает из фразы часть про окончание: «на кроссовки, она заканчивается» → «на кроссовки». */
function withoutEndingClause(rest: string): string {
  return rest
    .split(/[,;]/)
    .filter((part) => !ENDING.test(part) && !/^\s*(?:котор|что|она|они|оно|он)(?:\s|$)/i.test(part))
    .join(" ");
}

export function parsePromoExtendCommand(text: string): PromoExtendCommand | null {
  const verb = EXTEND_VERB.exec(text);
  const m = EXTEND.exec(text);
  if (verb && ENDING.test(text) && !NOT_PROMO.test(text)) {
    // «Продли скидку на кроссовки, она заканчивается»: только заканчивающиеся, и только кроссовки.
    const rest = m ? text.slice((m.index ?? 0) + m[0].length) : text.slice((verb.index ?? 0) + verb[0].length);
    const { query, days } = targetAndDays(withoutEndingClause(rest));
    const target = m ? query : "";
    return days ? { query: target, days, ending: true } : { query: target, ending: true };
  }
  if (!m) return null;
  return targetAndDays(text.slice((m.index ?? 0) + m[0].length));
}

export const PROMO_EXTEND_ASK =
  "На сколько дней продлить скидку? Например: «продли скидку на кроссовки на 7 дней» или «продли все скидки на неделю». Вся акция может идти не дольше 30 дней с запуска.";

export function promoExtendReply(command: PromoExtendCommand): string {
  if (command.ending) return `Проверю, какие скидки${command.query ? ` на «${command.query}»` : ""} закончатся в течение суток, и покажу новые даты.`;
  return `Проверю, какие скидки${command.query ? ` на «${command.query}»` : ""} можно продлить, и покажу новые даты.`;
}
