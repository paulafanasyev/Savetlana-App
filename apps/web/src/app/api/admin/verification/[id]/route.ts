import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireAdmin, ApiError } from "@/lib/auth";
import { decideVerification } from "@/lib/domains/admin";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
const ALLOWED_KINDS = new Set(["identity", "business", "npd", "document"]);

type Decision = { kind?: string; approved?: boolean; note?: string };

export const POST = apiRoute(async (request, { params }) => {
  if (!rateLimit("admin:verification-decision", 10, 60_000)) return tooManyRequests();
  const actor = await requireAdmin(request);
  const contentType = request.headers.get("content-type") ?? "";
  let body: Decision;
  let formRequest = false;
  if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
    formRequest = true;
    const form = await request.formData();
    body = { kind: String(form.get("kind") ?? ""), approved: String(form.get("approved")) === "true", note: form.get("note") ? String(form.get("note")) : undefined };
  } else {
    body = await jsonBody<Decision>(request);
  }
  if (!body.kind || !ALLOWED_KINDS.has(body.kind)) throw new ApiError(400, "Недопустимый вид проверки");
  if (typeof body.approved !== "boolean") throw new ApiError(400, "Укажите решение");
  const result = await decideVerification(params.id, body.kind, body.approved, body.note, actor.user.id);
  if (formRequest) redirect("/admin/verification");
  return Response.json(result);
});
