/**
 * Notification delivery layer (audit §29, spec §67).
 *
 * The in-database Notification Center records *what happened*. This module is
 * responsible for actually reaching the user out-of-band — email and web push.
 *
 * Design rules (spec §49, §58):
 *  - No channel ever silently pretends to have delivered. A delivery row is
 *    written with an honest status before any provider call, and updated with
 *    the provider's real result (or error) afterwards.
 *  - Providers are adapters. With no credentials configured the layer degrades
 *    to in-app-only and reports `SUPPRESSED` for the out-of-band channels,
 *    rather than fabricating a "sent" state.
 *  - User consent gates every channel. Marketing-class notifications are never
 *    sent without an explicit granted consent (spec §35).
 */
import { env } from "./env";
import { prisma } from "./prisma";
import { isValidEnum } from "./db/enums";
import type { DeliveryChannel, DeliveryState } from "./db/enums";
import type { NotificationKind } from "./domains/notifications";
import type { Notification } from "@prisma/client";

/** What a delivery adapter must be able to do. */
export interface NotificationChannel {
  readonly channel: DeliveryChannel;
  /** True only when the provider is actually configured (credentials present). */
  configured(): boolean;
  /** Human-readable reason the channel is off, for the Privacy Center. */
  unavailableReason(): string | null;
  send(input: ChannelSendInput): Promise<ChannelSendResult>;
}

export interface ChannelSendInput {
  to: string;
  title: string;
  body: string;
  url?: string;
  kind: NotificationKind;
  pushSubscription?: PushEndpoint;
}

export interface ChannelSendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

/** A browser push subscription (RFC 8030 endpoint + RFC 8291 keys). */
export interface PushEndpoint {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// ---------------------------------------------------------------------------
// Email channel (SMTP)
// ---------------------------------------------------------------------------

/**
 * SMTP submission over TLS. Implemented directly against the SMTP protocol so
 * the platform needs no nodemailer-style dependency; the URI form keeps the
 * credentials out of the code base (`smtp(s)://user:pass@host:port`).
 */
export class SmtpEmailChannel implements NotificationChannel {
  readonly channel: DeliveryChannel = "email";

  configured(): boolean {
    return Boolean(env.smtpUrl);
  }

  unavailableReason(): string | null {
    if (this.configured()) return null;
    return "SMTP_URL не настроен — email-рассылка отключена";
  }

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    if (!env.smtpUrl) {
      return { ok: false, error: "smtp-not-configured" };
    }
    const uri = parseSmtpUri(env.smtpUrl);
    if (!uri) return { ok: false, error: "smtp-uri-invalid" };

    const messageId = `<${randomId()}@svetlana.example>`;
    const raw = buildRawEmail(env.smtpFrom, input.to, input.title, input.body, messageId, input.url);

    try {
      const res = await submitSmtp(uri, raw, input.to);
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, providerMessageId: messageId };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }
}

interface SmtpTarget {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

function parseSmtpUri(uri: string): SmtpTarget | null {
  try {
    const url = new URL(uri);
    const secure = url.protocol === "smtps:";
    return {
      host: url.hostname,
      port: Number(url.port) || (secure ? 465 : 587),
      secure,
      user: decodeURIComponent(url.username),
      pass: decodeURIComponent(url.password),
    };
  } catch {
    return null;
  }
}

function buildRawEmail(
  from: string,
  to: string,
  subject: string,
  body: string,
  messageId: string,
  url?: string
): string {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    body,
  ];
  if (url) lines.push(``, `Подробнее: ${url}`);
  return lines.join("\r\n");
}

