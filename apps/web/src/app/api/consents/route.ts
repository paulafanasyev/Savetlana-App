import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import {
  listConsents,
  setConsent,
  hasConsent,
  type ConsentType,
} from "@/lib/domains/consents";

export const dynamic = "force-dynamic";

/**
 * Privacy Center API (spec §34, §82). The user sees exactly what is stored,
 * and can grant or revoke each consent. Revoking AI_PERSONALIZATION
 * immediately de-personalizes recommendations; nothing is inferred silently.
 */
export const GET = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  const consents = await listConsents(user.id);
  return Response.json({
    consents,
    summary: {
      personalization: await hasConsent(user.id, "AI_PERSONALIZATION" as ConsentType),
      aiMemory: await hasConsent(user.id, "AI_MEMORY" as ConsentType),
      marketing: await hasConsent(user.id, "MARKETING" as ConsentType),
      analytics: await hasConsent(user.id, "ANALYTICS" as ConsentType),
    },
  });
});

export const POST = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  const body = await jsonBody<{ type?: string; granted?: boolean }>(request);
  if (!body.type || typeof body.granted !== "boolean") {
    return Response.json(
      { error: "Укажите тип согласия и флаг granted", code: "empty" },
      { status: 400 }
    );
  }
  const result = await setConsent({
    userId: user.id,
    type: body.type,
    granted: body.granted,
    actorId: user.id,
  });
  return Response.json(result);
});
