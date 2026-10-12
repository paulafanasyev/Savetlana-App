/**
 * ЮKassa (api.yookassa.ru/v3) — реальная приёмка платежей в России.
 *
 * Поток: createCharge создаёт платёж с подтверждением redirect → покупатель
 * уходит на страницу ЮKassa (карта, СБП, SberPay, ЮMoney) → ЮKassa шлёт
 * уведомление на /api/webhooks/yookassa → мы ПЕРЕЗАПРАШИВАЕМ платёж через API
 * (уведомления ЮKassa не подписаны, источник правды — только её API) и только
 * тогда помечаем заказ оплаченным.
 *
 * method="sbp" — платёж сразу через СБП (payment_method_data.type = "sbp"):
 * покупатель выбирает свой банк и подтверждает оплату в приложении.
 *
 * Включается переменными (только сервер):
 *   YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY
 *   YOOKASSA_RECEIPTS=true  — передавать чек по 54-ФЗ (нужно, если включены «Чеки от ЮKassa»)
 *   YOOKASSA_VAT_CODE=1     — ставка НДС для чека (1 = без НДС)
 * Без ключей провайдер недоступен, работает sandbox — как раньше.
 *
 * Идемпотентность: заголовок Idempotence-Key = ключ заказа, поэтому повторное
 * нажатие «Оплатить» возвращает тот же платёж и ту же ссылку, а не новый.
 */
import { env } from "../env";
import type { PaymentProvider, ChargeResult, ChargeParams } from "./payments";

const API = "https://api.yookassa.ru/v3";

export interface YooReceiptItem {
  description: string;
  quantity: string;
  amount: { value: string; currency: string };
  vat_code: number;
  payment_mode: "full_payment";
  payment_subject: "commodity" | "service";
}

export interface YooReceipt {
  customer: { email?: string; phone?: string };
  items: YooReceiptItem[];
}

/** 123456 копеек → "1234.56" (без float). */
export function kopecksToValue(kopecks: number): string {
  const k = Math.max(0, Math.round(kopecks));
  return `${Math.floor(k / 100)}.${String(k % 100).padStart(2, "0")}`;
}

/** "1234.56" → 123456 копеек (без float). */
export function valueToKopecks(value: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!m) return NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

/** Статусы ЮKassa → статусы платформы. */
export function mapYooStatus(status: string | undefined): "PENDING" | "SUCCEEDED" | "FAILED" {
  if (status === "succeeded") return "SUCCEEDED";
  if (status === "canceled") return "FAILED";
  return "PENDING"; // pending, waiting_for_capture
}

/**
 * Чек 54-ФЗ. Сумма позиций обязана совпасть с суммой платежа, иначе ЮKassa
 * отклонит платёж — поэтому при расхождении чек не строится (null).
 */
export function buildReceipt(params: {
  items: { titleSnapshot: string; quantity: number; priceKopecks: number }[];
  deliveryKopecks: number;
  totalKopecks: number;
  email?: string | null;
  phone?: string | null;
  currency?: string;
  vatCode?: number;
}): YooReceipt | null {
  const currency = params.currency ?? "RUB";
  const vat = params.vatCode ?? 1;
  const lines: YooReceiptItem[] = params.items.map((it) => ({
    description: it.titleSnapshot.slice(0, 128) || "Товар",
    quantity: String(it.quantity),
    amount: { value: kopecksToValue(it.priceKopecks), currency },
    vat_code: vat,
    payment_mode: "full_payment",
    payment_subject: "commodity",
  }));
  if (params.deliveryKopecks > 0) {
    lines.push({
      description: "Доставка",
      quantity: "1",
      amount: { value: kopecksToValue(params.deliveryKopecks), currency },
      vat_code: vat,
      payment_mode: "full_payment",
      payment_subject: "service",
    });
  }
  const sum = params.items.reduce((s, it) => s + it.priceKopecks * it.quantity, 0) + Math.max(0, params.deliveryKopecks);
  if (sum !== params.totalKopecks || lines.length === 0) return null;
  const customer: YooReceipt["customer"] = {};
  if (params.email) customer.email = params.email;
  else if (params.phone) customer.phone = params.phone.replace(/\D/g, "");
  if (!customer.email && !customer.phone) return null;
  return { customer, items: lines };
}

