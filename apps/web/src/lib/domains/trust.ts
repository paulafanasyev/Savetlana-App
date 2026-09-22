/**
 * Trust & Verification (spec §19, §20, §21, §41).
 *
 * HONESTY CONTRACT: this module never claims a verification it did not
 * perform. `VerificationStatus` values map 1:1 to what an official source
 * actually returned. External checks (ЕСИА, ФНС/НПД) are adapters behind
 * interfaces; when no live credential is configured the adapter returns
 * UNAVAILABLE and the record stays UNVERIFIED — never a fake "VERIFIED".
 *
 * Statuses (spec §20):
 *   UNVERIFIED  — nothing checked yet
 *   PENDING     — check submitted, awaiting the authoritative answer
 *   VERIFIED    — authoritative source positively confirmed
 *   REVOKED     — was verified, confirmation withdrawn / expired
 *   REJECTED    — authoritative source contradicted the declared data
 *   UNAVAILABLE — no live integration configured (PENDING_EXTERNAL_ACCESS)
 */
import { prisma } from "../prisma";
import { audit } from "./audit";
import { esiaOfficialSource, isEsiaLive } from "./esia";

export type VerificationStatus =
  | "UNVERIFIED"
  | "PENDING"
  | "VERIFIED"
  | "REVOKED"
  | "REJECTED"
  | "UNAVAILABLE";

export type VerificationKind = "identity" | "npd" | "business" | "document";

export interface VerificationResult {
  status: VerificationStatus;
  checkedFields: Record<string, string>;
  externalRef?: string;
  note?: string;
  /** Name of the authoritative source that produced this verdict. */
  source: string;
}

/**
 * Adapter contract for an official identity/tax source. Both ЕСИА and the
 * ФНС/НПД check implement this; production wiring is PENDING_EXTERNAL_ACCESS
 * until real credentials exist.
 */
export interface OfficialSourceAdapter {
  readonly key: string;
  readonly displayName: string;
  /** True only when a real credential/endpoint is configured. */
  readonly live: boolean;
  checkNpdStatus(input: { inn: string }): Promise<VerificationResult>;
  checkBusiness(input: { inn: string; ogrn?: string }): Promise<VerificationResult>;
  checkIdentity(input: { inn: string }): Promise<VerificationResult>;
}

/**
 * Sandbox adapter. It validates INN format deterministically (real checksum!)
 * but NEVER returns VERIFIED from a live source — it reports UNAVAILABLE so
 * the UI can honestly show "проверка не подключена".
 */
class SandboxOfficialSource implements OfficialSourceAdapter {
  readonly key = "sandbox";
  readonly displayName = "sandbox-rule-engine";
  readonly live = false;

  private innValid(inn: string): boolean {
    // Real Russian INN checksum validation (10-digit for legal entities,
    // 12-digit for individuals / self-employed).
    if (!/^\d{10}$|^\d{12}$/.test(inn)) return false;
    const coeffs10 = [2, 4, 10, 3, 5, 9, 4, 6, 8];
    const coeffs11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
    const coeffs12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
    const digits = inn.split("").map(Number);
    if (inn.length === 10) {
      const sum = digits.slice(0, 9).reduce((a, d, i) => a + d * coeffs10[i], 0);
      return (sum % 11) % 10 === digits[9];
    }
    const s1 = digits.slice(0, 10).reduce((a, d, i) => a + d * coeffs11[i], 0);
    const s2 = digits.slice(0, 11).reduce((a, d, i) => a + d * coeffs12[i], 0);
    return ((s1 % 11) % 10 === digits[10]) && ((s2 % 11) % 11 === digits[11]);
  }

  async checkNpdStatus(input: { inn: string }): Promise<VerificationResult> {
    return {
      status: "UNAVAILABLE",
      checkedFields: { inn: this.innValid(input.inn) ? "format_valid" : "format_invalid" },
      note: "НПД-проверка: нет подключённого официального источника (PENDING_EXTERNAL_ACCESS)",
      source: this.key,
    };
  }
  async checkBusiness(input: { inn: string }): Promise<VerificationResult> {
    return {
      status: "UNAVAILABLE",
      checkedFields: { inn: this.innValid(input.inn) ? "format_valid" : "format_invalid" },
      note: "Проверка ЕГРЮЛ/ЕГРИП: нет подключённого официального источника",
      source: this.key,
    };
  }
  async checkIdentity(input: { inn: string }): Promise<VerificationResult> {
    return {
      status: "UNAVAILABLE",
      checkedFields: { inn: this.innValid(input.inn) ? "format_valid" : "format_invalid" },
      note: "Идентификация: нет подключённого официального источника",
      source: this.key,
    };
  }
}

/**
 * Resolves the official source. ЕСИА is used when its credentials and feature
 * flag are configured; otherwise the sandbox rule engine, which validates INN
 * format but never returns VERIFIED.
 */
export const officialSource: OfficialSourceAdapter = isEsiaLive()
  ? esiaOfficialSource
  : new SandboxOfficialSource();

