/**
 * Антифрод шаг 4: захват аккаунта.
 *
 * Схемы:
 * - вход с чужого устройства по украденному паролю: владелец должен сразу узнать;
 * - мошенник входит в кабинет продавца, меняет счёт для выплат на свой и
 *   выводит деньги, пока продавец не заметил;
 * - сброс пароля через взломанную почту и вывод денег сразу после него.
 *
 * Защита: письмо о входе с нового устройства и пауза на выплаты после смены
 * реквизитов или пароля. За паузу владелец успевает увидеть уведомление и
 * остановить вывод. Модуль чистый, без базы.
 */

export const UNKNOWN_DEVICE = "Неизвестное устройство";

/** Короткое название устройства по User-Agent: «Chrome · Windows». */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (!ua.trim()) return UNKNOWN_DEVICE;
  const browser = /YaBrowser\//.test(ua)
    ? "Яндекс Браузер"
    : /Edg(e|A|iOS)?\//.test(ua)
      ? "Edge"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /SamsungBrowser\//.test(ua)
          ? "Samsung Internet"
          : /Firefox\/|FxiOS\//.test(ua)
            ? "Firefox"
            : /Chrome\/|CriOS\//.test(ua)
              ? "Chrome"
              : /Safari\//.test(ua)
                ? "Safari"
                : "Браузер";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}

/**
 * Новое ли устройство. Тревогу поднимаем только когда есть с чем сравнить:
 * у первого входа после обновления сайта прошлых устройств ещё нет.
 */
export function isNewDevice(current: string, known: string[]): boolean {
  if (current === UNKNOWN_DEVICE) return false;
  const seen = known.filter((k) => k && k !== UNKNOWN_DEVICE);
  if (seen.length === 0) return false;
  return !seen.includes(current);
}

/** Пауза выплат после смены реквизитов. */
export const BANK_CHANGE_HOLD_HOURS = 48;
/** Пауза выплат после сброса пароля. */
export const PASSWORD_RESET_HOLD_HOURS = 24;

export interface PayoutHold {
  until: Date;
  reason: string;
}

export function payoutHold(input: { bankChangedAt?: Date | null; passwordResetAt?: Date | null; now?: Date }): PayoutHold | null {
  const now = input.now ?? new Date();
  const holds: PayoutHold[] = [];
  if (input.bankChangedAt) {
    holds.push({
      until: new Date(input.bankChangedAt.getTime() + BANK_CHANGE_HOLD_HOURS * 3600_000),
      reason: "Реквизиты для выплат недавно изменены",
    });
  }
  if (input.passwordResetAt) {
    holds.push({
      until: new Date(input.passwordResetAt.getTime() + PASSWORD_RESET_HOLD_HOURS * 3600_000),
      reason: "Пароль недавно сброшен",
    });
  }
  const active = holds.filter((h) => h.until.getTime() > now.getTime());
  if (!active.length) return null;
  return active.reduce((a, b) => (b.until.getTime() > a.until.getTime() ? b : a));
}

export function holdMessage(hold: PayoutHold): string {
  const when = hold.until.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  return `${hold.reason}, поэтому выплата будет доступна с ${when} (МСК). Так мы защищаем деньги, если в аккаунт вошёл не владелец. Если это были не вы, срочно смените пароль и напишите в поддержку.`;
}
