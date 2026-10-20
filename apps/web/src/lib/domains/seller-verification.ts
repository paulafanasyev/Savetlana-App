import { z } from "zod";
import { prisma } from "../prisma";
import { audit } from "./audit";
import { notify } from "./notifications";
import { isValidInn, isValidOgrn } from "../legal";
import { checkNpdStatus, type NpdCheckResult } from "./npd-check";
import { FNS_AUTO_IDENTITY } from "./seller-trust-display";

export const sellerOnboardingSchema = z.object({
  sellerType: z.enum(["SELF_EMPLOYED", "IP", "COMPANY"]),
  displayName: z.string().trim().min(2, "Укажите название магазина").max(120),
  inn: z.string().trim().regex(/^\d{10}$|^\d{12}$/, "ИНН должен содержать 10 или 12 цифр"),
  ogrn: z.string().trim().optional(),
});

export type SellerOnboardingInput = z.infer<typeof sellerOnboardingSchema>;

const SELLER_TYPE_LABEL: Record<string, string> = { SELF_EMPLOYED: "самозанятый", IP: "ИП", COMPANY: "организация" };

/** Уведомление всем администраторам (и в Telegram, если подключён). Сбой не ломает заявку. */
async function notifyAdmins(title: string, body: string): Promise<void> {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isBlocked: false }, select: { id: true }, take: 20 });
  await Promise.all(
    admins.map((a) => notify({ userId: a.id, kind: "document_status", title, body, url: "/admin/verification" }).catch(() => undefined)),
  );
}

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
  // Самозанятого сразу проверяем в ФНС: при подтверждении он одобряется автоматически.
  // Сбой проверки не ломает заявку, она остаётся на модерации.
  const npd = parsed.sellerType === "SELF_EMPLOYED" ? await verifySellerNpd(sellerId, actorId).catch(() => null) : null;
  if (npd?.status !== "VERIFIED") {
    await notifyAdmins(
      "Новая заявка продавца",
      `«${parsed.displayName}» (${SELLER_TYPE_LABEL[parsed.sellerType] ?? "продавец"}) ждёт проверки. Пока заявка не одобрена, продавец не может публиковать товары.`,
    ).catch(() => undefined);
  }
  return { seller, record, npd };
}

/**
 * Автоодобрение самозанятого: ФНС подтвердила НПД по ИНН из отправленной заявки.
 * Магазин сразу может публиковать товары и принимать заказы. Личность при этом
 * не считается проверенной (FNS_AUTO): нет отметки «Личность подтверждена» для
 * покупателей, а выплаты закрыты до ручной проверки. Иначе чужой ИНН давал бы
 * доступ к деньгам покупателей.
 *
 * Срабатывает только по заявке на проверке: отклонённую администратором или ещё не
 * отправленную не трогает.
 */
async function autoApproveSelfEmployed(sellerId: string, actorId: string, now: Date): Promise<boolean> {
  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: { userId: true, displayName: true, sellerType: true, identityStatus: true, npdStatus: true, isActivated: true },
  });
  if (!seller || seller.sellerType !== "SELF_EMPLOYED" || seller.npdStatus !== "VERIFIED" || seller.isActivated) return false;
  const latest = await prisma.verificationRecord.findFirst({
    where: { sellerId, NOT: { source: "fns" } },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });
  if (latest?.status !== "PENDING") return false;
  const identityStatus = seller.identityStatus === "VERIFIED" ? "VERIFIED" : FNS_AUTO_IDENTITY;
  await prisma.verificationRecord.create({
    data: {
      sellerId,
      kind: "npd",
      status: "VERIFIED",
      source: "fns_auto",
      externalRef: "statusnpd.nalog.ru",
      checkedFields: JSON.stringify({ inn: true, identity: identityStatus }),
      note: "Одобрено автоматически: ФНС подтвердила статус самозанятого. Личность не проверена, выплаты после ручной проверки.",
      verifiedAt: now,
    },
  });
  await prisma.sellerProfile.update({ where: { id: sellerId }, data: { isActivated: true, identityStatus } });
  await audit({
    actorId,
    actorRole: "system",
    action: "seller_auto_approved_npd",
    targetType: "SellerProfile",
    targetId: sellerId,
    before: { identityStatus: seller.identityStatus, isActivated: seller.isActivated },
    after: { identityStatus, isActivated: true, source: "fns" },
  });
  await notify({
    userId: seller.userId,
    kind: "document_status",
    title: "Магазин одобрен",
    body: "ФНС подтвердила статус самозанятого, можно публиковать товары и принимать заказы. Первая выплата станет доступна после ручной проверки личности.",
    url: "/seller/products",
  }).catch(() => undefined);
  await notifyAdmins(
    "Самозанятый одобрен по ФНС",
    `«${seller.displayName}» уже торгует: ФНС подтвердила статус самозанятого. Проверьте личность и нажмите «Одобрить»: до этого выплаты ему закрыты.`,
  ).catch(() => undefined);
  return true;
}

/** Последняя попытка проверки в ФНС по продавцу (защита от частых запросов). */
const lastNpdAttempt = new Map<string, number>();
const NPD_THROTTLE_MS = 60_000;

/**
 * Проверка статуса самозанятого в ФНС и запись результата. VERIFIED и
 * REJECTED ставит только ответ ФНС; если сервис недоступен, статус не меняется
 * и запись о проверке не создаётся (только журнал).
 * Не чаще раза в минуту на продавца: у ФНС ограничение частоты.
 * Подтверждение ФНС по заявке на проверке одобряет магазин (см. autoApproveSelfEmployed).
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
  if (result.status === "VERIFIED") {
    // Автоодобрение не должно сломать саму проверку: при сбое заявка остаётся администратору.
    await autoApproveSelfEmployed(sellerId, actorId, now).catch(() => false);
  }
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
  const identityOk = seller.identityStatus === "VERIFIED" || (seller.sellerType === "SELF_EMPLOYED" && seller.identityStatus === FNS_AUTO_IDENTITY && seller.npdStatus === "VERIFIED");
  const status = seller.isActivated && identityOk && (seller.businessStatus === "VERIFIED" || seller.npdStatus === "VERIFIED")
    ? "APPROVED"
    : latest?.status === "REJECTED" ? "REJECTED" : latest?.status === "PENDING" ? "PENDING" : "NOT_SUBMITTED";
  return { seller, status, latest, npdCheck, records, identityPending: seller.identityStatus === FNS_AUTO_IDENTITY };
}
