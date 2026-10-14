/**
 * Чеки 54-ФЗ для Т-Банка, Сбербанка и Альфа-Банка.
 *
 * Состав чека один для всех банков: позиции заказа + доставка, признак агента и
 * ИНН продавца (RECEIPT_AGENT_TYPE), мера «штука» для ФФД 1.2 (RECEIPT_FFD=1.2).
 * Он строится так же, как для ЮKassa (buildReceipt + applyReceiptSettings), а
 * здесь переводится в формат конкретного банка.
 *
 * Переменные (только сервер):
 *   TBANK_RECEIPTS=true, TBANK_TAXATION=usn_income, TBANK_TAX=none
 *   SBER_RECEIPTS=true / ALFA_RECEIPTS=true, RBS_TAX_SYSTEM=1, RBS_TAX_TYPE=0
 */
import "../env";
import { prisma } from "../prisma";
import { buildReceipt } from "./yookassa";
import { applyReceiptSettings, partialRefundReceipt, receiptSettings, type YooAgentType, type YooReceipt } from "./receipt";

/** Заказ с тем, что нужно для чека. */
export interface ReceiptBase {
  orderId: string;
  items: { titleSnapshot: string; quantity: number; priceKopecks: number }[];
  deliveryKopecks: number;
  totalKopecks: number;
  currency: string;
  email: string | null;
  supplier: { name?: string | null; inn?: string | null; phone?: string | null } | null;
}

const orderSelect = {
  id: true,
  deliveryKopecks: true,
  totalKopecks: true,
  currency: true,
  items: { select: { titleSnapshot: true, quantity: true, priceKopecks: true } },
  buyer: { select: { email: true } },
  sellerProfile: {
    select: {
      displayName: true,
      inn: true,
      companies: { select: { legalName: true, inn: true }, orderBy: { createdAt: "asc" }, take: 1 },
      user: { select: { profile: { select: { phone: true } } } },
    },
  },
} as const;

type LoadedOrder = {
  id: string;
  deliveryKopecks: number;
  totalKopecks: number;
  currency: string;
  items: { titleSnapshot: string; quantity: number; priceKopecks: number }[];
  buyer: { email: string } | null;
  sellerProfile: {
    displayName: string;
    inn: string | null;
    companies: { legalName: string; inn: string }[];
    user: { profile: { phone: string | null } | null } | null;
  } | null;
};

function toBase(o: LoadedOrder): ReceiptBase {
  const seller = o.sellerProfile;
  const company = seller?.companies[0];
  return {
    orderId: o.id,
    items: o.items,
    deliveryKopecks: o.deliveryKopecks,
    totalKopecks: o.totalKopecks,
    currency: o.currency,
    email: o.buyer?.email ?? null,
    supplier: seller
      ? { name: company?.legalName ?? seller.displayName, inn: company?.inn ?? seller.inn, phone: seller.user?.profile?.phone ?? null }
      : null,
  };
}

export async function loadReceiptBaseByOrder(orderId: string): Promise<ReceiptBase | null> {
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: orderSelect });
  return o ? toBase(o) : null;
}

export async function loadReceiptBaseByPayment(provider: string, providerRef: string): Promise<ReceiptBase | null> {
  const p = await prisma.payment.findFirst({ where: { provider, providerRef }, select: { order: { select: orderSelect } } });
  return p ? toBase(p.order) : null;
}

/** Общий чек (формат ЮKassa) на всю сумму заказа или на сумму возврата. */
export function fiscalReceipt(
  base: ReceiptBase,
  opts: { amountKopecks?: number; settings?: ReturnType<typeof receiptSettings> } = {},
): YooReceipt {
  const full = buildReceipt({
    items: base.items,
    deliveryKopecks: base.deliveryKopecks,
    totalKopecks: base.totalKopecks,
    email: base.email,
    currency: base.currency,
  });
  if (!full) throw new Error("Не удалось сформировать чек: сумма позиций не совпадает с суммой заказа или нет e-mail покупателя");
  const settings = opts.settings ?? receiptSettings();
  const sized = opts.amountKopecks === undefined ? full : partialRefundReceipt(full, opts.amountKopecks);
  return applyReceiptSettings(sized, settings, settings.agentType ? base.supplier : null);
}

function kop(value: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0")) : 0;
}

// --- Т-Банк -----------------------------------------------------------------

const TBANK_AGENT: Record<YooAgentType, string> = {
  banking_payment_agent: "bank_paying_agent",
  banking_payment_subagent: "bank_paying_subagent",
  payment_agent: "paying_agent",
  payment_subagent: "paying_subagent",
  attorney: "attorney",
  commission_agent: "commission_agent",
  agent: "another",
};

export interface TbankReceiptConfig {
  enabled: boolean;
  taxation: string;
  tax: string;
}

