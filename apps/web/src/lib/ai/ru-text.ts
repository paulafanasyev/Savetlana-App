/**
 * Последняя проверка текста, который видит человек: служебные коды и
 * английские термины заменяются русскими словами. Применяется к ответам
 * инструментов Светланы и к текстам аналитики продавца.
 */
import { availabilityLabels, orderStatusLabels, paymentStatusLabels, productStatusLabels } from "../labels";

const PHRASES: [RegExp, string][] = [
  [/с низким health score/gi, "с низкой оценкой качества"],
  [/health score:?/gi, "Качество карточки:"],
  [/health report/gi, "отчёт о качестве"],
  [/(?<![A-Za-z])health (\d{1,3})\/100/gi, "качество $1/100"],
  [/Требуются credentials:/g, "Нужны ключи доступа:"],
  [/(?<![A-Za-z])credentials(?![A-Za-z])/gi, "ключи доступа"],
  [/режиме sandbox/gi, "тестовом режиме"],
  [/Pricing Agent/g, "помощника по ценам"],
];

/** Коды с подчёркиванием не встречаются в обычном тексте, их меняем везде. */
const TECH_CODES: Record<string, string> = {
  PENDING_EXTERNAL_ACCESS: "ждёт подключения доступа",
  NOT_PROVEN: "не подтверждено",
  OUT_OF_STOCK: "нет в наличии",
  inventory_low: "заканчивается остаток",
  availability_expiring: "истекает срок размещения",
  new_review: "новый отзыв",
  competitor_price_drop: "конкурент снизил цену",
  notify_seller: "напомнить вам",
  draft_review_reply: "подготовить ответ на отзыв",
  ask_renew: "предложить продление",
  company_doc: "документы компании",
  product_doc: "документ на товар",
};

const DOC_KINDS: Record<string, string> = {
  company_doc: "документы компании",
  certificate: "сертификат",
  declaration: "декларация",
  license: "лицензия",
  product_doc: "документ на товар",
};

/** Статусы меняем только после слов «статус», «наличие»: в названиях товаров бывает «LIMITED» и т. п. */
const STATUS_CODES: Record<string, string> = {};
for (const map of [paymentStatusLabels, orderStatusLabels, productStatusLabels, availabilityLabels]) {
  for (const [code, label] of Object.entries(map)) STATUS_CODES[code] = label.charAt(0).toLowerCase() + label.slice(1);
}

function alternation(keys: string[]): string {
  return keys.sort((a, b) => b.length - a.length).join("|");
}

const TECH_RE = new RegExp(`(?<![A-Za-z0-9_])(${alternation(Object.keys(TECH_CODES))})(?![A-Za-z0-9_])`, "g");
const STATUS_RE = new RegExp(`((?:статус|наличи|состояни|подтвержден|оплат)[а-яё]*(?:[^:\\n.]{0,60}:)?\\s+)(${alternation(Object.keys(STATUS_CODES))})(?![A-Za-z0-9_])`, "gi");
const DOCS_RE = new RegExp(`(документ[а-яё]*:\\s*)((?:${alternation(Object.keys(DOC_KINDS))})(?:\\s*,\\s*(?:${alternation(Object.keys(DOC_KINDS))}))*)`, "gi");

export function ruText(text: string): string;
export function ruText(text: string | undefined): string | undefined;
export function ruText(text: string | undefined): string | undefined {
  if (!text) return text;
  let out = text;
  for (const [re, to] of PHRASES) out = out.replace(re, to);
  out = out.replace(DOCS_RE, (_m, head: string, list: string) => head + list.split(/\s*,\s*/).map((k) => DOC_KINDS[k] ?? k).join(", "));
  out = out.replace(STATUS_RE, (_m, head: string, code: string) => head + (STATUS_CODES[code] ?? code));
  return out.replace(TECH_RE, (code) => TECH_CODES[code] ?? code);
}
