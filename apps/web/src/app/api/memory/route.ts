import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import {
  describeMemory,
  forgetAllMemory,
  getMemory,
  updateMemoryEntry,
} from "@/lib/domains/memory";

export const dynamic = "force-dynamic";

/**
 * "What Svetlana knows about me" (spec §34). The user sees every stored
 * memory entry, its source and confidence, and can edit or delete it.
 */
export const GET = apiRoute(async (request) => {
  if (!rateLimit("memory:read", 30, 60_000)) return tooManyRequests();
  const ctx = await requireUser(request);
  const entries = await getMemory(ctx.user.id);
  return Response.json({
    entries,
    summary: describeMemory(entries),
    note: "Каждое предположение имеет источник и степень уверенности. Вы можете редактировать или удалять любые записи.",
  });
});

/** Edits a memory entry the user has marked editable. */
export const PATCH = apiRoute(async (request) => {
  if (!rateLimit("memory:edit", 20, 60_000)) return tooManyRequests();
  const ctx = await requireUser(request);
  const body = await jsonBody<{ entryId?: string; value?: string }>(request);

  if (!body.entryId) throw new ApiError(400, "Укажите запись памяти");
  if (!body.value?.trim()) throw new ApiError(400, "Укажите новое значение");

  const entry = await updateMemoryEntry(ctx.user.id, body.entryId, body.value.trim());
  return Response.json({ entry });
});

/**
 * Deletes every memory entry for the user. A destructive action, so it is
 * separated from the per-entry delete endpoint and audit-logged as a bulk
 * erase (spec §34, §82).
 */
export const DELETE = apiRoute(async (request) => {
  if (!rateLimit("memory:forget-all", 3, 60_000)) return tooManyRequests();
  const ctx = await requireUser(request);
  const deleted = await forgetAllMemory(ctx.user.id);
  return Response.json({ deleted });
});
