/**
 * Typed, fail-fast environment access.
 *
 * SECURITY: nothing here is ever exposed to the client. Every AI provider
 * credential lives server-side only. The frontend only ever receives
 * processed results.
 */
import { config } from "dotenv";

// `override: true` is deliberate. Some runtime containers export placeholder
// values (e.g. AI_GATEWAY_BASE_URL=https://api.example.com/v1) that predate the
// real configuration; dotenv without override silently keeps those stale
// shadows and the AI gateway then points at a dead endpoint. On Vercel there is
// no .env file at all, so this flag has no effect there — platform env wins.
config({ path: ".env", override: true });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    if (fallback === undefined) {
      throw new Error(`Missing required env var: ${name}`);
    }
    return fallback;
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function booleanFlag(name: string, def = true): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  return raw === "1" || raw.toLowerCase() === "true";
}

/**
 * Test isolation escape hatch (spec §47). `tests/setup.ts` points the suite at
 * an isolated per-worker SQLite file by setting SVETLANA_TEST_DB to an absolute
 * path. It must win over .env's DATABASE_URL: `config({ override: true })`
 * below reloads .env at import time and would otherwise re-target the suite at
 * the development database — silently polluting dev data AND making test
 * results depend on leftovers of previous runs (the payout idempotency,
 * audit-log and traceId assertions all become non-reproducible).
 *
 * The marker is set only by the test bootstrap; in production (Vercel) it is
 * absent and DATABASE_URL (Postgres) is used as-is.
 */
const TEST_DATABASE_URL = optional("SVETLANA_TEST_DB");

/**
 * SQLite relative paths are resolved against the app root (apps/web) so the
 * process works regardless of ambient CWD or an inherited `DATABASE_URL` from
 * the container environment. Absolute URLs (Postgres in production, or the
 * per-worker test file) pass through untouched.
 */
function resolveDatabaseUrl(raw: string): string {
  if (raw.startsWith("file:") && !raw.slice("file:".length).startsWith("/")) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolve } = require("node:path") as typeof import("node:path");
    const appRoot = resolve(__dirname, "..", ".."); // src/lib -> apps/web
    return "file:" + resolve(appRoot, raw.slice("file:".length));
  }
  return raw;
}

