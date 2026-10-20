import { apiRoute } from "@/lib/api-helpers";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { applyVerifiedPayment, type VerifiedStatus } from "@/lib/domains/payment-webhooks";

export const dynamic = "force-dynamic";

/** Платёжный партнёр общего вида (PAYMENT_PROVIDER_*): его ключ в таблице платежей. */
const PARTNER_KEY = "partner-payment";

function mapStatus(raw: string | undefined): VerifiedStatus {
  const s = (raw ?? "").toUpperCase();
  if (s === "SUCCEEDED") return "SUCCEEDED";
  if (s === "FAILED" || s === "CANCELED" || s === "CANCELLED") return "FAILED";
  return "PENDING";
}

/**
 * Webhook платёжного партнёра общего вида (P0-7, spec §25/§50).
 *
 * Подпись проверяется общим секретом. Но одной подписи мало: заказ становится
 * оплаченным, только если у него уже есть наш платёж у этого же партнёра с тем же
 * номером операции и сумма совпадает с суммой заказа. Это та же проверка, что у
 * ЮKassa, Т-Банка, Сбера и Альфы (applyVerifiedPayment): двойная оплата и оплата
 * отменённого заказа обрабатываются там же. Повтор события не применяется дважды.
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

  let event: {
    event_id?: string;
    type?: string;
    data?: {
      order_id?: string;
      provider_ref?: string;
      status?: string;
      amount_kopecks?: number;
    };
  };
  try {
    event = JSON.parse(body);
  } catch {
    return Response.json({ error: "Некорректное событие", code: "bad_event" }, { status: 400 });
  }

  if (!event.event_id || !event.data?.order_id || !event.data.provider_ref) {
    return Response.json({ error: "Некорректное событие", code: "bad_event" }, { status: 400 });
  }

  // Idempotent processing: a redelivered event is acknowledged, not re-applied.
  const eventId = `payment:${event.event_id}`.slice(0, 190);
  const existing = await prisma.outboxMessage.findUnique({ where: { id: eventId } }).catch(() => null);
  if (existing) return Response.json({ ok: true, deduplicated: true });

  try {
    await prisma.outboxMessage.create({
      data: {
        id: eventId,
        aggregate: "payment-webhook",
        aggregateId: event.data.order_id,
        type: (event.type ?? "PAYMENT_EVENT").slice(0, 120),
        payload: body.slice(0, 8000),
        status: "PROCESSED",
        processedAt: new Date(),
      },
    });
  } catch {
    return Response.json({ ok: true, deduplicated: true });
  }

  const status = mapStatus(event.data.status);
  if (status === "PENDING") return Response.json({ ok: true, ignored: true });

  const amount = Number(event.data.amount_kopecks);
  const result = await applyVerifiedPayment({
    providerKey: PARTNER_KEY,
    providerRef: String(event.data.provider_ref).slice(0, 190),
    orderId: event.data.order_id,
    status,
    rawStatus: String(event.data.status ?? "").slice(0, 40),
    amountKopecks: Number.isInteger(amount) ? amount : null,
  });

  return Response.json({ ok: true, result });
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
