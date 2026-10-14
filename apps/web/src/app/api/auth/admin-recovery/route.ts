import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requestIp } from "@/lib/client-ip";
import { recoverAdminPassword } from "@/lib/domains/admin-recovery";

export const dynamic = "force-dynamic";

/** Аварийная смена пароля администратора по секрету ADMIN_RECOVERY_TOKEN. */
export const POST = apiRoute(async (request) => {
  const body = await jsonBody<{ email?: string; token?: string; password?: string }>(request);
  const result = await recoverAdminPassword({
    email: String(body.email ?? ""),
    token: String(body.token ?? ""),
    newPassword: String(body.password ?? ""),
    ip: requestIp(request),
  });
  return Response.json({ ok: true, email: result.email });
});
