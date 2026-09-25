import { apiRoute } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { getVkAdapter, isVkLive } from "@/lib/domains/vk";
import { createOAuthState } from "@/lib/domains/oauth-state";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Begins the official VK OAuth flow. The user is redirected to VK with a
 * `state` that is persisted server-side and bound to the authenticated
 * platform user, so the callback can prove the flow was started by this user
 * and not replayed (P0 CSRF fix, spec §17/§38). VK credentials are never
 * exposed to the browser — only the redirect URL is constructed server-side.
 */
export const GET = apiRoute(async (request) => {
  const user = await requireBuyer(request);
  const adapter = getVkAdapter();
  if (!isVkLive()) {
    return Response.json(
      {
        ok: false,
        error: "PENDING_EXTERNAL_ACCESS",
        note: "VK-интеграция не настроена: требуются VK_APP_ID и VK_CLIENT_SECRET",
      },
      { status: 503 },
    );
  }
  const redirectUri = `${env.publicAppUrl}/api/integrations/vk/callback`;
  const created = await createOAuthState({
    userId: user.user.id,
    provider: "vk",
    redirectUri,
  });
  // The OAuth state carries our handle; the signature travels in the session
  // fragment so the callback can verify the handle was minted by this server.
  const authUrl = new URL(adapter.getAuthUrl(created.state, redirectUri));
  authUrl.hash = `sig=${created.signature}`;
  return Response.json({ authUrl: authUrl.toString() });
});
