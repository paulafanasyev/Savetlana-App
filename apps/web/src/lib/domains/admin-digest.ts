/**
 * Ежедневная сводка администраторам: что произошло за сутки и что ждёт решения.
 * Запускается фоновой задачей (jobs.ts). Не чаще раза в 20 часов на администратора;
 * если ничего не произошло, не шлётся совсем. Демо-магазины в счёт не идут.
 * Уходит в кабинет и дальше в Telegram и на почту, если они подключены.
 */
import { prisma } from "../prisma";
import { notify } from "./notifications";
import { listVerificationQueue } from "./admin";
import { digestText, type DigestCounts } from "../admin-digest-text";

const HOUR = 3_600_000;
export const ADMIN_DIGEST_URL = "/admin?from=digest";
const NOT_DEMO = { NOT: { slug: { startsWith: "demo-" } } };

/** Какие фоновые задачи упали при прошлом запуске (журнал jobs.run). */
async function lastJobFailures(): Promise<string[]> {
  const row = await prisma.auditLog.findFirst({ where: { action: "jobs.run" }, orderBy: { createdAt: "desc" }, select: { after: true } });
  if (!row?.after) return [];
  try {
    const parsed = typeof row.after === "string" ? JSON.parse(row.after) : row.after;
    const failures = (parsed as { failures?: unknown })?.failures;
    return Array.isArray(failures) ? failures.filter((f): f is string => typeof f === "string") : [];
  } catch {
    return [];
  }
}

export async function collectDigest(now: Date = new Date()): Promise<DigestCounts> {
  const since = new Date(now.getTime() - 24 * HOUR);
  const [newUsers, newSellers, applications, newProducts, orders, queue, jobFailures] = await Promise.all([
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.sellerProfile.count({ where: { ...NOT_DEMO, createdAt: { gte: since } } }),
    prisma.verificationRecord.count({ where: { source: "manual_review", status: "PENDING", createdAt: { gte: since }, sellerProfile: NOT_DEMO } }),
    prisma.product.count({ where: { status: "ACTIVE", createdAt: { gte: since }, sellerProfile: NOT_DEMO } }),
    prisma.order.count({ where: { createdAt: { gte: since } } }),
    listVerificationQueue(500).then((q) => q.length),
    lastJobFailures(),
  ]);
  return { newUsers, newSellers, applications, queue, newProducts, orders, jobFailures };
}

export async function sendAdminDigest(options: { now?: Date } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const text = digestText(await collectDigest(now));
  if (!text) return 0;
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isBlocked: false }, select: { id: true }, take: 20 });
  let sent = 0;
  for (const admin of admins) {
    const recent = await prisma.notification.findFirst({
      where: { userId: admin.id, kind: "reminder", url: ADMIN_DIGEST_URL, createdAt: { gte: new Date(now.getTime() - 20 * HOUR) } },
      select: { id: true },
    });
    if (recent) continue;
    await notify({ userId: admin.id, kind: "reminder", title: text.title, body: text.body, url: ADMIN_DIGEST_URL });
    sent += 1;
  }
  return sent;
}