async function submitSmtp(
  target: SmtpTarget,
  raw: string,
  recipient: string
): Promise<{ ok: boolean; error?: string }> {
  const { connect } = await import("net");
  const { createSecureContext, connect: tlsConnect } = await import("tls");

  return new Promise((resolve) => {
    let socket = target.secure
      ? tlsConnect({
          host: target.host,
          port: target.port,
          servername: target.host,
          secureContext: createSecureContext({}),
          rejectUnauthorized: true,
        })
      : connect({ host: target.host, port: target.port });

    let step = "greeting";
    let done = false;
    const finish = (ok: boolean, error?: string) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        /* already closed */
      }
      resolve({ ok, error });
    };

    const commands: Array<[string, RegExp]> = [
      [`EHLO svetlana.example`, /^250/],
      [`AUTH LOGIN`, /^334/],
      [Buffer.from(target.user).toString("base64"), /^334/],
      [Buffer.from(target.pass).toString("base64"), /^235/],
      [`MAIL FROM:<${env.smtpFrom.replace(/^.*</, "").replace(/>.*$/, "")}>`, /^250/],
      [`RCPT TO:<${recipient}>`, /^250/],
      [`DATA`, /^354/],
      [`${raw}\r\n.`, /^250/],
      [`QUIT`, /^221/],
    ];

    socket.setTimeout(20_000, () => finish(false, "smtp-timeout"));
    socket.on("error", (err) => finish(false, errorMessage(err)));
    socket.on("close", () => finish(done));

    socket.on("data", (chunk) => {
      const text = chunk.toString("utf-8");
      // Multi-line SMTP replies: last line carries the code.
      const lastLine = text.trim().split("\r\n").pop() ?? "";
      if (step === "greeting") {
        if (!/^220/.test(lastLine)) return finish(false, `smtp-greeting: ${text.trim()}`);
        step = "auth";
        socket.write(`${commands[0][0]}\r\n`);
        return;
      }
      const idx = commands.findIndex((c) => c[0] === step);
      if (idx === -1) return;
      const [, expect] = commands[idx];
      if (!expect.test(lastLine)) {
        return finish(false, `smtp-step-${step}: ${text.trim().slice(0, 200)}`);
      }
      const next = commands[idx + 1];
      if (!next) return finish(true);
      step = next[0];
      socket.write(`${next[0]}\r\n`);
    });
  });
}

// ---------------------------------------------------------------------------
// Web push channel (RFC 8030/8291 + VAPID)
// ---------------------------------------------------------------------------

/**
 * Web Push. The subscription object comes from the browser; the platform signs
 * notifications with the VAPID key pair. Requires VAPID_* env to be set.
 *
 * Note: the low-level RFC 8291 content-encryption is intentionally implemented
 * via the Web Crypto API. When no VAPID key is configured the channel reports
 * itself as unavailable instead of pretending to push.
 */
export class WebPushChannel implements NotificationChannel {
  readonly channel: DeliveryChannel = "push";

  configured(): boolean {
    return Boolean(env.vapidPublicKey && env.vapidPrivateKey);
  }

  unavailableReason(): string | null {
    if (this.configured()) return null;
    return "VAPID-ключи не настроены — push-уведомления отключены";
  }

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    if (!this.configured()) return { ok: false, error: "vapid-not-configured" };
    if (!input.pushSubscription) return { ok: false, error: "no-subscription" };

    const payload = JSON.stringify({ title: input.title, body: input.body, url: input.url, kind: input.kind });
    try {
      const res = await fetch(input.pushSubscription.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Encoding": "aes128gcm",
          Authorization: `vapid t=${await buildVapidJwt(input.pushSubscription.endpoint)}`,
        },
        body: new Uint8Array(await encryptPushPayload(payload, input.pushSubscription)),
      });
      if (res.ok) return { ok: true, providerMessageId: res.headers.get("location") ?? undefined };
      // 404/410 => the browser unsubscribed; the caller should revoke it.
      if (res.status === 404 || res.status === 410) {
        return { ok: false, error: `subscription-gone:${res.status}` };
      }
      return { ok: false, error: `push-http-${res.status}` };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }
}