export interface YooPayment {
  id: string;
  status: string;
  paid?: boolean;
  amount?: { value: string; currency: string };
  metadata?: Record<string, string>;
  confirmation?: { type?: string; confirmation_url?: string };
}

export class YooKassaPaymentProvider implements PaymentProvider {
  readonly key = "yookassa";
  readonly sandbox = false;
  readonly available: boolean;
  private readonly shopId: string | undefined;
  private readonly secretKey: string | undefined;

  constructor(shopId: string | undefined = env.yookassaShopId, secretKey: string | undefined = env.yookassaSecretKey) {
    this.shopId = shopId;
    this.secretKey = secretKey;
    this.available = Boolean(shopId && secretKey);
  }

  private headers(idempotenceKey?: string): Record<string, string> {
    const token = Buffer.from(`${this.shopId}:${this.secretKey}`).toString("base64");
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Basic ${token}`,
    };
    if (idempotenceKey) h["Idempotence-Key"] = idempotenceKey.slice(0, 64);
    return h;
  }

  private async call<T>(path: string, init: { method: string; body?: unknown; idempotenceKey?: string }): Promise<T> {
    if (!this.available) throw new Error("ЮKassa не настроена (нет YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY)");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(`${API}${path}`, {
        method: init.method,
        headers: this.headers(init.idempotenceKey),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        let code = "";
        try {
          const j = JSON.parse(text) as { code?: string; description?: string };
          code = [j.code, j.description].filter(Boolean).join(": ");
        } catch {
          code = "";
        }
        throw new Error(`ЮKassa HTTP ${res.status}${code ? ` (${code.slice(0, 200)})` : ""}`);
      }
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async createCharge(params: ChargeParams): Promise<ChargeResult> {
    const body: Record<string, unknown> = {
      amount: { value: kopecksToValue(params.amountKopecks), currency: params.currency || "RUB" },
      capture: true,
      confirmation: { type: "redirect", return_url: params.returnUrl ?? `${env.publicAppUrl}/orders/${params.orderId}` },
      description: (params.description ?? `Заказ ${params.orderId}`).slice(0, 128),
      metadata: { order_id: params.orderId },
    };
    if (params.method === "sbp") body.payment_method_data = { type: "sbp" };
    if (params.receipt) body.receipt = params.receipt;
    const p = await this.call<YooPayment>("/payments", { method: "POST", body, idempotenceKey: params.idempotencyKey });
    return {
      providerRef: p.id,
      status: mapYooStatus(p.status),
      confirmationUrl: p.confirmation?.confirmation_url,
    };
  }

  /** Полные данные платежа — источник правды для вебхука. */
  async getPayment(providerRef: string): Promise<YooPayment> {
    if (!/^[\w-]{8,64}$/.test(providerRef)) throw new Error("некорректный id платежа ЮKassa");
    return this.call<YooPayment>(`/payments/${providerRef}`, { method: "GET" });
  }

  async getStatus(providerRef: string): Promise<{ status: string }> {
    const p = await this.getPayment(providerRef);
    return { status: mapYooStatus(p.status) };
  }

  async refund(params: {
    paymentProviderRef: string;
    amountKopecks: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; status: string }> {
    const r = await this.call<{ id: string; status: string }>("/refunds", {
      method: "POST",
      idempotenceKey: params.idempotencyKey,
      body: {
        payment_id: params.paymentProviderRef,
        amount: { value: kopecksToValue(params.amountKopecks), currency: "RUB" },
        description: params.reason.slice(0, 250),
      },
    });
    return { providerRef: r.id, status: r.status === "succeeded" ? "SUCCEEDED" : r.status === "canceled" ? "FAILED" : "PENDING" };
  }
}
