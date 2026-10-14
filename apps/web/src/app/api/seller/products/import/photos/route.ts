import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireSeller } from "@/lib/auth";
import { consumeRateLimit, tooMany } from "@/lib/domains/rate-limits";
import { copyImportedPhotos } from "@/lib/domains/photo-copy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Порция копирования фото перенесённых товаров к нам в хранилище. */
export const POST = apiRoute(async (request) => {
  const { sellerId, user } = await requireSeller(request);
  const decision = await consumeRateLimit(`catalog-photos:${sellerId}`, 600, 60 * 60_000);
  if (!decision.allowed) return tooMany(decision);
  const body = await jsonBody<{ after?: unknown }>(request);
  const after = typeof body.after === "string" && /^[a-z0-9]{1,40}$/i.test(body.after) ? body.after : null;
  const result = await copyImportedPhotos({ sellerId, actorId: user.id, after });
  return Response.json(result);
});
