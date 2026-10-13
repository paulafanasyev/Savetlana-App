import { apiRoute } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { getStorageProvider, readDatabaseObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

const decode = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };

export const GET = apiRoute<{ path: string[] }>(async (request, context) => {
  const rawParams = await Promise.resolve(context.params);
  const key = (Array.isArray(rawParams.path) ? rawParams.path : [rawParams.path]).map(decode).join("/");
  // Права проверяются по логическому пути без префикса database/.
  const logical = key.startsWith("database/") ? key.slice("database/".length) : key;
  if (logical.split("/").some((part) => part === ".." || part === "")) throw new ApiError(400, "Некорректный путь");
  const isPublic = logical.startsWith("public/");

  if (!isPublic) {
    const ctx = await requireUser(request);
    const parts = logical.split("/");
    const isAdmin = ctx.user.role === "ADMIN";
    let allowed = false;
    if (parts[0] === "private" && parts[1] === ctx.user.id) allowed = true;
    if (parts[0] === "documents" || parts[0] === "evidence") {
      if (isAdmin) allowed = true;
      const seller = await prisma.sellerProfile.findUnique({ where: { userId: ctx.user.id }, select: { id: true } });
      if (parts[0] === "documents" && seller?.id === parts[1]) allowed = true;
      if (parts[0] === "evidence" && parts[1]) {
        const dispute = await prisma.dispute.findUnique({ where: { id: parts[1] }, select: { buyerId: true, sellerProfile: { select: { userId: true } } } }).catch(() => null);
        if (dispute && (dispute.buyerId === ctx.user.id || dispute.sellerProfile.userId === ctx.user.id)) allowed = true;
      }
    }
    if (!allowed) throw new ApiError(403, "Нет доступа к этому файлу");
  }

  const cacheControl = isPublic ? "public, max-age=31536000, immutable" : "private, no-store";

  if (key.startsWith("database/")) {
    const object = await readDatabaseObject(key);
    if (!object) throw new ApiError(404, "Объект не найден");
    return new Response(new Uint8Array(object.bytes), { headers: { "Content-Type": object.mimeType, "Cache-Control": cacheControl, "X-Content-Type-Options": "nosniff" } });
  }

  if (env.storageProvider !== "local") {
    return Response.redirect(await getStorageProvider().signedReadUrl(key, 60), 302);
  }

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(process.cwd(), env.storageLocalDir);
  const file = path.resolve(root, key);
  if (!file.startsWith(`${root}${path.sep}`)) throw new ApiError(403, "Нет доступа к этому файлу");
  try {
    const bytes = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".pdf" ? "application/pdf" : "image/jpeg";
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": mime, "Cache-Control": cacheControl, "X-Content-Type-Options": "nosniff" } });
  } catch {
    throw new ApiError(404, "Объект не найден");
  }
});
