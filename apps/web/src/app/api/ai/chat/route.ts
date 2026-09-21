import { apiRoute, jsonBody, tooManyRequests } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { masterAgent } from "@/lib/ai/agents/master";
import { rateLimit } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  if (!rateLimit(`ai:${user.id}`, 30, 60_000)) return tooManyRequests();

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
    conversationId: body.conversationId,
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
