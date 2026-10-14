/** Признак агента в чеке (тег 1222): площадка продаёт товары продавцов как агент. */
export const AGENT_TYPES = [
  "banking_payment_agent",
  "banking_payment_subagent",
  "payment_agent",
  "payment_subagent",
  "attorney",
  "commission_agent",
  "agent",
] as const;
export type YooAgentType = (typeof AGENT_TYPES)[number];

export interface YooSupplier {
  name: string;
  inn: string;
  phone?: string;
}

export interface YooReceiptItem {
  description: string;
  quantity: string;
  amount: { value: string; currency: string };
  vat_code: number;
  payment_mode: "full_payment";
  payment_subject: "commodity" | "service";
  measure?: "piece";
  agent_type?: YooAgentType;
  supplier?: YooSupplier;
}

export interface YooReceipt {
  customer: { email?: string; phone?: string };
  items: YooReceiptItem[];
}

/** Настройки чеков из окружения (только сервер). */
export function receiptSettings(source: Record<string, string | undefined> = process.env): {
  agentType?: YooAgentType;
  measure: boolean;
} {
  const raw = source.YOOKASSA_AGENT_TYPE?.trim().toLowerCase();
  const agentType = raw && (AGENT_TYPES as readonly string[]).includes(raw) ? (raw as YooAgentType) : undefined;
  return { agentType, measure: source.YOOKASSA_FFD?.trim() === "1.2" };
}

export function isValidInn(inn: string | null | undefined): inn is string {
  return typeof inn === "string" && /^(\d{10}|\d{12})$/.test(inn.trim());
}

/**
 * Дополняет чек тем, что требует закон для маркетплейса: признак агента и данные
 * поставщика (продавца) в каждой позиции, мера количества для ФФД 1.2.
 * Без ИНН продавца агентский чек пробить нельзя, поэтому тогда ошибка, а не
 * «тихий» неправильный чек.
 */
export function applyReceiptSettings(
  receipt: YooReceipt,
  settings: { agentType?: YooAgentType; measure: boolean },
  supplier: { name?: string | null; inn?: string | null; phone?: string | null } | null,
): YooReceipt {
  let supplierData: YooSupplier | undefined;
  if (settings.agentType) {
    if (!supplier || !isValidInn(supplier.inn)) {
      throw new Error("У продавца не указан ИНН: чек по 54-ФЗ с признаком агента сформировать нельзя");
    }
    supplierData = { name: (supplier.name ?? "").trim().slice(0, 239) || "Продавец", inn: supplier.inn.trim() };
    const phone = supplier.phone?.replace(/\D/g, "");
    if (phone && phone.length >= 10) supplierData.phone = `+${phone.length === 10 ? `7${phone}` : phone.replace(/^8/, "7")}`;
  }
  return {
    customer: { ...receipt.customer },
    items: receipt.items.map((item) => ({
      ...item,
      ...(settings.measure ? { measure: "piece" as const } : {}),
      ...(supplierData ? { agent_type: settings.agentType, supplier: { ...supplierData } } : {}),
    })),
  };
}

function toKop(value: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0")) : 0;
}

function toValue(kopecks: number): string {
  return `${Math.floor(kopecks / 100)}.${String(kopecks % 100).padStart(2, "0")}`;
}

/** Сумма чека в копейках: цена за единицу × количество по всем позициям. */
export function receiptTotalKopecks(receipt: YooReceipt): number {
  return receipt.items.reduce((sum, item) => sum + toKop(item.amount.value) * Number(item.quantity), 0);
}

/**
 * Чек возврата на часть суммы. Сумма возврата делится между позициями
 * пропорционально их стоимости (остаток копеек уходит позициям с наибольшей
 * дробной частью), каждая позиция идёт количеством 1. Сумма чека всегда точно
 * равна сумме возврата, иначе ЮKassa возврат отклонит.
 */
export function partialRefundReceipt(receipt: YooReceipt, refundKopecks: number): YooReceipt {
  const total = receiptTotalKopecks(receipt);
  if (refundKopecks <= 0 || total <= 0 || refundKopecks > total) {
    throw new Error("Сумма возврата не помещается в чек заказа");
  }
  if (refundKopecks === total) return receipt;
  const lines = receipt.items.map((item) => toKop(item.amount.value) * Number(item.quantity));
  const exact = lines.map((line) => (line * refundKopecks) / total);
  const shares = exact.map(Math.floor);
  let rest = refundKopecks - shares.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest -= 1) shares[order[k].i] += 1;
  return {
    customer: { ...receipt.customer },
    items: receipt.items
      .map((item, i) => ({ ...item, quantity: "1", amount: { ...item.amount, value: toValue(shares[i]) } }))
      .filter((item) => item.amount.value !== "0.00"),
  };
}
