/**
 * Consent domain (P0 fix, spec §34/§35/§82).
 *
 * Problem this solved: the recommendation engine looked up
 * `type: "personalization"`, but the canonical enum is `AI_PERSONALIZATION`,
 * so the row was never found — and the fallback was `granted ?? true`,
 * silently enabling personalization for users who never opted in. That is the
 * opposite of the consent-gating the spec requires.
 *
 * Rule: absence of a consent record means NOT GRANTED for anything that is
 * not strictly necessary. Only COOKIES_STRICTLY_NECESSARY and PERSONAL_DATA
 * (the processing basis the account itself runs on) default on, and even
 * those are explicitly recorded at registration so the record exists.
 */
import { prisma } from "../prisma";
import { isValidEnum, parseEnum, ConsentType, ConsentType_VALUES } from "../db/enums";

/** Re-exported so callers use the canonical type name, not a string. */
export { type ConsentType };

/** Consent types the platform may assume by default. */
const DEFAULT_ON = new Set<ConsentType>([
  "PERSONAL_DATA",
  "COOKIES_STRICTLY_NECESSARY",
]);

export interface ConsentState {
  type: ConsentType;
  granted: boolean;
  recordedAt: Date | null;
  version: string | null;
}

export async function getConsent(userId: string, type: ConsentType): Promise<ConsentState> {
  const row = await prisma.consent.findUnique({
    where: { userId_type: { userId, type } },
  });
  if (!row) {
    return {
      type,
      granted: DEFAULT_ON.has(type),
      recordedAt: null,
      version: null,
    };
  }
  return {
    type,
    granted: row.granted,
    recordedAt: row.grantedAt ?? row.updatedAt,
    version: row.version,
  };
}

export async function listConsents(userId: string): Promise<ConsentState[]> {
  const rows = await prisma.consent.findMany({ where: { userId } });
  const byType = new Map(rows.map((r) => [r.type as ConsentType, r]));
  return ConsentType_VALUES_LIST.map((type) => {
    const row = byType.get(type);
    return {
      type,
      granted: row ? row.granted : DEFAULT_ON.has(type),
      recordedAt: row ? (row.grantedAt ?? row.updatedAt) : null,
      version: row ? row.version : null,
    };
  });
}

/**
 * True only when the user affirmatively opted in. This is the single call
 * site every personalization/AI feature must use — never read Consent rows
 * directly, so the default cannot drift again.
 */
export async function hasConsent(userId: string, type: ConsentType): Promise<boolean> {
  const state = await getConsent(userId, type);
  return state.granted;
}

export async function setConsent(params: {
  userId: string;
  type: string;
  granted: boolean;
  source?: string;
  actorId: string;
}): Promise<ConsentState> {
  if (!isValidEnum("ConsentType", params.type)) {
    throw new Error(`Неизвестный тип согласия: ${params.type}`);
  }
  const type = params.type as ConsentType;
  const now = new Date();
  const row = await prisma.consent.upsert({
    where: { userId_type: { userId: params.userId, type } },
    create: {
      userId: params.userId,
      type,
      granted: params.granted,
      source: params.source ?? "privacy_center",
      version: CONSENT_VERSION,
      grantedAt: params.granted ? now : null,
      revokedAt: params.granted ? null : now,
    },
    update: {
      granted: params.granted,
      source: params.source ?? "privacy_center",
      version: CONSENT_VERSION,
      grantedAt: params.granted ? now : null,
      revokedAt: params.granted ? null : now,
    },
  });
  await prisma.auditLog.create({
    data: {
      action: "CONSENT_CHANGED",
      actorId: params.actorId,
      actorRole: "buyer",
      targetType: "user",
      targetId: params.userId,
      before: JSON.stringify({ type, granted: !params.granted }),
      after: JSON.stringify({ type, granted: params.granted }),
    },
  });
  return {
    type,
    granted: row.granted,
    recordedAt: row.grantedAt ?? row.updatedAt,
    version: row.version,
  };
}

/** Seeds the default-on consents so the record set is complete at sign-up. */
export async function seedDefaultConsents(userId: string, actorId: string): Promise<void> {
  for (const type of DEFAULT_ON) {
    await prisma.consent.upsert({
      where: { userId_type: { userId, type } },
      create: {
        userId,
        type,
        granted: true,
        source: "registration",
        version: CONSENT_VERSION,
        grantedAt: new Date(),
      },
      update: {},
    });
  }
  await prisma.auditLog.create({
    data: {
      action: "CONSENT_SEEDED",
      actorId,
      actorRole: "system",
      targetType: "user",
      targetId: userId,
      before: "{}",
      after: JSON.stringify([...DEFAULT_ON]),
    },
  });
}

const CONSENT_VERSION = "1.0";
const ConsentType_VALUES_LIST: ConsentType[] = [
  "PERSONAL_DATA",
  "SOCIAL_INTEGRATION",
  "MARKETING",
  "AI_PERSONALIZATION",
  "AI_MEMORY",
  "ANALYTICS",
  "COOKIES_STRICTLY_NECESSARY",
  "COOKIES_ANALYTICS",
  "COOKIES_PERSONALIZATION",
  "COOKIES_ADVERTISING",
];

/** Re-exported for callers that need the canonical type name. */
export { parseEnum };
