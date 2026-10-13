/** Когда предупреждать продавца об остатке. Чистые правила для тестов. */
export const LOW_STOCK_THRESHOLD = 3;
/** Одно и то же предупреждение по товару не чаще раза в три дня. */
export const STOCK_ALERT_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

export type StockLevel = "out" | "low";

export function stockLevel(quantity: number): StockLevel | null {
  if (quantity <= 0) return "out";
  if (quantity <= LOW_STOCK_THRESHOLD) return "low";
  return null;
}

/** Ссылка служит ключом повтора: отдельные ключи для «мало» и «закончился». */
export function stockAlertUrl(productId: string, level: StockLevel): string {
  return `/seller/products/${productId}/edit#stock-${level}`;
}

export function stockAlertText(title: string, quantity: number, level: StockLevel): { title: string; body: string } {
  if (level === "out") {
    return {
      title: `Закончился товар «${title}»`,
      body: "Покупатели больше не могут его заказать. Пополните остаток в карточке или в массовом редактировании, и товар снова появится в продаже.",
    };
  }
  return {
    title: `Заканчивается «${title}»: осталось ${quantity} шт.`,
    body: "Пополните остаток заранее, чтобы не потерять покупателей. Это можно сделать в карточке товара или сразу для многих товаров в массовом редактировании.",
  };
}
