import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { retryFailedDeliveries, type ChannelSendInput, type NotificationChannel } from "../src/lib/notification-delivery";

function fakeEmail(sent: ChannelSendInput[], ok = true): NotificationChannel {
  return {
    channel: "email",
    configured: () => true,
    unavailableReason: () => null,
    send: async (input) => {
      sent.push(input);
      return ok ? { ok: true, providerMessageId: "<test>" } : { ok: false, error: "smtp-timeout" };
    },
  };
}

async function failedEmail(userId: string, kind: string, title: string) {
  const notification = await prisma.notification.create({ data: { userId, kind, title, body: "Тело письма" } });
  return prisma.notificationDelivery.create({
    data: { notificationId: notification.id, userId, channel: "email", address: "p***@example.ru", status: "FAILED", attempts: 1, error: "smtp-timeout" },
  });
}

describe("повтор неотправленных писем", () => {
  it("шлёт на настоящий адрес из аккаунта, а не на замаскированный", async () => {
    const tag = `retry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const user = await prisma.user.create({ data: { email: `${tag}@example.ru`, passwordHash: "x" } });
    const row = await failedEmail(user.id, "security", `Сброс пароля ${tag}`);

    const sent: ChannelSendInput[] = [];
    await retryFailedDeliveries(24, { emailChannel: fakeEmail(sent) });

    const mine = sent.filter((s) => s.title === `Сброс пароля ${tag}`);
    expect(mine).toHaveLength(1);
    expect(mine[0].to).toBe(`${tag}@example.ru`);
    const after = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ status: "SENT", attempts: 2, address: "p***@example.ru" });
  });

  it("после трёх неудач больше не повторяет", async () => {
    const tag = `retry3-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const user = await prisma.user.create({ data: { email: `${tag}@example.ru`, passwordHash: "x" } });
    const row = await failedEmail(user.id, "order_status", `Заказ ${tag}`);
    const sent: ChannelSendInput[] = [];
    await retryFailedDeliveries(24, { emailChannel: fakeEmail(sent, false) });
    await retryFailedDeliveries(24, { emailChannel: fakeEmail(sent, false) });
    await retryFailedDeliveries(24, { emailChannel: fakeEmail(sent, false) });
    expect(sent.filter((s) => s.title === `Заказ ${tag}`)).toHaveLength(2);
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "FAILED", attempts: 3 });
  });

  it("рекламное письмо без согласия не повторяет", async () => {
    const tag = `retrym-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const user = await prisma.user.create({ data: { email: `${tag}@example.ru`, passwordHash: "x" } });
    const row = await failedEmail(user.id, "price_drop", `Цена снизилась ${tag}`);
    const sent: ChannelSendInput[] = [];
    await retryFailedDeliveries(24, { emailChannel: fakeEmail(sent) });
    expect(sent.filter((s) => s.title === `Цена снизилась ${tag}`)).toHaveLength(0);
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "SUPPRESSED" });
  });
});
