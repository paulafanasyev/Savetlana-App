/**
 * «Поторгуйся за первый: 100 штук, хочу по 800 ₽, максимум 900»: разбор
 * просьбы о B2B-торге для встроенной Светланы (без внешней модели) и для
 * ссылок на уже показанные товары. Чистые функции без базы.
 */

export const NEGOTIATE = /(?:поторгу|торгуйся|торговаться|договорись о цене|оптов\S* цен|цен\S* (?:за|на) парти|скидк\S* (?:за|на) (?:объ[её]м|парти)|коммерческ\S* предложен|(?:^|\s)КП(?:\s|[.,!?]|$))/i;

export function isNegotiationRequest(text: string): boolean {
  return NEGOTIATE.test(text);
}

const NUM = "(\\d[\\d\\s]*\\d|\\d)";
const QTY = new RegExp(NUM + "\\s*(?:шт|штук|единиц|ед\\.|pcs)", "i");
const TARGET = new RegExp("(?:по|хочу|хотим|цель|желательно|за)\\s*" + NUM + "(?!\\s*(?:шт|штук|единиц|%|\\d))\\s*(?:₽|руб|р\\b)?", "i");
const MAX = new RegExp("(?:максимум|макс\\.?|не (?:больше|дороже)|бюджет\\S*|потолок|до)\\s*" + NUM + "(?!\\s*(?:шт|штук|%|\\d))", "i");

function num(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s.replace(/\s/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Количество, желаемая цена и потолок бюджета (в рублях) из текста. Чего нет, того нет: не выдумываем. */
export function negotiationArgs(text: string): { quantity?: number; targetPriceRub?: number; maxPriceRub?: number; note: string } {
  const out: { quantity?: number; targetPriceRub?: number; maxPriceRub?: number; note: string } = { note: text.slice(0, 500) };
  const quantity = num(QTY.exec(text)?.[1]);
  const targetPriceRub = num(TARGET.exec(text)?.[1]);
  const maxPriceRub = num(MAX.exec(text)?.[1]);
  if (quantity !== undefined) out.quantity = quantity;
  if (targetPriceRub !== undefined) out.targetPriceRub = targetPriceRub;
  if (maxPriceRub !== undefined) out.maxPriceRub = maxPriceRub;
  return out;
}

export const NEGOTIATION_REPLY = "Запускаю торг: мой агент покупателя договаривается с агентом продавца в пределах его правил.";
