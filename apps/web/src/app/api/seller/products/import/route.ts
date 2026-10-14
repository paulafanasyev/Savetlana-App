import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireSeller } from "@/lib/auth";
import { consumeRateLimit, tooMany } from "@/lib/domains/rate-limits";
import { importCatalogItems } from "@/lib/domains/catalog-import";

export const dynamic = "force-dynamic";

/** Пачка товаров из файла переноса магазина. dryRun: только проверить, ничего не создавать. */
export const POST = apiRoute(async (request) => {
  const { sellerId, user } = await requireSeller(request);
  const body = await jsonBody<{ items?: unknown; dryRun?: boolean }>(request);
  const dryRun = body.dryRun !== false;
  if (!dryRun) {
    const decision = await consumeRateLimit(`catalog-import:${sellerId}`, 60, 60 * 60_000);
    if (!decision.allowed) return tooMany(decision);
  }
  const result = await importCatalogItems({ sellerId, actorId: user.id, items: body.items, dryRun });
  return Response.json(result);
});
