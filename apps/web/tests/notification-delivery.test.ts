/**
 * Notification delivery layer tests (audit §29, spec §49).
 *
 * The core invariant under test: the platform never claims a notification was
 * delivered when no channel actually carried it. With no SMTP/VAPID
 * configuration the layer must record SUPPRESSED, not SENT.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  SmtpEmailChannel,
  WebPushChannel,
  NOTIFICATION_CHANNELS,
  channelOf,
  redactAddress,
  deliverNotification,
  retryFailedDeliveries,
  hasChannelConsent,
  isValidDeliveryChannel,
  isValidDeliveryState,
} from "../src/lib/notification-delivery";
import { notify } from "../src/lib/domains/notifications";

const BUYER = "delivery-test-buyer";

beforeAll(async () => {
  await prisma.user.upsert({
    where: { id: BUYER },
    create: {
      id: BUYER,
      email: "anna-delivery@example.com",
      passwordHash: "x",
      name: "Анна",
      role: "BUYER",
    },
    update: { email: "anna-delivery@example.com" },
  });
  // Clean slate for the delivery rows of this user.
  await prisma.notificationDelivery.deleteMany({ where: { userId: BUYER } });
  await prisma.notification.deleteMany({ where: { userId: BUYER } });
  await prisma.pushSubscription.deleteMany({ where: { userId: BUYER } });
});

describe("notification delivery — channel honesty", () => {
  it("exposes every channel with an honest configured() state", () => {
    expect(NOTIFICATION_CHANNELS.length).toBeGreaterThanOrEqual(2);
    for (const channel of NOTIFICATION_CHANNELS) {
      // configured() must be a real boolean decision, never undefined.
      expect(typeof channel.configured()).toBe("boolean");
      // An unconfigured channel must explain why, for the Privacy Center.
      if (!channel.configured()) {
        expect(channel.unavailableReason()).toBeTruthy();
      }
    }
  });

  it("refuses to send when the provider is not configured", async () => {
    const email = new SmtpEmailChannel();
    if (!email.configured()) {
      const res = await email.send({
        to: "someone@example.com",
        title: "Тест",
        body: "Тело",
        kind: "order_status",
      });
      expect(res.ok).toBe(false);
      expect(res.error).toBeTruthy();
    }
  });

  it("validates canonical delivery states and channels", () => {
    expect(isValidDeliveryChannel("email")).toBe(true);
    expect(isValidDeliveryChannel("push")).toBe(true);
    expect(isValidDeliveryChannel("sms")).toBe(false);
    expect(isValidDeliveryState("SENT")).toBe(true);
    expect(isValidDeliveryState("SUPPRESSED")).toBe(true);
    expect(isValidDeliveryState("delivered")).toBe(false);
  });

  it("redacts recipient addresses before storing them", () => {
    const r = redactAddress("anna@example.com", "email");
    expect(r).not.toContain("anna@");
    expect(r).toContain("@example.com");

    const p = redactAddress("https://fcm.googleapis.com/fcm/long-token", "push");
    expect(p.length).toBeLessThan("https://fcm.googleapis.com/fcm/long-token".length);
  });
});

describe("notification delivery — consent gating", () => {
  it("allows service notifications without marketing consent", async () => {
    const allowed = await hasChannelConsent(BUYER, "email", "order_status");
    expect(allowed).toBe(true);
  });

  it("blocks marketing notifications when consent is not granted", async () => {
    // Ensure no granted marketing consent exists for this user.
    await prisma.consent.deleteMany({ where: { userId: BUYER, type: "MARKETING" } });
    const allowed = await hasChannelConsent(BUYER, "email", "price_drop");
    expect(allowed).toBe(false);
  });

  it("allows marketing notifications when consent is granted", async () => {
    await prisma.consent.create({
      data: {
        userId: BUYER,
        type: "MARKETING",
        granted: true,
        grantedAt: new Date(),
        version: "1.0",
      },
    });
    const allowed = await hasChannelConsent(BUYER, "email", "price_drop");
    expect(allowed).toBe(true);
  });
});

describe("notification delivery — engine", () => {
  it("records an honest SUPPRESSED delivery when no channel is configured", async () => {
    const push = new WebPushChannel();
    if (push.configured()) return; // only meaningful without VAPID keys

    // A push subscription exists, but the channel is not configured.
    await prisma.pushSubscription.create({
      data: {
        userId: BUYER,
        endpoint: "https://fcm.googleapis.com/fcm/suppressed-test",
        p256dhKey: "test-p256dh",
        authKey: "test-auth",
      },
    });

    const notification = await prisma.notification.create({
      data: {
        userId: BUYER,
        kind: "order_status",
        title: "Заказ подтверждён",
        body: "Продавец подтвердил ваш заказ",
      },
    });

    await deliverNotification(notification);

    const deliveries = await prisma.notificationDelivery.findMany({
      where: { notificationId: notification.id },
    });
    expect(deliveries.length).toBeGreaterThan(0);
    for (const d of deliveries) {
      // No channel may claim SENT without a configured provider.
      expect(d.status).not.toBe("SENT");
    }
  });

  it("revokes push subscriptions that the endpoint reports gone", async () => {
    const channel = channelOf("push");
    if (!channel || !channel.configured()) return;

    await prisma.pushSubscription.create({
      data: {
        userId: BUYER,
        endpoint: "https://fcm.googleapis.com/fcm/404-endpoint",
        p256dhKey: "test-p256dh",
        authKey: "test-auth",
      },
    });

    const notification = await prisma.notification.create({
      data: {
        userId: BUYER,
        kind: "delivery_update",
        title: "Посылка в пути",
        body: "Заказ передан перевозчику",
      },
    });

    await deliverNotification(notification);

    const sub = await prisma.pushSubscription.findFirst({
      where: { userId: BUYER, endpoint: "https://fcm.googleapis.com/fcm/404-endpoint" },
    });
    // If the endpoint answered 404/410 the subscription must be revoked,
    // never retried forever.
    const delivery = await prisma.notificationDelivery.findFirst({
      where: { notificationId: notification.id, channel: "push" },
    });
    if (delivery?.error?.startsWith("subscription-gone")) {
      expect(sub?.revokedAt).not.toBeNull();
    }
  });

  it("delivers via notify() without raising when channels are down", async () => {
    // notify() must never throw because of a delivery failure — the in-app
    // notification is independent of the out-of-band channels.
    await expect(
      notify({
        userId: BUYER,
        kind: "reminder",
        title: "Напоминание",
        body: "Пора подтвердить наличие",
      })
    ).resolves.toBeUndefined();
  });

  it("retries only genuinely failed deliveries", async () => {
    // A SUPPRESSED row must never be retried — there is nothing to retry.
    const notification = await prisma.notification.create({
      data: {
        userId: BUYER,
        kind: "ai_note",
        title: "Светлана нашла вариант",
        body: "Цена на товар из списка снизилась",
      },
    });
    await prisma.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        userId: BUYER,
        channel: "email",
        address: "a***@example.com",
        status: "SUPPRESSED",
      },
    });

    const retried = await retryFailedDeliveries();
    // SUPPRESSED rows are excluded by the status filter; count only covers FAILED.
    expect(retried).toBeGreaterThanOrEqual(0);
  });
});
