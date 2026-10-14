/**
 * Выплаты продавцам банковским переводом по реестру (PAYOUT_MODE=bank_registry).
 *
 * Как это работает:
 *   1. Продавец сохраняет реквизиты (bank-details.ts) и запрашивает выплату за
 *      доставленные заказы. Выплата резервируется со статусом «в работе», а
 *      реквизиты на этот момент сохраняются зашифрованными вместе с ней: если
 *      продавец потом сменит счёт, уже запрошенная выплата не уйдёт не туда.
 *   2. Администратор выгружает реестр (CSV для просмотра или файл 1С для
 *      загрузки в интернет-банк) и платит со счёта площадки.
 *   3. После оплаты администратор отмечает выплату оплаченной с номером
 *      платёжного поручения. Если банк вернул платёж, отмечает возврат: деньги
 *      снова доступны продавцу к выплате.
 *
 * Платформа сама деньги не двигает и не придумывает статусы: «оплачено»
 * ставит только человек, который видел платёжку.
 */
import { prisma } from "../prisma";
import { storeSecret, loadSecret } from "./secret-store";
import { audit } from "./audit";
import { notify } from "./notifications";
import { loadBankDetails, type BankDetails } from "./bank-details";
import { readySettlementWhere } from "./seller-payouts";

export const REGISTRY_PROVIDER = "bank-registry";
const SNAPSHOT_TYPE = "BANK_REGISTRY";

export function bankRegistryMode(): boolean {
  return process.env.PAYOUT_MODE === "bank_registry";
}

export class RegistryPayoutError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RegistryPayoutError";
  }
}

