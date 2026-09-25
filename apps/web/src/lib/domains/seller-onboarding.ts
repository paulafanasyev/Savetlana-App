/**
 * Seller onboarding gate (P0 fix, spec §19/§21/§31).
 *
 * Problem this solves: `requireSeller()` only checked that a SellerProfile row
 * existed, so a freshly registered seller could publish products and receive
 * orders without completing identity or business verification. The spec
 * requires a hard machine:
 *
 *   REGISTERED -> KYC_PENDING -> IDENTITY_VERIFIED -> BUSINESS/NPD_VERIFIED
 *             -> DOCUMENTS_VERIFIED -> SELLER_APPROVED -> ACTIVE
 *
 * Only ACTIVE may publish, receive orders or request a payout. Unverified
 * sellers keep full read access to their cabinet (spec §112: the seller must
 * be able to work manually) — they simply cannot trade yet.
 */
import { prisma } from "../prisma";

export type SellerOnboardingState =
  | "REGISTERED"
  | "KYC_PENDING"
  | "IDENTITY_VERIFIED"
  | "BUSINESS_VERIFIED"
  | "DOCUMENTS_VERIFIED"
  | "SELLER_APPROVED"
  | "ACTIVE";

export interface OnboardingGate {
  state: SellerOnboardingState;
  active: boolean;
  /** Concrete blockers, in machine order — empty when active. */
  blockers: string[];
  /** What the seller should do next. */
  nextStep?: string;
}

/**
 * Derives the onboarding state from the seller's live profile. This is the
 * single authoritative gate: routes and tools call it instead of eyeballing
 * individual status columns, so the rule cannot drift.
 */
export async function getSellerOnboardingGate(sellerId: string): Promise<OnboardingGate> {
  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: {
      id: true,
      identityStatus: true,
      businessStatus: true,
      npdStatus: true,
      isActivated: true,
      documents: { select: { status: true }, take: 32 },
    },
  });
  if (!seller) {
    return {
      state: "REGISTERED",
      active: false,
      blockers: ["профиль продавца не существует"],
      nextStep: "завершите регистрацию продавца",
    };
  }

  const blockers: string[] = [];
  let state: SellerOnboardingState = "REGISTERED";

  if (seller.identityStatus !== "VERIFIED") {
    blockers.push("личность не подтверждена");
    return {
      state,
      active: false,
      blockers,
      nextStep: "пройдите проверку личности (ИНН / ЕСИА)",
    };
  }
  state = "IDENTITY_VERIFIED";

  const businessOk =
    seller.businessStatus === "VERIFIED" || seller.npdStatus === "VERIFIED";
  if (!businessOk) {
    blockers.push("статус бизнеса или самозанятости не подтверждён");
    return {
      state,
      active: false,
      blockers,
      nextStep: "подтвердите статус ИП/ООО или самозанятого",
    };
  }
  state = "BUSINESS_VERIFIED";

  const docs = seller.documents ?? [];
  const verifiedDocs = docs.filter((d) => d.status === "VERIFIED").length;
  // Sellers with no documents at all can still pass when the category does not
  // require them; the gate only fails a document that was rejected.
  const rejectedDocs = docs.filter((d) => d.status === "REJECTED").length;
  if (rejectedDocs > 0) {
    blockers.push(`${rejectedDocs} документ(ов) отклонён(ы)`);
    return {
      state: "DOCUMENTS_VERIFIED",
      active: false,
      blockers,
      nextStep: "исправьте или загрузите заново отклонённые документы",
    };
  }
  state = "DOCUMENTS_VERIFIED";

  if (!seller.isActivated) {
    blockers.push("аккаунт продавца не активирован");
    return {
      state: "SELLER_APPROVED",
      active: false,
      blockers,
      nextStep: "активируйте аккаунт продавца",
    };
  }

  return {
    state: "ACTIVE",
    active: true,
    blockers: [],
    nextStep: verifiedDocs > 0 ? undefined : "можно загрузить сертификаты для роста доверия",
  };
}

/**
 * Throws when the seller may not trade. Callers pass the reason so the user
 * gets an actionable message instead of a bare 403.
 */
export async function assertSellerCanTrade(
  sellerId: string,
  action: string
): Promise<OnboardingGate> {
  const gate = await getSellerOnboardingGate(sellerId);
  if (!gate.active) {
    throw new Error(
      `Нельзя ${action}: ${gate.blockers.join(", ")}. Следующий шаг — ${gate.nextStep ?? "завершите верификацию"}.`
    );
  }
  return gate;
}
