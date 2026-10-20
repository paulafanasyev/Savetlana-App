/**
 * Защита от захвата аккаунта: уведомление о входе с нового устройства и пауза
 * выплат после смены реквизитов или сброса пароля. Решения считаются по
 * журналу аудита, поэтому работают на любом числе серверов.
 */
import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { audit } from "./audit";
import { notify } from "./notifications";
import { deviceLabel, holdMessage, identityPayoutHold, isNewDevice, payoutHold, type PayoutHold } from "./account-guard";
import { FNS_AUTO_IDENTITY } from "./seller-trust-display";

const DAY = 24 * 60 * 60 * 1000;

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`login-ip:${ip}`).digest("hex").slice(0, 32);
}

export interface LoginInspection {
  device: string;
  userAgent: string | null;
  ipHash: string | null;
  isNew: boolean;
}

/** Вызывать до создания новой сессии: сравнивает устройство с прошлыми входами. */
export async function inspectLogin(userId: string, userAgent: string | null, ip: string | null): Promise<LoginInspection> {
  const ua = userAgent ? userAgent.slice(0, 300) : null;
  const device = deviceLabel(ua);
  const previous = await prisma.session.findMany({
    where: { userId, userAgent: { not: null }, createdAt: { gte: new Date(Date.now() - 180 * DAY) } },
    select: { userAgent: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return { device, userAgent: ua, ipHash: hashIp(ip), isNew: isNewDevice(device, previous.map((p) => deviceLabel(p.userAgent))) };
}

export async function notifyNewDeviceLogin(userId: string, login: LoginInspection): Promise<void> {
  const when = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  await audit({
    actorId: userId,
    actorRole: "user",
    action: "auth.new_device_login",
    targetType: "user",
    targetId: userId,
    after: { device: login.device },
  });
  await notify(
    {
      userId,
      kind: "security",
      title: "Вход с нового устройства",
      body: `В ваш аккаунт вошли с устройства «${login.device}» ${when} (МСК). Если это были вы, ничего делать не нужно. Если нет, сразу смените пароль через «Забыли пароль»: все чужие входы сбросятся. Выплаты после смены пароля на сутки приостанавливаются, чтобы деньги не успели вывести.`,
    },
    { awaitDelivery: true }
  );
}

/** Смена счёта для выплат: запись в риски, особенно опасно сразу после входа с нового устройства. */
export async function flagBankDetailsChange(sellerId: string, userId: string): Promise<void> {
  const recentNewDevice = await prisma.auditLog.findFirst({
    where: { action: "auth.new_device_login", targetId: userId, createdAt: { gte: new Date(Date.now() - DAY) } },
    select: { id: true },
  });
  await prisma.riskEvent.create({
    data: {
      actorType: "seller",
      actorId: sellerId,
      level: recentNewDevice ? "HIGH" : "REVIEW",
      ruleId: recentNewDevice ? "A2_bank_change_after_new_device" : "A1_bank_details_changed",
      description: recentNewDevice
        ? "реквизиты для выплат изменены в течение суток после входа с нового устройства"
        : "реквизиты для выплат изменены",
      signals: JSON.stringify({ sellerId, userId, newDeviceLast24h: Boolean(recentNewDevice) }),
      explanation: "Выплаты на новый счёт приостановлены на 48 часов. Если продавец не подтверждает смену, проверьте аккаунт.",
      actionTaken: "payout_hold",
    },
  });
}

/**
 * Действующая пауза выплат продавца или null. Самозанятый, одобренный автоматически
 * по ФНС, торгует, но деньги не выводит, пока администратор не проверит личность:
 * ИНН чужого самозанятого иначе давал бы путь к чужим деньгам покупателей.
 */
export async function getPayoutHold(sellerId: string, now = new Date()): Promise<PayoutHold | null> {
  const seller = await prisma.sellerProfile.findUnique({ where: { id: sellerId }, select: { userId: true, identityStatus: true } });
  if (!seller) return null;
  if (seller.identityStatus === FNS_AUTO_IDENTITY) return identityPayoutHold(now);
  const since = new Date(now.getTime() - 3 * DAY);
  const [bank, reset] = await Promise.all([
    prisma.auditLog.findFirst({
      where: { action: "seller.bank_details_changed", targetId: sellerId, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.auditLog.findFirst({
      where: { action: "password_reset_completed", targetId: seller.userId, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  return payoutHold({ bankChangedAt: bank?.createdAt ?? null, passwordResetAt: reset?.createdAt ?? null, now });
}

export class PayoutHoldError extends Error {
  readonly code = "security_hold";
  constructor(readonly hold: PayoutHold) {
    super(holdMessage(hold));
    this.name = "PayoutHoldError";
  }
}

export async function assertNoPayoutHold(sellerId: string): Promise<void> {
  const hold = await getPayoutHold(sellerId);
  if (hold) throw new PayoutHoldError(hold);
}
