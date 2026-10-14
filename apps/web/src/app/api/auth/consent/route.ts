import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { clientIp } from "@/lib/domains/rate-limits";
import { needsTermsConsent, recordTermsConsent } from "@/lib/domains/terms-consent";

export const dynamic = "force-dynamic";

/** Нужно ли текущему пользователю принять условия. */
export const GET = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  return Response.json({ needsConsent: await needsTermsConsent(user.id) });
});

/** Человек принял условия и дал согласие на обработку данных (аккаунт создан раньше). */
export const POST = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  const body = await jsonBody<{ acceptTerms?: boolean }>(request);
  if (body.acceptTerms !== true) {
    return Response.json({ error: "Чтобы продолжить, примите условия и согласие на обработку персональных данных", code: "consent_required" }, { status: 400 });
  }
  await recordTermsConsent({
    userId: user.id,
    actorRole: user.role.toLowerCase(),
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent") ?? "",
    source: "login",
  });
  return Response.json({ ok: true });
});
