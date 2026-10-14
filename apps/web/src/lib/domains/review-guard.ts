/**
 * Антифрод отзывов (шаг 3).
 *
 * Схемы, от которых защищаемся:
 * - продавец хвалит свой товар сам или со своих второстепенных аккаунтов;
 * - накрутка: пачка пятёрок за сутки от новых аккаунтов без покупки;
 * - «отзыв за кешбэк»: товар бесплатно или деньги назад за пять звёзд;
 * - конкуренты топят товар единицами с аккаунтов без покупок;
 * - один и тот же текст под разными аккаунтами;
 * - реклама, контакты и фишинговые ссылки внутри отзыва.
 *
 * block  — отзыв не принимается, автор видит причину;
 * hold   — отзыв сохраняется скрытым и ждёт модератора, в рейтинг не идёт;
 * ok     — публикуется сразу.
 * Модуль чистый: данные из базы ему передаёт вызывающий код.
 */
import { scanMessage } from "./scam-guard";

export type ReviewSeverity = "hold" | "block";

export interface ReviewFinding {
  code: string;
  severity: ReviewSeverity;
  reason: string;
}

export interface ReviewVerdict {
  verdict: "ok" | ReviewSeverity;
  findings: ReviewFinding[];
}

export interface RecentReview {
  rating: number;
  body: string;
  verifiedPurchase: boolean;
  /** Возраст аккаунта автора в днях на момент отзыва. */
  authorAgeDays: number;
  createdAt: Date;
}

export interface ReviewForScan {
  rating: number;
  body: string;
  verifiedPurchase: boolean;
  authorAgeDays: number;
  /** Сколько заказов у автора вообще было (любые статусы, кроме отменённых). */
  authorOrders: number;
  /** Автор и есть продавец этого товара. */
  authorIsSeller: boolean;
  /** Отзывы автора за последние сутки (до этого). */
  authorReviewsLast24h: number;
}

export interface ReviewScanContext {
  ownDomains?: string[];
  /** Отзывы на этот товар других авторов за последние 7 дней. */
  recentOnProduct?: RecentReview[];
  /** Тексты недавних отзывов на любые товары (для поиска одинаковых текстов). */
  recentTexts?: string[];
  now?: Date;
}

/** Новый аккаунт: моложе стольких дней. */
export const NEW_ACCOUNT_DAYS = 3;
/** Столько подозрительных отзывов одной тональности за сутки на товар считаем накруткой. */
export const BURST_THRESHOLD = 5;
/** Похожесть текстов (доля общих троек слов), начиная с которой тексты считаем копией. */
export const DUPLICATE_SIMILARITY = 0.7;

export function normalizeReviewText(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();
}

