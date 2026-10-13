import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { storeUpload, type StorageClass } from "@/lib/storage";
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
  if (bucket.startsWith("public/")) {
    // Публично можно хранить только фото своего товара.
    const parts = bucket.split("/");
    if (parts[1] !== "products" || parts.length !== 3) throw new ApiError(403, "Нет прав на запись в это хранилище");
    if (!productId || parts[2] !== productId) throw new ApiError(400, "Не указан товар для фотографий");
    const seller = await prisma.sellerProfile.findUnique({ where: { userId: ctx.user.id }, select: { id: true } });
    const owned = seller ? await prisma.product.findFirst({ where: { id: productId, sellerId: seller.id }, select: { id: true } }) : null;
    if (!owned || storageClass !== "public") throw new ApiError(403, "Нет прав на фотографии товара");
  } else if (!bucket.startsWith(`private/${ctx.user.id}`)) {
    throw new ApiError(403, "Нет прав на запись в это хранилище");
  }
  if (productId && !bucket.startsWith("public/products/")) throw new ApiError(400, "Фото товара загружаются только в его хранилище");
  const files = form.getAll("file").filter((file): file is File => file instanceof File);
  if (!files.length) throw new ApiError(400, "Файлы не переданы");
  if (files.length > MAX_FILES) throw new ApiError(400, `Максимум ${MAX_FILES} фотографий за раз`);
  if (productId && replace) await prisma.productImage.deleteMany({ where: { productId } });
  const start = productId ? await prisma.productImage.count({ where: { productId } }) : 0;
  const results: Array<Record<string, unknown>> = [];
  let saved = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "photo";
      const stored = await storeUpload({ bucket, filename: `${Date.now()}-${index}-${safeName}`, bytes, declaredMimeType: file.type || undefined, storageClass });
      if (productId) {
        const position = start + saved;
        await prisma.productImage.create({ data: { productId, url: stored.url, alt: file.name.slice(0, 200), isPrimary: position === 0, position } });
      }
      saved += 1;
      results.push({ ok: true, ...stored, originalName: file.name });
    } catch (error) {
      results.push({ ok: false, originalName: file.name, reason: error instanceof Error ? error.message : "Файл отклонён" });
    }
  }
  return Response.json({ results, storageProvider: results.find((item) => item.ok)?.provider ?? null }, { status: saved > 0 ? 201 : 400 });
});
