import { apiRoute } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { linkVkAccount, getVkAdapter, isVkLive } from "@/lib/domains/vk";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Begins the official VK OAuth flow. The user is redirected to VK; the
 * `state` binds the flow to the authenticated platform user. VK credentials
 * are never exposed to the browser — only the redirect URL is constructed
 * server-side (spec §17, §38).
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
  const state = `${user.user.id}:${crypto.randomUUID()}`;
  return Response.json({ authUrl: adapter.getAuthUrl(state, redirectUri) });
});
