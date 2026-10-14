import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireSeller, ApiError } from "@/lib/auth";
import { env } from "@/lib/env";
import { consumeRateLimit, tooMany } from "@/lib/domains/rate-limits";
import {
  createTelegramLinkCode,
  ensureTelegramWebhook,
  sendTelegramTest,
  telegramStatus,
  unlinkTelegramForUser,
} from "@/lib/domains/telegram-link";

export const dynamic = "force-dynamic";

/** Подключён ли Telegram к кабинету. */
export const GET = apiRoute(async (request) => {
  const { user } = await requireSeller(request);
  return Response.json(await telegramStatus(user.id));
});

/** action: "link" — одноразовая ссылка на бота; "test" — пробное сообщение. */
export const POST = apiRoute(async (request) => {
  const { user } = await requireSeller(request);
  const body = await jsonBody<{ action?: string }>(request).catch(() => ({}) as { action?: string });
  const status = await telegramStatus(user.id);
  if (!status.configured) throw new ApiError(503, "Telegram-уведомления пока не включены на площадке.");

  if (body.action === "test") {
    const decision = await consumeRateLimit(`telegram-test:${user.id}`, 5, 60 * 60_000);
    if (!decision.allowed) return tooMany(decision);
    const res = await sendTelegramTest(user.id);
    if (!res.ok) throw new ApiError(400, res.error ?? "Не удалось отправить сообщение");
    return Response.json({ ok: true });
  }

  const decision = await consumeRateLimit(`telegram-link:${user.id}`, 10, 60 * 60_000);
  if (!decision.allowed) return tooMany(decision);
  const hook = await ensureTelegramWebhook(env.publicAppUrl);
  if (!hook.ok) throw new ApiError(503, "Бот Telegram сейчас не отвечает. Попробуйте через несколько минут.");
  const link = await createTelegramLinkCode(user.id);
  return Response.json({ url: link.url, expiresAt: link.expiresAt.toISOString() });
});

/** Отключить Telegram. */
export const DELETE = apiRoute(async (request) => {
  const { user } = await requireSeller(request);
  await unlinkTelegramForUser(user.id);
  return Response.json({ ok: true });
});
