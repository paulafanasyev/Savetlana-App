/**
 * Напоминание тем, кто открыл кабинет продавца, но заявку так и не подал.
 * Запускается фоновой задачей (jobs.ts) раз в сутки. Одно сообщение на человека за всё
 * время: не раньше суток после открытия кабинета и не позже двух недель (потом уже не
 * кстати). Демо-магазинам и заблокированным не шлём. Дальше по обычным каналам
 * (notify): в кабинет, почту и Telegram, если они подключены.
 */
import { prisma } from "../prisma";
import { notify } from "./notifications";

const DAY = 86_400_000;
/** По этой ссылке отличаем напоминание от других и не шлём его повторно. */
export const APPLICATION_REMINDER_URL = "/seller/onboarding?from=reminder";
export const APPLICATION_REMINDER_AFTER_DAYS = 1;
export const APPLICATION_REMINDER_UNTIL_DAYS = 14;

export const APPLICATION_REMINDER_TEXT = {
  title: "До открытия магазина один шаг",
  body: "Укажите тип, название магазина и ИНН. Самозанятых одобряем сразу по данным ФНС, ИП и организации проверяет администратор. Товары можно готовить уже сейчас.",
} as const;

export async function sendApplicationReminders(options: { limit?: number; now?: Date } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const sellers = await prisma.sellerProfile.findMany({
    where: {
      NOT: { slug: { startsWith: "demo-" } },
      isActivated: false,
      createdAt: {
        lte: new Date(now.getTime() - APPLICATION_REMINDER_AFTER_DAYS * DAY),
        gte: new Date(now.getTime() - APPLICATION_REMINDER_UNTIL_DAYS * DAY),
      },
      verificationRecords: { none: { NOT: { source: "fns" } } },
      user: { isBlocked: false },
    },
    select: { userId: true },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 100,
  });
  let sent = 0;
  for (const s of sellers) {
    const already = await prisma.notification.findFirst({
      where: { userId: s.userId, kind: "reminder", url: APPLICATION_REMINDER_URL },
      select: { id: true },
    });
    if (already) continue;
    await notify({ userId: s.userId, kind: "reminder", title: APPLICATION_REMINDER_TEXT.title, body: APPLICATION_REMINDER_TEXT.body, url: APPLICATION_REMINDER_URL });
    sent += 1;
  }
  return sent;
}