function rubText(kopecks: number): string {
  return `${(kopecks / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

export async function requestRegistryPayout(input: { sellerId: string; actorId: string; idempotencyKey: string }) {
  const details = await loadBankDetails(input.sellerId);
  if (!details) throw new RegistryPayoutError("bank_details_required", "Сначала укажите реквизиты для выплат");
  const snapshot = storeSecret({ value: JSON.stringify(details), expiresAt: null });

  const reserved = await prisma.$transaction(async (tx) => {
    const existing = await tx.payout.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { payoutId: existing.id, amountKopecks: existing.amountKopecks };
    const ready = await tx.settlement.findMany({ where: readySettlementWhere(input.sellerId), orderBy: { createdAt: "asc" } });
    if (ready.length === 0) return null;
    const total = ready.reduce((sum, s) => sum + s.payoutKopecks, 0);
    const payout = await tx.payout.create({
      data: {
        sellerId: input.sellerId,
        provider: REGISTRY_PROVIDER,
        idempotencyKey: input.idempotencyKey,
        amountKopecks: total,
        status: "IN_PROGRESS",
        settlements: { connect: ready.map((s) => ({ id: s.id })) },
      },
    });
    await tx.settlement.updateMany({ where: { id: { in: ready.map((s) => s.id) } }, data: { status: "AVAILABLE", payoutId: payout.id } });
    // Реквизиты на момент запроса, зашифрованные. Обработчик выплат партнёра
    // берёт только PAYOUT_REQUEST, поэтому эту запись никто не отправит сам.
    await tx.outboxMessage.create({
      data: { aggregate: "payout", aggregateId: payout.id, type: SNAPSHOT_TYPE, payload: JSON.stringify({ requisites: snapshot }) },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorRole: "SELLER",
        action: "PAYOUT_REQUESTED",
        targetType: "Payout",
        targetId: payout.id,
        before: String(null),
        after: JSON.stringify({ amountKopecks: total, provider: REGISTRY_PROVIDER, account: `•••• ${details.account.slice(-4)}` }),
      },
    });
    return { payoutId: payout.id, amountKopecks: total };
  });
  if (!reserved) return { payoutId: null, amountKopecks: 0, status: "NOTHING_TO_PAYOUT", sandbox: false };
  return { payoutId: reserved.payoutId, amountKopecks: reserved.amountKopecks, status: "IN_PROGRESS", sandbox: false };
}

export interface RegistryRow {
  payoutId: string;
  sellerId: string;
  sellerName: string;
  amountKopecks: number;
  createdAt: Date;
  details: BankDetails | null;
}

/** Выплаты, которые ждут перевода из банка площадки. */
export async function registryRows(limit = 500): Promise<RegistryRow[]> {
  const payouts = await prisma.payout.findMany({
    where: { provider: REGISTRY_PROVIDER, status: "IN_PROGRESS" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, sellerId: true, amountKopecks: true, createdAt: true, sellerProfile: { select: { displayName: true } } },
  });
  if (payouts.length === 0) return [];
  const snapshots = await prisma.outboxMessage.findMany({
    where: { aggregate: "payout", type: SNAPSHOT_TYPE, aggregateId: { in: payouts.map((p) => p.id) } },
    select: { aggregateId: true, payload: true },
  });
  const byPayout = new Map(snapshots.map((s) => [s.aggregateId, s.payload]));
  return payouts.map((p) => {
    let details: BankDetails | null = null;
    try {
      const blob = (JSON.parse(byPayout.get(p.id) ?? "{}") as { requisites?: string }).requisites;
      const secret = loadSecret(blob);
      details = secret ? (JSON.parse(secret.value) as BankDetails) : null;
    } catch {
      details = null;
    }
    return { payoutId: p.id, sellerId: p.sellerId, sellerName: p.sellerProfile.displayName, amountKopecks: p.amountKopecks, createdAt: p.createdAt, details };
  });
}

export function paymentPurpose(row: Pick<RegistryRow, "payoutId">): string {
  return `Выплата продавцу за проданные товары на площадке Светлана, выплата ${row.payoutId.slice(-8)}. НДС не облагается`;
}

function csvCell(value: string): string {
  return /[;"\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Чистая функция: реестр в CSV (разделитель «;», сумма с запятой) для просмотра в Excel. */
export function registryCsv(rows: RegistryRow[]): string {
  const header = ["Получатель", "ИНН", "КПП", "Банк", "БИК", "Корр. счёт", "Счёт", "Сумма", "Назначение платежа", "Номер выплаты"];
  const lines = [header.join(";")];
  for (const r of rows) {
    const d = r.details;
    lines.push(
      [
        d?.recipientName ?? `НЕТ РЕКВИЗИТОВ: ${r.sellerName}`,
        d?.inn ?? "",
        d?.kpp ?? "",
        d?.bankName ?? "",
        d?.bik ?? "",
        d?.corrAccount ?? "",
        d?.account ?? "",
        (r.amountKopecks / 100).toFixed(2).replace(".", ","),
        paymentPurpose(r),
        r.payoutId,
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

export interface RegistryPayer {
  name: string;
  inn: string;
  kpp?: string;
  account: string;
  bankName: string;
  bik: string;
  corrAccount: string;
}

/** Счёт площадки, с которого платим (PAYOUT_PAYER_*). Без него файл для банка не собрать. */
export function registryPayerFromEnv(): RegistryPayer | null {
  const e = process.env;
  const payer = {
    name: e.PAYOUT_PAYER_NAME ?? "",
    inn: e.PAYOUT_PAYER_INN ?? "",
    kpp: e.PAYOUT_PAYER_KPP || undefined,
    account: e.PAYOUT_PAYER_ACCOUNT ?? "",
    bankName: e.PAYOUT_PAYER_BANK ?? "",
    bik: e.PAYOUT_PAYER_BIK ?? "",
    corrAccount: e.PAYOUT_PAYER_CORR ?? "",
  };
  return payer.name && payer.inn && payer.account && payer.bik && payer.corrAccount && payer.bankName ? payer : null;
}

function ruDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

/**
 * Чистая функция: файл обмена «1С: Предприятие — Клиент банка» (версия 1.03)
 * с платёжными поручениями. Его принимают интернет-банки (Сбер, Т-Банк, Альфа,
 * Точка, Модуль) через «Импорт платёжек из 1С». Строки без реквизитов пропускаются.
 */
export function registry1C(rows: RegistryRow[], payer: RegistryPayer, now: Date = new Date(), firstNumber = 1): string {
  const date = ruDate(now);
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const out: string[] = [
    "1CClientBankExchange",
    "ВерсияФормата=1.03",
    "Кодировка=Windows",
    "Отправитель=Светлана",
    "Получатель=",
    `ДатаСоздания=${date}`,
    `ВремяСоздания=${time}`,
    `ДатаНачала=${date}`,
    `ДатаКонца=${date}`,
    `РасчСчет=${payer.account}`,
    "Документ=Платежное поручение",
  ];
  let number = firstNumber;
  for (const r of rows) {
    const d = r.details;
    if (!d) continue;
    out.push(
      "СекцияДокумент=Платежное поручение",
      `Номер=${number++}`,
      `Дата=${date}`,
      `Сумма=${(r.amountKopecks / 100).toFixed(2)}`,
      `ПлательщикСчет=${payer.account}`,
      `Плательщик=${payer.name}`,
      `ПлательщикИНН=${payer.inn}`,
      `ПлательщикКПП=${payer.kpp ?? ""}`,
      `Плательщик1=${payer.name}`,
      `ПлательщикРасчСчет=${payer.account}`,
      `ПлательщикБанк1=${payer.bankName}`,
      `ПлательщикБИК=${payer.bik}`,
      `ПлательщикКорсчет=${payer.corrAccount}`,
      `ПолучательСчет=${d.account}`,
      `Получатель=${d.recipientName}`,
      `ПолучательИНН=${d.inn}`,
      `ПолучательКПП=${d.kpp ?? ""}`,
      `Получатель1=${d.recipientName}`,
      `ПолучательРасчСчет=${d.account}`,
      `ПолучательБанк1=${d.bankName}`,
      `ПолучательБИК=${d.bik}`,
      `ПолучательКорсчет=${d.corrAccount}`,
      "ВидОплаты=01",
      "Очередность=5",
      `НазначениеПлатежа=${paymentPurpose(r)}`,
      "КонецДокумента",
    );
  }
  out.push("КонецФайла");
  return out.join("\r\n") + "\r\n";
}

/** Windows-1251, как требует формат 1С. Неизвестные символы заменяются на «?». */
export function encodeCp1251(text: string): Uint8Array {
  const special: Record<number, number> = { 0x401: 0xa8, 0x451: 0xb8, 0x2116: 0xb9, 0xab: 0xab, 0xbb: 0xbb, 0x2014: 0x97, 0x2013: 0x96, 0x20bd: 0x3f };
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes[i] = c;
    else if (c >= 0x410 && c <= 0x44f) bytes[i] = c - 0x410 + 0xc0;
    else bytes[i] = special[c] ?? 0x3f;
  }
  return bytes;
}

async function sellerUserId(sellerId: string): Promise<string | null> {
  const s = await prisma.sellerProfile.findUnique({ where: { id: sellerId }, select: { userId: true } });
  return s?.userId ?? null;
}

/** Администратор видел платёжку: выплата оплачена. Повторная отметка ничего не меняет. */
export async function markRegistryPayoutPaid(input: { payoutId: string; adminId: string; documentNumber: string }) {
  const doc = input.documentNumber.trim().slice(0, 40);
  if (!doc) throw new RegistryPayoutError("document_required", "Укажите номер платёжного поручения");
  const claimed = await prisma.payout.updateMany({
    where: { id: input.payoutId, provider: REGISTRY_PROVIDER, status: "IN_PROGRESS" },
    data: { status: "SUCCEEDED", providerRef: `ПП № ${doc}`, processedAt: new Date() },
  });
  if (claimed.count === 0) throw new RegistryPayoutError("not_pending", "Эта выплата уже отмечена или не ждёт перевода");
  const payout = await prisma.payout.findUniqueOrThrow({ where: { id: input.payoutId }, select: { sellerId: true, amountKopecks: true } });
  await prisma.settlement.updateMany({ where: { payoutId: input.payoutId }, data: { status: "PAID" } });
  await prisma.outboxMessage.updateMany({ where: { aggregate: "payout", aggregateId: input.payoutId, type: SNAPSHOT_TYPE }, data: { status: "PROCESSED", processedAt: new Date() } });
  await audit({ actorId: input.adminId, actorRole: "admin", action: "payout.registry_paid", targetType: "Payout", targetId: input.payoutId, after: { document: doc, amountKopecks: payout.amountKopecks } });
  const userId = await sellerUserId(payout.sellerId);
  if (userId) {
    await notify({ userId, kind: "payout_update", title: `Выплата ${rubText(payout.amountKopecks)} отправлена`, body: `Перевод отправлен платёжным поручением № ${doc}. Обычно деньги приходят за 1 рабочий день.`, url: "/seller/payouts" });
  }
  return { ok: true };
}

/** Банк вернул перевод (например, неверный счёт): деньги снова доступны продавцу. */
export async function markRegistryPayoutReturned(input: { payoutId: string; adminId: string; reason: string }) {
  const reason = input.reason.trim().slice(0, 300) || "банк вернул платёж";
  const claimed = await prisma.payout.updateMany({
    where: { id: input.payoutId, provider: REGISTRY_PROVIDER, status: "IN_PROGRESS" },
    data: { status: "FAILED", processedAt: new Date() },
  });
  if (claimed.count === 0) throw new RegistryPayoutError("not_pending", "Эта выплата уже отмечена или не ждёт перевода");
  const payout = await prisma.payout.findUniqueOrThrow({ where: { id: input.payoutId }, select: { sellerId: true, amountKopecks: true } });
  await prisma.settlement.updateMany({ where: { payoutId: input.payoutId }, data: { status: "PENDING", payoutId: null } });
  await prisma.outboxMessage.updateMany({ where: { aggregate: "payout", aggregateId: input.payoutId, type: SNAPSHOT_TYPE }, data: { status: "DEAD", lastError: reason } });
  await audit({ actorId: input.adminId, actorRole: "admin", action: "payout.registry_returned", targetType: "Payout", targetId: input.payoutId, after: { reason } });
  const userId = await sellerUserId(payout.sellerId);
  if (userId) {
    await notify({ userId, kind: "payout_update", title: "Выплата не прошла", body: `Банк вернул перевод ${rubText(payout.amountKopecks)}: ${reason}. Проверьте реквизиты и запросите выплату снова, деньги числятся за вами.`, url: "/seller/payouts" });
  }
  return { ok: true };
}
