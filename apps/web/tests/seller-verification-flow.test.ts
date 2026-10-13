import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { ensureBaseCategories } from "../src/lib/domains/categories";
import { submitSellerOnboarding } from "../src/lib/domains/seller-verification";
import { decideVerification, listVerificationQueue } from "../src/lib/domains/admin";
import { getSellerOnboardingGate } from "../src/lib/domains/seller-onboarding";
import { promoteConfiguredAdmin } from "../src/lib/domains/admin-bootstrap";
import { env } from "../src/lib/env";

const worker = process.env.VITEST_WORKER_ID ?? "0";
const userId = `flow-user-${worker}`;
const sellerId = `flow-seller-${worker}`;
let adminId = "";

describe("путь проверки продавца", () => {
  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: userId }, create: { id: userId, email: `flow-${worker}@test.example`, name: "Тестовый продавец", passwordHash: "x", role: "SELLER" }, update: { role: "SELLER" } });
    await prisma.sellerProfile.deleteMany({ where: { id: sellerId } });
    await prisma.sellerProfile.create({ data: { id: sellerId, userId, slug: `flow-seller-${worker}`, displayName: "Магазин", isActivated: false } });
    const admin = await prisma.user.create({ data: { email: `flow-admin-${worker}-${Date.now()}@test.example`, name: "Администратор", passwordHash: "x", role: "ADMIN" } });
    adminId = admin.id;
  });

  it("отклоняет ИНН с неверной контрольной суммой", async () => {
    await expect(submitSellerOnboarding(sellerId, { sellerType: "SELF_EMPLOYED", displayName: "Магазин", inn: "7707083894" }, userId)).rejects.toThrow(/ИНН/);
  });

  it("создаёт заявку и показывает её в очереди", async () => {
    const result = await submitSellerOnboarding(sellerId, { sellerType: "SELF_EMPLOYED", displayName: "Магазин тест", inn: "500100732259" }, userId);
    expect(result.record.status).toBe("PENDING");
    expect(result.record.source).toBe("manual_review");
    expect((await listVerificationQueue(500)).some((item) => item.id === sellerId)).toBe(true);
  });

  it("одобряет заявку, активирует продавца и убирает из очереди", async () => {
    await decideVerification(sellerId, "npd", true, "Данные проверены", adminId);
    const seller = await prisma.sellerProfile.findUniqueOrThrow({ where: { id: sellerId } });
    expect(seller.isActivated).toBe(true);
    expect(seller.identityStatus).toBe("VERIFIED");
    expect((await getSellerOnboardingGate(sellerId)).active).toBe(true);
    expect((await listVerificationQueue(500)).some((item) => item.id === sellerId)).toBe(false);
  });

  it("отклонённая заявка не открывает публикацию", async () => {
    await prisma.sellerProfile.update({ where: { id: sellerId }, data: { isActivated: false, npdStatus: "REJECTED" } });
    await decideVerification(sellerId, "npd", false, "Не подтверждён статус", adminId);
    expect((await getSellerOnboardingGate(sellerId)).active).toBe(false);
    expect((await prisma.verificationRecord.findFirstOrThrow({ where: { sellerId }, orderBy: { createdAt: "desc" } })).note).toContain("Не подтверждён");
  });

  it("повторное создание базовых категорий безопасно", async () => {
    const first = await ensureBaseCategories();
    const second = await ensureBaseCategories();
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(first.length);
    expect(new Set(second.map((category) => category.slug)).size).toBe(second.length);
  });

  it("повышает пользователя из ADMIN_EMAILS, если адрес настроен", async () => {
    if (!env.adminEmails[0]) return;
    const email = env.adminEmails[0];
    const user = await prisma.user.create({ data: { email: `bootstrap-${worker}-${Date.now()}@test.example`, passwordHash: "x", role: "BUYER" } });
    await prisma.user.update({ where: { id: user.id }, data: { email } });
    expect(await promoteConfiguredAdmin(user.id, email)).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe("ADMIN");
  });
});
