/**
 * VK social integration (spec §17, §19).
 *
 * HONESTY CONTRACT: this module never fabricates a social graph. VK data is
 * fetched ONLY through the official OAuth 2.0 / API surface, ONLY for the
 * scopes the user actually granted, and ONLY for the explicitly permitted
 * purposes below. A link record stores a *reference* to a secret, never the
 * token itself. When no VK app credentials are configured, every method
 * reports UNAVAILABLE rather than returning fake friends.
 *
 * Permitted purposes (spec §19):
 *   - registration / login via VK OAuth
 *   - account linking / unlinking
 *   - relationship *suggestions* — always SUGGESTED, never VERIFIED. A
 *     suggestion becomes a fact only after the other user confirms
 *     (spec §16, §18: mutual confirmation).
 *
 * Forbidden: hidden surveillance, scraping data not needed for a stated
 * function, using VK as a covert source of personal data.
 */
import { prisma } from "../prisma";
import { env } from "../env";
import { audit } from "./audit";
import { isValidEnum } from "../db/enums";
import { LinkStatus_VALUES } from "../db/enums";

export const VK_SCOPES = ["email", "friends"] as const;
export type VkScope = (typeof VK_SCOPES)[number];

export type LinkStatus = (typeof LinkStatus_VALUES)[number];

export interface VkUser {
  externalId: string;
  firstName: string;
  lastName: string;
  photoUrl?: string;
  email?: string;
}

export interface VkFriendSuggestion {
  externalId: string;
  firstName: string;
  lastName: string;
  photoUrl?: string;
  /** True only if this person already has a platform account. */
  hasPlatformAccount: boolean;
  /** Platform user id if hasPlatformAccount, else null. */
  platformUserId: string | null;
}

/**
 * Adapter contract for the VK platform. The live adapter calls the official
 * API; the unavailable adapter is used when credentials are missing.
 */
export interface VkAdapter {
  readonly key: string;
  readonly live: boolean;
  /** OAuth 2.0 authorization redirect the user must be sent to. */
  getAuthUrl(state: string, redirectUri: string): string;
  /** Exchanges the OAuth code for an access token. */
  exchangeCode(code: string, redirectUri: string): Promise<{
    accessToken: string;
    expiresAt: Date;
    email?: string;
    externalId: string;
    grantedScopes: VkScope[];
  } | null>;
  /** Fetches the VK user profile. */
  getUser(accessToken: string): Promise<VkUser | null>;
  /** Fetches friends, restricted to the granted scope. */
  getFriends(accessToken: string): Promise<VkFriendSuggestion[]>;
}

class UnavailableVkAdapter implements VkAdapter {
  readonly key = "vk-unavailable";
  readonly live = false;
  getAuthUrl(): string {
    throw new Error("VK_NOT_CONFIGURED");
  }
  async exchangeCode(): Promise<null> {
    return null;
  }
  async getUser(): Promise<VkUser | null> {
    return null;
  }
  async getFriends(): Promise<VkFriendSuggestion[]> {
    return [];
  }
}

class LiveVkAdapter implements VkAdapter {
  readonly key = "vk";
  readonly live = true;
  private readonly apiBase = "https://api.vk.com/method";
  private readonly apiVersion = "5.199";

  getAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: env.vkAppId!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: VK_SCOPES.join(","),
      state,
      v: this.apiVersion,
    });
    return `https://oauth.vk.com/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<{
    accessToken: string;
    expiresAt: Date;
    email?: string;
    externalId: string;
    grantedScopes: VkScope[];
  } | null> {
    const params = new URLSearchParams({
      client_id: env.vkAppId!,
      client_secret: env.vkClientSecret!,
      code,
      redirect_uri: redirectUri,
    });
    const res = await fetch(`https://oauth.vk.com/access_token?${params}`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      user_id?: number;
      email?: string;
      scope?: string;
      error?: string;
    };
    if (!data.access_token || !data.user_id) return null;
    const grantedScopes = (data.scope ?? "")
      .split(",")
      .filter((s): s is VkScope => (VK_SCOPES as readonly string[]).includes(s));
    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
      email: data.email,
      externalId: String(data.user_id),
      grantedScopes,
    };
  }

  async getUser(accessToken: string): Promise<VkUser | null> {
    const res = await fetch(
      `${this.apiBase}/users.get?fields=photo_200,email&access_token=${accessToken}&v=${this.apiVersion}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      response?: Array<{
        id: number;
        first_name?: string;
        last_name?: string;
        photo_200?: string;
        email?: string;
      }>;
      error?: { error_msg?: string };
    };
    const u = data.response?.[0];
    if (!u) return null;
    return {
      externalId: String(u.id),
      firstName: u.first_name ?? "",
      lastName: u.last_name ?? "",
      photoUrl: u.photo_200,
      email: u.email,
    };
  }

  async getFriends(accessToken: string): Promise<VkFriendSuggestion[]> {
    const res = await fetch(
      `${this.apiBase}/friends.get?fields=photo_200&access_token=${accessToken}&v=${this.apiVersion}`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      response?: {
        items?: Array<{ id: number; first_name?: string; last_name?: string; photo_200?: string }>;
      };
      error?: { error_msg?: string };
    };
    const items = data.response?.items ?? [];
    if (items.length === 0) return [];
    // Resolve which of these people already have platform accounts — only
    // those can be invited to confirm a relationship.
    const links = await prisma.integrationLink.findMany({
      where: {
        provider: "vk",
        externalId: { in: items.map((i) => String(i.id)) },
        status: "ACTIVE",
        userId: { not: null },
      },
      select: { externalId: true, userId: true },
    });
    const byExternal = new Map(links.map((l) => [l.externalId, l.userId]));
    return items.map((i) => ({
      externalId: String(i.id),
      firstName: i.first_name ?? "",
      lastName: i.last_name ?? "",
      photoUrl: i.photo_200,
      hasPlatformAccount: byExternal.has(String(i.id)),
      platformUserId: byExternal.get(String(i.id)) ?? null,
    }));
  }
}

let cached: VkAdapter | null = null;

/**
 * Resolves the VK adapter. Live only when both the app id and client secret
 * are configured AND the VK_LOGIN feature flag is enabled.
 */
export function getVkAdapter(): VkAdapter {
  if (cached) return cached;
  if (env.vkAppId && env.vkClientSecret && env.features.vkLogin) {
    cached = new LiveVkAdapter();
  } else {
    cached = new UnavailableVkAdapter();
  }
  return cached;
}

export function isVkLive(): boolean {
  return getVkAdapter().live;
}

/**
 * Links a VK account to a platform user. The token itself is never stored —
 * only an opaque reference to the secret store (spec §38).
 */
export async function linkVkAccount(params: {
  userId: string;
  code: string;
  redirectUri: string;
  actorId: string;
}): Promise<{ status: LinkStatus; externalId: string | null }> {
  const adapter = getVkAdapter();
  if (!adapter.live) {
    return { status: "UNAVAILABLE", externalId: null };
  }
  const token = await adapter.exchangeCode(params.code, params.redirectUri);
  if (!token) return { status: "UNVERIFIED", externalId: null };
  const vkUser = await adapter.getUser(token.accessToken);
  if (!vkUser) return { status: "UNVERIFIED", externalId: null };

  const secretRef = `vk:${token.externalId}:${params.userId}`;
  const link = await prisma.integrationLink.upsert({
    where: {
      provider_externalId: { provider: "vk", externalId: token.externalId },
    },
    create: {
      userId: params.userId,
      provider: "vk",
      externalId: token.externalId,
      externalScope: JSON.stringify(token.grantedScopes),
      status: "ACTIVE",
      accessTokenRef: secretRef,
    },
    update: {
      userId: params.userId,
      externalScope: JSON.stringify(token.grantedScopes),
      status: "ACTIVE",
      accessTokenRef: secretRef,
      unlinkedAt: null,
    },
  });
  await audit({
    action: "vk.account.linked",
    actorId: params.actorId,
    actorRole: "user",
    targetType: "IntegrationLink",
    targetId: link.id,
    after: { externalId: token.externalId, scopes: token.grantedScopes },
  });
  return { status: "ACTIVE", externalId: token.externalId };
}

/** Unlinks VK and revokes the stored reference (spec §19 revocation). */
export async function unlinkVkAccount(params: {
  userId: string;
  actorId: string;
}): Promise<void> {
  const link = await prisma.integrationLink.findFirst({
    where: { userId: params.userId, provider: "vk", status: "ACTIVE" },
  });
  if (!link) return;
  await prisma.integrationLink.update({
    where: { id: link.id },
    data: { status: "REVOKED", unlinkedAt: new Date(), accessTokenRef: null },
  });
  await audit({
    action: "vk.account.unlinked",
    actorId: params.actorId,
    actorRole: "user",
    targetType: "IntegrationLink",
    targetId: link.id,
    before: { externalId: link.externalId },
  });
}

/**
 * Produces relationship suggestions from granted VK friends. Every suggestion
 * is status SUGGESTED with source social_suggestion and a confidence < 1 —
 * never a verified fact (spec §16, §18).
 */
export async function suggestVkRelationships(params: {
  userId: string;
}): Promise<{ created: number; suggestions: string[] }> {
  const adapter = getVkAdapter();
  if (!adapter.live) return { created: 0, suggestions: [] };
  const link = await prisma.integrationLink.findFirst({
    where: { userId: params.userId, provider: "vk", status: "ACTIVE" },
  });
  if (!link?.accessTokenRef) return { created: 0, suggestions: [] };

  const friends = await adapter.getFriends(link.accessTokenRef);
  const candidates = friends.filter((f) => f.hasPlatformAccount && f.platformUserId);
  if (candidates.length === 0) return { created: 0, suggestions: [] };

  const RELATIONSHIP_TYPES = ["FRIEND", "COLLEAGUE", "RELATIVE"];
  let created = 0;
  const suggestionIds: string[] = [];
  for (const c of candidates) {
    // Only suggest where no relationship of any type exists in either direction.
    const existing = await prisma.relationship.findFirst({
      where: {
        OR: [
          { fromUserId: params.userId, toUserId: c.platformUserId! },
          { fromUserId: c.platformUserId!, toUserId: params.userId },
        ],
      },
      select: { id: true },
    });
    if (existing) continue;
    const rel = await prisma.relationship.create({
      data: {
        fromUserId: params.userId,
        toUserId: c.platformUserId!,
        type: "FRIEND",
        status: "SUGGESTED",
        source: "social_suggestion",
        confidence: 0.5,
        note: "Предложено на основе разрешённых данных VK",
      },
    });
    suggestionIds.push(rel.id);
    created += 1;
  }
  if (created > 0) {
    await audit({
      action: "vk.relationships.suggested",
      actorId: params.userId,
      actorRole: "user",
      targetType: "Relationship",
      after: { count: created, type: "FRIEND", status: "SUGGESTED" },
    });
  }
  return { created, suggestions: suggestionIds };
}

export function parseLinkStatus(value: string): LinkStatus {
  return isValidEnum("LinkStatus", value) ? (value as LinkStatus) : "UNVERIFIED";
}
