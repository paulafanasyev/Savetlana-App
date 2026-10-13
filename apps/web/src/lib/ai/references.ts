/**
 * Короткая память Светланы о том, что она только что показала: «сравни эти
 * два», «добавь первый в корзину», «а отзывы на второй?». Без этого каждое
 * сообщение понималось бы с нуля и «эти два» искались бы как товар.
 *
 * Чистые функции без базы: разбор ссылок и подстановка товаров в аргументы
 * инструментов. Сами показанные товары берутся из журнала вызовов
 * инструментов этого же разговора (master.ts).
 */
export interface ShownItem {
  productId: string;
  title: string;
}

export type ReferenceKind =
  | { kind: "count"; count: number }
  | { kind: "index"; index: number }
  | { kind: "all" };

const ORDINALS: [RegExp, number][] = [
  [/\bперв(?:ый|ого|ому|ым|ая|ую|ой|ое|ые)\b/i, 0],
  [/\bвтор(?:ой|ого|ому|ым|ая|ую|ое|ые)\b/i, 1],
  [/\bтрет(?:ий|ьего|ьему|ьим|ья|ью|ье|ьи)\b/i, 2],
  [/\bпоследн(?:ий|его|ему|им|яя|юю|ее|ие)\b/i, -1],
];

const COUNTS: [RegExp, number][] = [
  [/\b(?:эти|этих|все|оба|обе|обоих|обеих)\s+(?:два|две|двух|2)\b|\bоба\b|\bобе\b|\bобоих\b|\bобеих\b|\bэту пару\b/i, 2],
  [/\b(?:эти|этих|все)\s+(?:три|трёх|трех|3)\b/i, 3],
];

function has(re: RegExp, text: string): boolean {
  // Левая граница: не буква перед совпадением; правая: не буква после.
  const source = re.source.replace(/\\b/g, "(?:(?<![а-яёa-z0-9])|(?![а-яёa-z0-9]))");
  return new RegExp(source, re.flags).test(text);
}

/** Есть ли в сообщении ссылка на уже показанные товары и какая. */
export function detectReference(text: string): ReferenceKind | null {
  const t = text.toLowerCase().replace(/ё/g, "е");
  for (const [re, count] of COUNTS) if (has(re, t)) return { kind: "count", count };
  for (const [re, index] of ORDINALS) if (has(re, t)) return { kind: "index", index };
  if (has(/\b(?:их|эти|этих|из них)\b/i, t)) return { kind: "all" };
  // «Его», «этот» понимаем как ссылку только в короткой фразе: «его в корзину», «а этот дешевле?».
  const words = t.split(/\s+/).filter(Boolean).length;
  if (words <= 6 && has(/\b(?:этот|эту|этого|его|ее|него|нее|этой)\b/i, t)) return { kind: "index", index: 0 };
  return null;
}

export function pickItems(shown: ShownItem[], ref: ReferenceKind): ShownItem[] {
  if (shown.length === 0) return [];
  if (ref.kind === "index") {
    const i = ref.index < 0 ? shown.length + ref.index : ref.index;
    return shown[i] ? [shown[i]] : [];
  }
  if (ref.kind === "count") return shown.slice(0, ref.count);
  return shown.slice(0, 4);
}

