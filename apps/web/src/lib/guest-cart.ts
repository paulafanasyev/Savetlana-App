/**
 * Корзина гостя: пока человек не вошёл, отложенные товары хранятся в браузере.
 * После входа GuestCartSync переносит их в настоящую корзину.
 */
export interface GuestCartItem {
  productId: string;
  variantId?: string;
  quantity: number;
}

const KEY = "svetlana_guest_cart";
const MAX_ITEMS = 30;
const MAX_QTY = 99;

function valid(x: unknown): x is GuestCartItem {
  if (!x || typeof x !== "object") return false;
  const i = x as Record<string, unknown>;
  return typeof i.productId === "string" && i.productId.length > 0 && Number.isInteger(i.quantity) && (i.quantity as number) > 0 && (i.variantId === undefined || typeof i.variantId === "string");
}

/** Добавляет товар: тот же товар и вариант складываются в одну строку. */
export function mergeGuestItem(items: GuestCartItem[], item: GuestCartItem): GuestCartItem[] {
  const next = items.map((i) => ({ ...i }));
  const same = next.find((i) => i.productId === item.productId && (i.variantId ?? "") === (item.variantId ?? ""));
  if (same) same.quantity = Math.min(MAX_QTY, same.quantity + item.quantity);
  else next.push({ productId: item.productId, variantId: item.variantId || undefined, quantity: Math.min(MAX_QTY, item.quantity) });
  return next.slice(-MAX_ITEMS);
}

export function readGuestCart(): GuestCartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter(valid).slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

export function writeGuestCart(items: GuestCartItem[]): void {
  if (typeof window === "undefined") return;
  try {
    if (items.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // приватный режим браузера: просто не запоминаем
  }
}

export function addGuestItem(item: GuestCartItem): number {
  const next = mergeGuestItem(readGuestCart(), item);
  writeGuestCart(next);
  return next.reduce((s, i) => s + i.quantity, 0);
}
