import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { masterAgent } from "@/lib/ai/agents/master";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, AUTH_LIMITS, tooMany } from "@/lib/domains/rate-limits";
import { confirmedAnswerWithLinks } from "@/lib/ai/answer-links";
import { stripChatLinks } from "@/lib/chat-links";

export const dynamic = "force-dynamic";

/**
 * Executes a tool call the user explicitly confirmed.
 *
 * Security model (P0 fix, spec §39/§45/§147): the client echoes back ONLY the
 * opaque {actionId, nonce} handle Svetlana returned when she surfaced the
 * action. The server redeems it against a persisted row bound to
 * (userId, conversationId): nonce compared in constant time, row must be
 * PENDING and unexpired, stored args re-hashed against the stored digest, and
 * the row is consumed before execution. A forged confirm with attacker-chosen
 * (toolName, args) is impossible; a replay of a used handle is rejected.
 *
 * Товары в ответе становятся ссылками, после публикации появляется ссылка на
 * карточку (lib/ai/answer-links.ts). В строке шага остаётся только подпись.
 */
export const POST = apiRoute(async (request) => {
  const { user } = await requireUser(request);

  // Rate limit (P0-15): confirmed actions move money and publish listings, so
  // a compromised or abusive session must not be able to hammer this endpoint.
  const decision = await consumeRateLimit(
    `ai-confirm:user:${user.id}`,
    AUTH_LIMITS.aiConfirm.limit,
    AUTH_LIMITS.aiConfirm.windowMs,
  );
  if (!decision.allowed) return tooMany(decision);

  const body = await jsonBody<{
    conversationId?: string;
    actionId?: string;
    nonce?: string;
  }>(request);

  if (!body.actionId || !body.nonce) {
    return Response.json({ error: "Нечего подтверждать", code: "empty" }, { status: 400 });
  }
  const sellerProfile = await prisma.sellerProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  const result = await masterAgent.executeConfirmed(
    {
      userId: user.id,
      role: sellerProfile ? "seller" : "buyer",
      sellerProfileId: sellerProfile?.id,
      conversationId: body.conversationId,
    },
    { actionId: body.actionId, nonce: body.nonce }
  );

  return Response.json({
    answer: confirmedAnswerWithLinks(result.answer, result.steps),
    conversationId: result.conversationId,
    verification: result.verification,
    steps: result.steps.map((s) => ({
      tool: s.toolName,
      ok: s.result.ok,
      summary: s.result.summary ? stripChatLinks(s.result.summary) : s.result.summary,
    })),
    traceId: result.traceId,
  });
});
