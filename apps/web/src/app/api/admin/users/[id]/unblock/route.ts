import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireAdmin } from "@/lib/auth";
import { setUserBlocked } from "@/lib/domains/admin";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request, ctx) => {
  if (!rateLimit("admin:user-unblock", 20, 60_000)) return tooManyRequests();
  const actor = await requireAdmin(request);
  const form = await request.formData();
  const confirmed = form.get("confirm");
  if (confirmed !== "true") {
    return Response.json({ error: "Требуется подтверждение" }, { status: 400 });
  }
  await setUserBlocked(ctx.params.id, false, actor.user.id);
  redirect("/admin/users");
});
