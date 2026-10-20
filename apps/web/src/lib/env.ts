/**
 * Typed, fail-fast environment access.
 *
 * SECURITY: nothing here is ever exposed to the client. Every AI provider
 * credential lives server-side only. The frontend only ever receives
 * processed results.
 */
import { existsSync, readFileSync } from "node:fs";

/**
 * Minimal .env loader (replaces the `dotenv` package, which is declared only in
 * the monorepo root and is not installed when Vercel builds apps/web).
 * Supports KEY=value, `export KEY=value`, single/double quotes, `\n` inside
 * double quotes and trailing ` # comments`.
 *
 * Values from .env override ambient ones on purpose: some runtime containers
 * export placeholder values (e.g. AI_GATEWAY_BASE_URL=https://api.example.com/v1)
 * that predate the real configuration. On Vercel there is no .env file at all,
 * so this has no effect there — platform env wins.
 */
export function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n");
    } else {
      const comment = value.search(/\s#/);
      if (comment >= 0) value = value.slice(0, comment).trim();
    }
    process.env[match[1]] = value;
  }
}

loadDotEnv();

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

/**
 * Адрес ИИ в виде «…/v1»: без слэша в конце и без «/chat/completions», если их вставили вместе
 * с адресом: код сам дописывает путь запроса.
 */
export function normalizeAiBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "").replace(/\/+$/, "");
}

const NODE_ENV = optional("NODE_ENV") ?? "development";
const IS_PRODUCTION = NODE_ENV === "production";
// Next.js sets NEXT_PHASE=phase-production-build while compiling. Runtime
// production requests do not have that marker, so secrets are enforced only
// after the build artifact exists.
const IS_NEXT_BUILD = process.env.NEXT_PHASE === "phase-production-build";
const ENFORCE_PRODUCTION_SECRETS = IS_PRODUCTION && !IS_NEXT_BUILD;

function requiredInProduction(name: string, developmentFallback?: string): string {
  return required(name, ENFORCE_PRODUCTION_SECRETS ? undefined : developmentFallback);
}

function optionalInProduction(name: string): string | undefined {
  const value = optional(name);
  if (ENFORCE_PRODUCTION_SECRETS && !value) {
    throw new Error(`Missing required production env var: ${name}`);
  }
  return value;
}

function booleanFlag(name: string, def = true): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  return raw === "1" || raw.toLowerCase() === "true";
}

/**
 * Test isolation escape hatch (spec §47). `tests/setup.ts` points the suite at
 * an isolated per-worker SQLite file by setting SVETLANA_TEST_DB to an absolute
 * path. It must win over .env's DATABASE_URL: `loadDotEnv()` above reloads
 * .env at import time and would otherwise re-target the suite at the
 * development database.
 */
const TEST_DATABASE_URL = optional("SVETLANA_TEST_DB");

/**
 * Vercel Postgres/Neon integrations name the connection string differently
 * depending on the chosen prefix: DATABASE_URL (default), STORAGE_URL
 * (prefix "STORAGE") or POSTGRES_PRISMA_URL / POSTGRES_URL (legacy Vercel
 * Postgres). The first non-empty one wins; DATABASE_URL always has priority.
 */
const PLATFORM_DATABASE_URL =
  optional("DATABASE_URL") ??
  optional("STORAGE_URL") ??
  optional("POSTGRES_PRISMA_URL") ??
  optional("POSTGRES_URL");

