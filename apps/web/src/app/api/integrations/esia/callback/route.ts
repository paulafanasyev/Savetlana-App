import { apiRoute } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { getEsiaAdapter, isEsiaLive } from "@/lib/domains/esia";
import { env } from "@/lib/env";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * ЕСИА OIDC callback. The operator redirects here after the user
 * authenticated on its side. We record only the minimum necessary identity
 * assertion and never store raw tokens (spec §18, §20).
 */
export const GET = apiRoute(async (request) => {
  await requireBuyer(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const redirectUri = `${env.publicAppUrl}/api/integrations/esia/callback`;

  if (error || !code) {
    redirect(
      `/profile?tab=integrations&esia_status=${
        error === "access_denied" ? "declined" : "failed"
      }`,
    );
  }
  if (!isEsiaLive()) {
    redirect(`/profile?tab=integrations&esia_status=unavailable`);
  }
  const adapter = getEsiaAdapter();
  const tokens = await adapter.exchangeCode({ code: code as string, redirectUri });
  if (!tokens) {
    redirect(`/profile?tab=integrations&esia_status=failed`);
  }
  const person = await adapter.getPerson(tokens.accessToken);
  if (!person || !person.verified) {
    // ЕСИА did not positively assert identity — this is a fact, not a failure
    // to be papered over (spec §49).
    redirect(`/profile?tab=integrations&esia_status=not_verified`);
  }
  redirect(`/profile?tab=integrations&esia_status=verified`);
});
