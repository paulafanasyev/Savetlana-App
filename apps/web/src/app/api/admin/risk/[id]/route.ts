import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireAdmin, ApiError } from "@/lib/auth";
import { reviewRiskEvent } from "@/lib/domains/admin";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request, ctx) => {
  if (!rateLimit("admin:risk-review", 20, 60_000)) return tooManyRequests();
  const actor = await requireAdmin(request);
  const form = await request.formData();
  const decision = String(form.get("decision") ?? "").trim();

  if (decision.length < 3 || decision.length > 120) {
    throw new ApiError(400, "Укажите решение (3–120 символов)");
  }

  await reviewRiskEvent(ctx.params.id, decision, actor.user.id);
  redirect("/admin/risk");
});
