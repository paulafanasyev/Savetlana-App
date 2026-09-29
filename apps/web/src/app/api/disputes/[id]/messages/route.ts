import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { appendMessage, getDisputeCase } from "@/lib/domains/disputes";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request, ctx) => {
  const auth = await requireUser(request);
  const dispute = await getDisputeCase(ctx.params.id, auth.user.id, auth.user.role);
  if (!dispute) return Response.json({ error: "Спор не найден" }, { status: 404 });
  return Response.json({ messages: dispute.messages });
});

export const POST = apiRoute(async (request, ctx) => {
  if (!rateLimit("disputes:message", 20, 60_000)) return tooManyRequests();
  const auth = await requireUser(request);
  const body = await jsonBody<{ body?: string; isInternal?: boolean }>(request);
  if (!body.body?.trim()) return Response.json({ error: "Пустое сообщение" }, { status: 400 });

  const dispute = await getDisputeCase(ctx.params.id, auth.user.id, auth.user.role);
  if (!dispute) return Response.json({ error: "Спор не найден" }, { status: 404 });

  const role =
    dispute.buyerId === auth.user.id
      ? "buyer"
      : dispute.sellerId === auth.user.id
        ? "seller"
        : auth.user.role === "admin"
          ? "admin"
          : "support";

  const msg = await appendMessage(ctx.params.id, auth.user.id, role, body.body, !!body.isInternal);
  return Response.json({ message: msg });
});
