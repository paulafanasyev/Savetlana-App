/**
 * Диагностика настроек бота для /api/health. Показывает только имена
 * недостающих переменных и причину, сами значения никогда не выводит.
 */

export interface TelegramDiagnostics {
  status: "READY" | "NOT_CONFIGURED";
  missing: string[];
  problems: string[];
}

export function telegramDiagnostics(env: Record<string, string | undefined> = process.env): TelegramDiagnostics {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const username = env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") ?? "";
  const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
  const missing: string[] = [];
  if (!token) missing.push("TELEGRAM_BOT_TOKEN");
  if (!username) missing.push("TELEGRAM_BOT_USERNAME");
  if (!secret) missing.push("TELEGRAM_WEBHOOK_SECRET");
  const problems: string[] = [];
  if (token && !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) problems.push("токен не похож на токен BotFather (цифры:буквы)");
  if (secret && !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) problems.push("секрет вебхука: нужно от 16 символов, только A-Z, a-z, 0-9, _ и -");
  if (username && !/^[A-Za-z0-9_]{5,32}$/.test(username)) problems.push("имя бота: только латиница, цифры и _, без ссылки t.me");
  // Сайт считает бота включённым по тем же правилам, что и telegramConfig(): три переменные и верный секрет.
  const secretOk = /^[A-Za-z0-9_-]{16,256}$/.test(secret);
  const status = missing.length === 0 && secretOk ? "READY" : "NOT_CONFIGURED";
  return { status, missing, problems };
}
