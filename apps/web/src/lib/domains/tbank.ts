/**
 * Т-Банк (Тинькофф) интернет-эквайринг, API v2 — карты, СБП, T-Pay.
 *
 * Поток: Init → покупатель платит на странице Т-Банка (PaymentURL) или по
 * ссылке/QR СБП (GetQr) → Т-Банк шлёт уведомление на /api/webhooks/tbank →
 * проверяем подпись Token И перезапрашиваем статус через GetState → только
 * CONFIRMED делает заказ оплаченным.
 *
 * Переменные (только сервер): TBANK_TERMINAL_KEY, TBANK_PASSWORD,
 * TBANK_API_URL (по умолчанию https://securepay.tinkoff.ru/v2).
 * СБП включается в личном кабинете Т-Бизнеса для терминала.
 *
 * Чеки 54-ФЗ: TBANK_RECEIPTS=true (+ TBANK_TAXATION, TBANK_TAX). Чек уходит в
 * Init и в Cancel (возврат на свою сумму), см. fiscal.ts.
 */
import { createHash } from "node:crypto";
import { env } from "../env";
import type { ChargeParams, ChargeResult, PaymentProvider } from "./payments";
import {
  bundleTotal,
  fiscalReceipt,
  loadReceiptBaseByOrder,
  loadReceiptBaseByPayment,
  tbankReceiptConfig,
  toTbankReceipt,
  type ReceiptBase,
  type TbankReceipt,
  type TbankReceiptConfig,
} from "./fiscal";
import { receiptSettings } from "./receipt";

/**
 * Подпись Т-Банка: корневые скалярные поля (без Token, без вложенных
 * объектов DATA/Receipt) + Password, сортировка по ключу, склейка значений,
 * SHA-256 в hex.
 */
export function tbankToken(params: Record<string, unknown>, password: string): string {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === "Token" || v === undefined || v === null || typeof v === "object") continue;
    flat[k] = String(v);
  }
  flat.Password = password;
  const joined = Object.keys(flat).sort().map((k) => flat[k]).join("");
  return createHash("sha256").update(joined, "utf8").digest("hex");
}

export function mapTbankStatus(status: string | undefined): "PENDING" | "SUCCEEDED" | "FAILED" {
  if (status === "CONFIRMED") return "SUCCEEDED";
  if (status === "REJECTED" || status === "CANCELED" || status === "DEADLINE_EXPIRED" || status === "AUTH_FAIL") return "FAILED";
  return "PENDING";
}

/**
 * Номер попытки оплаты для банка: «<id заказа>_<время>». Банки требуют
 * уникальный OrderId на каждую попытку; из него же обратно достаём заказ.
 * Т-Банк ограничивает OrderId 36 символами.
 */
export function attemptOrderId(orderId: string, now = Date.now(), max = 36): string {
  const a = `${orderId}_${now.toString(36)}`;
  return a.length <= max ? a : orderId.slice(0, max);
}

/** Обратное преобразование: «<id>_<время>» → id заказа. */
export function orderIdFromAttempt(attempt: string | undefined): string | undefined {
  if (!attempt) return undefined;
  const i = attempt.lastIndexOf("_");
  return i > 0 ? attempt.slice(0, i) : attempt;
}

interface TbankResponse {
  Success?: boolean;
  ErrorCode?: string;
  Message?: string;
  Details?: string;
  PaymentId?: string | number;
  PaymentURL?: string;
  Status?: string;
  Amount?: number;
  OrderId?: string;
  Data?: string;
}

/** Откуда брать чек. Подменяется в тестах. */
export interface TbankReceiptDeps {
  config: () => TbankReceiptConfig;
  settings: () => ReturnType<typeof receiptSettings>;
  loadByOrder: (orderId: string) => Promise<ReceiptBase | null>;
  loadByPayment: (paymentId: string) => Promise<ReceiptBase | null>;
}

const defaultTbankDeps: TbankReceiptDeps = {
  config: () => tbankReceiptConfig(),
  settings: () => receiptSettings(),
  loadByOrder: loadReceiptBaseByOrder,
  loadByPayment: (paymentId) => loadReceiptBaseByPayment("tbank", paymentId),
};

export class TbankPaymentProvider implements PaymentProvider {
  readonly key = "tbank";
  readonly sandbox = false;
  readonly available: boolean;
  private readonly terminalKey: string | undefined;
  private readonly password: string | undefined;
  private readonly apiUrl: string;
  private readonly receiptDeps: TbankReceiptDeps;

