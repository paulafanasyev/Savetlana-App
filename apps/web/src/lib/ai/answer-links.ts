/**
 * Ссылки на карточки в ответах Светланы: товар, который она нашла, сравнила
 * или положила в корзину, в ответе становится ссылкой на его страницу.
 *
 * Ссылку ставим только на товар из результата инструмента этого же ответа,
 * а не на то, что модель назвала сама: так ссылка всегда ведёт на настоящую
 * карточку. Работает одинаково для встроенной Светланы и внешней модели.
 * Товары из акций продавца (запуск и снятие скидки) тоже получают ссылки.
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
  result: { ok: boolean; data?: unknown };
}

/** Подтверждённые действия, после которых у товара есть открытая карточка. */
const OPENS_PRODUCT = new Set(["publish_product"]);

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

/** Акции продавца: товары, на которые скидку запустили или сняли. */
const PROMO_TOOLS: Record<string, string> = { start_promotion: "started", end_promotion: "endedItems", extend_promotion: "extended" };
/** Раздел «Акции»: там все товары со скидкой, даже те, что не влезли в ответ. */
export const PROMO_PAGE = "/seller/promotions";

function isPromoTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROMO_TOOLS, name);
}

/** Товары из успешных запусков и снятий скидки в этом ответе. */
export function promoProducts(steps: StepLike[]): ShownItem[] {
  const out: ShownItem[] = [];
  for (const step of steps) {
    if (!step.result.ok || !isPromoTool(step.toolName)) continue;
    const key = PROMO_TOOLS[step.toolName];
    const data = step.result.data;
    if (!data || typeof data !== "object") continue;
    const list = (data as Record<string, unknown>)[key];
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      const { id, title } = row as Record<string, unknown>;
      if (typeof id === "string" && typeof title === "string") out.push({ productId: id, title });
    }
  }
  return out;
}

export function answerWithLinks(answer: string, steps: StepLike[]): string {
  const items = shownProducts(steps);
  const seen = new Set(items.map((i) => i.productId));
  for (const item of promoProducts(steps)) {
    if (seen.has(item.productId)) continue;
    seen.add(item.productId);
    items.push(item);
  }
  return linkProducts(answer, items);
}

function productIdOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const id = (data as Record<string, unknown>).productId;
  return typeof id === "string" && SAFE_ID.test(id) ? id : null;
}

/**
 * Ответ после кнопки «Подтвердить действие»: те же ссылки на товары, а после
 * публикации ещё и ссылка на саму карточку, чтобы продавец сразу её увидел.
 * После запуска, продления или снятия скидки добавляем ссылку на раздел «Акции»: в ответе
 * показаны не больше пяти товаров, а там видны все.
 */
export function confirmedAnswerWithLinks(answer: string, steps: StepLike[]): string {
  let text = answerWithLinks(answer, steps);
  for (const step of steps) {
    if (!step.result.ok || !OPENS_PRODUCT.has(step.toolName)) continue;
    const id = productIdOf(step.result.data);
    if (!id) continue;
    const href = productHref(id);
    if (text.includes(`](${href})`)) continue;
    text = `${text} [Открыть карточку](${href})`;
  }
  const promo = steps.some((step) => step.result.ok && isPromoTool(step.toolName));
  if (promo && !text.includes(`](${PROMO_PAGE})`)) text = `${text}\n[Все товары со скидкой](${PROMO_PAGE})`;
  return text;
}
