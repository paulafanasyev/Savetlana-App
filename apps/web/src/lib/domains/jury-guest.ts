/**
 * Вход гостем для жюри конкурса: одно нажатие, и человек внутри как покупатель,
 * без почты и пароля.
 *
 * - Каждому гостю свой аккаунт (своя корзина и заказы), общего пароля нет.
 * - Только роль покупателя: в админку и кабинет продавца так не попасть.
 * - Почта на домене .invalid (письма туда не уходят), пароль случайный и нигде
 *   не хранится: войти в такой аккаунт повторно нельзя, только в этом браузере.
 * - Лимит: 5 гостей в час с одного адреса и 300 в сутки всего.
 * - Выключается переменной окружения JURY_DEMO=0 (например, после конкурса).
 * - Согласие с условиями записывается с источником «jury_guest»: кнопка на странице
 *   входа прямо говорит, что нажатие означает принятие условий.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../prisma";
import { ApiError, createToken, hashPassword } from "../auth";
import { audit } from "./audit";
import { consumeRateLimit } from "./rate-limits";

export const JURY_EMAIL_DOMAIN = "jury.aiko.invalid";
export const JURY_GUEST_NAME = "Гость жюри";
const TERMS_VERSION = "1.0";
const CONSENTS = ["PERSONAL_DATA", "COOKIES_STRICTLY_NECESSARY"] as const;
const SESSION_DAYS = 3;

export function juryGuestEnabled(): boolean {
  return (process.env.JURY_DEMO ?? "").trim() !== "0";
}

export function isJuryGuestEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${JURY_EMAIL_DOMAIN}`);
}

export async function createJuryGuest(ip: string): Promise<{ user: { id: string; name: string | null; email: string; role: string }; token: string; expiresAt: Date }> {
  if (!juryGuestEnabled()) throw new ApiError(404, "Вход для жюри выключен.", "jury_disabled");
  const [perIp, global] = await Promise.all([
    consumeRateLimit(`jury-guest:ip:${ip}`, 5, 60 * 60_000),
    consumeRateLimit("jury-guest:global", 300, 24 * 60 * 60_000),
  ]);
  if (!perIp.allowed || !global.allowed) {
    throw new ApiError(429, "Слишком много гостевых входов. Попробуйте позже или зарегистрируйтесь.", "rate_limited");
  }
  const email = `guest-${randomBytes(6).toString("hex")}@${JURY_EMAIL_DOMAIN}`;
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  const now = new Date();
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { name: JURY_GUEST_NAME, email, passwordHash, role: "BUYER", isBlocked: false } });
    await tx.profile.create({ data: { userId: u.id, displayName: JURY_GUEST_NAME } });
    for (const type of CONSENTS) {
      await tx.consent.create({ data: { userId: u.id, type, granted: true, source: "jury_guest", version: TERMS_VERSION, grantedAt: now } });
    }
    return u;
  }, { maxWait: 15000, timeout: 15000 });
  const token = await createToken({ sub: user.id, role: user.role });
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 864e5);
  await prisma.session.create({ data: { userId: user.id, token, expiresAt } });
  await audit({ actorId: user.id, actorRole: "buyer", action: "auth.jury_guest", targetType: "user", targetId: user.id, after: { at: now.toISOString() } });
  return { user: { id: user.id, name: user.name, email: user.email, role: user.role }, token, expiresAt };
}
