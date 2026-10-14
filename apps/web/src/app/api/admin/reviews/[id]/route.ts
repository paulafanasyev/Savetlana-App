import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireAdmin, ApiError } from "@/lib/auth";
import { moderateReview } from "@/lib/domains/review-screening";
import { UserFacingError } from "@/lib/domains/engagement-rules";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Решение модератора по отзыву из очереди антифрода. */
export const POST = apiRoute<{ id: string }>(async (request, ctx) => {
  if (!rateLimit("admin:review-moderation", 120, 60_000)) return tooManyRequests();
  const actor = await requireAdmin(request);
  const form = await request.formData();
  const decision = String(form.get("decision") ?? "");
  const note = String(form.get("note") ?? "").trim() || undefined;
  if (decision !== "approve" && decision !== "reject") throw new ApiError(400, "Выберите: опубликовать или нет");
  try {
    await moderateReview(ctx.params.id, decision === "approve", actor.user.id, note);
  } catch (error) {
    if (error instanceof UserFacingError) throw new ApiError(error.status, error.message);
    throw error;
  }
  redirect("/admin/reviews");
});
