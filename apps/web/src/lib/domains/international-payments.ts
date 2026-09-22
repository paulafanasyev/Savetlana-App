/**
 * International Payments (spec §36, §105, §149).
 *
 * HONESTY CONTRACT: this module NEVER performs a real currency conversion or
 * cross-border payment. It defines the adapter contract for a regulated FX /
 * payment bridge partner. The sandbox adapter computes deterministic
 * reference rates and is always recorded with `sandbox: true`; a real adapter
 * only becomes live when a partner contract + API credentials exist.
 *
 * STATUS: PENDING_EXTERNAL_ACCESS
 *   Required: FX/payment bridge partner agreement + merchant API credentials.
 *   Integration point: `getInternationalPaymentBridge()` below.
 *
 * Alipay / Alipay+ is a *provider adapter*, not a hardcoded path (spec §36).
 *
 * Money rules (spec §148): a quote has a strict expiry; an exact amount is
 * locked only when the partner confirms a quote id. Rates are never cached
 * beyond TTL and never invented.
 */
import { env } from "../env";

/** ISO 4217 currencies the platform architecture can support. */
export type Currency = "RUB" | "CNY" | "USD" | "EUR";

export const SUPPORTED_CURRENCIES: readonly Currency[] = [
  "RUB",
  "CNY",
  "USD",
  "EUR",
];

/** A wallet/network the bridge can route to. */
export interface ExternalWalletProvider {
  readonly key: string;
  readonly displayName: string;
  /** e.g. "alipay", "alipay_plus", "wechat_pay" */
  readonly network: string;
  /** True only when a real partner contract is configured. */
  readonly live: boolean;
}

export interface FxQuote {
  quoteId: string;
  from: Currency;
  to: Currency;
  /** Units of `to` per 1 unit of `from`, scaled by rateScale. */
  rate: bigint;
  rateScale: number;
  expiresAt: Date;
  /** Name of the source that produced this rate. */
  source: string;
  sandbox: boolean;
}

export interface CrossBorderPaymentRequest {
  orderId: string;
  /** Amount the buyer pays, in the smallest unit of `from` currency. */
  amountMinorUnits: number;
  from: Currency;
  to: Currency;
  wallet: ExternalWalletProvider["key"];
  idempotencyKey: string;
}

export interface CrossBorderPaymentResult {
  providerRef: string;
  status: "PENDING" | "AUTHORIZED" | "SETTLED" | "FAILED";
  /** Amount actually debited in `to` currency, if the partner reported it. */
  settledMinorUnits?: number;
  sandbox: boolean;
}

/**
 * Adapter contract for an international payment / FX bridge. A real adapter
 * talks to the partner API; a sandbox adapter only simulates for dev/tests.
 */
export interface InternationalPaymentBridge {
  readonly key: string;
  readonly live: boolean;
  readonly wallets: readonly ExternalWalletProvider[];
  /** Fresh quote, or null if the pair is unsupported / unreachable. */
  quote(params: { from: Currency; to: Currency; amountMinorUnits: number }): Promise<FxQuote | null>;
  pay(request: CrossBorderPaymentRequest, quote: FxQuote): Promise<CrossBorderPaymentResult>;
  getStatus(providerRef: string): Promise<{ status: CrossBorderPaymentResult["status"] }>;
}

// --- Sandbox bridge (development/test only) -------------------------------

/** Deterministic reference rates in minor units per 1 unit of `from`. */
const SANDBOX_RATES: Record<Currency, Record<Currency, bigint>> = {
  RUB: { CNY: 81000n, USD: 11000n, EUR: 10000n, RUB: 100000n },
  CNY: { RUB: 1234560n, USD: 13580n, EUR: 12350n, CNY: 100000n },
  USD: { RUB: 9090910n, CNY: 735290n, EUR: 90910n, USD: 100000n },
  EUR: { RUB: 10000000n, CNY: 810000n, USD: 110000n, EUR: 100000n },
};

const SANDBOX_SCALE = 5;

class SandboxExternalWallet implements ExternalWalletProvider {
  constructor(
    readonly key: string,
    readonly displayName: string,
    readonly network: string,
  ) {}
  readonly live = false;
}

class SandboxInternationalBridge implements InternationalPaymentBridge {
  readonly key = "sandbox-international";
  readonly live = false;
  readonly wallets: readonly ExternalWalletProvider[] = [
    new SandboxExternalWallet("alipay", "Alipay", "alipay"),
    new SandboxExternalWallet("alipay_plus", "Alipay+", "alipay_plus"),
    new SandboxExternalWallet("wechat_pay", "WeChat Pay", "wechat_pay"),
  ];
  private readonly quotes = new Map<string, FxQuote>();

