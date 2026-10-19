/**
 * «Поторгуйся за первый: 100 штук, хочу по 800 ₽, максимум 900»: разбор
 * просьбы о B2B-торге для встроенной Светланы (без внешней модели) и для
 * ссылок на уже показанные товары. Чистые функции без базы.
 */
import { termsFromText, type PaymentTerms } from "../negotiation-terms";

export const NEGOTIATE = /(?:поторгу|торгуйся|торговаться|договорись о цене|собери\S* (?:кп|предложени|цен)|запрос\S* (?:цен|кп|предложени)\S* (?:у|от) |тендер|аукцион|оптов\S* цен|цен\S* (?:за|на) парти|скидк\S* (?:за|на) (?:объ[её]м|парти)|коммерческ\S* предложен|(?:^|\s)КП(?:\s|[.,!?]|$))/i;

export function isNegotiationRequest(text: string): boolean {
  return NEGOTIATE.test(text);
}

const NUM = "(\\d[\\d\\s]*\\d|\\d)";
const QTY = new RegExp(NUM + "\\s*(?:шт|штук|единиц|ед\\.|pcs)", "i");
const TARGET = new RegExp("(?:по|хочу|хотим|цель|желательно|за)\\s*" + NUM + "(?!\\s*(?:шт|штук|единиц|%|\\d|дн|день|дня|раб|недел|месяц))\\s*(?:₽|руб|р\\b)?", "i");
const MAX = new RegExp("(?:максимум|макс\\.?|не (?:больше|дороже)|бюджет\\S*|потолок|до)\\s*" + NUM + "(?!\\s*(?:шт|штук|%|\\d|дн|день|дня|раб|недел|месяц))", "i");

function num(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s.replace(/\s/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const REF_WORDS = /^(?:перв|втор|трет|последн|этот|эту|этого|его|него|нее|неё|них|их|все|всех|нескольк|разн|продавц)/i;

/**
 * Что ищем, когда товар назван словами: «поторгуйся за перчатки рабочие: 100 шт»,
 * «собери КП на каски 50 штук». Ссылки «за первый», «за этот» товаром не считаем.
 */
export function negotiationQuery(text: string): string | undefined {
  const re = /(?:^|\s)(?:на|за|для)\s+([^\d:,.;!?()«»"]+?)(?=\s*[:,.;!?(]|\s+\d|\s+(?:у|от|по|до|максимум|хочу|нужно|надо|бюджет)\s|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const q = m[1].replace(/\s+/g, " ").trim();
    if (q.length < 3 || REF_WORDS.test(q) || /^(?:парти|объ[её]м|штук|шт)/i.test(q)) continue;
    return q.slice(0, 80);
  }
  return undefined;
}

export type NegotiationArgs = {
  quantity?: number;
  targetPriceRub?: number;
  maxPriceRub?: number;
  query?: string;
  leadDays?: number;
  payment?: PaymentTerms;
  deferralDays?: number;
  note: string;
};

/** Количество, желаемая цена, потолок бюджета (в рублях), товар, срок и оплата из текста. Чего нет, того нет. */
export function negotiationArgs(text: string): NegotiationArgs {
  const out: NegotiationArgs = { note: text.slice(0, 500), ...termsFromText(text) };
  const query = negotiationQuery(text);
  if (query !== undefined) out.query = query;
  const quantity = num(QTY.exec(text)?.[1]);
  const targetPriceRub = num(TARGET.exec(text)?.[1]);
  const maxPriceRub = num(MAX.exec(text)?.[1]);
  if (quantity !== undefined) out.quantity = quantity;
  if (targetPriceRub !== undefined) out.targetPriceRub = targetPriceRub;
  if (maxPriceRub !== undefined) out.maxPriceRub = maxPriceRub;
  return out;
}

export const NEGOTIATION_REPLY = "Запускаю торг: мой агент покупателя договаривается с агентом продавца в пределах его правил.";
