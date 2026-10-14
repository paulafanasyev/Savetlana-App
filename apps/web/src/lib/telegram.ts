/**
 * Telegram Bot API: настройки бота и отправка сообщений.
 *
 * Токен бота живёт только на сервере (TELEGRAM_BOT_TOKEN) и никогда не попадает
 * в браузер. Настройки читаются при каждом вызове, поэтому их можно поменять
 * в окружении без пересборки.
 */
import { env } from "./env";

export interface TelegramConfig {
  token: string;
  /** Имя бота без @, из него строится ссылка t.me/<имя>?start=<код>. */
  username: string;
  /** Секрет вебхука: Telegram присылает его в заголовке каждого запроса. */
  webhookSecret: string;
}

export function telegramConfig(): TelegramConfig | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!token || !username || !webhookSecret) return null;
  // Telegram разрешает в secret_token только A-Z, a-z, 0-9, _ и -, до 256 символов.
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(webhookSecret)) return null;
  return { token, username, webhookSecret };
}

export type TelegramResult<T> = { ok: true; result: T } | { ok: false; status: number; description: string };

export async function telegramApi<T = unknown>(method: string, payload: Record<string, unknown>, config = telegramConfig()): Promise<TelegramResult<T>> {
  if (!config) return { ok: false, status: 0, description: "telegram-not-configured" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (res.ok && json?.ok) return { ok: true, result: json.result as T };
    return { ok: false, status: res.status, description: (json?.description ?? `http-${res.status}`).slice(0, 200) };
  } catch (err) {
    return { ok: false, status: 0, description: err instanceof Error ? err.message.slice(0, 200) : "network-error" };
  }
}

/** Абсолютная ссылка на страницу площадки (уведомления хранят относительные пути). */
export function absoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/")) return `${env.publicAppUrl.replace(/\/$/, "")}${url}`;
  return /^https?:\/\//.test(url) ? url : null;
}

export interface TelegramText {
  text: string;
  reply_markup?: { inline_keyboard: { text: string; url: string }[][] };
}

/**
 * Текст сообщения без разметки: заголовок, тело и кнопка «Открыть». Telegram
 * принимает в кнопках только https-ссылки, поэтому на localhost ссылка
 * просто дописывается в текст.
 */
export function formatTelegramMessage(input: { title: string; body: string; url?: string | null }): TelegramText {
  const link = absoluteUrl(input.url);
  let text = `${input.title}\n\n${input.body}`.slice(0, 3800);
  if (link && link.startsWith("https://")) {
    return { text, reply_markup: { inline_keyboard: [[{ text: "Открыть", url: link }]] } };
  }
  if (link) text += `\n\n${link}`;
  return { text };
}

/** Бот заблокирован или чат удалён: дальше слать бессмысленно, привязку снимаем. */
export function isChatGone(result: { ok: false; status: number; description: string }): boolean {
  if (result.status === 403) return true;
  return result.status === 400 && /chat not found|user is deactivated/i.test(result.description);
}
