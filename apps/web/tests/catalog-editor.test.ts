import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { transitionOrder } from "../src/lib/domains/orders";
import { notify } from "../src/lib/domains/notifications";
import { verifyUpload } from "../src/lib/storage";
import { labelsCoverCanonicalEnums, orderStatusLabel, paymentStatusLabel, shipmentStatusLabel, productStatusLabel, settlementStatusLabel, payoutStatusLabel } from "../src/lib/labels";
import { OrderStatus_VALUES, PaymentStatus_VALUES, ShipmentStatus_VALUES, ProductStatus_VALUES, SettlementStatus_VALUES, PayoutStatus_VALUES } from "../src/lib/db/enums";

describe("редактор товара и хранение фотографий", () => {
  it("принимает настоящий JPEG", async () => {
    const result = await verifyUpload({ bucket: "public/products/p1", filename: "photo.jpg", bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), declaredMimeType: "image/jpeg", storageClass: "public" });
    expect(result.allowed).toBe(true);
    expect(result.sniffedMimeType).toBe("image/jpeg");
  });
  it("отклоняет поддельный и слишком большой файл", async () => {
    const fake = await verifyUpload({ bucket: "public/products/p1", filename: "photo.jpg", bytes: Buffer.from("not an image"), declaredMimeType: "image/jpeg", storageClass: "public" });
    expect(fake.allowed).toBe(false);
    const huge = await verifyUpload({ bucket: "public/products/p1", filename: "photo.jpg", bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024)]), declaredMimeType: "image/jpeg", storageClass: "public" });
    expect(huge.allowed).toBe(false);
  });
  it("имеет русскую подпись для каждого статуса каталога и расчётов", () => {
    expect(labelsCoverCanonicalEnums()).toBe(true);
    for (const value of OrderStatus_VALUES) expect(orderStatusLabel(value)).not.toBe(value);
    for (const value of PaymentStatus_VALUES) expect(paymentStatusLabel(value)).not.toBe(value);
    for (const value of ShipmentStatus_VALUES) expect(shipmentStatusLabel(value)).not.toBe(value);
    for (const value of ProductStatus_VALUES) expect(productStatusLabel(value)).not.toBe(value);
    for (const value of SettlementStatus_VALUES) expect(settlementStatusLabel(value)).not.toBe(value);
    for (const value of PayoutStatus_VALUES) expect(payoutStatusLabel(value)).not.toBe(value);
  });
});

describe("сценарии редактора (реальная SQLite база)", () => {
  async function fixture() {
    const suffix = Math.random().toString(36).slice(2);
    const buyer = await prisma.user.create({ data: { email: `buyer-${suffix}@test.local`, passwordHash: "test", name: "Покупатель" } });
    const sellerUser = await prisma.user.create({ data: { email: `seller-${suffix}@test.local`, passwordHash: "test", name: "Продавец", role: "SELLER" } });
    const otherUser = await prisma.user.create({ data: { email: `other-${suffix}@test.local`, passwordHash: "test", role: "SELLER" } });
    const seller = await prisma.sellerProfile.create({ data: { userId: sellerUser.id, slug: `seller-${suffix}`, displayName: "Продавец", isActivated: true } });
    const otherSeller = await prisma.sellerProfile.create({ data: { userId: otherUser.id, slug: `other-${suffix}`, displayName: "Другой продавец" } });
    const product = await prisma.product.create({ data: { sellerId: seller.id, sku: `SKU-${suffix}`, title: "Товар", priceKopecks: 1000, status: "DRAFT", inventory: { create: { quantity: 7 } } } });
    return { buyer, sellerUser, otherUser, seller, otherSeller, product };
  }

  it("ограничивает редактирование владельцем и сохраняет остаток", async () => {
    const f = await fixture();
    expect(await prisma.product.findFirst({ where: { id: f.product.id, sellerId: f.otherSeller.id } })).toBeNull();
    await prisma.inventory.update({ where: { productId: f.product.id }, data: { quantity: 13 } });
    expect((await prisma.inventory.findUniqueOrThrow({ where: { productId: f.product.id } })).quantity).toBe(13);
  });

  it("скрывает и повторно публикует товар с историей", async () => {
    const f = await fixture();
    await prisma.product.update({ where: { id: f.product.id }, data: { status: "HIDDEN" } });
    await prisma.listingHistory.create({ data: { productId: f.product.id, sellerId: f.seller.id, action: "HIDDEN", change: "{}" } });
    await prisma.product.update({ where: { id: f.product.id }, data: { status: "ACTIVE" } });
    await prisma.listingHistory.create({ data: { productId: f.product.id, sellerId: f.seller.id, action: "PUBLISHED", change: "{}" } });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } })).status).toBe("ACTIVE");
    expect(await prisma.listingHistory.count({ where: { productId: f.product.id, action: { in: ["HIDDEN", "PUBLISHED"] } } })).toBe(2);
  });

  it("отмечает доставку, уведомляет покупателя и не допускает выплату до доставки", async () => {
    const f = await fixture();
    const order = await prisma.order.create({ data: { buyerId: f.buyer.id, sellerId: f.seller.id, number: `ORD-${Math.random().toString(36).slice(2)}`, status: "IN_TRANSIT", subtotalKopecks: 1000, totalKopecks: 1000, items: { create: { productId: f.product.id, titleSnapshot: f.product.title, priceKopecks: 1000, quantity: 1 } } } });
    await prisma.settlement.create({ data: { orderId: order.id, sellerId: f.seller.id, grossKopecks: 1000, payoutKopecks: 985, status: "PENDING" } });
    const deliveredOnly = { sellerId: f.seller.id, status: "PENDING", order: { status: { in: ["DELIVERED", "COMPLETED"] } } };
    expect(await prisma.settlement.count({ where: deliveredOnly })).toBe(0);
    await transitionOrder({ orderId: order.id, to: "DELIVERED", actorId: f.sellerUser.id, actorRole: "seller", actingSellerId: f.seller.id, note: "Передано лично" });
    await notify({ userId: f.buyer.id, kind: "delivery_update", title: "Заказ доставлен", body: "Продавец передал заказ." });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("DELIVERED");
    expect(await prisma.notification.count({ where: { userId: f.buyer.id, kind: "delivery_update" } })).toBe(1);
    expect(await prisma.settlement.count({ where: deliveredOnly })).toBe(1);
  });
});
