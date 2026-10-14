/**
 * Сбербанк и Альфа-Банк: интернет-эквайринг на платформе RBS (одинаковый REST:
 * register.do / getOrderStatusExtended.do / refund.do). Карты, «Мир», SberPay,
 * СБП — на платёжной странице банка (способы включает банк для мерчанта).
 *
 * Поток: register.do → покупатель платит на formUrl → банк вызывает callback
 * /api/webhooks/sber или /api/webhooks/alfa → проверяем checksum (если задан
 * секрет) И перезапрашиваем getOrderStatusExtended → только orderStatus=2
 * (деньги списаны) делает заказ оплаченным.
 *
 * Переменные: SBER_USERNAME, SBER_PASSWORD, SBER_API_URL, SBER_CALLBACK_SECRET;
 *             ALFA_USERNAME, ALFA_PASSWORD, ALFA_API_URL, ALFA_CALLBACK_SECRET.
 * Тестовые стенды: Сбер https://3dsec.sberbank.ru/payment/rest,
 *                  Альфа https://alfa.rbsuat.com/payment/rest.
 *
 * Чеки 54-ФЗ: SBER_RECEIPTS=true / ALFA_RECEIPTS=true (+ RBS_TAX_SYSTEM,
 * RBS_TAX_TYPE). Корзина orderBundle передаётся в register.do, см. fiscal.ts.
 */
import { createHmac } from "node:crypto";
import { env } from "../env";
import type { ChargeParams, ChargeResult, PaymentProvider } from "./payments";
import { bundleTotal, fiscalReceipt, loadReceiptBaseByOrder, rbsReceiptConfig, toRbsOrderBundle, type RbsReceiptConfig, type ReceiptBase } from "./fiscal";
import { receiptSettings } from "./receipt";

export type RbsBank = "sber" | "alfa";

/** orderStatus RBS → статус платформы. 2 = оплачен; 3/6 = отменён/отклонён. */
export function mapRbsStatus(orderStatus: number | undefined): "PENDING" | "SUCCEEDED" | "FAILED" {
  if (orderStatus === 2) return "SUCCEEDED";
  if (orderStatus === 3 || orderStatus === 6) return "FAILED";
  return "PENDING";
}

/**
 * Контрольная сумма callback RBS: параметры (кроме checksum и sign_alias)
 * по алфавиту в виде "имя;значение;", HMAC-SHA256 с секретом, HEX в верхнем регистре.
 */
export function rbsChecksum(params: Record<string, string>, secret: string): string {
  const data = Object.keys(params)
    .filter((k) => k !== "checksum" && k !== "sign_alias")
    .sort()
    .map((k) => `${k};${params[k]};`)
    .join("");
  return createHmac("sha256", secret).update(data, "utf8").digest("hex").toUpperCase();
}

interface RbsResponse {
  errorCode?: string | number;
  errorMessage?: string;
  orderId?: string;
  formUrl?: string;
  orderStatus?: number;
  amount?: number;
  orderNumber?: string;
  merchantOrderParams?: { name?: string; value?: string }[];
}

/** orderNumber для RBS: ≤ 32 символов, уникален на попытку. Заказ берём из jsonParams. */
export function rbsOrderNumber(orderId: string, now = Date.now()): string {
  return `${orderId.slice(-20)}_${now.toString(36)}`.slice(0, 32);
}

/** Откуда брать чек. Подменяется в тестах. */
export interface RbsReceiptDeps {
  config: () => RbsReceiptConfig;
  settings: () => ReturnType<typeof receiptSettings>;
  loadByOrder: (orderId: string) => Promise<ReceiptBase | null>;
}

export class RbsPaymentProvider implements PaymentProvider {
  readonly key: RbsBank;
  readonly sandbox = false;
  readonly available: boolean;
  private readonly userName: string | undefined;
  private readonly password: string | undefined;
  private readonly apiUrl: string;
  private readonly callbackSecret: string | undefined;
  private readonly receiptDeps: RbsReceiptDeps;

