/**
 * Ссылки на карточки в ответах Светланы: товар, который она нашла, сравнила
 * или положила в корзину, в ответе становится ссылкой на его страницу.
 *
 * Ссылку ставим только на товар из результата инструмента этого же ответа,
 * а не на то, что модель назвала сама: так ссылка всегда ведёт на настоящую
 * карточку. Работает одинаково для встроенной Светланы и внешней модели.
 */
import { extractShownItems, type ShownItem } from "./references";
import { splitChatLinks, type ChatPart } from "../chat-links";

/** Инструменты, которые показывают покупателю опубликованные товары площадки. */
const PRODUCT_TOOLS = new Set([
  "search_products",
  "search_cheaper",
  "compare_products",
  "get_product",
  "get_reviews",
  "plan_gift",
  "cart_add",
  "wishlist_add",
  "check_inventory",
  "vision_search",
]);

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
/** Подпись ссылки в чате не длиннее 80 знаков (lib/chat-links.ts). */
const MAX_TITLE = 80;
const MAX_LINKS = 8;

interface StepLike {
  toolName: string;
  result: { ok: boolean };
}

/** Товары из успешных шагов этого ответа, без повторов. */
export function shownProducts(steps: StepLike[]): ShownItem[] {
  const out: ShownItem[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    if (!step.result.ok || !PRODUCT_TOOLS.has(step.toolName)) continue;
    for (const item of extractShownItems(JSON.stringify(step.result))) {
      if (seen.has(item.productId)) continue;
      seen.add(item.productId);
      out.push(item);
    }
  }
  return out;
}

export function productHref(productId: string): string {
  return `/product/${productId}`;
}

/** Первое упоминание каждого товара в тексте ответа становится ссылкой. */
export function linkProducts(answer: string, items: ShownItem[]): string {
  if (!items.length || !answer) return answer;
  const parts: ChatPart[] = splitChatLinks(answer);
  const linked = new Set(parts.flatMap((p) => ("href" in p ? [p.href] : [])));
  let added = 0;
  // Длинные названия первыми: «Чайник Bosch TWK» не должен съесть «Чайник Bosch TWK 3A».
  const ordered = [...items].sort((a, b) => b.title.length - a.title.length);
  for (const item of ordered) {
    if (added >= MAX_LINKS) break;
    const title = item.title.trim();
    if (title.length < 3 || title.length > MAX_TITLE || /[[\]()\n]/.test(title) || !SAFE_ID.test(item.productId)) continue;
    const href = productHref(item.productId);
    if (linked.has(href)) continue;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part || "href" in part) continue;
      const at = part.text.indexOf(title);
      if (at < 0) continue;
      parts.splice(i, 1, { text: part.text.slice(0, at) }, { text: title, href }, { text: part.text.slice(at + title.length) });
      linked.add(href);
      added++;
      break;
    }
  }
  return parts.map((p) => ("href" in p ? `[${p.text}](${p.href})` : p.text)).join("");
}

export function answerWithLinks(answer: string, steps: StepLike[]): string {
  return linkProducts(answer, shownProducts(steps));
}
