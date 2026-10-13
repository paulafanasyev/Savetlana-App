/**
 * File upload endpoint (spec §81, P0-11). Private buckets are authorized
 * server-side: documents/<sellerProfileId> only for that seller,
 * evidence/<disputeId> only for dispute participants or admins,
 * public/products/<productId> only for the seller who owns the product
 * (each stored photo becomes a ProductImage, the first one is primary).
 */
import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { storeUpload } from "@/lib/storage";
import type { StorageClass } from "@/lib/storage";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const MAX_FILES = 8;

export const POST = apiRoute(async (request) => {
  if (!rateLimit("uploads", 20, 60_000)) return tooManyRequests();
  const ctx = await requireUser(request);
  const form = await request.formData();
  const bucket = String(form.get("bucket") ?? "");
  const storageClass = String(form.get("storageClass") ?? "private") as StorageClass;
  const productId = String(form.get("productId") ?? "");
  const replace = String(form.get("replace") ?? "false") === "true";
  if (!bucket || !/^[a-z0-9_-]+(\/[a-z0-9_-]+)*$/i.test(bucket)) throw new ApiError(400, "Укажите корректное хранилище");
  if (storageClass !== "public" && storageClass !== "private") throw new ApiError(400, "Неверный класс хранилища");

  const parts = bucket.split("/");
  const isProductPhotos = parts[0] === "public" && parts[1] === "products";
  if (isProductPhotos) {
    if (parts.length !== 3 || !productId || parts[2] !== productId) throw new ApiError(400, "Не указан товар для фотографий");
    const seller = await prisma.sellerProfile.findUnique({ where: { userId: ctx.user.id }, select: { id: true } });
    const owned = seller ? await prisma.product.findFirst({ where: { id: productId, sellerId: seller.id }, select: { id: true } }) : null;
    if (!owned) throw new ApiError(403, "Нет прав на фотографии этого товара");
    if (storageClass !== "public") throw new ApiError(400, "Фото товара должны быть публичными");
  } else if (productId) {
    throw new ApiError(400, "Фото товара загружаются только в его хранилище");
  } else if (parts[0] === "documents") {
    const seller = await prisma.sellerProfile.findUnique({ where: { userId: ctx.user.id }, select: { id: true } });
    if (!seller || parts[1] !== seller.id) throw new ApiError(403, "Нет прав на запись в документы продавца");
    if (storageClass !== "private") throw new ApiError(403, "Документы должны быть приватными");
  } else if (parts[0] === "evidence") {
    const dispute = parts[1] ? await prisma.dispute.findUnique({ where: { id: parts[1] }, select: { buyerId: true, sellerProfile: { select: { userId: true } } } }).catch(() => null) : null;
    const participant = Boolean(dispute && (dispute.buyerId === ctx.user.id || dispute.sellerProfile.userId === ctx.user.id));
    if (ctx.user.role !== "ADMIN" && !participant) throw new ApiError(403, "Только участники спора могут загружать доказательства");
    if (storageClass !== "private") throw new ApiError(403, "Доказательства должны быть приватными");
  } else if (storageClass === "private" && !bucket.startsWith(`private/${ctx.user.id}`)) {
    throw new ApiError(403, "Нет прав на запись в это хранилище");
  }

  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) throw new ApiError(400, "Файлы не переданы");
  if (files.length > MAX_FILES) throw new ApiError(400, `Максимум ${MAX_FILES} файлов за один запрос`);
  if (isProductPhotos && replace) await prisma.productImage.deleteMany({ where: { productId } });
  const start = isProductPhotos ? await prisma.productImage.count({ where: { productId } }) : 0;

  const results = [];
  let saved = 0;
  for (const file of files) {
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128) || "file";
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
      const stored = await storeUpload({ bucket, filename: unique, bytes, declaredMimeType: file.type || undefined, storageClass });
      if (isProductPhotos) {
        const position = start + saved;
        await prisma.productImage.create({ data: { productId, url: stored.url, alt: file.name.slice(0, 200), isPrimary: position === 0, position } });
      }
      saved += 1;
      results.push({ ok: true as const, ...stored, originalName: file.name });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Файл отклонён";
      results.push({ ok: false as const, originalName: file.name, reason: message });
    }
  }
  return Response.json({ results, storageProvider: results.find((r) => r.ok)?.provider ?? null }, { status: saved > 0 ? 201 : 400 });
});
