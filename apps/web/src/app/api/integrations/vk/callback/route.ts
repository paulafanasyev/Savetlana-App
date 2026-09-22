import { apiRoute } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { linkVkAccount, getVkAdapter, isVkLive } from "@/lib/domains/vk";
import { env } from "@/lib/env";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * VK OAuth callback. VK redirects here with `code`; we exchange it server-side
 * for an access token and link the account. The token itself is never stored —
 * only an opaque reference (spec §38). On any failure the user is returned to
 * the privacy center with an honest status, never a fake success.
 */
export const GET = apiRoute(async (request) => {
  const user = await requireBuyer(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const redirectUri = `${env.publicAppUrl}/api/integrations/vk/callback`;

  if (error || !code) {
    redirect(
      `/profile?tab=integrations&vk_status=${
        error === "access_denied" ? "declined" : "failed"
      }`,
    );
  }
  if (!isVkLive()) {
    redirect(`/profile?tab=integrations&vk_status=unavailable`);
  }
  const result = await linkVkAccount({
    userId: user.user.id,
    code: code as string,
    redirectUri,
    actorId: user.user.id,
  });
  redirect(
    `/profile?tab=integrations&vk_status=${
      result.status === "ACTIVE" ? "linked" : "failed"
    }`,
  );
});