/**
 * Submits a seller's declared data to the authoritative source and records
 * exactly what came back. The seller profile is only upgraded to VERIFIED
 * when the source itself says VERIFIED.
 */
export async function verifySeller(
  sellerId: string,
  actorId: string
): Promise<{ identity: VerificationStatus; npd: VerificationStatus; business: VerificationStatus }> {
  const seller = await prisma.sellerProfile.findUniqueOrThrow({ where: { id: sellerId } });
  if (!seller.inn) {
    throw new Error("ИНН не указан — проверка невозможна");
  }

  const results = {
    identity: await officialSource.checkIdentity({ inn: seller.inn }),
    npd: await officialSource.checkNpdStatus({ inn: seller.inn }),
    business: await officialSource.checkBusiness({ inn: seller.inn, ogrn: seller.ogrn ?? undefined }),
  };

  for (const [kind, res] of Object.entries(results) as [VerificationKind, VerificationResult][]) {
    await prisma.verificationRecord.create({
      data: {
        sellerId,
        kind,
        status: res.status,
        source: res.source,
        checkedFields: JSON.stringify(res.checkedFields),
        note: res.note,
        verifiedAt: res.status === "VERIFIED" ? new Date() : null,
      },
    });
  }

  const identityStatus = results.identity.status;
  const npdStatus = results.npd.status;
  const businessStatus = results.business.status;

  await prisma.sellerProfile.update({
    where: { id: sellerId },
    data: { identityStatus, npdStatus, businessStatus },
  });

  await audit({
    actorId,
    actorRole: "seller",
    action: "seller_verification_submitted",
    targetType: "SellerProfile",
    targetId: sellerId,
    after: JSON.stringify({ identityStatus, npdStatus, businessStatus }),
  });

  return { identity: identityStatus, npd: npdStatus, business: businessStatus };
}

/**
 * Multi-signal Trust Profile (spec §41). Explicitly not one magic number:
 * each signal is reported separately with its evidence basis.
 */
export async function getTrustProfile(sellerId: string) {
  const seller = await prisma.sellerProfile.findUniqueOrThrow({
    where: { id: sellerId },
    include: {
      verificationRecords: { orderBy: { createdAt: "desc" }, take: 10 },
      documents: { orderBy: { createdAt: "desc" } },
    },
  });

  const sellerOrders = await prisma.order.findMany({
    where: { sellerId },
    select: { id: true },
    take: 500,
  });
  const orderIds = sellerOrders.map((o) => o.id);

  const [orders, reviews, disputes, returns] = await Promise.all([
    prisma.order.count({ where: { sellerId } }),
    prisma.review.count({
      where: { product: { sellerId }, isHidden: false },
    }),
    prisma.dispute.count({ where: { sellerId, status: { not: "RESOLVED" } } }),
    prisma.refund.count({ where: { orderId: { in: orderIds } } }),
  ]);

  const avgRating =
    reviews > 0
      ? (await prisma.review.aggregate({
          where: { product: { sellerId }, isHidden: false },
          _avg: { rating: true },
        }))._avg.rating ?? 0
      : 0;

  const accountAgeDays = Math.max(
    1,
    Math.round((Date.now() - seller.createdAt.getTime()) / (1000 * 60 * 60 * 24))
  );

  const fulfillmentOk = orders > 0 ? Math.max(0, 1 - (returns + disputes) / orders) : 0;

  const signals = {
    identityStatus: seller.identityStatus,
    businessStatus: seller.businessStatus,
    npdStatus: seller.npdStatus,
    accountAgeDays,
    ordersCount: orders,
    avgRating: Number(avgRating.toFixed(2)),
    reviewsCount: reviews,
    openDisputes: disputes,
    returnsCount: returns,
    fulfillmentRate: Number(fulfillmentOk.toFixed(2)),
    documentsVerified: seller.documents.filter((d) => d.status === "VERIFIED").length,
    documentsPending: seller.documents.filter((d) =>
      ["UPLOADED", "PROCESSING", "PENDING_REVIEW"].includes(d.status)
    ).length,
  };

  // Explainable summary, derived only from the signals above.
  const strengths: string[] = [];
  const concerns: string[] = [];
  if (signals.businessStatus === "VERIFIED") strengths.push("бизнес верифицирован");
  if (signals.avgRating >= 4.5) strengths.push(`средний рейтинг ${signals.avgRating.toFixed(1)}`);
  if (signals.fulfillmentRate >= 0.95 && orders > 3) strengths.push("высокая доля успешных сделок");
  if (signals.openDisputes > 2) concerns.push(`открыто споров: ${signals.openDisputes}`);
  if (signals.returnsCount > 3 && orders > 0 && signals.fulfillmentRate < 0.9)
    concerns.push("повышенный уровень возвратов");
  if (signals.identityStatus !== "VERIFIED") concerns.push("личность не подтверждена");

  await prisma.sellerProfile.update({
    where: { id: sellerId },
    data: { trustSignals: JSON.stringify(signals) },
  });

  return { seller, signals, strengths, concerns };
}
