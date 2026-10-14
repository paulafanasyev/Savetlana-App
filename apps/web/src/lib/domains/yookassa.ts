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
 *   YOOKASSA_AGENT_TYPE=agent — площадка продаёт товары продавцов как агент: в каждой
 *                             позиции признак агента и ИНН/название продавца
 *   YOOKASSA_FFD=1.2        — касса на ФФД 1.2: в позициях передаётся мера «штука»
 * Без ключей провайдер недоступен, работает sandbox — как раньше.
 *
 * Чек возврата: при включённых чеках каждый возврат идёт со своим чеком (полный
 * возврат повторяет чек оплаты, частичный делит сумму между позициями), иначе
 * ЮKassa такой возврат отклоняет.
 *
 * Идемпотентность: заголовок Idempotence-Key = ключ заказа, поэтому повторное
 * нажатие «Оплатить» возвращает тот же платёж и ту же ссылку, а не новый.
 */
import { env } from "../env";
import { prisma } from "../prisma";
import type { PaymentProvider, ChargeResult, ChargeParams } from "./payments";
import {
  applyReceiptSettings,
  partialRefundReceipt,
  receiptSettings,
  type YooReceipt,
  type YooReceiptItem,
} from "./receipt";

export type { YooReceipt, YooReceiptItem } from "./receipt";

const API = "https://api.yookassa.ru/v3";

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

type Supplier = { name?: string | null; inn?: string | null; phone?: string | null } | null;

/** Данные из базы, нужные для чеков. Подменяются в тестах. */
export interface ReceiptDeps {
  receiptsEnabled: boolean;
  settings: () => ReturnType<typeof receiptSettings>;
  /** Продавец заказа: юрлицо (если есть) или профиль продавца. */
  loadSupplier: (orderId: string) => Promise<Supplier>;
  /** Заказ, оплаченный платежом ЮKassa: позиции, доставка, почта покупателя, продавец. */
  loadRefundBase: (paymentRef: string) => Promise<{
    orderId: string;
    items: { titleSnapshot: string; quantity: number; priceKopecks: number }[];
    deliveryKopecks: number;
    totalKopecks: number;
    currency: string;
    email: string | null;
  } | null>;
}

async function loadSupplierFromDb(orderId: string): Promise<Supplier> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      sellerProfile: {
        select: {
          displayName: true,
          inn: true,
          companies: { select: { legalName: true, inn: true }, orderBy: { createdAt: "asc" }, take: 1 },
          user: { select: { profile: { select: { phone: true } } } },
        },
      },
    },
  });
  const seller = order?.sellerProfile;
  if (!seller) return null;
  const company = seller.companies[0];
  return {
    name: company?.legalName ?? seller.displayName,
    inn: company?.inn ?? seller.inn,
    phone: seller.user?.profile?.phone ?? null,
  };
}

async function loadRefundBaseFromDb(paymentRef: string): Promise<Awaited<ReturnType<ReceiptDeps["loadRefundBase"]>>> {
  const payment = await prisma.payment.findFirst({
    where: { providerRef: paymentRef, provider: "yookassa" },
    select: {
      order: {
        select: {
          id: true,
          deliveryKopecks: true,
          totalKopecks: true,
          currency: true,
          items: { select: { titleSnapshot: true, quantity: true, priceKopecks: true } },
          buyer: { select: { email: true } },
        },
      },
    },
  });
  if (!payment) return null;
  const o = payment.order;
  return { orderId: o.id, items: o.items, deliveryKopecks: o.deliveryKopecks, totalKopecks: o.totalKopecks, currency: o.currency, email: o.buyer?.email ?? null };
}

const defaultDeps: ReceiptDeps = {
  receiptsEnabled: env.yookassaReceipts,
  settings: () => receiptSettings(),
  loadSupplier: loadSupplierFromDb,
  loadRefundBase: loadRefundBaseFromDb,
};

export class YooKassaPaymentProvider implements PaymentProvider {
  readonly key = "yookassa";
  readonly sandbox = false;
  readonly available: boolean;
  private readonly shopId: string | undefined;
  private readonly secretKey: string | undefined;
  private readonly deps: ReceiptDeps;

  constructor(
    shopId: string | undefined = env.yookassaShopId,
    secretKey: string | undefined = env.yookassaSecretKey,
    deps: Partial<ReceiptDeps> = {},
  ) {
    this.shopId = shopId;
    this.secretKey = secretKey;
    this.available = Boolean(shopId && secretKey);
    this.deps = { ...defaultDeps, ...deps };
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

  /** Признак агента, данные продавца и мера количества, если они включены. */
  private async finalizeReceipt(receipt: YooReceipt, orderId: string): Promise<YooReceipt> {
    const settings = this.deps.settings();
    const supplier = settings.agentType ? await this.deps.loadSupplier(orderId) : null;
    return applyReceiptSettings(receipt, settings, supplier);
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
    if (params.receipt) body.receipt = await this.finalizeReceipt(params.receipt, params.orderId);
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

  /** Чек возврата: тот же состав, что при оплате, на сумму возврата. */
  private async refundReceipt(paymentRef: string, amountKopecks: number): Promise<YooReceipt> {
    const base = await this.deps.loadRefundBase(paymentRef);
    if (!base) throw new Error("Не найден заказ для чека возврата");
    const full = buildReceipt({
      items: base.items,
      deliveryKopecks: base.deliveryKopecks,
      totalKopecks: base.totalKopecks,
      email: base.email,
      currency: base.currency,
      vatCode: env.yookassaVatCode,
    });
    if (!full) throw new Error("Не удалось сформировать чек возврата: сумма позиций не совпадает с суммой заказа или нет e-mail покупателя");
    return this.finalizeReceipt(partialRefundReceipt(full, amountKopecks), base.orderId);
  }

  async refund(params: {
    paymentProviderRef: string;
    amountKopecks: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; status: string }> {
    const body: Record<string, unknown> = {
      payment_id: params.paymentProviderRef,
      amount: { value: kopecksToValue(params.amountKopecks), currency: "RUB" },
      description: params.reason.slice(0, 250),
    };
    if (this.deps.receiptsEnabled) body.receipt = await this.refundReceipt(params.paymentProviderRef, params.amountKopecks);
    const r = await this.call<{ id: string; status: string }>("/refunds", {
      method: "POST",
      idempotenceKey: params.idempotencyKey,
      body,
    });
    return { providerRef: r.id, status: r.status === "succeeded" ? "SUCCEEDED" : r.status === "canceled" ? "FAILED" : "PENDING" };
  }
}
