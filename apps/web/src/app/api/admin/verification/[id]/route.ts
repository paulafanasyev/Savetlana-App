import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireAdmin, ApiError } from "@/lib/auth";
import { decideVerification } from "@/lib/domains/admin";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const ALLOWED_KINDS = new Set(["identity", "business", "npd", "document"]);

/**
 * HTML-form endpoint for the admin verification queue. The resulting record is
 * always source=manual_review — it can never be mistaken for an official
 * ESIA/FNS check (spec §49: no fake verification).
 */
export const POST = apiRoute(async (request, ctx) => {
  if (!rateLimit("admin:verification-decision", 10, 60_000)) return tooManyRequests();
  const actor = await requireAdmin(request);
  const form = await request.formData();
  const kind = String(form.get("kind") ?? "");
  const approvedRaw = form.get("approved");
  const note = form.get("note");

  if (!ALLOWED_KINDS.has(kind)) throw new ApiError(400, "Недопустимый вид проверки");
  if (approvedRaw !== "true" && approvedRaw !== "false") {
    throw new ApiError(400, "Укажите approved");
  }

  await decideVerification(
    ctx.params.id,
    kind,
    approvedRaw === "true",
    note ? String(note) : undefined,
    actor.user.id
  );
  redirect("/admin/verification");
});
