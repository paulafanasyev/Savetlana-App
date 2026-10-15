import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, tooMany } from "@/lib/domains/rate-limits";
import { BULK_MAX_LINES, composeMany, sanitizeComposition, titleKey } from "@/lib/domains/product-compose-bulk";
import { toolRegistry } from "@/lib/ai/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/seller/products/compose-bulk
 * { text } — разобрать список, по товару на строку, ничего не сохраняя.
 * { items } — создать черновики из проверенных продавцом карточек.
 * Товар с таким же названием, как уже есть у продавца, не дублируется.
 */
export const POST = apiRoute(async (request) => {
  const { sellerId, user } = await requireSeller(request);
  const body = await jsonBody<{ text?: unknown; items?: unknown }>(request);
  const categories = await prisma.category.findMany({ select: { slug: true, name: true }, orderBy: { name: "asc" }, take: 300 });

  if (!Array.isArray(body.items)) {
    const text = typeof body.text === "string" ? body.text : "";
    if (text.trim().length < 5) return Response.json({ error: "Вставьте список товаров, по одному на строку.", code: "empty" }, { status: 400 });
    if (text.length > 20_000) return Response.json({ error: "Слишком длинный список, разделите его на части.", code: "too_long" }, { status: 400 });
    const items = composeMany(text, categories);
    const existing = await prisma.product.findMany({ where: { sellerId, title: { in: items.map((i) => i.title) } }, select: { title: true } });
    const taken = new Set(existing.map((p) => titleKey(p.title)));
    return Response.json({ items: items.map((i) => ({ ...i, exists: taken.has(titleKey(i.title)) })), max: BULK_MAX_LINES });
  }

  const decision = await consumeRateLimit(`product-compose-bulk:${sellerId}`, 20, 60 * 60_000);
  if (!decision.allowed) return tooMany(decision);
  if (body.items.length > BULK_MAX_LINES) return Response.json({ error: `За раз можно создать до ${BULK_MAX_LINES} карточек.`, code: "too_many" }, { status: 400 });

  const ctx = { userId: user.id, role: "seller", sellerProfileId: sellerId, traceId: "api-compose-bulk" };
  const auth = await toolRegistry.authorize("create_product_draft", ctx, {});
  if (!auth.allowed) return Response.json({ error: auth.reason }, { status: 403 });

  const slugs = new Set(categories.map((c) => c.slug));
  const clean = body.items.map((raw) => sanitizeComposition(raw, slugs));
  const existing = await prisma.product.findMany({
    where: { sellerId, title: { in: clean.filter((c): c is NonNullable<typeof c> => c !== null).map((c) => c.title) } },
    select: { title: true },
  });
  const taken = new Set(existing.map((p) => titleKey(p.title)));

  let created = 0;
  const skipped: { title: string; reason: string }[] = [];
  for (const [index, item] of clean.entries()) {
    if (!item) { skipped.push({ title: `строка ${index + 1}`, reason: "нет названия" }); continue; }
    const key = titleKey(item.title);
    if (taken.has(key)) { skipped.push({ title: item.title, reason: "такой товар уже есть" }); continue; }
    const result = await auth.tool.execute(ctx, {
      title: item.title,
      description: item.description,
      priceRub: item.priceRub,
      categorySlug: item.categorySlug || undefined,
      keywords: item.keywords,
      attributes: item.attributes,
    });
    if (result.ok) {
      created += 1;
      taken.add(key);
    } else {
      skipped.push({ title: item.title, reason: result.error ?? "не удалось создать" });
    }
  }
  return Response.json({ created, skipped });
});
