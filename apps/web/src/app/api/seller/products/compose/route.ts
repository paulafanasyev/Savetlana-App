import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, tooMany } from "@/lib/domains/rate-limits";
import { composeProduct, MAX_COMPOSE_INPUT } from "@/lib/domains/product-compose";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/seller/products/compose
 * Body: { text } — товар своими словами. Возвращает заполненные поля карточки.
 * Ничего не сохраняет: черновик создаётся отдельно, после проверки продавцом.
 */
export const POST = apiRoute(async (request) => {
  const { sellerId } = await requireSeller(request);
  const decision = await consumeRateLimit(`product-compose:${sellerId}`, 30, 60 * 60_000);
  if (!decision.allowed) return tooMany(decision);
  const body = await jsonBody<{ text?: unknown }>(request);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length < 5) {
    return Response.json({ error: "Опишите товар подробнее: что это, бренд, размер или цвет, цена.", code: "too_short" }, { status: 400 });
  }
  if (text.length > MAX_COMPOSE_INPUT) {
    return Response.json({ error: `Слишком длинно, сократите до ${MAX_COMPOSE_INPUT} символов.`, code: "too_long" }, { status: 400 });
  }
  const categories = await prisma.category.findMany({ select: { slug: true, name: true }, orderBy: { name: "asc" }, take: 300 });
  return Response.json(await composeProduct(text, categories));
});
