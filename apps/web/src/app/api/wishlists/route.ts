import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  listWishlists,
  getOrCreateWishlist,
  listWishlistItems,
  addWishlistItem,
  removeWishlistItem,
} from "@/lib/domains/collections";
import { fromKopecks } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  const { user } = await requireBuyer(request);
  const url = new URL(request.url);
  const listId = url.searchParams.get("listId");

  if (listId) {
    const items = await listWishlistItems(listId, user.id);
    return Response.json({
      listId,
      totalUnits: items.length,
      items: items.map((p) => ({ ...p, priceRub: fromKopecks(p.priceKopecks) })),
    });
  }

  const lists = await listWishlists(user.id);
  if (lists.length === 0) {
    const main = await getOrCreateWishlist(user.id);
    return Response.json({ lists: [{ ...main, itemsCount: 0 }] });
  }
  return Response.json({ lists });
});

export const POST = apiRoute(async (request) => {
  const { user } = await requireBuyer(request);
  const body = await jsonBody<{ productId?: string; name?: string; note?: string }>(request);
  if (!body.productId) return Response.json({ error: "Укажите товар", code: "bad_product" }, { status: 400 });

  const list = await getOrCreateWishlist(user.id, body.name?.trim() || "Избранное");
  await addWishlistItem(list.id, user.id, body.productId, body.note);
  return Response.json({ ok: true, listId: list.id });
});

export const DELETE = apiRoute(async (request) => {
  const { user } = await requireBuyer(request);
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  const listId = url.searchParams.get("listId");
  if (!productId) return Response.json({ error: "Укажите товар", code: "bad_product" }, { status: 400 });

  const list = listId
    ? await ownedWishlist(listId, user.id)
    : await getOrCreateWishlist(user.id);
  await removeWishlistItem(list.id, user.id, productId);
  return Response.json({ ok: true });
});

async function ownedWishlist(id: string, userId: string) {
  const found = await prisma.wishlist.findFirst({ where: { id, userId } });
  if (!found) throw new Error("Список не найден");
  return found;
}