export function tbankReceiptConfig(source: Record<string, string | undefined> = process.env): TbankReceiptConfig {
  const on = source.TBANK_RECEIPTS?.trim().toLowerCase();
  return {
    enabled: on === "1" || on === "true",
    taxation: source.TBANK_TAXATION?.trim() || "usn_income",
    tax: source.TBANK_TAX?.trim() || "none",
  };
}

export interface TbankReceipt {
  Email?: string;
  Phone?: string;
  Taxation: string;
  FfdVersion?: "1.2";
  Items: Record<string, unknown>[];
}

/** Чек в формате Т-Банка (поле Receipt в Init и Cancel). Суммы в копейках. */
export function toTbankReceipt(r: YooReceipt, cfg: TbankReceiptConfig): TbankReceipt {
  const ffd12 = r.items.some((i) => i.measure);
  const out: TbankReceipt = { Taxation: cfg.taxation, Items: [] };
  if (r.customer.email) out.Email = r.customer.email;
  else if (r.customer.phone) out.Phone = `+${r.customer.phone}`;
  if (ffd12) out.FfdVersion = "1.2";
  out.Items = r.items.map((i) => {
    const price = kop(i.amount.value);
    const qty = Number(i.quantity);
    const item: Record<string, unknown> = {
      Name: i.description.slice(0, 128),
      Price: price,
      Quantity: qty,
      Amount: price * qty,
      Tax: cfg.tax,
      PaymentMethod: "full_payment",
      PaymentObject: i.payment_subject,
    };
    if (ffd12) item.MeasurementUnit = "pc";
    if (i.agent_type && i.supplier) {
      item.AgentData = { AgentSign: TBANK_AGENT[i.agent_type] };
      item.SupplierInfo = { Inn: i.supplier.inn, Name: i.supplier.name, ...(i.supplier.phone ? { Phones: [i.supplier.phone] } : {}) };
    }
    return item;
  });
  return out;
}

// --- Сбербанк / Альфа-Банк (RBS) --------------------------------------------

const RBS_AGENT: Record<YooAgentType, string> = {
  banking_payment_agent: "1",
  banking_payment_subagent: "2",
  payment_agent: "3",
  payment_subagent: "4",
  attorney: "5",
  commission_agent: "6",
  agent: "7",
};

export interface RbsReceiptConfig {
  enabled: boolean;
  taxSystem: string;
  taxType: number;
}

export function rbsReceiptConfig(bank: "sber" | "alfa", source: Record<string, string | undefined> = process.env): RbsReceiptConfig {
  const on = (bank === "sber" ? source.SBER_RECEIPTS : source.ALFA_RECEIPTS)?.trim().toLowerCase();
  const taxType = Number(source.RBS_TAX_TYPE ?? "0");
  const taxSystem = source.RBS_TAX_SYSTEM?.trim() ?? "";
  return {
    enabled: on === "1" || on === "true",
    taxSystem: /^[0-5]$/.test(taxSystem) ? taxSystem : "1",
    taxType: Number.isInteger(taxType) && taxType >= 0 && taxType <= 10 ? taxType : 0,
  };
}

/** Корзина orderBundle для register.do. Суммы в копейках. */
export function toRbsOrderBundle(r: YooReceipt, cfg: RbsReceiptConfig): Record<string, unknown> {
  const ffd12 = r.items.some((i) => i.measure);
  const customerDetails: Record<string, string> = {};
  if (r.customer.email) customerDetails.email = r.customer.email;
  else if (r.customer.phone) customerDetails.phone = `+${r.customer.phone}`;
  return {
    customerDetails,
    cartItems: {
      items: r.items.map((i, index) => {
        const price = kop(i.amount.value);
        const qty = Number(i.quantity);
        const attributes: { name: string; value: string }[] = [
          { name: "paymentMethod", value: "4" },
          { name: "paymentObject", value: i.payment_subject === "service" ? "4" : "1" },
        ];
        if (i.agent_type && i.supplier) {
          attributes.push({ name: "agent_info.type", value: RBS_AGENT[i.agent_type] });
          attributes.push({ name: "supplier_info.inn", value: i.supplier.inn });
          attributes.push({ name: "supplier_info.name", value: i.supplier.name });
          if (i.supplier.phone) attributes.push({ name: "supplier_info.phones", value: i.supplier.phone });
        }
        return {
          positionId: String(index + 1),
          name: i.description.slice(0, 100),
          quantity: { value: qty, measure: ffd12 ? "0" : "шт" },
          itemAmount: price * qty,
          itemPrice: price,
          itemCode: `item-${index + 1}`,
          tax: { taxType: cfg.taxType },
          itemAttributes: { attributes },
        };
      }),
    },
  };
}

/** Сумма корзины Т-Банка / RBS: должна ровно совпадать с суммой платежа. */
export function bundleTotal(items: { Amount?: unknown; itemAmount?: unknown }[]): number {
  return items.reduce<number>((s, i) => s + Number(i.Amount ?? i.itemAmount ?? 0), 0);
}