/** Достаёт товары из сохранённого результата инструмента (даже обрезанного). */
export function extractShownItems(output: string): ShownItem[] {
  const items: ShownItem[] = [];
  const seen = new Set<string>();
  const re = /"productId":"([^"\\]{1,80})","title":"((?:[^"\\]|\\.){1,300})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    if (seen.has(m[1])) continue;
    let title = m[2];
    try { title = JSON.parse(`"${m[2]}"`) as string; } catch { /* оставляем как есть */ }
    seen.add(m[1]);
    items.push({ productId: m[1], title });
    if (items.length >= 12) break;
  }
  return items;
}

const SINGLE_PRODUCT_TOOLS = new Set(["get_product", "get_reviews", "cart_add", "wishlist_add", "search_cheaper", "check_inventory"]);

/**
 * Подставляет показанные товары в аргументы, если пользователь сослался на
 * них, а модель передала текст вместо идентификатора.
 */
export function resolveToolArgs(toolName: string, args: Record<string, unknown>, message: string, shown: ShownItem[]): Record<string, unknown> {
  if (shown.length === 0) return args;
  const ref = detectReference(message);
  if (!ref) return args;
  if (toolName === "compare_products") {
    const ids = Array.isArray(args.productIds) ? args.productIds.filter((x) => typeof x === "string") : [];
    if (ids.length >= 2) return args;
    const picked = pickItems(shown, ref.kind === "index" ? { kind: "all" } : ref);
    if (picked.length < 2) return args;
    const next: Record<string, unknown> = { ...args, productIds: picked.map((p) => p.productId) };
    delete next.query;
    return next;
  }
  if (SINGLE_PRODUCT_TOOLS.has(toolName)) {
    if (typeof args.productId === "string" && shown.some((s) => s.productId === args.productId)) return args;
    // Модель уже передала настоящий идентификатор, а не текст: не трогаем.
    if (typeof args.productId === "string" && /^[a-z0-9_-]{8,}$/i.test(args.productId)) return args;
    const picked = pickItems(shown, ref.kind === "index" ? ref : { kind: "index", index: 0 });
    if (picked.length !== 1) return args;
    const next: Record<string, unknown> = { ...args, productId: picked[0].productId };
    delete next.query;
    return next;
  }
  return args;
}

/**
 * Прямое действие по ссылке на показанные товары: «сравни эти два», «добавь
 * второй в корзину», «отзывы на первый», «подробнее про третий».
 */
export function planReferenceAction(message: string, shown: ShownItem[]): { tool: string; args: Record<string, unknown>; label: string } | null {
  if (shown.length === 0) return null;
  const ref = detectReference(message);
  if (!ref) return null;
  const t = message.toLowerCase().replace(/ё/g, "е");
  if (/сравн|чем отлича|разниц|какой лучше|что лучше/.test(t)) {
    const picked = pickItems(shown, ref.kind === "index" ? { kind: "all" } : ref);
    if (picked.length < 2) return null;
    return { tool: "compare_products", args: { productIds: picked.map((p) => p.productId) }, label: `Сравниваю: ${picked.map((p) => `«${p.title}»`).join(", ")}.` };
  }
  const single = pickItems(shown, ref.kind === "index" ? ref : { kind: "index", index: 0 });
  if (single.length !== 1 || ref.kind !== "index") return null;
  const item = single[0];
  if (/в корзин|добав|положи|беру|возьму|куплю|купить/.test(t)) {
    return { tool: "cart_add", args: { productId: item.productId, quantity: 1 }, label: `Добавляю «${item.title}» в корзину.` };
  }
  if (/отзыв|что пишут|что говорят|плюсы|минусы/.test(t)) {
    return { tool: "get_reviews", args: { productId: item.productId }, label: `Смотрю отзывы на «${item.title}».` };
  }
  if (/в избранн|в желани|отлож/.test(t)) {
    return { tool: "wishlist_add", args: { productId: item.productId }, label: `Добавляю «${item.title}» в список желаний.` };
  }
  if (/дешевле|подешевле|аналог/.test(t)) {
    return { tool: "search_cheaper", args: { productId: item.productId }, label: `Ищу дешевле, чем «${item.title}».` };
  }
  if (/подробн|расскаж|характеристик|покажи|что за|наличи/.test(t)) {
    return { tool: "get_product", args: { productId: item.productId }, label: `Открываю «${item.title}».` };
  }
  return null;
}

/** Подсказка внешней модели: что пользователь видел на экране. */
export function shownContext(shown: ShownItem[]): string {
  return (
    "Недавно показанные пользователю товары (по порядку): " +
    shown.slice(0, 6).map((s, i) => `${i + 1}) «${s.title}» productId=${s.productId}`).join("; ") +
    ". Если пользователь пишет «первый», «эти два», «его» и т. п., речь о них: передавай их productId."
  );
}

/**
 * Из нескольких последних показанных списков (новые первыми) выбирает тот, о
 * котором речь: для «сравни эти два» нужен список, а не одна открытая карточка.
 */
export function chooseShown(lists: ShownItem[][], message: string): ShownItem[] {
  if (lists.length === 0) return [];
  const ref = detectReference(message);
  const wantsMany = (ref !== null && ref.kind !== "index") || /сравн|чем отлича|разниц|лучше/i.test(message);
  if (wantsMany) return lists.find((l) => l.length >= 2) ?? lists[0];
  return lists[0];
}
