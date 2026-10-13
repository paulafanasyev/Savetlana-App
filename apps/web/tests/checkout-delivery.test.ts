import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { addToCart } from "../src/lib/domains/cart";
import { createOrdersFromCart } from "../src/lib/domains/orders";
import { createShipment, syncTracking, nextShipmentStatus, orderStepsForShipment } from "../src/lib/domains/delivery";
import { SELLER_DELIVERY_KOPECKS } from "../src/lib/delivery-options";

async function fixture(price = 120_000) {
  const suffix = Math.random().toString(36).slice(2);
  const buyer = await prisma.user.create({ data: { email: `cd-buyer-${suffix}@test.local`, passwordHash: "x", name: "Покупатель" } });
  const sellerUser = await prisma.user.create({ data: { email: `cd-seller-${suffix}@test.local`, passwordHash: "x", name: "Продавец", role: "SELLER" } });
  const seller = await prisma.sellerProfile.create({ data: { userId: sellerUser.id, slug: `cd-${suffix}`, displayName: "Лавка", isActivated: true } });
  const product = await prisma.product.create({ data: { sellerId: seller.id, sku: `CD-${suffix}`, title: "Кружка", priceKopecks: price, status: "ACTIVE", inventory: { create: { quantity: 5 } } } });
  await addToCart(buyer.id, product.id, 1);
  return { buyer, seller, product, key: `cd-key-${suffix}` };
}

describe("доставка при оформлении", () => {
  it("самовывоз по умолчанию бесплатный", async () => {
    const f = await fixture();
    const result = await createOrdersFromCart({ buyerId: f.buyer.id, idempotencyKey: f.key, deliveryAddress: {} });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: result.orders[0].id } });
    expect(order.deliveryKopecks).toBe(0);
    expect(order.totalKopecks).toBe(120_000);
    expect(JSON.parse(order.deliveryAddress ?? "{}").deliveryMethod).toBe("PICKUP");
  });

  it("доставка продавцом входит в сумму и не задваивается при повторе", async () => {
    const f = await fixture();
    const input = { buyerId: f.buyer.id, idempotencyKey: f.key, deliveryAddress: { city: "Москва", street: "Тверская", house: "1" }, deliveryBySeller: { [f.seller.id]: { method: "SELLER" as const } } };
    const first = await createOrdersFromCart(input);
    expect(first.orders[0].totalKopecks).toBe(120_000 + SELLER_DELIVERY_KOPECKS);
    expect(first.orders[0].deliveryKopecks).toBe(SELLER_DELIVERY_KOPECKS);
    const replay = await createOrdersFromCart(input);
    expect(replay.orders[0].id).toBe(first.orders[0].id);
    expect(replay.orders[0].totalKopecks).toBe(120_000 + SELLER_DELIVERY_KOPECKS);
  });

  it("отправление после оплаты не меняет сумму и переводит заказ в сборку", async () => {
    const f = await fixture();
    const result = await createOrdersFromCart({ buyerId: f.buyer.id, idempotencyKey: f.key, deliveryAddress: {}, deliveryBySeller: { [f.seller.id]: { method: "SELLER" } } });
    const orderId = result.orders[0].id;
    await prisma.order.update({ where: { id: orderId }, data: { status: "CONFIRMED" } });
    await createShipment({ orderId, sellerProfileId: f.seller.id, carrier: "SELLER_OWN_DELIVERY" });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PROCESSING");
    expect(order.totalKopecks).toBe(120_000 + SELLER_DELIVERY_KOPECKS);
  });

  it("тестовый перевозчик продвигает заказ по шагам до «в пути»", async () => {
    const f = await fixture();
    const result = await createOrdersFromCart({ buyerId: f.buyer.id, idempotencyKey: f.key, deliveryAddress: {} });
    const orderId = result.orders[0].id;
    await prisma.order.update({ where: { id: orderId }, data: { status: "CONFIRMED" } });
    const shipment = await createShipment({ orderId, sellerProfileId: f.seller.id, carrier: "sandbox-carrier" });
    const synced = await syncTracking(shipment.id);
    expect(synced.status).toBe("IN_TRANSIT");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("IN_TRANSIT");
  });

  it("путь отправления идёт только вперёд", () => {
    expect(nextShipmentStatus("CREATED", "IN_TRANSIT")).toBe("IN_TRANSIT");
    expect(nextShipmentStatus("IN_TRANSIT", "CREATED")).toBe("IN_TRANSIT");
    expect(orderStepsForShipment("PROCESSING", "DELIVERED")).toEqual(["HANDED_TO_CARRIER", "IN_TRANSIT", "DELIVERED"]);
    expect(orderStepsForShipment("PAID", "DELIVERED")).toEqual([]);
  });
});
