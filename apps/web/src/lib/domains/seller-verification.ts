import { z } from "zod";
import { prisma } from "../prisma";
import { audit } from "./audit";
import { isValidInn, isValidOgrn } from "../legal";
import { checkNpdStatus, type NpdCheckResult } from "./npd-check";

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
  // Самозанятого сразу проверяем в ФНС: ответ сервиса и есть отметка.
  // Сбой проверки не ломает заявку, она остаётся на модерации.
  const npd = parsed.sellerType === "SELF_EMPLOYED" ? await verifySellerNpd(sellerId, actorId).catch(() => null) : null;
  return { seller, record, npd };
}

/** Последняя попытка проверки в ФНС по продавцу (защита от частых запросов). */
const lastNpdAttempt = new Map<string, number>();
const NPD_THROTTLE_MS = 60_000;

/**
 * Проверка статуса самозанятого в ФНС и запись результата. VERIFIED и
 * REJECTED ставит только ответ ФНС; если сервис недоступен, статус не меняется
 * и запись о проверке не создаётся (только журнал).
 * Не чаще раза в минуту на продавца: у ФНС ограничение частоты.
 */
export async function verifySellerNpd(
  sellerId: string,
  actorId: string,
  opts: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<NpdCheckResult> {
  const seller = await prisma.sellerProfile.findUniqueOrThrow({ where: { id: sellerId }, select: { inn: true, npdStatus: true, sellerType: true } });
  const now = opts.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  if (seller.sellerType !== "SELF_EMPLOYED") {
    return { status: "UNAVAILABLE", message: "проверка в ФНС нужна только самозанятым", requestDate: today };
  }
  const last = lastNpdAttempt.get(sellerId);
  const recent = await prisma.verificationRecord.findFirst({
    where: { sellerId, kind: "npd", source: "fns", createdAt: { gt: new Date(now.getTime() - NPD_THROTTLE_MS) } },
    select: { id: true },
  });
  if (recent || (last !== undefined && now.getTime() - last < NPD_THROTTLE_MS)) {
    return { status: "UNAVAILABLE", message: "проверка уже была меньше минуты назад, повторите позже", requestDate: today };
  }
  lastNpdAttempt.set(sellerId, now.getTime());
  const result = await checkNpdStatus(seller.inn ?? "", { fetchImpl: opts.fetchImpl, now });
  if (result.status !== "UNAVAILABLE") {
    await prisma.verificationRecord.create({
      data: {
        sellerId,
        kind: "npd",
        status: result.status,
        source: "fns",
        externalRef: "statusnpd.nalog.ru",
        checkedFields: JSON.stringify({ inn: true, requestDate: result.requestDate }),
        note: result.message,
        verifiedAt: result.status === "VERIFIED" ? now : null,
      },
    });
    if (seller.npdStatus !== result.status) {
      await prisma.sellerProfile.update({ where: { id: sellerId }, data: { npdStatus: result.status } });
    }
  }
  await audit({
    actorId,
    actorRole: "seller",
    action: "seller_npd_checked",
    targetType: "SellerProfile",
    targetId: sellerId,
    before: { npdStatus: seller.npdStatus },
    after: { npdStatus: result.status === "UNAVAILABLE" ? seller.npdStatus : result.status, source: "fns", result: result.status },
  });
  return result;
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
  // Автоматическая проверка ФНС не заменяет заявку: статус заявки считаем по
  // записям модерации, а ответ ФНС отдаём отдельно.
  const latest = records.find((r) => r.source !== "fns") ?? null;
  const npdCheck = records.find((r) => r.source === "fns") ?? null;
  const status = seller.isActivated && seller.identityStatus === "VERIFIED" && (seller.businessStatus === "VERIFIED" || seller.npdStatus === "VERIFIED")
    ? "APPROVED"
    : latest?.status === "REJECTED" ? "REJECTED" : latest?.status === "PENDING" ? "PENDING" : "NOT_SUBMITTED";
  return { seller, status, latest, npdCheck, records };
}
