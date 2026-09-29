import { apiRoute } from "@/lib/api-helpers";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/domains/audit";
import { markOrderPaid } from "@/lib/domains/payments";

export const dynamic = "force-dynamic";

/**
 * Payment provider webhook (P0-7, spec §25/§50).
 *
 * The provider — not our own code — is the source of truth for whether money
 * arrived. Without this endpoint the platform could only learn about a
 * successful charge by polling, which is what made the sandbox the default.
 *
 * Security: the request must carry the provider's signing secret. Every
 * accepted event is recorded in an idempotency ledger keyed by the provider's
 * own event id, so a redelivery is acknowledged but never applied twice.
 */
export const POST = apiRoute(async (request) => {
  const secret = env.paymentWebhookSecret;
  if (!secret) {
    // An unconfigured deployment must not accept unsigned payment events.
    return Response.json({ error: "Webhooks не настроены", code: "not_configured" }, { status: 503 });
  }
  const signature = request.headers.get("x-payment-signature");
  const body = await request.text();
  const expected = await hmacHex(secret, body);
  if (!signature || !timingSafeEqual(signature, expected)) {
    return Response.json({ error: "Нет доступа", code: "bad_signature" }, { status: 401 });
  }

  const event = JSON.parse(body) as {
    event_id?: string;
    type?: string;
    data?: {
      order_id?: string;
      provider_ref?: string;
      status?: string;
      amount_kopecks?: number;
    };
  };

  if (!event.event_id || !event.data?.order_id) {
    return Response.json({ error: "Некорректное событие", code: "bad_event" }, { status: 400 });
  }

  // Idempotent processing: a redelivered event is acknowledged, not re-applied.
  const eventId = `payment:${event.event_id}`;
  const existing = await prisma.outboxMessage.findUnique({ where: { id: eventId } }).catch(() => null);
  if (existing) return Response.json({ ok: true, deduplicated: true });

  await prisma.outboxMessage.create({
    data: {
      id: eventId,
      aggregate: "payment-webhook",
      aggregateId: event.data.order_id,
      type: event.type ?? "PAYMENT_EVENT",
      payload: JSON.stringify(event),
    },
  });

  const order = await prisma.order.findUnique({
    where: { id: event.data.order_id },
    select: { id: true, status: true },
  });

  if (event.data.status === "SUCCEEDED" && order) {
    await markOrderPaid(order.id, false);
    // actorId null: the actor is the payment provider, not a User row. The FK
    // on AuditLog.actorId would otherwise reject the insert.
    await audit({
      actorRole: "system",
      action: "payment.webhook.captured",
      targetType: "Order",
      targetId: order.id,
      after: { providerRef: event.data.provider_ref, eventId: event.event_id },
    }).catch(() => undefined);
  }

  return Response.json({ ok: true });
});

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
