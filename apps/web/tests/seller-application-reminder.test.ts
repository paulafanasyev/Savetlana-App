import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";
import { APPLICATION_REMINDER_URL, sendApplicationReminders } from "../src/lib/domains/seller-application-reminder";

const W = process.env.VITEST_WORKER_ID ?? "0";
const DAY = 86_400_000;
const now = new Date();

const ids: Record<"old" | "fresh" | "demo" | "applied", string> = { old: "", fresh: "", demo: "", applied: "" };

async function seller(key: keyof typeof ids, slug: string, ageMs: number) {
  const email = `rem-${key}@${W}.test`;
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: `Напоминание ${key}`, role: "SELLER", passwordHash: await hashPassword("password123") },
    update: {},
  });
  const createdAt = new Date(now.getTime() - ageMs);
  const profile = await prisma.sellerProfile.upsert({
    where: { slug },
    create: { userId: user.id, slug, displayName: `Магазин ${key}`, isActivated: false, createdAt },
    update: { isActivated: false, createdAt },
  });
  ids[key] = user.id;
  return profile;
}

function reminders(userId: string) {
  return prisma.notification.count({ where: { userId, kind: "reminder", url: APPLICATION_REMINDER_URL } });
}

beforeAll(async () => {
  await seller("old", `rem-old-${W}`, 2 * DAY);
  await seller("fresh", `rem-fresh-${W}`, 60 * 60 * 1000);
  await seller("demo", `demo-rem-${W}`, 2 * DAY);
  const applied = await seller("applied", `rem-applied-${W}`, 2 * DAY);
  await prisma.verificationRecord.create({ data: { sellerId: applied.id, kind: "npd", status: "PENDING", source: "manual_review" } });
});

describe("напоминание подать заявку продавца", () => {
  it("шлёт только тому, кто открыл кабинет больше суток назад и заявку не подал", async () => {
    await sendApplicationReminders({ now, limit: 500 });
    expect(await reminders(ids.old)).toBe(1);
    expect(await reminders(ids.fresh)).toBe(0);
    expect(await reminders(ids.demo)).toBe(0);
    expect(await reminders(ids.applied)).toBe(0);
  });

  it("не повторяет напоминание", async () => {
    await sendApplicationReminders({ now, limit: 500 });
    await sendApplicationReminders({ now: new Date(now.getTime() + 3 * DAY), limit: 500 });
    expect(await reminders(ids.old)).toBe(1);
  });
});
