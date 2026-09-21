import { apiRoute } from "@/lib/api-helpers";
import { integrationStatus, env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Honest readiness report: every external integration states whether its
 * credentials are actually configured. Nothing is claimed working without
 * proof (spec §58, §59).
 */
export const GET = apiRoute(async () => {
  return Response.json({
    integrations: integrationStatus,
    features: env.features,
    platformFeePercent: env.platformFeePercent,
    currency: env.defaultCurrency,
  });
});
