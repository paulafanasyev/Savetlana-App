import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireAdmin, ApiError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assignAdmin, getDisputeCase, resolveDispute } from "@/lib/domains/disputes";

export const dynamic = "force-dynamic";

const ACTIVE_REFUND_STATUSES = ["PENDING", "PROCESSING", "SUCCEEDED"];

export const GET = apiRoute(async (request, ctx) => {
  await requireAdmin(request);
  const dispute = await getDisputeCase(ctx.params.id, "admin", "admin");
  if (!dispute) throw new ApiError(404, "Спор не найден");
  return Response.json({ dispute });
});

/** Remaining refundable amount: captured payment minus active refunds (audit: refund over-cap). */
async function refundableKopecks(disputeId: string): Promise<number | null> {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    select: { order: { select: { payment: { select: { id: true, amountKopecks: true, status: true } } } } },
  });
  const payment = dispute?.order.payment;
  if (!payment || payment.status !== "SUCCEEDED") return null;
  const used = await prisma.refund.aggregate({
    where: { paymentId: payment.id, status: { in: ACTIVE_REFUND_STATUSES } },
    _sum: { amountKopecks: true },
  });
  return Math.max(0, payment.amountKopecks - (used._sum.amountKopecks ?? 0));
}

export const POST = apiRoute(async (request, ctx) => {
  if (!rateLimit("admin:dispute:act", 10, 60_000)) return tooManyRequests();
  const auth = await requireAdmin(request);

  // Admin forms are HTML form-encoded; the JSON shape is kept for API clients.
  const isJson = request.headers.get("content-type")?.includes("application/json") ?? false;
  const raw: Record<string, string> = isJson
    ? await jsonBody<Record<string, string>>(request)
    : Object.fromEntries(
        (await request.formData()).entries().map(([k, v]) => [k, String(v)]),
      );
  // HTML forms get a redirect back to the case file instead of a raw JSON page.
  const done = (payload: unknown, flag: string) =>
    isJson
      ? Response.json(payload)
      : new Response(null, { status: 303, headers: { Location: `/admin/disputes/${encodeURIComponent(ctx.params.id)}?done=${flag}` } });

  const action = raw.action ?? "";
  const refundRub = Number(raw.refundRub ?? 0);

  if (action === "assign") {
    const d = await assignAdmin(ctx.params.id, auth.user.id);
    return done({ dispute: d }, "assigned");
  }

  // Audit fix: the case-file form submits action=resolve_buyer / resolve_seller;
  // before, only the literal "resolve" was accepted, so admins could never
  // resolve a dispute from the UI.
  if (action === "resolve" || action.startsWith("resolve_")) {
    const fromAction = action.startsWith("resolve_") ? action.slice("resolve_".length) : undefined;
    const winnerRaw = raw.winner ?? fromAction;
    const winner = winnerRaw === "buyer" || winnerRaw === "seller" ? winnerRaw : undefined;
    if (!winner || !raw.reasonCode || !raw.resolution) {
      throw new ApiError(400, "Укажите сторону, код причины и обоснование решения");
    }

    let refundAmountKopecks: number | undefined =
      Number.isFinite(refundRub) && refundRub > 0 ? Math.round(refundRub * 100) : undefined;
    if (winner === "buyer") {
      const available = await refundableKopecks(ctx.params.id);
      if (available !== null) {
        if (available <= 0) throw new ApiError(409, "По этому заказу уже возвращена вся оплаченная сумма");
        if (refundAmountKopecks !== undefined && refundAmountKopecks > available) {
          throw new ApiError(400, `Сумма возврата больше доступной: максимум ${(available / 100).toFixed(2)} ₽`);
        }
        refundAmountKopecks = refundAmountKopecks ?? available;
      }
    }

    const result = await resolveDispute({
      disputeId: ctx.params.id,
      actorId: auth.user.id,
      winner,
      reasonCode: raw.reasonCode,
      resolution: raw.resolution,
      refundAmountKopecks,
    });
    return done(result, "resolved");
  }

  throw new ApiError(400, "Неизвестное действие");
});