function shingles(text: string): Set<string> {
  const words = normalizeReviewText(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  if (words.length < 3) {
    if (words.length) out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

/** Похожесть двух текстов от 0 до 1 (коэффициент Жаккара по тройкам слов). */
export function textSimilarity(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  if (!sa.size || !sb.size) return 0;
  let common = 0;
  for (const s of sa) if (sb.has(s)) common++;
  return common / (sa.size + sb.size - common);
}

const INCENTIVE_RE =
  /((кешбэк|кэшбэк|кешбек|кэшбек|cashback|возврат денег|вернули деньги|вернут деньги|компенсаци\S*|бонус\S*|балл\S*|подарок|скидк\S*|оплатили|заплатили)[^.!?\n]{0,40}за (отзыв|оценк|5 звезд|пять звезд|пятерк)|за (отзыв|оценку|5 звезд|пять звезд|пятерку)[^.!?\n]{0,30}(вернули|вернут|заплатили|заплатят|получил|получила|дали|дадут|обещали|кешбэк|кэшбэк|деньги)|(получил|получила|достался|дали) (товар )?бесплатно за отзыв|товар (получил|получила|достался) бесплатно|оставьте отзыв[^.!?\n]{0,40}(получите|вернем|вернём))/;

export function scanReview(review: ReviewForScan, ctx: ReviewScanContext = {}): ReviewVerdict {
  const findings: ReviewFinding[] = [];
  const add = (code: string, severity: ReviewSeverity, reason: string) => {
    if (!findings.some((f) => f.code === code)) findings.push({ code, severity, reason });
  };
  const text = normalizeReviewText(review.body);
  const now = ctx.now ?? new Date();

  if (review.authorIsSeller) {
    add("SELF_REVIEW", "block", "Нельзя оставлять отзыв на собственный товар");
  }

  // Ссылки, карты, коды, контакты: отзыв не место для рекламы и мошенничества.
  for (const f of scanMessage(review.body, { ownDomains: ctx.ownDomains }).findings) {
    if (f.severity === "block") add(f.code, "block", f.reason);
    else if (["EXTERNAL_LINK", "MESSENGER_LURE", "MESSENGER_CONTACT", "EMAIL", "PHONE", "OFF_PLATFORM_PAYMENT", "CRYPTO"].includes(f.code)) {
      add("CONTACTS_IN_REVIEW", "hold", "В отзыве контакты или ссылка. Отзыв не должен рекламировать продавца или уводить с площадки");
    }
  }

  if (INCENTIVE_RE.test(text)) {
    add("INCENTIVIZED", "hold", "Похоже, за отзыв обещали деньги, кешбэк или товар бесплатно. Такие отзывы искажают рейтинг");
  }

  if (!review.verifiedPurchase && review.authorAgeDays < NEW_ACCOUNT_DAYS) {
    add("NEW_ACCOUNT_NO_PURCHASE", "hold", "Новый аккаунт без покупки этого товара");
  }
  if (!review.verifiedPurchase && review.authorOrders === 0 && (review.rating === 1 || review.rating === 5)) {
    add("NO_PURCHASE_EXTREME", "hold", "Крайняя оценка от человека без единой покупки на площадке: так накручивают рейтинг или топят конкурента");
  }
  if (review.authorReviewsLast24h >= 5) {
    add("AUTHOR_FLOOD", "hold", "Слишком много отзывов от одного человека за сутки");
  }

  // Одинаковые тексты: один автор под разными аккаунтами или купленные отзывы.
  const others = [...(ctx.recentOnProduct ?? []).map((r) => r.body), ...(ctx.recentTexts ?? [])];
  if (text.split(" ").length >= 4 && others.some((o) => textSimilarity(review.body, o) >= DUPLICATE_SIMILARITY)) {
    add("DUPLICATE_TEXT", "hold", "Такой же текст уже есть в другом отзыве");
  }

  // Накрутка: много подозрительных отзывов одной тональности за сутки.
  const polarity = (rating: number) => (rating >= 4 ? "pos" : rating <= 2 ? "neg" : null);
  const suspicious = (r: { verifiedPurchase: boolean; authorAgeDays: number }) => !r.verifiedPurchase || r.authorAgeDays < 7;
  const own = polarity(review.rating);
  if (own && suspicious(review)) {
    const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
    const burst =
      (ctx.recentOnProduct ?? []).filter((r) => r.createdAt.getTime() >= dayAgo && suspicious(r) && polarity(r.rating) === own).length + 1;
    if (burst >= BURST_THRESHOLD) {
      add(
        "REVIEW_BURST",
        "hold",
        own === "pos"
          ? "За сутки на товар пришло много хвалебных отзывов от новых аккаунтов или без покупки: похоже на накрутку"
          : "За сутки на товар пришло много плохих отзывов от новых аккаунтов или без покупки: похоже на атаку конкурентов"
      );
    }
  }

  const verdict: ReviewVerdict["verdict"] = findings.some((f) => f.severity === "block")
    ? "block"
    : findings.length
      ? "hold"
      : "ok";
  return { verdict, findings };
}

export function explainReview(v: ReviewVerdict): string {
  const target = v.verdict === "block" ? "block" : "hold";
  return v.findings.filter((f) => f.severity === target).slice(0, 2).map((f) => f.reason).join(". ");
}

/** Подписи кодов для модератора. */
export const REVIEW_FINDING_LABEL: Record<string, string> = {
  SELF_REVIEW: "Отзыв на свой товар",
  CONTACTS_IN_REVIEW: "Контакты или ссылка",
  INCENTIVIZED: "Отзыв за вознаграждение",
  NEW_ACCOUNT_NO_PURCHASE: "Новый аккаунт без покупки",
  NO_PURCHASE_EXTREME: "Крайняя оценка без покупок",
  AUTHOR_FLOOD: "Много отзывов за сутки",
  DUPLICATE_TEXT: "Повтор текста",
  REVIEW_BURST: "Волна отзывов",
  PHISHING_LINK: "Фишинговая ссылка",
  SHORT_LINK: "Сокращённая ссылка",
  PAYMENT_LINK: "Ссылка на оплату",
  CARD_NUMBER: "Номер карты",
  CARD_SECRET: "CVV карты",
  SMS_CODE: "Код из СМС",
  FAKE_PAYOUT: "«Получить деньги»",
  OFF_PLATFORM_PAYMENT: "Оплата напрямую",
};

/** Метка в hiddenReason для отзывов, ждущих модератора. */
export const REVIEW_MODERATION_PREFIX = "moderation:";
