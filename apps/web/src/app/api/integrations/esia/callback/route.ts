import { apiRoute } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { getEsiaAdapter, isEsiaLive } from "@/lib/domains/esia";
import { consumeOAuthState } from "@/lib/domains/oauth-state";
import { env } from "@/lib/env";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * ЕСИА OIDC callback. The operator redirects here after the user
 * authenticated on its side. We record only the minimum necessary identity
 * assertion and never store raw tokens (spec §18, §20). The persisted OAuth
 * state is redeemed first so a replayed or cross-user callback is rejected
 * (P0 CSRF fix).
 */
export const GET = apiRoute(async (request) => {
  const user = await requireBuyer(request);
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

  const state = url.searchParams.get("state");
  const signature =
    url.searchParams.get("sig") ??
    (url.hash.length > 1 ? new URLSearchParams(url.hash.slice(1)).get("sig") : null);
  const verified = await consumeOAuthState({
    state,
    signature,
    userId: user.user.id,
    provider: "esia",
  });
  if (!verified.ok) {
    redirect(`/profile?tab=integrations&esia_status=invalid_state`);
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
