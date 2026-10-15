/**
 * Карточка товара прямо из чата со Светланой.
 *
 * Продавец пишет в чат «Создай карточку: кроссовки Nike Air Max 90, белые,
 * 42 размер, новые, 7990 ₽». Раньше черновик получал только название (вместе
 * с размером и цветом) и цену. Теперь сообщение разбирается тем же
 * составителем, что и блок «Светлана составит карточку сама»: цена, категория,
 * характеристики, ключевые слова и описание.
 *
 * Правило то же: ничего не выдумывать. То, что прислала модель, остаётся,
 * только если это есть в тексте продавца. Черновик покупатели не видят,
 * публикует его продавец.
 */
import { inventedNumbers, parseProductText, valueInText, type CategoryOption } from "./product-compose";

const MAX_ATTRS = 15;

const COMMAND =
  /^[\s\S]*?(?:созда(?:й|йте|ть)|сдела(?:й|йте|ть)|оформ(?:и|ите|ить)|вылож(?:и|ите|ить)|состав(?:ь|ьте|ить)|добав(?:ь|ьте|ить))\s+(?:мне\s+|пожалуйста\s+)?(?:нов(?:ую|ый|ое)\s+)?(?:карточк[а-яё]*|товар[а-яё]*|объявлени[а-яё]*)(?:\s+(?:товара|на|для))?\s*[:—–-]?\s*/i;

export interface ChatDraftSource {
  /** Текст о товаре без самой просьбы. */
  text: string;
  /** Продавец явно попросил создать карточку. */
  command: boolean;
}

/** «Светлана, создай карточку: чайник Bosch, 2990 ₽» → «чайник Bosch, 2990 ₽». */
export function chatDraftSource(message: string): ChatDraftSource | null {
  const raw = message.replace(/\r/g, "").trim();
  if (!raw) return null;
  const m = COMMAND.exec(raw);
  if (m) {
    const text = raw.slice(m[0].length).trim();
    return text.length >= 3 ? { text, command: true } : null;
  }
  return { text: raw, command: false };
}

const str = (v: unknown) => (typeof v === "string" ? v.replace(/[ \t]+/g, " ").trim() : "");

/**
 * Аргументы черновика: разбор текста продавца плюс проверенное из ответа
 * модели. Возвращает null, если в сообщении нет описания товара (например,
 * «да, давай»): тогда аргументы модели не трогаем.
 */
export function chatDraftArgs(args: Record<string, unknown>, source: ChatDraftSource, categories: CategoryOption[]): Record<string, unknown> | null {
  const text = source.text;
  const base = parseProductText(text, categories);
  const hasDetails = base.priceRub !== undefined || Object.keys(base.attributes).length > 0;
  if (!source.command && !hasDetails) return null;

  const modelTitle = str(args.title).slice(0, 120);
  // По явной просьбе название берём из текста: встроенный разбор и модель
  // часто тащат в название цену и все характеристики подряд.
  const title = source.command ? base.title || modelTitle : modelTitle.length >= 3 ? modelTitle : base.title;

  const modelDescription = typeof args.description === "string" ? args.description.trim() : "";
  const description =
    modelDescription.length >= 20 && modelDescription.length <= 4000 && inventedNumbers(modelDescription, text).length === 0
      ? modelDescription
      : base.description;

  const modelPrice = typeof args.priceRub === "number" ? args.priceRub : Number.NaN;
  const priceRub =
    base.priceRub ??
    (Number.isFinite(modelPrice) && modelPrice > 0 && inventedNumbers(String(modelPrice), text).length === 0 ? modelPrice : undefined);

  const slug = str(args.categorySlug);
  const categorySlug = categories.some((c) => c.slug === slug) ? slug : base.categorySlug;

  const attributes: Record<string, string> = { ...base.attributes };
  if (args.attributes && typeof args.attributes === "object" && !Array.isArray(args.attributes)) {
    for (const [k, v] of Object.entries(args.attributes as Record<string, unknown>)) {
      const key = str(k).slice(0, 40);
      const value = str(typeof v === "number" ? String(v) : v).slice(0, 100);
      if (!key || !value || Object.keys(attributes).length >= MAX_ATTRS) continue;
      const name = key.charAt(0).toUpperCase() + key.slice(1);
      // Числа сверяем целиком: «12 месяцев» не подтверждается словами «128 гб».
      const numbersOk = inventedNumbers(value, text).length === 0;
      if (!(name in attributes) && numbersOk && valueInText(value, text)) attributes[name] = value;
    }
  }

  const modelKeywords = Array.isArray(args.keywords)
    ? args.keywords.filter((k): k is string => typeof k === "string").map((k) => k.toLowerCase().trim()).filter((k) => k.length >= 2 && k.length <= 40)
    : [];
  const keywords = [...new Set([...base.keywords, ...modelKeywords])].slice(0, 15);

  const next: Record<string, unknown> = { ...args, title, description, keywords, attributes };
  if (priceRub !== undefined) next.priceRub = priceRub;
  else delete next.priceRub;
  if (categorySlug) next.categorySlug = categorySlug;
  else delete next.categorySlug;
  return next;
}

function rubles(n: number): string {
  return `${n.toLocaleString("ru-RU")} ₽`;
}

/** Что Светлана заполнила и чего не хватает для публикации. */
export function chatDraftReport(args: Record<string, unknown>, categoryName: string | null): string {
  const title = str(args.title);
  const price = typeof args.priceRub === "number" && args.priceRub > 0 ? args.priceRub : null;
  const attributes = args.attributes && typeof args.attributes === "object" ? Object.entries(args.attributes as Record<string, string>) : [];
  const filled: string[] = [];
  if (price) filled.push(`цена ${rubles(price)}`);
  if (categoryName) filled.push(`категория «${categoryName}»`);
  if (attributes.length) filled.push(`характеристики (${attributes.map(([k, v]) => `${k.toLowerCase()}: ${v}`).join(", ")})`);
  if (str(args.description)) filled.push("описание из ваших слов");

  const missing: string[] = [];
  if (!price) missing.push("цену");
  if (!categoryName) missing.push("категорию");
  missing.push("фото", "остаток");

  return [
    `Черновик «${title}» создан, покупатели его пока не видят.`,
    filled.length ? `Заполнила: ${filled.join("; ")}.` : "",
    `Добавьте ${missing.slice(0, -1).join(", ")} и ${missing[missing.length - 1]}: без них карточку опубликовать нельзя.`,
    "Черновик в кабинете продавца, раздел «Товары». Проверьте его и опубликуйте, когда всё будет готово.",
  ]
    .filter(Boolean)
    .join(" ");
}