  constructor(
    bank: RbsBank,
    cfg?: { userName?: string; password?: string; apiUrl?: string; callbackSecret?: string },
    receiptDeps: Partial<RbsReceiptDeps> = {},
  ) {
    this.key = bank;
    const d = bank === "sber"
      ? { userName: env.sberUserName, password: env.sberPassword, apiUrl: env.sberApiUrl, callbackSecret: env.sberCallbackSecret }
      : { userName: env.alfaUserName, password: env.alfaPassword, apiUrl: env.alfaApiUrl, callbackSecret: env.alfaCallbackSecret };
    const c = cfg ?? d;
    this.userName = c.userName;
    this.password = c.password;
    this.apiUrl = (c.apiUrl ?? d.apiUrl).replace(/\/+$/, "");
    this.callbackSecret = c.callbackSecret;
    this.available = Boolean(this.userName && this.password && /^https:\/\//.test(this.apiUrl));
    this.receiptDeps = {
      config: () => rbsReceiptConfig(bank),
      settings: () => receiptSettings(),
      loadByOrder: loadReceiptBaseByOrder,
      ...receiptDeps,
    };
  }

  get label(): string {
    return this.key === "sber" ? "Сбербанк" : "Альфа-Банк";
  }

  /** true, если секрет не задан (полагаемся на перезапрос) или checksum верна. */
  verifyCallback(params: Record<string, string>): boolean {
    if (!this.callbackSecret) return true;
    const got = (params.checksum ?? "").toUpperCase();
    const expected = rbsChecksum(params, this.callbackSecret);
    if (got.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  }

  private async call(method: string, payload: Record<string, string>): Promise<RbsResponse> {
    if (!this.available || !this.userName || !this.password) throw new Error(`${this.label}: эквайринг не настроен`);
    const form = new URLSearchParams({ userName: this.userName, password: this.password, ...payload });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(`${this.apiUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`${this.label} HTTP ${res.status}`);
      const json = (await res.json()) as RbsResponse;
      if (json.errorCode !== undefined && String(json.errorCode) !== "0") {
        throw new Error(`${this.label} ${method}: ${json.errorCode} ${(json.errorMessage ?? "").slice(0, 120)}`.trim());
      }
      return json;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** orderBundle + taxSystem для register.do, если чеки включены. */
  private async receiptFields(orderId: string, amountKopecks: number): Promise<Record<string, string>> {
    const cfg = this.receiptDeps.config();
    if (!cfg.enabled) return {};
    const base = await this.receiptDeps.loadByOrder(orderId);
    if (!base) throw new Error(`${this.label}: не найден заказ для чека`);
    const bundle = toRbsOrderBundle(fiscalReceipt(base, { settings: this.receiptDeps.settings() }), cfg);
    const items = (bundle.cartItems as { items: { itemAmount: number }[] }).items;
    if (bundleTotal(items) !== Math.round(amountKopecks)) throw new Error(`${this.label}: сумма чека не совпадает с суммой платежа`);
    return { orderBundle: JSON.stringify(bundle), taxSystem: cfg.taxSystem };
  }

  async createCharge(params: ChargeParams): Promise<ChargeResult> {
    const back = params.returnUrl ?? `${env.publicAppUrl}/orders/${params.orderId}`;
    const r = await this.call("register.do", {
      orderNumber: rbsOrderNumber(params.orderId),
      amount: String(Math.round(params.amountKopecks)),
      currency: "643",
      returnUrl: back,
      failUrl: back,
      description: (params.description ?? `Заказ ${params.orderId}`).slice(0, 512),
      dynamicCallbackUrl: `${env.publicAppUrl}/api/webhooks/${this.key}`,
      jsonParams: JSON.stringify({ order_id: params.orderId }),
      ...(await this.receiptFields(params.orderId, params.amountKopecks)),
    });
    if (!r.orderId || !r.formUrl) throw new Error(`${this.label}: банк не вернул orderId/formUrl`);
    return { providerRef: r.orderId, status: "PENDING", confirmationUrl: r.formUrl };
  }

  async getPayment(providerRef: string): Promise<{ orderStatus: number | undefined; amountKopecks: number | null; orderId?: string }> {
    const r = await this.call("getOrderStatusExtended.do", { orderId: providerRef });
    const own = r.merchantOrderParams?.find((p) => p.name === "order_id")?.value;
    return { orderStatus: r.orderStatus, amountKopecks: typeof r.amount === "number" ? r.amount : null, orderId: own };
  }

  async getStatus(providerRef: string): Promise<{ status: string }> {
    const p = await this.getPayment(providerRef);
    return { status: mapRbsStatus(p.orderStatus) };
  }

  async refund(params: { paymentProviderRef: string; amountKopecks: number; reason: string; idempotencyKey: string }): Promise<{ providerRef: string; status: string }> {
    await this.call("refund.do", { orderId: params.paymentProviderRef, amount: String(Math.round(params.amountKopecks)) });
    return { providerRef: `${params.paymentProviderRef}:refund`, status: "SUCCEEDED" };
  }
}
