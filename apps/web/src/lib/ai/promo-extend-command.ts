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

export function parsePromoExtendCommand(text: string): PromoExtendCommand | null {
  const verb = EXTEND_VERB.exec(text);
  if (verb && ENDING.test(text) && !NOT_PROMO.test(text)) {
    const { days } = extractPromoDuration(text.slice((verb.index ?? 0) + verb[0].length).replace(/[?!.,;:«»"]+/g, " "));
    return days ? { query: "", days, ending: true } : { query: "", ending: true };
  }
  const m = EXTEND.exec(text);
  if (!m) return null;
  const rest = text.slice((m.index ?? 0) + m[0].length).replace(/[?!.,;:«»"]+/g, " ");
  const parsed = extractPromoDuration(rest);
  const query = parsed.rest.replace(/^(?:для|на|с|со)\s+/i, "").replace(/\s+/g, " ").trim();
  return parsed.days ? { query, days: parsed.days } : { query };
}

export const PROMO_EXTEND_ASK =
  "На сколько дней продлить скидку? Например: «продли скидку на кроссовки на 7 дней» или «продли все скидки на неделю». Вся акция может идти не дольше 30 дней с запуска.";

export function promoExtendReply(command: PromoExtendCommand): string {
  if (command.ending) return "Проверю, какие скидки закончатся в течение суток, и покажу новые даты.";
  return `Проверю, какие скидки${command.query ? ` на «${command.query}»` : ""} можно продлить, и покажу новые даты.`;
}
