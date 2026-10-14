import { timingSafeEqual } from "node:crypto";
import { telegramConfig } from "@/lib/telegram";
import { handleTelegramUpdate, type TelegramUpdate } from "@/lib/domains/telegram-link";

export const dynamic = "force-dynamic";

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Вебхук бота. Telegram подписывает каждый запрос секретом из setWebhook
 * (заголовок X-Telegram-Bot-Api-Secret-Token); без него запрос отклоняется,
 * поэтому подделать /start с чужим кодом снаружи нельзя.
 */
export async function POST(request: Request): Promise<Response> {
  const config = telegramConfig();
  if (!config) return new Response("Not found", { status: 404 });
  const secret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!sameSecret(secret, config.webhookSecret)) return new Response("Forbidden", { status: 403 });
  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  if (update) {
    try {
      await handleTelegramUpdate(update);
    } catch {
      // Ответ 200 всё равно: иначе Telegram будет бесконечно повторять то же обновление.
    }
  }
  return Response.json({ ok: true });
}
