import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { masterAgent } from "@/lib/ai/agents/master";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Executes a tool call the user explicitly confirmed. The pending payload is
 * echoed back from the client and re-validated server-side — the agent never
 * trusts a confirmation for a tool it did not itself surface.
 */
export const POST = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  const body = await jsonBody<{
    conversationId?: string;
    toolName?: string;
    args?: Record<string, unknown>;
  }>(request);

  if (!body.toolName || !body.args) {
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
    { toolName: body.toolName, args: body.args }
  );

  return Response.json({
    answer: result.answer,
    conversationId: result.conversationId,
    verification: result.verification,
    steps: result.steps.map((s) => ({
      tool: s.toolName,
      ok: s.result.ok,
      summary: s.result.summary,
    })),
    traceId: result.traceId,
  });
});
