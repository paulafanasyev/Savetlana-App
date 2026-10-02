/**
 * Private file read endpoint (spec §81, P0-11).
 *
 * Files under a private bucket are only reachable through this route, which
 * re-checks authorization on every request — a signed-looking path is never
 * enough on its own. Access is scoped by bucket ownership:
 *   private/<userId>/...   → the owning user only (or an admin)
 *   documents/<sellerId>/. → the owning seller only (or an admin)
 *   evidence/<disputeId>/. → dispute participants only
 *
 * Public buckets are served directly by the storage provider and never hit
 * this route.
 */
import { apiRoute } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

function decodeKey(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export const GET = apiRoute<{ path: string[] }>(async (request, { params }) => {
  const ctx = await requireUser(request);
  const key = decodeKey(Array.isArray(params.path) ? params.path.join("/") : params.path);

  // Public objects bypass this route entirely.
  if (key.startsWith("public/")) {
    throw new ApiError(404, "Объект не найден");
  }

  const segments = key.split("/");
  const [scope, ownerId] = segments;
  const isAdmin = ctx.user.role === "ADMIN";

  let authorized = false;
  if (scope === "private" && ownerId === ctx.user.id) {
    authorized = true;
  } else if (scope === "documents" || scope === "evidence") {
    if (isAdmin) {
      authorized = true;
    } else {
      // Sellers may read their own documents and dispute evidence.
      const seller = await prisma.sellerProfile.findUnique({
        where: { userId: ctx.user.id },
        select: { id: true },
      });
      if (seller && ownerId === seller.id) authorized = true;
      if (scope === "evidence" && segments[1]) {
        const dispute = await prisma.dispute
          .findUnique({
            where: { id: segments[1] },
            select: { orderId: true },
          })
          .catch(() => null);
        if (dispute) {
          const order = await prisma.order
            .findUnique({ where: { id: dispute.orderId }, select: { buyerId: true } })
            .catch(() => null);
          if (order?.buyerId === ctx.user.id) authorized = true;
        }
      }
    }
  }

  if (!authorized) throw new ApiError(403, "Нет доступа к этому файлу");

  if (env.storageProvider !== "local") {
    // Production: issue a short-lived signed URL and redirect.
    const { getStorageProvider } = await import("@/lib/storage");
    const url = await getStorageProvider().signedReadUrl(key, 60);
    return Response.redirect(url, 302);
  }

  // Development: stream the file from the local folder.
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const abs = path.resolve(process.cwd(), env.storageLocalDir, key);
  // Prevent path traversal outside the uploads root.
  const root = path.resolve(process.cwd(), env.storageLocalDir);
  if (!abs.startsWith(root)) throw new ApiError(403, "Нет доступа к этому файлу");
  try {
    const bytes = await fs.readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    const mime =
      ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return new Response(bytes, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    throw new ApiError(404, "Объект не найден");
  }
});
