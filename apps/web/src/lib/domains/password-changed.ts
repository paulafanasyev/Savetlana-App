/**
 * Письмо «Пароль изменён».
 *
 * Если пароль сменил не владелец (угнали почту или подсмотрели ссылку), он
 * должен узнать об этом сразу, а не когда пропадут деньги. Письмо служебное
 * ("security"): согласие на рассылку для него не нужно. Пароль и ссылки в
 * письмо не попадают.
 */
import { notify } from "./notifications";

export type PasswordChangeWay = "reset" | "admin_recovery" | "change";

export const PASSWORD_CHANGED_TITLE = "Пароль изменён";

/** Время по Москве: «14.10.2026, 18:42». */
export function moscowTime(at: Date): string {
  return at.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function passwordChangedMessage(way: PasswordChangeWay, at: Date): { title: string; body: string } {
  const how =
    way === "reset"
      ? "по ссылке из письма для сброса пароля"
      : way === "change"
        ? "в настройках профиля"
        : "через аварийное восстановление администратора";
  const parts = [
    `Пароль от вашего аккаунта АИКО изменён ${moscowTime(at)} (время московское) ${how}.`,
    "Все входы на других устройствах завершены.",
  ];
  // Задержка выплат после сброса пароля описана в account-guard.ts (24 часа).
  if (way === "reset") parts.push("Если вы продаёте на АИКО, выплаты придержаны на 24 часа для безопасности.");
  parts.push("Если пароль меняли не вы, срочно восстановите доступ через «Забыли пароль» на странице входа и напишите в поддержку.");
  return { title: PASSWORD_CHANGED_TITLE, body: parts.join(" ") };
}

/** Отправляет письмо и ждёт отправки. Ошибка доставки смену пароля не отменяет. */
export async function notifyPasswordChanged(userId: string, way: PasswordChangeWay, at: Date = new Date()): Promise<void> {
  const message = passwordChangedMessage(way, at);
  await notify({ userId, kind: "security", title: message.title, body: message.body, url: "/password-reset" }, { awaitDelivery: true }).catch(() => undefined);
}
