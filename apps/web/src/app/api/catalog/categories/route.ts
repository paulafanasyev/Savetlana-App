import { apiRoute } from "@/lib/api-helpers";
import { ensureBaseCategories } from "@/lib/domains/categories";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => {
  const categories = await ensureBaseCategories();
  return Response.json({ items: categories.map((category) => ({ id: category.id, slug: category.slug, name: category.name, parentId: category.parentId })) });
});
