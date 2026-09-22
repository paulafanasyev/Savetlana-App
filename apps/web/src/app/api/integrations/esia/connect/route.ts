import { apiRoute } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { getEsiaAdapter, isEsiaLive } from "@/lib/domains/esia";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Begins the official ЕСИА (Госуслуги) OIDC flow for identity verification.
 * Uses only the officially documented authorization-code flow (spec §18).
 * Returns PENDING_EXTERNAL_ACCESS honestly when production credentials are
 * absent.
 */
export const GET = apiRoute(async (request) => {
  const user = await requireBuyer(request);
  const adapter = getEsiaAdapter();
  if (!isEsiaLive()) {
    return Response.json(
      {
        ok: false,
        error: "PENDING_EXTERNAL_ACCESS",
        note: "ЕСИА: требуются ESIA_CLIENT_ID, ESIA_CLIENT_SECRET, ESIA_REDIRECT_URI и подписанный сертификат",
      },
      { status: 503 },
    );
  }
  const redirectUri = `${env.publicAppUrl}/api/integrations/esia/callback`;
  const state = `${user.user.id}:${crypto.randomUUID()}`;
  return Response.json({ authUrl: adapter.getAuthUrl({ state, redirectUri }) });
});