  async quote(params: {
    from: Currency;
    to: Currency;
    amountMinorUnits: number;
  }): Promise<FxQuote | null> {
    const table = SANDBOX_RATES[params.from];
    if (!table || table[params.to] == null) return null;
    const quote: FxQuote = {
      quoteId: `sb-quote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from: params.from,
      to: params.to,
      rate: table[params.to],
      rateScale: SANDBOX_SCALE,
      expiresAt: new Date(Date.now() + 15 * 60_000),
      source: "sandbox-reference-rate",
      sandbox: true,
    };
    this.quotes.set(quote.quoteId, quote);
    return quote;
  }

  async pay(
    request: CrossBorderPaymentRequest,
    quote: FxQuote,
  ): Promise<CrossBorderPaymentResult> {
    if (quote.expiresAt.getTime() < Date.now()) {
      throw new Error("quote_expired");
    }
    const settled =
      (BigInt(request.amountMinorUnits) * quote.rate) /
      BigInt(10 ** quote.rateScale);
    return {
      providerRef: `sb-xb-${request.orderId}-${request.idempotencyKey.slice(0, 8)}`,
      status: "AUTHORIZED",
      settledMinorUnits: Number(settled),
      sandbox: true,
    };
  }

  async getStatus(providerRef: string): Promise<{
    status: CrossBorderPaymentResult["status"];
  }> {
    return { status: providerRef.startsWith("sb-xb-") ? "SETTLED" : "PENDING" };
  }

  wallet(key: string): ExternalWalletProvider | undefined {
    return this.wallets.find((w) => w.key === key);
  }
}

// --- Live bridge (activated only by real credentials) --------------------

class LiveInternationalBridge implements InternationalPaymentBridge {
  readonly key = "international-bridge";
  readonly live = true;
  readonly wallets: readonly ExternalWalletProvider[] = [
    { key: "alipay", displayName: "Alipay", network: "alipay", live: true },
    { key: "alipay_plus", displayName: "Alipay+", network: "alipay_plus", live: true },
  ];

  constructor(private readonly config: {
    baseUrl: string;
    apiKey: string;
    merchantId: string;
  }) {}

  private async call(path: string, init: RequestInit): Promise<Response> {
    return fetch(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
        "X-Merchant-Id": this.config.merchantId,
        ...(init.headers ?? {}),
      },
    });
  }

  async quote(params: {
    from: Currency;
    to: Currency;
    amountMinorUnits: number;
  }): Promise<FxQuote | null> {
    const res = await this.call("/fx/quotes", {
      method: "POST",
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      quoteId: string;
      rate: string;
      rateScale: number;
      expiresAt: string;
    };
    return {
      quoteId: data.quoteId,
      from: params.from,
      to: params.to,
      rate: BigInt(data.rate),
      rateScale: data.rateScale,
      expiresAt: new Date(data.expiresAt),
      source: this.key,
      sandbox: false,
    };
  }

  async pay(
    request: CrossBorderPaymentRequest,
    quote: FxQuote,
  ): Promise<CrossBorderPaymentResult> {
    const res = await this.call("/payments", {
      method: "POST",
      body: JSON.stringify({ ...request, quoteId: quote.quoteId }),
    });
    if (!res.ok) {
      return {
        providerRef: `failed-${request.idempotencyKey}`,
        status: "FAILED",
        sandbox: false,
      };
    }
    const data = (await res.json()) as {
      providerRef: string;
      status: CrossBorderPaymentResult["status"];
      settledMinorUnits?: number;
    };
    return {
      providerRef: data.providerRef,
      status: data.status,
      settledMinorUnits: data.settledMinorUnits,
      sandbox: false,
    };
  }

  async getStatus(providerRef: string): Promise<{
    status: CrossBorderPaymentResult["status"];
  }> {
    const res = await this.call(`/payments/${providerRef}`, { method: "GET" });
    if (!res.ok) return { status: "PENDING" };
    const data = (await res.json()) as {
      status: CrossBorderPaymentResult["status"];
    };
    return { status: data.status };
  }
}

let cached: InternationalPaymentBridge | null = null;

/**
 * Resolves the active bridge. A live bridge is used ONLY when the full partner
 * credential set is present; otherwise the sandbox bridge is returned and the
 * caller must surface `sandbox: true` to the user (spec §49, §161).
 */
export function getInternationalPaymentBridge(): InternationalPaymentBridge {
  if (cached) return cached;
  const baseUrl = env.internationalBridgeBaseUrl;
  const apiKey = env.internationalBridgeApiKey;
  const merchantId = env.internationalBridgeMerchantId;
  if (baseUrl && apiKey && merchantId) {
    cached = new LiveInternationalBridge({ baseUrl, apiKey, merchantId });
  } else {
    cached = new SandboxInternationalBridge();
  }
  return cached;
}

/** True only if a real partner bridge is configured. */
export function isInternationalPaymentsLive(): boolean {
  return getInternationalPaymentBridge().live;
}

/** Converts a quoted amount to a displayable rate string. */
export function formatRate(quote: FxQuote): string {
  const whole = Number(quote.rate) / 10 ** quote.rateScale;
  return `1 ${quote.from} = ${whole.toFixed(4)} ${quote.to}`;
}
