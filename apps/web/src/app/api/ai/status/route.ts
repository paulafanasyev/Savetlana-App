import { apiRoute } from "@/lib/api-helpers";
import { aiMode } from "@/lib/ai/gateway";
import { hasExternalAiCredentials, integrationStatus } from "@/lib/env";
import { toolRegistry } from "@/lib/ai/tools";
import { registerAllTools } from "@/lib/ai/tools";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

registerAllTools();

/**
 * AI operational status (spec §51, §116).
 *
 * The public answer is deliberately minimal — the user sees Svetlana, never
 * the provider name, endpoint or internal agent list. The detailed view
 * (tool catalogue, permissions, risk levels, credential configuration) is
 * admin-only: it is operational tooling, and publishing it would hand an
 * attacker the exact permission surface to target.
 */
export const GET = apiRoute(async (request) => {
  const url = new URL(request.url);
  const detail = url.searchParams.get("detail") === "full";

  // Minimal public status: is the assistant available, and honestly, is it
  // running on a live model or a sandbox fallback.
  if (!detail) {
    const mode = aiMode();
    return Response.json({
      available: true,
      liveModel: mode.mode === "LIVE",
      mode: mode.mode,
    });
  }

  const admin = await requireAdmin(request).catch(() => null);
  if (!admin) {
    return Response.json(
      {
        error: "Требуются права администратора",
        code: "admin_only",
      },
      { status: 403 }
    );
  }

  return Response.json({
    ai: aiMode(),
    externalCredentialsConfigured: hasExternalAiCredentials,
    integrations: integrationStatus,
    tools: toolRegistry.list().map((t) => ({
      name: t.name,
      permission: t.permission,
      riskLevel: t.riskLevel,
      needsConfirmation: t.needsConfirmation,
    })),
  });
});
