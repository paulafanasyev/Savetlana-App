/**
 * Документы по КП: договор поставки, счёт на оплату и УПД. Собираются из
 * подлинного КП (отпечаток условий сверяется) и реквизитов сторон, печатаются
 * из браузера в PDF.
 *
 * Честные ограничения:
 *   • оплата идёт через площадку (безопасная сделка), поэтому в счёте получатель
 *     платежа — оператор площадки как агент, а не расчётный счёт продавца;
 *     реквизиты оператора берутся из переменных окружения (legal.ts);
 *   • ставку НДС продавец на площадке не указывает: так и пишем;
 *   • реквизиты покупателя-организации площадка не хранит: поля оставлены
 *     для заполнения;
 *   • документы не подписаны: это проекты для подписи сторонами (ЭДО или
 *     на бумаге), что указано на каждом.
 */
import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { getLegalEntity, type LegalEntity } from "../legal";
import { QUOTE_TOOL, ordersForQuotes, parseQuote, quoteTermsText, type Quote } from "./b2b-quotes";

export type QuoteDocKind = "contract" | "invoice" | "upd";

export const QUOTE_DOC_LABEL: Record<QuoteDocKind, string> = {
  contract: "Договор поставки",
  invoice: "Счёт на оплату",
  upd: "УПД",
};

export type QuoteDocParty = { name: string; inn: string | null; ogrn: string | null; kind: string };

export type QuoteDocument = {
  kind: QuoteDocKind;
  title: string;
  number: string;
  date: Date;
  quote: Quote;
  orderNumber: string | null;
  seller: QuoteDocParty;
  buyer: { name: string; email: string };
  operator: LegalEntity;
  lines: { title: string; unit: string; quantity: number; priceKopecks: number; sumKopecks: number }[];
  totalKopecks: number;
  totalInWords: string;
  vatNote: string;
  termsNote: string;
  fingerprint: string;
  draft: boolean;
};

const SELLER_KIND: Record<string, string> = { COMPANY: "организация", IP: "индивидуальный предприниматель", SELF_EMPLOYED: "самозанятый", INDIVIDUAL: "частное лицо" };

// ---- Сумма прописью -------------------------------------------------------

const ONES_M = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const ONES_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const TEENS = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];

/** Форма слова для числа: 1 рубль, 2 рубля, 5 рублей. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return many;
  if (m10 === 1) return one;
  if (m10 >= 2 && m10 <= 4) return few;
  return many;
}

function triad(n: number, feminine: boolean): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  if (h) out.push(HUNDREDS[h]);
  if (t === 1) out.push(TEENS[o]);
  else {
    if (t) out.push(TENS[t]);
    if (o) out.push((feminine ? ONES_F : ONES_M)[o]);
  }
  return out;
}

/** 12345600 коп. → «Сто двадцать три тысячи четыреста пятьдесят шесть рублей 00 копеек». */
export function rublesInWords(kopecks: number): string {
  const total = Math.max(0, Math.round(kopecks));
  let rub = Math.floor(total / 100);
  const kop = total % 100;
  const groups: [string, string, string, boolean][] = [
    ["", "", "", false],
    ["тысяча", "тысячи", "тысяч", true],
    ["миллион", "миллиона", "миллионов", false],
    ["миллиард", "миллиарда", "миллиардов", false],
  ];
  const words: string[] = [];
  const rubForm = plural(rub, "рубль", "рубля", "рублей");
  if (rub === 0) words.push("ноль");
  for (let g = 0; rub > 0 && g < groups.length; g++) {
    const n = rub % 1000;
    rub = Math.floor(rub / 1000);
    if (n === 0) continue;
    const [one, few, many, fem] = groups[g];
    const part = triad(n, fem);
    if (g > 0) part.push(plural(n, one, few, many));
    words.unshift(...part);
  }
  const text = `${words.join(" ")} ${rubForm} ${String(kop).padStart(2, "0")} ${plural(kop, "копейка", "копейки", "копеек")}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---- Сборка документа -----------------------------------------------------

/**
 * Документ по КП для участника сделки. Отказ: КП нет, оно подделано, или
 * смотрит посторонний. Счёт и УПД только после оформления заказа; договор
 * доступен сразу (до подтверждения продавцом — как проект).
 */
export async function buildQuoteDocument(
  quoteId: string,
  kind: QuoteDocKind,
  viewer: { userId: string; sellerId?: string | null },
  now: Date = new Date()
): Promise<{ ok: true; doc: QuoteDocument } | { ok: false; reason: string }> {
  const row = await prisma.pendingAction.findFirst({
    where: { id: quoteId, toolName: QUOTE_TOOL },
    select: { id: true, args: true, argsHash: true, status: true, createdAt: true, expiresAt: true },
  });
  const quote = row ? parseQuote(row, now) : null;
  if (!row || !quote) return { ok: false, reason: "КП не найдено" };
  const isBuyer = quote.buyerId === viewer.userId;
  const isSeller = Boolean(viewer.sellerId) && quote.sellerId === viewer.sellerId;
  if (!isBuyer && !isSeller) return { ok: false, reason: "КП не найдено" };
  if (quote.status === "DECLINED" || quote.status === "EXPIRED") return { ok: false, reason: "КП отклонено или истекло: документы по нему не формируются" };
  if ((kind === "invoice" || kind === "upd") && quote.status !== "ORDERED") {
    return { ok: false, reason: "Счёт и УПД появятся после того, как покупатель оформит заказ по КП" };
  }

  const [seller, buyer, orders] = await Promise.all([
    prisma.sellerProfile.findUnique({ where: { id: quote.sellerId }, select: { displayName: true, inn: true, ogrn: true, sellerType: true } }),
    prisma.user.findUnique({ where: { id: quote.buyerId }, select: { name: true, email: true } }),
    ordersForQuotes([quote.id]),
  ]);
  const orderId = orders[quote.id];
  const order = orderId ? await prisma.order.findUnique({ where: { id: orderId }, select: { number: true } }) : null;

  const sum = quote.unitPriceKopecks * quote.quantity;
  const terms = quoteTermsText(quote).replace(/^; /, "");
  const doc: QuoteDocument = {
    kind,
    title: QUOTE_DOC_LABEL[kind],
    number: `${kind === "contract" ? "Д" : kind === "invoice" ? "СЧ" : "УПД"}-${quote.id.slice(-6).toUpperCase()}`,
    date: now,
    quote,
    orderNumber: order?.number ?? null,
    seller: { name: seller?.displayName ?? "продавец", inn: seller?.inn ?? null, ogrn: seller?.ogrn ?? null, kind: SELLER_KIND[seller?.sellerType ?? ""] ?? "продавец" },
    buyer: { name: buyer?.name ?? "покупатель", email: buyer?.email ?? "" },
    operator: getLegalEntity(),
    lines: [{ title: quote.title, unit: "шт", quantity: quote.quantity, priceKopecks: quote.unitPriceKopecks, sumKopecks: sum }],
    totalKopecks: sum,
    totalInWords: rublesInWords(sum),
    vatNote: "Ставка НДС продавцом на площадке не указана: уточните у продавца перед подписанием.",
    termsNote: terms || "поставка и оплата на условиях площадки (безопасная сделка)",
    fingerprint: createHash("sha256").update(row.args).digest("hex").slice(0, 16),
    draft: quote.status === "AWAITING_SELLER",
  };
  return { ok: true, doc };
}

export const rubFormat = (k: number) =>
  `${(Math.round(k) / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