  constructor(
    terminalKey: string | undefined = env.tbankTerminalKey,
    password: string | undefined = env.tbankPassword,
    apiUrl: string = env.tbankApiUrl,
    receiptDeps: Partial<TbankReceiptDeps> = {},
  ) {
    this.terminalKey = terminalKey;
    this.password = password;
    this.apiUrl = apiUrl.replace(/\/+$/, "");
    this.available = Boolean(terminalKey && password && /^https:\/\//.test(this.apiUrl));
    this.receiptDeps = { ...defaultTbankDeps, ...receiptDeps };
  }

  /** Проверка подписи уведомления. */
  verifyNotification(body: Record<string, unknown>): boolean {
    if (!this.password || typeof body.Token !== "string") return false;
    if (body.TerminalKey !== this.terminalKey) return false;
    const expected = tbankToken(body, this.password);
    const got = body.Token.toLowerCase();
    if (got.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  }

  private async call(method: string, payload: Record<string, unknown>): Promise<TbankResponse> {
    if (!this.available || !this.terminalKey || !this.password) throw new Error("Т-Банк не настроен (нет TBANK_TERMINAL_KEY / TBANK_PASSWORD)");
    const body: Record<string, unknown> = { TerminalKey: this.terminalKey, ...payload };
    body.Token = tbankToken(body, this.password);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(`${this.apiUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Т-Банк HTTP ${res.status}`);
      const json = (await res.json()) as TbankResponse;
      if (json.Success === false || (json.ErrorCode && json.ErrorCode !== "0")) {
        throw new Error(`Т-Банк ${method}: ${json.ErrorCode ?? "?"} ${(json.Message ?? "").slice(0, 120)}`.trim());
      }
      return json;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Чек на сумму amountKopecks (для возврата — на сумму возврата), или null, если чеки выключены. */
  private async receipt(base: ReceiptBase | null, amountKopecks: number, refund: boolean): Promise<TbankReceipt | null> {
    const cfg = this.receiptDeps.config();
    if (!cfg.enabled) return null;
    if (!base) throw new Error("Т-Банк: не найден заказ для чека");
    const r = toTbankReceipt(
      fiscalReceipt(base, { amountKopecks: refund ? amountKopecks : undefined, settings: this.receiptDeps.settings() }),
      cfg,
    );
    if (bundleTotal(r.Items) !== Math.round(amountKopecks)) throw new Error("Т-Банк: сумма чека не совпадает с суммой платежа");
    return r;
  }

  async createCharge(params: ChargeParams): Promise<ChargeResult> {
    const cfg = this.receiptDeps.config();
    const receipt = cfg.enabled ? await this.receipt(await this.receiptDeps.loadByOrder(params.orderId), params.amountKopecks, false) : null;
    const init = await this.call("Init", {
      Amount: Math.round(params.amountKopecks),
      OrderId: attemptOrderId(params.orderId),
      Description: (params.description ?? `Заказ ${params.orderId}`).slice(0, 140),
      PayType: "O",
      SuccessURL: params.returnUrl ?? `${env.publicAppUrl}/orders/${params.orderId}`,
      FailURL: params.returnUrl ?? `${env.publicAppUrl}/orders/${params.orderId}`,
      NotificationURL: `${env.publicAppUrl}/api/webhooks/tbank`,
      DATA: { order_id: params.orderId },
      ...(receipt ? { Receipt: receipt } : {}),
    });
    const paymentId = String(init.PaymentId ?? "");
    if (!paymentId) throw new Error("Т-Банк не вернул PaymentId");
    let confirmationUrl = init.PaymentURL;
    if (params.method === "sbp") {
      // Ссылка СБП: на телефоне открывает приложение банка покупателя, на компьютере — QR.
      const qr = await this.call("GetQr", { PaymentId: paymentId, DataType: "PAYLOAD" });
      if (qr.Data && /^https:\/\//.test(qr.Data)) confirmationUrl = qr.Data;
    }
    return { providerRef: paymentId, status: mapTbankStatus(init.Status), confirmationUrl };
  }

  /** Статус и сумма платежа напрямую у Т-Банка (источник правды). */
  async getPayment(providerRef: string): Promise<{ status: string; amountKopecks: number | null; orderId?: string }> {
    const s = await this.call("GetState", { PaymentId: providerRef });
    return { status: s.Status ?? "", amountKopecks: typeof s.Amount === "number" ? s.Amount : null, orderId: orderIdFromAttempt(s.OrderId) };
  }

  async getStatus(providerRef: string): Promise<{ status: string }> {
    const p = await this.getPayment(providerRef);
    return { status: mapTbankStatus(p.status) };
  }

  async refund(params: { paymentProviderRef: string; amountKopecks: number; reason: string; idempotencyKey: string }): Promise<{ providerRef: string; status: string }> {
    const cfg = this.receiptDeps.config();
    const receipt = cfg.enabled ? await this.receipt(await this.receiptDeps.loadByPayment(params.paymentProviderRef), params.amountKopecks, true) : null;
    const r = await this.call("Cancel", {
      PaymentId: params.paymentProviderRef,
      Amount: Math.round(params.amountKopecks),
      ...(receipt ? { Receipt: receipt } : {}),
    });
    const ok = r.Status === "REFUNDED" || r.Status === "PARTIAL_REFUNDED" || r.Status === "REVERSED" || r.Status === "QUEUED";
    return { providerRef: `${params.paymentProviderRef}:refund`, status: ok ? "SUCCEEDED" : "FAILED" };
  }
}
