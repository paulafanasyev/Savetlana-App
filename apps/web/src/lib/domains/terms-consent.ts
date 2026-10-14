/**
 * Согласие с условиями и на обработку персональных данных (152-ФЗ).
 *
 * При регистрации оно записывается вместе с аккаунтом. У тех, кто зарегистрировался
 * раньше (или соглашался на старую версию условий), согласие спрашиваем при входе.
 * При изменении текстов /legal/offer или /privacy поднимите TERMS_VERSION: тогда все
 * при следующем входе подтвердят новую версию.
 */
import { prisma } from "../prisma";
import { audit } from "./audit";

/** Должна совпадать с TERMS_VERSION в маршруте регистрации. */
export const TERMS_VERSION = "1.0";
export const TERMS_CONSENTS = ["PERSONAL_DATA", "COOKIES_STRICTLY_NECESSARY"] as const;

/** True, если человек ещё не соглашался с текущей версией условий. */
export async function needsTermsConsent(userId: string): Promise<boolean> {
  const row = await prisma.consent.findUnique({
    where: { userId_type: { userId, type: "PERSONAL_DATA" } },
    select: { granted: true, version: true },
  });
  return !row || !row.granted || row.version !== TERMS_VERSION;
}

export async function recordTermsConsent(params: {
  userId: string;
  actorRole: string;
  ip: string;
  userAgent: string;
  source: string;
}): Promise<void> {
  const now = new Date();
  for (const type of TERMS_CONSENTS) {
    await prisma.consent.upsert({
      where: { userId_type: { userId: params.userId, type } },
      create: { userId: params.userId, type, granted: true, source: params.source, version: TERMS_VERSION, grantedAt: now },
      update: { granted: true, source: params.source, version: TERMS_VERSION, grantedAt: now, revokedAt: null },
    });
  }
  // Доказательство для проверок: кто, когда, на какую версию, с какого адреса и браузера.
  await audit({
    actorId: params.userId,
    actorRole: params.actorRole,
    action: "consent.terms_accepted",
    targetType: "user",
    targetId: params.userId,
    after: {
      types: [...TERMS_CONSENTS],
      version: TERMS_VERSION,
      documents: ["/legal/offer", "/privacy"],
      at: now.toISOString(),
      source: params.source,
      ip: params.ip,
      userAgent: params.userAgent.slice(0, 300),
    },
  });
}
