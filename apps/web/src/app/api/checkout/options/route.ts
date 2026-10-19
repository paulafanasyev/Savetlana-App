import { apiRoute } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { getCartView } from "@/lib/domains/cart";
import { shipCitiesBySeller } from "@/lib/domains/seller-ship-from";
import { DELIVERY_OPTIONS } from "@/lib/delivery-options";

export const dynamic = "force-dynamic";

/** Продавцы из корзины и способы доставки для каждого: заказ делится по продавцам. */
export const GET = apiRoute(async (request) => {
  const { user } = await requireBuyer(request);
  const view = await getCartView(user.id);
  const sellers = new Map<string, { sellerId: string; sellerName: string; subtotalKopecks: number; itemsCount: number; shipCity: string | null }>();
  for (const line of view.lines) {
    const row = sellers.get(line.sellerId) ?? { sellerId: line.sellerId, sellerName: line.sellerName, subtotalKopecks: 0, itemsCount: 0, shipCity: null };
    row.subtotalKopecks += line.lineTotalKopecks;
    row.itemsCount += line.quantity;
    sellers.set(line.sellerId, row);
  }
  // Город отгрузки: для самовывоза покупатель должен знать, куда ехать. Ошибка не ломает оформление.
  const cities = await shipCitiesBySeller([...sellers.keys()]).catch(() => new Map<string, string>());
  for (const row of sellers.values()) row.shipCity = cities.get(row.sellerId) ?? null;
  return Response.json({
    sellers: [...sellers.values()],
    options: DELIVERY_OPTIONS,
    unavailable: view.lines.filter((l) => !l.available).map((l) => l.title),
  });
});
