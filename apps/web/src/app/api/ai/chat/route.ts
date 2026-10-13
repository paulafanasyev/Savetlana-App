import { apiRoute, jsonBody, tooManyRequests } from "@/lib/api-helpers";
import { resolveSession, ApiError } from "@/lib/auth";
import { masterAgent, GUEST_CONVERSATION } from "@/lib/ai/agents/master";
import { sharedRateLimit } from "@/lib/domains/rate-limits";
import { requestIp } from "@/lib/client-ip";
import { numberWordsToDigits } from "@/lib/ai/number-words";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Чат со Светланой. Без входа она ищет, сравнивает и показывает отзывы;
 * заказы, корзина, подарки и всё, что меняет данные, доступно после входа.
 *
 * Лимит частоты считается в базе, поэтому он общий для всех копий сервера,
 * а адрес гостя берётся тот, что поставил наш прокси, а не браузер.
 */
export const POST = apiRoute(async (request) => {
  const { user } = await resolveSession(request);
  if (user?.isBlocked) throw new ApiError(403, "Аккаунт заблокирован");
  const allowed = user
    ? await sharedRateLimit(`ai:${user.id}`, 30, 60_000)
    : await sharedRateLimit(`ai:guest:${requestIp(request)}`, 15, 60_000);
  if (!allowed) return tooManyRequests();

  const body = await jsonBody<{
    message?: string;
    conversationId?: string;
    confirmations?: Record<string, boolean>;
    side?: "buyer" | "seller";
  }>(request);

  const raw = (body.message ?? "").trim();
  if (raw.length === 0) {
    return Response.json({ error: "Пустое сообщение", code: "empty" }, { status: 400 });
  }
  if (raw.length > 4000) {
    return Response.json({ error: "Сообщение слишком длинное", code: "too_long" }, { status: 400 });
  }
  // «до пяти тысяч» → «до 5000»: так бюджет понимают и поиск, и Светлана.
  const message = numberWordsToDigits(raw);

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
