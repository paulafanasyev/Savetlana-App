/**
 * Напоминание автору: срок объявления заканчивается (за 3 дня, когда уже можно
 * продлить). Запускается фоновой задачей (jobs.ts) раз в сутки. По одному
 * объявлению шлём не чаще раза в 7 дней, примерам от площадки не шлём совсем.
 * Уведомление попадает в кабинет и дальше по обычным каналам (notify): почта, Telegram.
 */
import { prisma } from "../prisma";
import { notify } from "./notifications";
import { DEMO_AUTHOR_EMAIL } from "../demo-classifieds";
import { RENEW_WINDOW_DAYS } from "../ad-active";
import { listingExpiryText, listingExpiryUrl } from "../listing-expiry-text";

const DAY = 86_400_000;
const COOLDOWN_MS = 7 * DAY;

export async function sendListingExpiryReminders(options: { limit?: number; now?: Date } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const ads = await prisma.classified.findMany({
    where: {
      status: "PUBLISHED",
      expiresAt: { gt: now, lte: new Date(now.getTime() + RENEW_WINDOW_DAYS * DAY) },
      author: { email: { not: DEMO_AUTHOR_EMAIL } },
    },
    select: { id: true, title: true, authorId: true, expiresAt: true },
    orderBy: { expiresAt: "asc" },
    take: options.limit ?? 100,
  });
  let sent = 0;
  for (const ad of ads) {
    if (!ad.expiresAt) continue;
    const url = listingExpiryUrl(ad.id);
    const recent = await prisma.notification.findFirst({
      where: { userId: ad.authorId, kind: "listing_expiring", url, createdAt: { gte: new Date(now.getTime() - COOLDOWN_MS) } },
      select: { id: true },
    });
    if (recent) continue;
    const text = listingExpiryText(ad.title, ad.expiresAt, now);
    await notify({ userId: ad.authorId, kind: "listing_expiring", title: text.title, body: text.body, url });
    sent += 1;
  }
  return sent;
}
