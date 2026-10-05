import { apiRoute } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { isPathWithinRoot } from "@/lib/path-safety";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
function decodeKey(path: string): string { try { return decodeURIComponent(path); } catch { return path; } }
export const GET = apiRoute<{ path: string[] }>(async (request, { params }) => {
  const ctx = await requireUser(request);
  const key = decodeKey(Array.isArray(params.path) ? params.path.join("/") : params.path);
  if (key.startsWith("public/")) throw new ApiError(404, "Объект не найден");
  const segments = key.split("/");
  const [scope, ownerId] = segments;
  const isAdmin = ctx.user.role === "ADMIN";
  let authorized = false;
  if (scope === "private" && ownerId === ctx.user.id) authorized = true;
  else if (scope === "documents" || scope === "evidence") {
    if (isAdmin) authorized = true;
    else {
      const seller = await prisma.sellerProfile.findUnique({ where: { userId: ctx.user.id }, select: { id: true } });
      if (scope === "documents" && seller && ownerId === seller.id) authorized = true;
      if (scope === "evidence" && segments[1]) {
        const dispute = await prisma.dispute.findUnique({ where: { id: segments[1] }, select: { buyerId: true, sellerProfile: { select: { userId: true } } } }).catch(() => null);
        if (dispute && (dispute.buyerId === ctx.user.id || dispute.sellerProfile.userId === ctx.user.id)) authorized = true;
      }
    }
  }
  if (!authorized) throw new ApiError(403, "Нет доступа к этому файлу");
  if (env.storageProvider !== "local") {
    const { getStorageProvider } = await import("@/lib/storage");
    return Response.redirect(await getStorageProvider().signedReadUrl(key, 60), 302);
  }
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const abs = path.resolve(process.cwd(), env.storageLocalDir, key);
  const root = path.resolve(process.cwd(), env.storageLocalDir);
  if (!isPathWithinRoot(root, abs)) throw new ApiError(403, "Нет доступа к этому файлу");
  try {
    const bytes = await fs.readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    const mime = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return new Response(bytes, { headers: { "Content-Type": mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { throw new ApiError(404, "Объект не найден"); }
});
