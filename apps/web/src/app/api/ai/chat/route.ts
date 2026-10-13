import { apiRoute, jsonBody, tooManyRequests } from "@/lib/api-helpers";
import { resolveSession, ApiError } from "@/lib/auth";
import { masterAgent, GUEST_CONVERSATION } from "@/lib/ai/agents/master";
import { rateLimit } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Адрес гостя для ограничения частоты: берём то, что поставил наш прокси, а не браузер. */
function guestKey(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
  return real || forwarded || "unknown";
}

/**
 * Чат со Светланой. Без входа она ищет, сравнивает и показывает отзывы;
 * заказы, корзина, подарки и всё, что меняет данные, доступно после входа.
 */
export const POST = apiRoute(async (request) => {
  const { user } = await resolveSession(request);
  if (user?.isBlocked) throw new ApiError(403, "Аккаунт заблокирован");
  const allowed = user ? rateLimit(`ai:${user.id}`, 30, 60_000) : rateLimit(`ai:guest:${guestKey(request)}`, 15, 60_000);
  if (!allowed) return tooManyRequests();

  const body = await jsonBody<{
    message?: string;
    conversationId?: string;
    confirmations?: Record<string, boolean>;
    side?: "buyer" | "seller";
  }>(request);

  const message = (body.message ?? "").trim();
  if (message.length === 0) {
    return Response.json({ error: "Пустое сообщение", code: "empty" }, { status: 400 });
  }
  if (message.length > 4000) {
    return Response.json({ error: "Сообщение слишком длинное", code: "too_long" }, { status: 400 });
  }

  if (!user) {
    const result = await masterAgent.run({ userId: "", message, role: "guest" });
    return Response.json({
      answer: result.answer,
      conversationId: null,
      agent: result.agent,
      guest: true,
      verification: result.verification,
      steps: result.steps.map((s) => ({ tool: s.toolName, ok: s.result.ok, summary: s.result.summary })),
      traceId: result.traceId,
    });
  }

  const sellerProfile = await prisma.sellerProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  const side = body.side ?? (sellerProfile ? "seller" : "buyer");

  const result = await masterAgent.run({
    userId: user.id,
    message,
    role: side === "seller" && sellerProfile ? "seller" : "buyer",
    sellerProfileId: sellerProfile?.id,
    conversationId: body.conversationId && body.conversationId !== GUEST_CONVERSATION ? body.conversationId : undefined,
    confirmations: body.confirmations,
  });

  return Response.json({
    answer: result.answer,
    conversationId: result.conversationId,
    agent: result.agent,
    /** The user-facing brand is always Svetlana; internal agent name only. */
    verification: result.verification,
    pendingConfirmation: result.pendingConfirmation,
    steps: result.steps.map((s) => ({
      tool: s.toolName,
      ok: s.result.ok,
      summary: s.result.summary,
    })),
    traceId: result.traceId,
  });
});