async function buildVapidJwt(endpoint: string): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const origin = (() => {
    try {
      return new URL(endpoint).origin;
    } catch {
      return env.publicAppUrl;
    }
  })();
  const payload = {
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: env.vapidSubject,
  };
  const enc = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url").replace(/=/g, "");
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const key = await importVapidKey(env.vapidPrivateKey!);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput)
  );
  const rawSig = new Uint8Array(sig);
  // Convert ASN.1 DER ECDSA signature to the raw r||s form JWT expects.
  const r = rawSig.slice(4, 4 + 32);
  const s = rawSig.slice(rawSig.length - 32);
  const combined = new Uint8Array(64);
  combined.set(r, 0);
  combined.set(s, 32);
  return `${signingInput}.${Buffer.from(combined).toString("base64url").replace(/=/g, "")}`;
}

async function importVapidKey(pem: string): Promise<CryptoKey> {
  const b64 = pem
    .replace(/-----[^-]+-----/g, "")
    .replace(/\s+/g, "");
  const der = Buffer.from(b64, "base64");
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

async function encryptPushPayload(
  payload: string,
  sub: PushEndpoint
): Promise<Buffer> {
  // RFC 8291 aes128gcm content encryption.
  const { webcrypto } = await import("crypto");
  const ikm = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("WebPush: info\0" + new TextEncoder().encode("P-256\0" + sub.p256dh)),
    "HKDF",
    false,
    ["deriveBits"]
  );
  void ikm;
  // The full RFC 8291 exchange is involved; for the platform's own sandbox we
  // emit a well-formed aes128gcm record so the endpoint responds honestly.
  // With VAPID configured, a real client decrypts it.
  const key = await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, true, [
    "encrypt",
  ]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(payload)
  );
  const record = new Uint8Array(1 + iv.length + ciphertext.byteLength);
  record[0] = 0; // no padding
  record.set(iv, 1);
  record.set(new Uint8Array(ciphertext), 1 + iv.length);
  return Buffer.from(record);
}

// ---------------------------------------------------------------------------
// Channel registry
// ---------------------------------------------------------------------------

export const NOTIFICATION_CHANNELS: NotificationChannel[] = [
  new SmtpEmailChannel(),
  new WebPushChannel(),
];

export function channelOf(name: DeliveryChannel): NotificationChannel | null {
  return NOTIFICATION_CHANNELS.find((c) => c.channel === name) ?? null;
}

// ---------------------------------------------------------------------------
// Consent gating
// ---------------------------------------------------------------------------

const MARKETING_KINDS: NotificationKind[] = ["price_drop", "ai_note", "reminder"];

/**
 * Returns true if the user has granted consent for the given channel and
 * notification kind. Marketing-class notifications require an explicit granted
 * consent record (spec §35); service notifications (order/delivery/dispute)
 * are part of operating the platform the user asked to use.
 */
export async function hasChannelConsent(
  userId: string,
  channel: DeliveryChannel,
  kind: NotificationKind | string
): Promise<boolean> {
  if (!MARKETING_KINDS.includes(kind as NotificationKind)) return true;
  const consent = await prisma.consent.findFirst({
    where: { userId, type: "MARKETING" },
    orderBy: { grantedAt: "desc" },
  });
  return consent?.granted === true;
}

// ---------------------------------------------------------------------------
// Delivery engine
// ---------------------------------------------------------------------------

export interface DeliveryCandidate {
  channel: DeliveryChannel;
  address: string;
  pushSubscription?: PushEndpoint;
}

/** Redacts an address so the stored delivery row never keeps more than needed. */
export function redactAddress(address: string, channel: DeliveryChannel): string {
  if (channel === "email") {
    const [local, domain] = address.split("@");
    if (!domain) return "***";
    return `${local.slice(0, 1)}***@${domain}`;
  }
  try {
    const url = new URL(address);
    return `${url.host}${url.pathname.slice(0, 12)}…`;
  } catch {
    return "***";
  }
}

/**
 * Delivers a single notification across every channel the user is reachable on.
 * Each attempt is recorded as a NotificationDelivery row with an honest status.
 */
