import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireSeller, requireVerifiedSeller, ApiError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeAvailability } from "@/lib/domains/inventory";
import { publishProblems, publishProblemsMessage } from "@/lib/domains/publish-check";
import { toKopecks } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface EditBody {
  title?: string; description?: string; priceRub?: number; oldPriceRub?: number | null;
  priceKopecks?: number; oldPriceKopecks?: number | null; categorySlug?: string | null;
  stockQuantity?: number; attributes?: Record<string, unknown>; imageUrls?: string[]; publish?: boolean;
}

export const PATCH = apiRoute(async (request, { params }) => {
  const { user, sellerId } = await requireSeller(request);
  if (!rateLimit(`seller-product-edit:${sellerId}`, 60, 60_000)) return tooManyRequests();
  const { id } = await Promise.resolve(params);
  const body = await jsonBody<EditBody>(request);
  const current = await prisma.product.findFirst({ where: { id, sellerId }, include: { inventory: true, listing: true } });
  if (!current) throw new ApiError(404, "Товар не найден в вашем каталоге");
  if (body.publish === true) await requireVerifiedSeller(request, "публиковать товары");

  const data: Record<string, unknown> = {};
  const changes: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const value = body.title.trim();
    if (value.length < 2) throw new ApiError(400, "Название слишком короткое");
    data.title = value.slice(0, 200);
    changes.title = [current.title, value];
  }
  if (body.description !== undefined) { data.description = body.description.trim().slice(0, 4000) || null; changes.description = true; }
  if (body.priceRub !== undefined || body.priceKopecks !== undefined) {
    const value = body.priceKopecks ?? toKopecks(Number(body.priceRub));
    if (!Number.isInteger(value) || value < 100) throw new ApiError(400, "Укажите цену от 1 ₽");
    data.priceKopecks = value;
    changes.priceKopecks = [current.priceKopecks, value];
  }
  if (body.oldPriceRub !== undefined || body.oldPriceKopecks !== undefined) {
    const raw = body.oldPriceKopecks ?? (body.oldPriceRub == null ? null : toKopecks(Number(body.oldPriceRub)));
    if (raw !== null && (!Number.isInteger(raw) || raw < 0)) throw new ApiError(400, "Укажите корректную старую цену");
    data.oldPriceKopecks = raw;
    changes.oldPriceKopecks = true;
  }
  if (body.categorySlug !== undefined) {
    const category = body.categorySlug ? await prisma.category.findUnique({ where: { slug: body.categorySlug }, select: { id: true } }) : null;
    if (body.categorySlug && !category) throw new ApiError(400, "Категория не найдена");
    data.categoryId = category?.id ?? null;
    changes.categoryId = true;
  }
  if (body.attributes !== undefined) {
    if (!body.attributes || typeof body.attributes !== "object" || Array.isArray(body.attributes)) throw new ApiError(400, "Характеристики должны быть списком полей");
    data.attributes = JSON.stringify(body.attributes);
    changes.attributes = true;
  }
  if (body.stockQuantity !== undefined) {
    if (!Number.isInteger(body.stockQuantity) || body.stockQuantity < 0) throw new ApiError(400, "Остаток должен быть целым числом от нуля");
    changes.stockQuantity = [current.inventory?.quantity ?? 0, body.stockQuantity];
  }
  if (body.publish === true) {
    if (current.status === "ARCHIVED") throw new ApiError(400, "Архивный товар нельзя опубликовать");
    data.status = "ACTIVE";
    changes.status = [current.status, "ACTIVE"];
  }
  const imageUrls = body.imageUrls;
  if (imageUrls !== undefined) {
    if (!Array.isArray(imageUrls) || imageUrls.length > 8 || imageUrls.some((url) => typeof url !== "string" || (!url.startsWith("/api/storage/") && !url.startsWith("https://")))) throw new ApiError(400, "Фотографии должны быть загружены через хранилище");
    changes.images = imageUrls.length;
  }
  if (Object.keys(data).length === 0 && body.stockQuantity === undefined && imageUrls === undefined) throw new ApiError(400, "Нет изменений");

  const updated = await prisma.$transaction(async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const product = await tx.product.update({ where: { id }, data: data as any });
    if (body.stockQuantity !== undefined) {
      const confirmed = current.inventory?.confirmedBySeller ?? false;
      const saleUntil = current.inventory?.saleUntil ?? null;
      await tx.inventory.upsert({
        where: { productId: id },
        create: { productId: id, quantity: body.stockQuantity, confirmedBySeller: false, availability: computeAvailability(body.stockQuantity, false, saleUntil) },
        update: { quantity: body.stockQuantity, availability: computeAvailability(body.stockQuantity, confirmed, saleUntil) },
      });
    }
    if (imageUrls !== undefined) {
      await tx.productImage.deleteMany({ where: { productId: id } });
      if (imageUrls.length) await tx.productImage.createMany({ data: imageUrls.map((url, position) => ({ productId: id, url, isPrimary: position === 0, position })) });
    }
    if (body.publish === true) {
      // Проверяем уже с учётом изменений в этом же запросе; ошибка откатывает всё.
      const problems = await publishProblems(tx, id);
      if (problems.length) throw new ApiError(400, publishProblemsMessage(problems));
      await tx.listing.upsert({ where: { productId: id }, create: { productId: id, publishedAt: new Date(), isLive: true }, update: { publishedAt: new Date(), isLive: true } });
    }
    if (Object.keys(changes).length) {
      const action = body.publish ? "PUBLISHED"
        : imageUrls !== undefined ? "PHOTOS_CHANGED"
        : body.stockQuantity !== undefined ? "INVENTORY_CHANGED"
        : body.attributes !== undefined ? "ATTRIBUTES_CHANGED"
        : body.priceRub !== undefined || body.priceKopecks !== undefined || body.oldPriceRub !== undefined || body.oldPriceKopecks !== undefined ? "PRICE_CHANGED"
        : "DESCRIPTION_CHANGED";
      await tx.listingHistory.create({ data: { productId: id, sellerId, actorId: user.id, action, change: JSON.stringify(changes) } });
    }
    return product;
  });
  return Response.json({ product: updated });
});
