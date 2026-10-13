/**
 * Предупреждения продавцу «товар заканчивается» и «товар закончился».
 * Запускается фоновой задачей (jobs.ts) и не шлёт одно и то же чаще раза в
 * три дня.
 */
import { prisma } from "../prisma";
import { notify } from "./notifications";
import { LOW_STOCK_THRESHOLD, STOCK_ALERT_COOLDOWN_MS, stockAlertText, stockAlertUrl, stockLevel } from "./stock-rules";

export async function sendLowStockAlerts(options: { limit?: number; now?: Date } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const products = await prisma.product.findMany({
    where: { status: "ACTIVE", inventory: { is: { quantity: { lte: LOW_STOCK_THRESHOLD } } } },
    select: { id: true, title: true, inventory: { select: { quantity: true } }, sellerProfile: { select: { userId: true } } },
    take: options.limit ?? 100,
  });
  let sent = 0;
  for (const product of products) {
    const quantity = product.inventory?.quantity ?? 0;
    const level = stockLevel(quantity);
    if (!level) continue;
    const url = stockAlertUrl(product.id, level);
    const recent = await prisma.notification.findFirst({
      where: { userId: product.sellerProfile.userId, url, createdAt: { gte: new Date(now.getTime() - STOCK_ALERT_COOLDOWN_MS) } },
      select: { id: true },
    });
    if (recent) continue;
    const text = stockAlertText(product.title, quantity, level);
    await notify({ userId: product.sellerProfile.userId, kind: "stock_low", title: text.title, body: text.body, url });
    sent += 1;
  }
  return sent;
}
