/**
 * Русские подписи для админки: роли, проверка личности, уровни риска, объекты и решения.
 * Незнакомый код показываем как есть, чтобы не прятать данные от администратора.
 */

const ROLE: Record<string, string> = {
  BUYER: "покупатель",
  SELLER: "продавец",
  ADMIN: "администратор",
  SUPPORT: "поддержка",
  MODERATOR: "модератор",
};

const IDENTITY: Record<string, string> = {
  NOT_STARTED: "не начата",
  UNVERIFIED: "не проверен",
  PENDING: "на проверке",
  IN_REVIEW: "на проверке",
  VERIFIED: "проверен",
  APPROVED: "проверен",
  REJECTED: "отклонён",
  NOT_PROVEN: "не подтверждён",
  MOCK_VERIFIED: "тестовая проверка",
};

const RISK_LEVEL: Record<string, string> = {
  LOW: "низкий",
  MEDIUM: "средний",
  HIGH: "высокий",
  CRITICAL: "критический",
  REVIEW: "на проверку",
  BLOCKED: "заблокировано",
};

const ACTOR: Record<string, string> = {
  USER: "пользователь",
  BUYER: "покупатель",
  SELLER: "продавец",
  ORDER: "заказ",
  PAYMENT: "платёж",
  PRODUCT: "товар",
  LISTING: "объявление",
  CLASSIFIED: "объявление",
};

const RISK_ACTION: Record<string, string> = {
  reviewed_by_admin: "рассмотрено администратором",
  blocked: "заблокировано",
  hold: "приостановлено",
  held: "приостановлено",
  flagged: "помечено для проверки",
  review: "отправлено на проверку",
  allowed: "разрешено",
  none: "без действий",
};

function pick(map: Record<string, string>, value: string | null | undefined, upper = true): string {
  if (!value) return "—";
  return map[upper ? value.toUpperCase() : value] ?? map[value] ?? value;
}

export const roleLabel = (v: string | null | undefined) => pick(ROLE, v);
export const identityStatusLabel = (v: string | null | undefined) => pick(IDENTITY, v);
export const riskLevelLabel = (v: string | null | undefined) => pick(RISK_LEVEL, v);
export const actorTypeLabel = (v: string | null | undefined) => pick(ACTOR, v);
export const riskActionLabel = (v: string | null | undefined) => pick(RISK_ACTION, v ? v.toLowerCase() : v, false);
