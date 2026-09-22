import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireSeller, ApiError } from "@/lib/auth";
import { toolRegistry } from "@/lib/ai/tools";
// Importing the tool index also bootstraps the registry (registerAllTools).

export const dynamic = "force-dynamic";

/**
 * AI product draft creation (spec §12). Svetlana prepares a draft card from
 * the seller's description/photo; the draft is NOT published. Publishing is a
 * separate, explicitly confirmed action (see publish route).
 */
export const POST = apiRoute(async (request) => {
  if (!rateLimit("ai:draft", 10, 60_000)) return tooManyRequests();
  const ctx = await requireSeller(request);
  const body = await jsonBody<{
    title?: string;
    description?: string;
    priceRub?: number;
    categorySlug?: string;
    keywords?: string[];
    attributes?: Record<string, unknown>;
    imageUrl?: string;
  }>(request);

  if (!body.title?.trim()) throw new ApiError(400, "Укажите название товара");
  if (!body.description?.trim()) throw new ApiError(400, "Опишите товар");

  const tool = toolRegistry.get("create_product_draft");
  if (!tool) throw new ApiError(503, "Инструмент создания карточки недоступен");

  const auth = await toolRegistry.authorize(
    "create_product_draft",
    { userId: ctx.user.id, role: "seller", sellerProfileId: ctx.sellerId, traceId: "api-draft" },
    {}
  );
  if (!auth.allowed) throw new ApiError(403, auth.reason);

  const result = await tool.execute(
    { userId: ctx.user.id, role: "seller", sellerProfileId: ctx.sellerId, traceId: "api-draft" },
    {
      title: body.title.trim(),
      description: body.description.trim(),
      priceRub: body.priceRub,
      categorySlug: body.categorySlug,
      keywords: body.keywords,
      attributes: body.attributes,
      imageUrl: body.imageUrl,
    }
  );

  if (!result.ok) {
    throw new ApiError(400, result.error ?? "Не удалось создать черновик");
  }

  return Response.json({ draft: result.data, summary: result.summary }, { status: 201 });
});