/**
 * SQLite relative paths are resolved against the app root (apps/web) so the
 * process works regardless of ambient CWD. Absolute URLs pass through.
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

/** Адрес сайта без лишнего: пробелы и «/» в конце убираются, без схемы дописывается https://. */
export function normalizeAppUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export const env = {
  databaseUrl: TEST_DATABASE_URL ?? resolveDatabaseUrl(
    PLATFORM_DATABASE_URL ?? requiredInProduction("DATABASE_URL", "file:./prisma/dev.db"),
  ),
  jwtSecret: requiredInProduction("JWT_SECRET", "dev-only-insecure-secret"),
  jwtExpiresIn: required("JWT_EXPIRES_IN", "7d"),
  // At-rest protection for persisted pending AI actions (spec §38).
  pendingActionKey: optionalInProduction("PENDING_ACTION_KEY"),
  // Signing key for one-time OAuth states (spec §17/§18).
  oauthStateKey: optionalInProduction("OAUTH_STATE_KEY"),
  // Почты администраторов площадки (через запятую). Пользователь с такой почтой
  // при входе/регистрации получает роль ADMIN — так появляется первый модератор.
  adminEmails: (optional("ADMIN_EMAILS") ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),

  // --- AI Gateway (server-side only) -------------------------------------
  // Понимаем и имена из проекта Светланы (AI_API_KEY, AI_BASE_URL, AI_MODEL): если они уже
  // заданы в Vercel, переименовывать не нужно. AI_GATEWAY_* важнее, если заданы оба.
  aiGatewayBaseUrl: normalizeAiBaseUrl(optional("AI_GATEWAY_BASE_URL") ?? optional("AI_BASE_URL") ?? "http://localhost:11434/v1"),
  aiGatewayApiKey: optional("AI_GATEWAY_API_KEY") ?? optional("AI_API_KEY"),
  aiGatewayModel: optional("AI_GATEWAY_MODEL") ?? optional("AI_MODEL") ?? "external-chat-model",
  aiGatewayTimeoutMs: Number(optional("AI_GATEWAY_TIMEOUT_MS") ?? "30000"),
  aiGatewayMaxRetries: Number(optional("AI_GATEWAY_MAX_RETRIES") ?? "2"),
  aiProviderOrder: (optional("AI_PROVIDER_ORDER") ?? "external,mock")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // --- Единая Светлана на своём сервере (профиль aiko, server-side only) ------
  // URL — https://мир-самозанятых.рф (punycode), KEY — ASSISTANT_KEY_AIKO с сервера Светланы.
  svetlanaCoreUrl: optional("SVETLANA_CORE_URL"),
  svetlanaCoreKey: optional("SVETLANA_CORE_KEY"),

  // --- Payment / delivery partners ----------------------------------------
  paymentProviderBaseUrl: optional("PAYMENT_PROVIDER_BASE_URL"),
  paymentProviderApiKey: optional("PAYMENT_PROVIDER_API_KEY"),
  paymentMerchantId: optional("PAYMENT_MERCHANT_ID"),
  // Signing secret for incoming payment webhooks (P0-7).
  paymentWebhookSecret: optional("PAYMENT_WEBHOOK_SECRET"),
  // Основной эквайер, если подключено несколько: yookassa | tbank | sber | alfa | partner.
  // Не задан — берётся первый настроенный (ЮKassa → Т-Банк → Сбер → Альфа → партнёр).
  paymentAcquirer: optional("PAYMENT_ACQUIRER"),
  // ЮKassa (api.yookassa.ru/v3). Без ключей — sandbox. Уведомления: /api/webhooks/yookassa.
  yookassaShopId: optional("YOOKASSA_SHOP_ID"),
  yookassaSecretKey: optional("YOOKASSA_SECRET_KEY"),
  // Чек 54-ФЗ в каждом платеже (включать, если подключены «Чеки от ЮKassa»).
  yookassaReceipts: booleanFlag("YOOKASSA_RECEIPTS", false),
  // Ставка НДС для чека: 1 — без НДС (справочник vat_code ЮKassa).
  yookassaVatCode: Number(optional("YOOKASSA_VAT_CODE") ?? "1"),
  // Т-Банк интернет-эквайринг (карты, СБП, T-Pay). Уведомления: /api/webhooks/tbank.
  tbankTerminalKey: optional("TBANK_TERMINAL_KEY"),
  tbankPassword: optional("TBANK_PASSWORD"),
  tbankApiUrl: optional("TBANK_API_URL") ?? "https://securepay.tinkoff.ru/v2",
  // Сбербанк интернет-эквайринг (RBS). Callback: /api/webhooks/sber.
  sberUserName: optional("SBER_USERNAME"),
  sberPassword: optional("SBER_PASSWORD"),
  sberApiUrl: optional("SBER_API_URL") ?? "https://securepayments.sberbank.ru/payment/rest",
  sberCallbackSecret: optional("SBER_CALLBACK_SECRET"),
  // Альфа-Банк интернет-эквайринг (RBS). Callback: /api/webhooks/alfa.
  alfaUserName: optional("ALFA_USERNAME"),
  alfaPassword: optional("ALFA_PASSWORD"),
  alfaApiUrl: optional("ALFA_API_URL") ?? "https://payment.alfabank.ru/payment/rest",
  alfaCallbackSecret: optional("ALFA_CALLBACK_SECRET"),
  deliveryProviderApiKey: optional("DELIVERY_PROVIDER_API_KEY"),
  // --- Real carrier adapters (audit §10) ----------------------------------
  cdekAccount: optional("CDEK_ACCOUNT"),
  cdekSecureKey: optional("CDEK_SECURE_KEY"),
  cdekToken: optional("CDEK_TOKEN"),
  carrierTimeoutMs: Number(optional("CARRIER_TIMEOUT_MS") ?? "15000"),

  // --- Media / document storage (P0-11) -----------------------------------
  // "local" (dev), "vercel-blob" (prod, нужен BLOB_READ_WRITE_TOKEN) или
  // "database" (фото в базе). Без токена Blob автоматически используется база,
  // поэтому загрузка фото работает и без отдельного хранилища.
  storageProvider: IS_PRODUCTION
    ? optional("STORAGE_PROVIDER") ?? "vercel-blob"
    : optional("STORAGE_PROVIDER") ?? "local",
  storageLocalDir: optional("STORAGE_LOCAL_DIR") ?? "uploads",
  blobReadWriteToken: optional("BLOB_READ_WRITE_TOKEN"),

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
  publicAppUrl: normalizeAppUrl(required(
    "PUBLIC_APP_URL",
    // На Vercel постоянный адрес сайта приходит сам (VERCEL_PROJECT_PRODUCTION_URL),
    // поэтому PUBLIC_APP_URL задавать не обязательно. VERCEL_URL меняется с каждой
    // выкладкой и годится только как запасной вариант.
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : ENFORCE_PRODUCTION_SECRETS
      ? undefined
      : "http://localhost:3000",
  )),
  nodeEnv: NODE_ENV,
  isProduction: IS_PRODUCTION,
  // Shared secret for the background-job scheduler (P0-18).
  cronSecret: optionalInProduction("CRON_SECRET"),

  // --- Notification delivery (audit §29) -----------------------------------
  smtpUrl: optional("SMTP_URL"),
  smtpFrom: optional("SMTP_FROM") ?? "Светлана <no-reply@svetlana.example>",
  vapidPublicKey: optional("VAPID_PUBLIC_KEY"),
  vapidPrivateKey: optional("VAPID_PRIVATE_KEY"),
  vapidSubject: optional("VAPID_SUBJECT") ?? "mailto:no-reply@svetlana.example",

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
 * routes to the deterministic MOCK provider.
 */
export const hasExternalAiCredentials = Boolean(
  env.aiGatewayApiKey && env.aiGatewayBaseUrl && !env.aiGatewayBaseUrl.includes("localhost"),
);

/** Хотя бы один эквайер настроен ключами. */
const hasPaymentCredentials = Boolean(
  (env.yookassaShopId && env.yookassaSecretKey) ||
    (env.tbankTerminalKey && env.tbankPassword) ||
    (env.sberUserName && env.sberPassword) ||
    (env.alfaUserName && env.alfaPassword) ||
    (env.paymentProviderApiKey && env.paymentProviderBaseUrl),
);

/**
 * Integration readiness registry. An entry is only "ready" when the
 * credentials it needs exist.
 */
export const integrationStatus = {
  externalAi: hasExternalAiCredentials ? "READY" : "PENDING_EXTERNAL_ACCESS",
  payment: hasPaymentCredentials ? "READY" : "PENDING_EXTERNAL_ACCESS",
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
  // local / database работают всегда; vercel-blob без токена падает на базу.
  storage: (env.storageProvider === "vercel-blob" && !env.blobReadWriteToken ? "READY" : "READY") as "READY" | "PENDING_EXTERNAL_ACCESS",
} as const;

export type IntegrationKey = keyof typeof integrationStatus;
export type IntegrationState = (typeof integrationStatus)[IntegrationKey];
