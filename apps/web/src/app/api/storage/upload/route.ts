/**
 * File upload endpoint (spec §81, P0-11).
 *
 * Accepts multipart/form-data, runs every file through the storage pipeline
 * (mime sniffing, size limit, hash, private/public classification) and returns
 * an honest descriptor. The caller — e.g. the seller document API — then
 * persists the returned key/url. Storage alone never implies verification.
 *
 * Private buckets require an authenticated session; anonymous upload is
 * refused outright.
 */
import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { storeUpload } from "@/lib/storage";
import type { StorageClass } from "@/lib/storage";

export const dynamic = "force-dynamic";

const MAX_FILES = 5;

export const POST = apiRoute(async (request) => {
  if (!rateLimit("uploads", 20, 60_000)) return tooManyRequests();
  const ctx = await requireUser(request);

  const form = await request.formData();
  const bucket = String(form.get("bucket") ?? "");
  const storageClass = String(form.get("storageClass") ?? "private") as StorageClass;
  if (!bucket || !/^[a-z0-9_-]+(\/[a-z0-9_-]+)*$/i.test(bucket)) {
    throw new ApiError(400, "Укажите корректный бакет");
  }
  if (storageClass !== "public" && storageClass !== "private") {
    throw new ApiError(400, "Неверный класс хранилища");
  }
  // Private buckets require an authenticated user (already enforced above) and
  // must be user-scoped or seller-scoped.
  if (storageClass === "private" && !bucket.startsWith(`private/${ctx.user.id}`) && !bucket.startsWith("documents/") && !bucket.startsWith("evidence/")) {
    throw new ApiError(403, "Нет прав на запись в этот бакет");
  }

  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) throw new ApiError(400, "Файлы не переданы");
  if (files.length > MAX_FILES) throw new ApiError(400, `Максимум ${MAX_FILES} файлов за один запрос`);

  const results = [];
  for (const file of files) {
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
      const stored = await storeUpload({
        bucket,
        filename: unique,
        bytes,
        declaredMimeType: file.type || undefined,
        storageClass,
      });
      results.push({ ok: true as const, ...stored, originalName: file.name });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Файл отклонён";
      results.push({ ok: false as const, originalName: file.name, reason: message });
    }
  }

  const anyOk = results.some((r) => r.ok);
  return Response.json(
    { results, storageProvider: results.find((r) => r.ok)?.provider ?? null },
    { status: anyOk ? 201 : 400 }
  );
});
