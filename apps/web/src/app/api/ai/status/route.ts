import { apiRoute } from "@/lib/api-helpers";
import { aiMode } from "@/lib/ai/gateway";
import { hasExternalAiCredentials, integrationStatus } from "@/lib/env";
import { toolRegistry } from "@/lib/ai/tools";
import { registerAllTools } from "@/lib/ai/tools";

export const dynamic = "force-dynamic";

registerAllTools();

export const GET = apiRoute(async () => {
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
