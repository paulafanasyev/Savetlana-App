/**
 * Реквизиты продавца для выплат банковским переводом.
 *
 * Хранятся зашифрованными (AES-256-GCM, ключ SVETLANA_SECRET_KEY) в записи
 * IntegrationLink с provider = "bank_requisites": в базе нет открытого номера
 * счёта, а в профиле продавца остаются только последние 4 цифры.
 *
 * Проверки как в банке: БИК, контрольный ключ расчётного и корреспондентского
 * счёта, контрольные цифры ИНН. ИНН получателя должен совпадать с ИНН магазина,
 * чтобы выплату нельзя было перенаправить на чужой счёт.
 * После смены счёта выплаты на 48 часов приостанавливаются (account-security).
 */
import { prisma } from "../prisma";
import { storeSecret, loadSecret } from "./secret-store";
import { audit } from "./audit";
import { notify } from "./notifications";
import { flagBankDetailsChange } from "./account-security";

export const BANK_DETAILS_PROVIDER = "bank_requisites";

export interface BankDetails {
  recipientName: string;
  inn: string;
  kpp?: string;
  bik: string;
  account: string;
  corrAccount: string;
  bankName: string;
}

export type BankDetailsErrors = Partial<Record<keyof BankDetails, string>>;

export function digitsOnly(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** Контрольные цифры ИНН (10 цифр у организаций, 12 у физлиц и ИП). */
export function isValidInn(inn: string): boolean {
  if (!/^(\d{10}|\d{12})$/.test(inn)) return false;
  const d = inn.split("").map(Number);
  const check = (weights: number[]) => (weights.reduce((s, w, i) => s + w * d[i], 0) % 11) % 10;
  if (inn.length === 10) return check([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  return check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && check([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
}

/** Контрольный ключ счёта по методике Банка России (веса 7, 1, 3). */
function controlKeyOk(prefix3: string, account20: string): boolean {
  const s = prefix3 + account20;
  if (!/^\d{23}$/.test(s)) return false;
  const weights = [7, 1, 3];
  let sum = 0;
  for (let i = 0; i < 23; i++) sum += (Number(s[i]) * weights[i % 3]) % 10;
  return sum % 10 === 0;
}

export function isValidBik(bik: string): boolean {
  return /^04\d{7}$/.test(bik);
}

export function isValidAccount(account: string, bik: string): boolean {
  return /^\d{20}$/.test(account) && isValidBik(bik) && controlKeyOk(bik.slice(-3), account);
}

export function isValidCorrAccount(corr: string, bik: string): boolean {
  return /^301\d{17}$/.test(corr) && isValidBik(bik) && controlKeyOk(`0${bik.slice(4, 6)}`, corr);
}

export function maskAccount(account: string): string {
  return `•••• ${account.slice(-4)}`;
}

/** Чистая функция: приводит ввод к виду банка и проверяет каждое поле. */
export function validateBankDetails(raw: Record<string, unknown>, shopInn?: string | null): { details?: BankDetails; errors: BankDetailsErrors } {
  const details: BankDetails = {
    recipientName: String(raw.recipientName ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
    inn: digitsOnly(raw.inn),
    kpp: digitsOnly(raw.kpp) || undefined,
    bik: digitsOnly(raw.bik),
    account: digitsOnly(raw.account),
    corrAccount: digitsOnly(raw.corrAccount),
    bankName: String(raw.bankName ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
  };
  const errors: BankDetailsErrors = {};
  if (details.recipientName.length < 3) errors.recipientName = "Укажите получателя, как в банке: ФИО, ИП или название организации";
  if (!isValidInn(details.inn)) errors.inn = "ИНН с ошибкой: проверьте цифры";
  else if (shopInn && digitsOnly(shopInn) && digitsOnly(shopInn) !== details.inn) errors.inn = "ИНН получателя должен совпадать с ИНН вашего магазина";
  if (details.kpp && !/^\d{9}$/.test(details.kpp)) errors.kpp = "КПП из 9 цифр (только у организаций)";
  if (!isValidBik(details.bik)) errors.bik = "БИК из 9 цифр, начинается с 04";
  if (!isValidAccount(details.account, details.bik)) errors.account = "Расчётный счёт из 20 цифр не сходится с БИК: проверьте счёт и БИК";
  if (!isValidCorrAccount(details.corrAccount, details.bik)) errors.corrAccount = "Корреспондентский счёт начинается с 301 и должен сходиться с БИК";
  if (details.bankName.length < 3) errors.bankName = "Укажите название банка";
  return Object.keys(errors).length ? { errors } : { details, errors };
}

export async function loadBankDetails(sellerId: string): Promise<BankDetails | null> {
  const link = await prisma.integrationLink.findUnique({
    where: { provider_externalId: { provider: BANK_DETAILS_PROVIDER, externalId: sellerId } },
    select: { secretBlob: true, status: true },
  });
  if (!link || link.status !== "ACTIVE") return null;
  const secret = loadSecret(link.secretBlob);
  if (!secret) return null;
  try {
    return JSON.parse(secret.value) as BankDetails;
  } catch {
    return null;
  }
}

/** Что продавец видит о своих реквизитах: без полного номера счёта. */
export async function bankDetailsSummary(sellerId: string): Promise<{ recipientName: string; bankName: string; bik: string; accountMasked: string } | null> {
  const d = await loadBankDetails(sellerId);
  return d ? { recipientName: d.recipientName, bankName: d.bankName, bik: d.bik, accountMasked: maskAccount(d.account) } : null;
}

export async function saveBankDetails(input: { sellerId: string; actorId: string; raw: Record<string, unknown> }): Promise<{ ok: true; accountMasked: string } | { ok: false; errors: BankDetailsErrors }> {
  const seller = await prisma.sellerProfile.findUniqueOrThrow({ where: { id: input.sellerId }, select: { inn: true, userId: true } });
  const { details, errors } = validateBankDetails(input.raw, seller.inn);
  if (!details) return { ok: false, errors };

  const secretBlob = storeSecret({ value: JSON.stringify(details), expiresAt: null });
  const previous = await prisma.integrationLink.findUnique({
    where: { provider_externalId: { provider: BANK_DETAILS_PROVIDER, externalId: input.sellerId } },
    select: { id: true },
  });
  await prisma.integrationLink.upsert({
    where: { provider_externalId: { provider: BANK_DETAILS_PROVIDER, externalId: input.sellerId } },
    create: { provider: BANK_DETAILS_PROVIDER, externalId: input.sellerId, sellerId: input.sellerId, status: "ACTIVE", secretBlob },
    update: { status: "ACTIVE", secretBlob, unlinkedAt: null },
  });
  const accountMasked = maskAccount(details.account);
  await prisma.sellerProfile.update({ where: { id: input.sellerId }, data: { bankAccountMasked: accountMasked } });
  await audit({
    actorId: input.actorId,
    actorRole: "seller",
    action: previous ? "seller.bank_details_changed" : "seller.bank_details_added",
    targetType: "SellerProfile",
    targetId: input.sellerId,
    after: { bik: details.bik, account: accountMasked, inn: details.inn },
  });
  // Смена счёта: запись в риски (особенно опасно сразу после входа с нового устройства).
  if (previous) await flagBankDetailsChange(input.sellerId, seller.userId).catch(() => undefined);
  // Смена счёта для выплат: продавец должен узнать, если это сделал не он.
  await notify({
    userId: seller.userId,
    kind: "security",
    title: previous ? "Реквизиты для выплат изменены" : "Реквизиты для выплат сохранены",
    body: previous
      ? `Выплаты будут приходить на счёт ${accountMasked} в ${details.bankName}. Для защиты от мошенников выплаты на новый счёт начнутся через 48 часов. Если это были не вы, смените пароль и напишите в поддержку.`
      : `Выплаты будут приходить на счёт ${accountMasked} в ${details.bankName}. Если это были не вы, смените пароль и напишите в поддержку.`,
    url: "/seller/payouts",
  });
  return { ok: true, accountMasked };
}
