import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { getSellerOnboardingGate, assertSellerCanTrade } from "../src/lib/domains/seller-onboarding";

const UNVERIFIED_ID = "onboarding-seller-unverified";
const VERIFIED_ID = "onboarding-seller-verified";

async function seedSeller(id: string, slug: string) {
  const userId = `${id}-user`;
  await prisma.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      email: `${slug}@svetlana.example`,
      passwordHash: "x",
      role: "SELLER",
    },
    update: {},
  });
  // Fresh seller rows per run: delete first so statuses are deterministic.
  await prisma.sellerProfile.deleteMany({ where: { id } });
  return prisma.sellerProfile.create({
    data: {
      id,
      userId,
      displayName: `Продавец ${slug}`,
      slug,
      identityStatus: "UNVERIFIED",
      businessStatus: "UNVERIFIED",
      npdStatus: "UNVERIFIED",
      isActivated: false,
    },
  });
}

describe("seller onboarding gate (P0 fix)", () => {
  beforeAll(async () => {
    await seedSeller(UNVERIFIED_ID, "onb-unverified");
    const verified = await seedSeller(VERIFIED_ID, "onb-verified");
    await prisma.sellerProfile.update({
      where: { id: verified.id },
      data: {
        identityStatus: "VERIFIED",
        npdStatus: "VERIFIED",
        isActivated: true,
      },
    });
  });

  it("blocks a freshly registered seller from trading", async () => {
    const gate = await getSellerOnboardingGate(UNVERIFIED_ID);
    expect(gate.active).toBe(false);
    expect(gate.blockers).toContain("личность не подтверждена");
    expect(gate.nextStep).toMatch(/личности/);
  });

  it("blocks a seller whose identity passed but business status did not", async () => {
    await prisma.sellerProfile.update({
      where: { id: UNVERIFIED_ID },
      data: { identityStatus: "VERIFIED" },
    });
    const gate = await getSellerOnboardingGate(UNVERIFIED_ID);
    expect(gate.active).toBe(false);
    expect(gate.blockers).toContain("статус бизнеса или самозанятости не подтверждён");
    await prisma.sellerProfile.update({
      where: { id: UNVERIFIED_ID },
      data: { identityStatus: "UNVERIFIED" },
    });
  });

  it("blocks a verified-but-deactivated seller", async () => {
    await prisma.sellerProfile.update({
      where: { id: VERIFIED_ID },
      data: { isActivated: false },
    });
    const gate = await getSellerOnboardingGate(VERIFIED_ID);
    expect(gate.active).toBe(false);
    expect(gate.blockers).toContain("аккаунт продавца не активирован");
    await prisma.sellerProfile.update({
      where: { id: VERIFIED_ID },
      data: { isActivated: true },
    });
  });

  it("admits a fully verified and activated seller", async () => {
    const gate = await getSellerOnboardingGate(VERIFIED_ID);
    expect(gate.active).toBe(true);
    expect(gate.blockers).toEqual([]);
    expect(gate.state).toBe("ACTIVE");
  });

  it("throws an actionable error for a blocked trading action", async () => {
    await expect(
      assertSellerCanTrade(UNVERIFIED_ID, "публиковать товары")
    ).rejects.toThrow(/Нельзя публиковать товары.*личность не подтверждена/);
  });

  it("lets a verified seller trade", async () => {
    const gate = await assertSellerCanTrade(VERIFIED_ID, "публиковать товары");
    expect(gate.active).toBe(true);
  });
});