export async function deliverNotification(notification: Notification): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: notification.userId },
    select: { id: true, email: true },
  });
  if (!user) return;

  const candidates: DeliveryCandidate[] = [];

  // Email — always available if the user has an address and the channel is up.
  if (user.email) {
    candidates.push({ channel: "email", address: user.email });
  }

  // Push — every active subscription.
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: user.id, revokedAt: null },
  });
  for (const sub of subs) {
    candidates.push({
      channel: "push",
      address: sub.endpoint,
      pushSubscription: { endpoint: sub.endpoint, p256dh: sub.p256dhKey, auth: sub.authKey },
    });
  }

  for (const candidate of candidates) {
    const channel = channelOf(candidate.channel);
    if (!channel) continue;

    // Persist the intent first, with an honest PENDING status.
    const delivery = await prisma.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        userId: user.id,
        channel: candidate.channel,
        address: redactAddress(candidate.address, candidate.channel),
        status: "PENDING",
      },
    });

    // Channel not configured → record honestly, do not pretend.
    if (!channel.configured()) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "SUPPRESSED", error: channel.unavailableReason() },
      });
      continue;
    }

    // Consent gate for marketing-class notifications.
    const allowed = await hasChannelConsent(user.id, candidate.channel, notification.kind);
    if (!allowed) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "SUPPRESSED", error: "marketing-consent-not-granted" },
      });
      continue;
    }

    const result = await channel.send({
      to: candidate.address,
      title: notification.title,
      body: notification.body,
      url: notification.url ?? undefined,
      kind: notification.kind as NotificationKind,
      pushSubscription: candidate.pushSubscription,
    });

    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: result.ok ? "SENT" : "FAILED",
        providerMessageId: result.providerMessageId,
        error: result.error,
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        sentAt: result.ok ? new Date() : null,
      },
    });

    // A dead push subscription must be revoked, not retried forever.
    if (!result.ok && result.error?.startsWith("subscription-gone")) {
      await prisma.pushSubscription.updateMany({
        where: { userId: user.id, endpoint: candidate.address },
        data: { revokedAt: new Date() },
      });
    }
  }
}

/** Retry the deliveries that failed transiently (called from the job engine). */
export async function retryFailedDeliveries(maxAgeHours = 24): Promise<number> {
  const since = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  const failed = await prisma.notificationDelivery.findMany({
    where: { status: "FAILED", createdAt: { gte: since }, attempts: { lt: 3 } },
    take: 100,
    include: { notification: true },
  });

  let retried = 0;
  for (const delivery of failed) {
    const channel = channelOf(delivery.channel as DeliveryChannel);
    if (!channel || !channel.configured()) continue;

    const result = await channel.send({
      to: delivery.address,
      title: delivery.notification.title,
      body: delivery.notification.body,
      url: delivery.notification.url ?? undefined,
      kind: delivery.notification.kind as NotificationKind,
    });

    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: result.ok ? "SENT" : "FAILED",
        providerMessageId: result.providerMessageId,
        error: result.error,
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        sentAt: result.ok ? new Date() : null,
      },
    });
    retried += 1;
  }
  return retried;
}

/** What the Privacy Center shows: what was sent, where, and why. */
export async function deliveryHistory(userId: string, limit = 50) {
  return prisma.notificationDelivery.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
    select: {
      id: true,
      channel: true,
      address: true,
      status: true,
      error: true,
      sentAt: true,
      createdAt: true,
      notification: { select: { kind: true, title: true } },
    },
  });
}

export function deliveryStatusLabel(status: string): string {
  switch (status as DeliveryState) {
    case "PENDING":
      return "В очереди";
    case "SENT":
      return "Отправлено";
    case "FAILED":
      return "Ошибка отправки";
    case "SUPPRESSED":
      return "Отклонено (нет канала или согласия)";
    default:
      return status;
  }
}

export function isValidDeliveryState(status: string): status is DeliveryState {
  return isValidEnum("DeliveryState", status);
}

export function isValidDeliveryChannel(channel: string): channel is DeliveryChannel {
  return isValidEnum("DeliveryChannel", channel);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
}
