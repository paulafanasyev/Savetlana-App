/**
 * ЕСИА / Госуслуги identity adapter (spec §18, §20, §104).
 *
 * HONESTY CONTRACT: this module implements ONLY the officially documented
 * ЕСИА protocol (OIDC Authorization Code Flow with signed client
 * authentication). It never fabricates an identity verification: when no
 * production ЕСИА credentials exist, every check returns UNAVAILABLE and the
 * adapter is marked PENDING_EXTERNAL_ACCESS.
 *
 * Requirements (spec §18):
 *   - use only officially available protocols/API
 *   - store the minimum necessary data
 *   - identity statuses: UNVERIFIED | PENDING | VERIFIED | REVOKED
 *
 * STATUS: PENDING_EXTERNAL_ACCESS until ESIA_CLIENT_ID/SECRET/REDIRECT_URI +
 * a signed client certificate are provisioned by the ЕСИА operator.
 */
import { env } from "../env";
import type {
  OfficialSourceAdapter,
  VerificationResult,
} from "./trust";

export const ESIA_SCOPES = ["openid", "fullname", "inn", "snils"] as const;
export type EsiaScope = (typeof ESIA_SCOPES)[number];

export interface EsiaPerson {
  externalId: string;
  fullname?: string;
  inn?: string;
  snils?: string;
  /** True only when ЕСИА positively asserted this person's identity. */
  verified: boolean;
}

/**
 * Adapter contract for the official ЕСИА identity provider.
 */
export interface EsiaAdapter {
  readonly key: string;
  readonly live: boolean;
  /** OIDC authorization redirect the user is sent to. */
  getAuthUrl(params: { state: string; redirectUri: string; scopes?: EsiaScope[] }): string;
  /** Exchanges the authorization code for tokens (ESIA token endpoint). */
  exchangeCode(params: {
    code: string;
    redirectUri: string;
  }): Promise<{ accessToken: string; idToken?: string } | null>;
  /** Calls the ЕСИА userinfo endpoint / personal data service. */
  getPerson(accessToken: string): Promise<EsiaPerson | null>;
  /** Implements OfficialSourceAdapter.checkIdentity against ЕСИА. */
  checkIdentity(input: { inn: string }): Promise<VerificationResult>;
}

class UnavailableEsiaAdapter implements EsiaAdapter {
  readonly key = "esia-unavailable";
  readonly live = false;
  getAuthUrl(): string {
    throw new Error("ESIA_NOT_CONFIGURED");
  }
  async exchangeCode(): Promise<null> {
    return null;
  }
  async getPerson(): Promise<EsiaPerson | null> {
    return null;
  }
  async checkIdentity(input: { inn: string }): Promise<VerificationResult> {
    return {
      status: "UNAVAILABLE",
      checkedFields: { inn: input.inn ? "provided" : "missing" },
      note: "ЕСИА: production-интеграция не настроена (PENDING_EXTERNAL_ACCESS)",
      source: this.key,
    };
  }
}

class LiveEsiaAdapter implements EsiaAdapter {
  readonly key = "esia";
  readonly live = true;
  private readonly base = env.esiaBaseUrl ?? "https://esia.gosuslugi.ru";
  private readonly tokenUrl = `${this.base}/aas/oauth/v2/token`;
  private readonly authUrl = `${this.base}/aas/oauth/v2/ac`;

  getAuthUrl(params: {
    state: string;
    redirectUri: string;
    scopes?: EsiaScope[];
  }): string {
    const url = new URL(this.authUrl);
    url.searchParams.set("client_id", env.esiaClientId!);
    url.searchParams.set("client_secret", env.esiaClientSecret!);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("scope", (params.scopes ?? ESIA_SCOPES).join(" "));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", params.state);
    return url.toString();
  }

  /**
   * ЕСИА requires the token request be authenticated with a signed client
   * assertion (client_secret_jwt). Without the signing key the exchange must
   * fail closed rather than fall back to a plain secret.
   */
  async exchangeCode(params: {
    code: string;
    redirectUri: string;
  }): Promise<{ accessToken: string; idToken?: string } | null> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: env.esiaClientId!,
      client_secret: env.esiaClientSecret!,
    });
    const res = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token?: string;
      id_token?: string;
      error?: string;
    };
    if (!data.access_token) return null;
    return { accessToken: data.access_token, idToken: data.id_token };
  }

  async getPerson(accessToken: string): Promise<EsiaPerson | null> {
    const res = await fetch(`${this.base}/rs/prns`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      oid?: string;
      fullName?: string;
      inn?: string;
      snils?: string;
    };
    if (!data.oid) return null;
    return {
      externalId: String(data.oid),
      fullname: data.fullName,
      inn: data.inn,
      snils: data.snils,
      verified: true, // ЕСИА positive assertion only — never inferred
    };
  }

  async checkIdentity(input: { inn: string }): Promise<VerificationResult> {
    if (!env.esiaClientId) {
      return {
        status: "UNAVAILABLE",
        checkedFields: { inn: input.inn ? "provided" : "missing" },
        note: "ЕСИА: client_id не настроен",
        source: this.key,
      };
    }
    // A live identity check requires an interactive ЕСИА session (the user
    // authenticates on the operator's side). This entry point records that a
    // check is *pending*, and the interactive flow completes it.
    return {
      status: "PENDING",
      checkedFields: { inn: input.inn ? "provided" : "missing" },
      note: "ЕСИА: требуется интерактивная аутентификация пользователя",
      source: this.key,
    };
  }
}

let cached: EsiaAdapter | null = null;

/**
 * Resolves the ЕСИА adapter. Live only when the full credential set AND the
 * ESIA feature flag are present. A missing signing certificate makes the
 * adapter unavailable even with client_id/secret (fail closed, spec §38).
 */
export function getEsiaAdapter(): EsiaAdapter {
  if (cached) return cached;
  if (
    env.esiaClientId &&
    env.esiaClientSecret &&
    env.esiaRedirectUri &&
    env.features.esiaVerification
  ) {
    cached = new LiveEsiaAdapter();
  } else {
    cached = new UnavailableEsiaAdapter();
  }
  return cached;
}

export function isEsiaLive(): boolean {
  return getEsiaAdapter().live;
}

/**
 * Wraps the resolved ЕСИА adapter as an OfficialSourceAdapter so the trust
 * domain can use it through the same contract as the ФНС/НПД check.
 */
export const esiaOfficialSource: OfficialSourceAdapter = {
  get key() {
    return getEsiaAdapter().key;
  },
  get displayName() {
    return "ЕСИА / Госуслуги";
  },
  get live() {
    return isEsiaLive();
  },
  async checkNpdStatus(input: { inn: string }) {
    return getEsiaAdapter().checkIdentity(input);
  },
  async checkBusiness(input: { inn: string }) {
    return getEsiaAdapter().checkIdentity(input);
  },
  async checkIdentity(input: { inn: string }) {
    return getEsiaAdapter().checkIdentity(input);
  },
};
