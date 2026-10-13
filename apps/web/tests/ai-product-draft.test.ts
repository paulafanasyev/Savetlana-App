/**
 * AI product creation (spec §12): Svetlana prepares a draft card, the seller
 * reviews it, and publication is an explicitly confirmed action. The draft is
 * never visible to buyers, and a card without photo or stock is not published.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { toolRegistry } from "../src/lib/ai/tools";
import { hashPassword } from "../src/lib/auth";

const EMAIL = `draft-seller@${process.env.VITEST_WORKER_ID ?? "0"}.test`;

let userId = "";
let sellerId = "";
let categoryId = "";

beforeAll(async () => {
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    create: {
      email: EMAIL,
      name: "Продавец черновиков",
      role: "SELLER",
      passwordHash: await hashPassword("password123"),
    },
    update: {},
  });
  userId = user.id;

  // A seller must complete onboarding before they can trade (P0 fix, spec §19).
  // Drafting stays available to unverified sellers (spec §112); publishing does not.
  const seller = await prisma.sellerProfile.upsert({
    where: { slug: "draft-seller" },
    create: {
      userId,
      slug: "draft-seller",
      displayName: "Продавец черновиков",
      identityStatus: "VERIFIED",
      businessStatus: "VERIFIED",
      isActivated: true,
    },
    update: { identityStatus: "VERIFIED", businessStatus: "VERIFIED", isActivated: true },
  });
  sellerId = seller.id;

  const category = await prisma.category.upsert({
    where: { slug: "draft-electronics" },
    create: { name: "Черновичная электроника", slug: "draft-electronics" },
    update: {},
  });
  categoryId = category.id;
});

function ctx() {
  return {
    userId,
    role: "seller",
    sellerProfileId: sellerId,
    traceId: "test-draft",
    confirm: async () => true,
  };
}

describe("AI product draft (spec §12)", () => {
  it("creates a draft card that is invisible to buyers", async () => {
    const tool = toolRegistry.get("create_product_draft");
    expect(tool).toBeDefined();

    const result = await tool!.execute(ctx(), {
      title: "Беспроводные наушники",
      description: "Полноразмерные наушники с активным шумоподавлением.",
      priceRub: 8990,
      categorySlug: "draft-electronics",
      keywords: ["наушники", "беспроводные"],
      attributes: { тип: "накладные" },
    });

    expect(result.ok).toBe(true);
    const draft = result.data as {
      productId: string;
      sku: string;
      status: string;
      needsSellerApproval: boolean;
    };
    expect(draft.status).toBe("DRAFT");
    expect(draft.needsSellerApproval).toBe(true);

    const product = await prisma.product.findUnique({
      where: { id: draft.productId },
      include: { images: true },
    });
    expect(product).not.toBeNull();
    expect(product!.status).toBe("DRAFT");
    expect(product!.sellerId).toBe(sellerId);
    expect(product!.categoryId).toBe(categoryId);
    expect(product!.priceKopecks).toBe(8990 * 100);
    expect(JSON.parse(product!.keywords as string)).toEqual(["наушники", "беспроводные"]);
    expect(JSON.parse(product!.attributes as string)).toEqual({ тип: "накладные" });
    expect(product!.aiGeneratedFrom).toBe("seller-photo-assistant");

    // A draft must never appear as a live listing.
    const listing = await prisma.listing.findUnique({ where: { productId: draft.productId } });
    expect(listing ?? { isLive: false }).toMatchObject({ isLive: false });

    // Creation is recorded in the listing history (audit trail, spec §11).
    const history = await prisma.listingHistory.findMany({
      where: { productId: draft.productId, action: "AI_DRAFT_CREATED" },
    });
    expect(history.length).toBe(1);
  });

  it("refuses to create a draft without a meaningful title", async () => {
    const tool = toolRegistry.get("create_product_draft");
    const result = await tool!.execute(ctx(), { title: "??", description: "что-то" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("название");
  });

  it("attaches the image and derives a search slug", async () => {
    const tool = toolRegistry.get("create_product_draft");
    const result = await tool!.execute(ctx(), {
      title: "Умная колонка",
      description: "Колонка с голосовым ассистентом.",
      imageUrl: "https://example.com/speaker.jpg",
    });
    const draft = result.data as { productId: string };

    const product = await prisma.product.findUnique({
      where: { id: draft.productId },
      include: { images: true },
    });
    expect(product!.images).toHaveLength(1);
    expect(product!.images[0].url).toBe("https://example.com/speaker.jpg");
    expect(product!.images[0].isPrimary).toBe(true);
    expect(product!.seoSlug).toContain("umnaya-kolonka");
  });
});

describe("AI draft publication (spec §12, §147)", () => {
  let draftId = "";

  beforeAll(async () => {
    const tool = toolRegistry.get("create_product_draft");
    const result = await tool!.execute(ctx(), {
      title: "Планшет для публикаций",
      description: "Лёгкий планшет для чтения и работы.",
      priceRub: 15000,
    });
    expect(result.ok).toBe(true);
    draftId = (result.data as { productId: string }).productId;
  });

  it("refuses to publish a card without photo and stock", async () => {
    const tool = toolRegistry.get("publish_product");
    const result = await tool!.execute(ctx(), { productId: draftId });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("фото");
    expect(result.error).toContain("остаток");
    const product = await prisma.product.findUnique({ where: { id: draftId } });
    expect(product!.status).toBe("DRAFT");
  });

  it("publishes a reviewed draft and makes it visible to buyers", async () => {
    await prisma.productImage.create({ data: { productId: draftId, url: "https://example.com/tablet.jpg", isPrimary: true, position: 0 } });
    await prisma.inventory.upsert({ where: { productId: draftId }, create: { productId: draftId, quantity: 3 }, update: { quantity: 3 } });

    const tool = toolRegistry.get("publish_product");
    const result = await tool!.execute(ctx(), { productId: draftId });
    expect(result.ok).toBe(true);

    const product = await prisma.product.findUnique({
      where: { id: draftId },
      include: { listing: true },
    });
    expect(product!.status).toBe("ACTIVE");
    expect(product!.listing?.isLive).toBe(true);

    const history = await prisma.listingHistory.findMany({
      where: { productId: draftId, action: "PUBLISHED" },
    });
    expect(history.length).toBe(1);
  });

  it("does not publish another seller's draft", async () => {
    const other = await prisma.user.upsert({
      where: { email: `draft-other@${process.env.VITEST_WORKER_ID ?? "0"}.test` },
      create: {
        email: `draft-other@${process.env.VITEST_WORKER_ID ?? "0"}.test`,
        name: "Другой продавец",
        role: "SELLER",
        passwordHash: await hashPassword("password123"),
      },
      update: {},
    });
    const otherSeller = await prisma.sellerProfile.upsert({
      where: { slug: "draft-other" },
      create: {
        userId: other.id,
        slug: "draft-other",
        displayName: "Другой продавец",
        identityStatus: "VERIFIED",
        businessStatus: "VERIFIED",
        isActivated: true,
      },
      update: { identityStatus: "VERIFIED", businessStatus: "VERIFIED", isActivated: true },
    });

    const mine = await prisma.product.create({
      data: {
        sellerId,
        sku: "DRAFT-OWNER-1",
        title: "Мой товар",
        priceKopecks: 1000,
        status: "DRAFT",
      },
    });

    const tool = toolRegistry.get("publish_product");
    const result = await tool!.execute(
      {
        userId: other.id,
        role: "seller",
        sellerProfileId: otherSeller.id,
        traceId: "test-draft-other",
        confirm: async () => true,
      },
      { productId: mine.id }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("другому продавцу");
  });

  it("refuses to publish when the seller has not completed verification (P0-4)", async () => {
    const unverified = await prisma.user.upsert({
      where: { email: `draft-unverified@${process.env.VITEST_WORKER_ID ?? "0"}.test` },
      create: {
        email: `draft-unverified@${process.env.VITEST_WORKER_ID ?? "0"}.test`,
        name: "Неверифицированный продавец",
        role: "SELLER",
        passwordHash: await hashPassword("password123"),
      },
      update: {},
    });
    const unverifiedSeller = await prisma.sellerProfile.upsert({
      where: { slug: "draft-unverified" },
      create: { userId: unverified.id, slug: "draft-unverified", displayName: "Неверифицированный" },
      update: { identityStatus: "UNVERIFIED", businessStatus: "UNVERIFIED", isActivated: false },
    });
    const mine = await prisma.product.create({
      data: {
        sellerId: unverifiedSeller.id,
        sku: "DRAFT-UNVERIFIED-1",
        title: "Товар без проверки",
        priceKopecks: 1000,
        status: "DRAFT",
      },
    });

    const tool = toolRegistry.get("publish_product");
    const result = await tool!.execute(
      {
        userId: unverified.id,
        role: "seller",
        sellerProfileId: unverifiedSeller.id,
        traceId: "test-draft-unverified",
        confirm: async () => true,
      },
      { productId: mine.id }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Нельзя публиковать товар");

    // The draft is still invisible to buyers.
    const product = await prisma.product.findUnique({ where: { id: mine.id } });
    expect(product!.status).toBe("DRAFT");
  });
});
