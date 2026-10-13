import { z } from "zod";
import { prisma } from "../prisma";
import { audit } from "./audit";
import { isValidInn, isValidOgrn } from "../legal";

export const sellerOnboardingSchema = z.object({
  sellerType: z.enum(["SELF_EMPLOYED", "IP", "COMPANY"]),
  displayName: z.string().trim().min(2, "Укажите название магазина").max(120),
  inn: z.string().trim().regex(/^\d{10}$|^\d{12}$/, "ИНН должен содержать 10 или 12 цифр"),
  ogrn: z.string().trim().optional(),
});

export type SellerOnboardingInput = z.infer<typeof sellerOnboardingSchema>;

export async function submitSellerOnboarding(sellerId: string, input: SellerOnboardingInput, actorId: string) {
  const parsed = sellerOnboardingSchema.parse(input);
  if (!isValidInn(parsed.inn)) throw new Error("ИНН не прошёл проверку контрольной суммы");
  const needsOgrn = parsed.sellerType === "IP" || parsed.sellerType === "COMPANY";
  if (needsOgrn && !parsed.ogrn) throw new Error("Укажите ОГРН или ОГРНИП");
  if (parsed.ogrn && !isValidOgrn(parsed.ogrn)) throw new Error("ОГРН или ОГРНИП не прошёл проверку контрольной суммы");

  const businessKind = parsed.sellerType === "SELF_EMPLOYED" ? "npd" : "business";
  const seller = await prisma.sellerProfile.update({
    where: { id: sellerId },
    data: {
      sellerType: parsed.sellerType,
      displayName: parsed.displayName,
      inn: parsed.inn,
      ogrn: needsOgrn ? parsed.ogrn : null,
      identityStatus: "PENDING",
      businessStatus: "PENDING",
      npdStatus: "PENDING",
      isActivated: false,
    },
  });
  const record = await prisma.verificationRecord.create({
    data: {
      sellerId,
      kind: businessKind,
      status: "PENDING",
      source: "manual_review",
      checkedFields: JSON.stringify({ sellerType: parsed.sellerType, inn: true, ogrn: Boolean(parsed.ogrn) }),
    },
  });
  await audit({
    actorId,
    actorRole: "seller",
    action: "seller_onboarding_submitted",
    targetType: "SellerProfile",
    targetId: sellerId,
    after: { recordId: record.id, kind: businessKind, sellerType: seller.sellerType },
  });
  return { seller, record };
}

export async function getSellerVerificationStatus(sellerId: string) {
  const seller = await prisma.sellerProfile.findUniqueOrThrow({
    where: { id: sellerId },
    select: { id: true, sellerType: true, displayName: true, inn: true, ogrn: true, identityStatus: true, businessStatus: true, npdStatus: true, isActivated: true },
  });
  const records = await prisma.verificationRecord.findMany({
    where: { sellerId }, orderBy: { createdAt: "desc" }, take: 20,
    select: { id: true, kind: true, status: true, source: true, note: true, createdAt: true, verifiedAt: true },
  });
  const latest = records[0] ?? null;
  const status = seller.isActivated && seller.identityStatus === "VERIFIED" && (seller.businessStatus === "VERIFIED" || seller.npdStatus === "VERIFIED")
    ? "APPROVED"
    : latest?.status === "REJECTED" ? "REJECTED" : latest?.status === "PENDING" ? "PENDING" : "NOT_SUBMITTED";
  return { seller, status, latest, records };
}