export const env = {
  databaseUrl: TEST_DATABASE_URL ?? resolveDatabaseUrl(required("DATABASE_URL", "file:./prisma/dev.db")),
  jwtSecret: required("JWT_SECRET", "dev-only-insecure-secret"),
  jwtExpiresIn: required("JWT_EXPIRES_IN", "7d"),
  // At-rest protection for persisted pending AI actions (spec §38).
  pendingActionKey: optional("PENDING_ACTION_KEY"),
  // Signing key for one-time OAuth states (spec §17/§18).
  oauthStateKey: optional("OAUTH_STATE_KEY"),

  // --- AI Gateway (server-side only) -------------------------------------
  aiGatewayBaseUrl: optional("AI_GATEWAY_BASE_URL") ?? "http://localhost:11434/v1",
  aiGatewayApiKey: optional("AI_GATEWAY_API_KEY"),
  aiGatewayModel: optional("AI_GATEWAY_MODEL") ?? "external-chat-model",
  aiGatewayTimeoutMs: Number(optional("AI_GATEWAY_TIMEOUT_MS") ?? "30000"),
  aiGatewayMaxRetries: Number(optional("AI_GATEWAY_MAX_RETRIES") ?? "2"),
  aiProviderOrder: (optional("AI_PROVIDER_ORDER") ?? "external,mock")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // --- Payment / delivery partners ----------------------------------------
  paymentProviderBaseUrl: optional("PAYMENT_PROVIDER_BASE_URL"),
  paymentProviderApiKey: optional("PAYMENT_PROVIDER_API_KEY"),
  paymentMerchantId: optional("PAYMENT_MERCHANT_ID"),
  deliveryProviderApiKey: optional("DELIVERY_PROVIDER_API_KEY"),

  // --- Identity adapters (absent => PENDING_EXTERNAL_ACCESS) --------------
  vkAppId: optional("VK_APP_ID"),
  vkClientSecret: optional("VK_CLIENT_SECRET"),
  esiaClientId: optional("ESIA_CLIENT_ID"),
  esiaClientSecret: optional("ESIA_CLIENT_SECRET"),
  esiaRedirectUri: optional("ESIA_REDIRECT_URI"),
  esiaBaseUrl: optional("ESIA_BASE_URL"),
  alipayMerchantId: optional("ALIPAY_MERCHANT_ID"),
  alipayPrivateKey: optional("ALIPAY_PRIVATE_KEY"),
  internationalBridgeBaseUrl: optional("INTERNATIONAL_BRIDGE_BASE_URL"),
  internationalBridgeApiKey: optional("INTERNATIONAL_BRIDGE_API_KEY"),
  internationalBridgeMerchantId: optional("INTERNATIONAL_BRIDGE_MERCHANT_ID"),

  // --- Platform config ----------------------------------------------------
  platformFeePercent: Number(optional("PLATFORM_FEE_PERCENT") ?? "1.5"),
  defaultCurrency: optional("DEFAULT_CURRENCY") ?? "RUB",
  publicAppUrl:
    optional("PUBLIC_APP_URL") ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"),
  nodeEnv: optional("NODE_ENV") ?? "development",
  isProduction: process.env.NODE_ENV === "production",

  // --- Feature flags ------------------------------------------------------
  features: {
    aiSearch: booleanFlag("FEATURE_AI_SEARCH"),
    photoSearch: booleanFlag("FEATURE_PHOTO_SEARCH"),
    giftAi: booleanFlag("FEATURE_GIFT_AI"),
    vkLogin: booleanFlag("FEATURE_VK_LOGIN", false),
    esiaVerification: booleanFlag("FEATURE_ESIA_VERIFICATION", false),
    sellerAi: booleanFlag("FEATURE_SELLER_AI"),
    priceAlerts: booleanFlag("FEATURE_PRICE_ALERTS"),
    collectiveGifts: booleanFlag("FEATURE_COLLECTIVE_GIFTS"),
    internationalPayments: booleanFlag("FEATURE_INTERNATIONAL_PAYMENTS", false),
  },
} as const;

/**
 * True only when a real external AI key is configured. When false the gateway
 * routes to the deterministic MOCK provider and every answer it produces is
 * labelled MOCK VERIFIED, never VERIFIED.
 */
export const hasExternalAiCredentials = Boolean(env.aiGatewayApiKey);

/**
 * Integration readiness registry. An entry is only "ready" when the
 * credentials it needs exist. Anything else is PENDING_EXTERNAL_ACCESS and
 * must never be reported as working.
 */
export const integrationStatus = {
  externalAi: hasExternalAiCredentials ? "READY" : "PENDING_EXTERNAL_ACCESS",
  payment: env.paymentProviderApiKey ? "READY" : "PENDING_EXTERNAL_ACCESS",
  delivery: env.deliveryProviderApiKey ? "READY" : "PENDING_EXTERNAL_ACCESS",
  vk: env.vkAppId && env.vkClientSecret ? "READY" : "PENDING_EXTERNAL_ACCESS",
  esia:
    env.esiaClientId && env.esiaClientSecret && env.esiaRedirectUri
      ? "READY"
      : "PENDING_EXTERNAL_ACCESS",
  alipay:
    env.alipayMerchantId && env.alipayPrivateKey
      ? "READY"
      : "PENDING_EXTERNAL_ACCESS",
  internationalPayments:
    env.internationalBridgeBaseUrl &&
    env.internationalBridgeApiKey &&
    env.internationalBridgeMerchantId
      ? "READY"
      : "PENDING_EXTERNAL_ACCESS",
} as const;

export type IntegrationKey = keyof typeof integrationStatus;
export type IntegrationState = (typeof integrationStatus)[IntegrationKey];
