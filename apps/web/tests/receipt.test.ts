import { describe, expect, it, vi, afterEach } from "vitest";
import { applyReceiptSettings, partialRefundReceipt, receiptSettings, receiptTotalKopecks } from "../src/lib/domains/receipt";
import { YooKassaPaymentProvider, buildReceipt, type ReceiptDeps, type YooReceipt } from "../src/lib/domains/yookassa";

const base = {
  orderId: "ord1",
  items: [
    { titleSnapshot: "Наушники", quantity: 2, priceKopecks: 150_000 },
    { titleSnapshot: "Чехол", quantity: 1, priceKopecks: 49_900 },
  ],
  deliveryKopecks: 30_000,
  totalKopecks: 379_900,
  currency: "RUB",
  email: "buyer@example.com",
};

function receipt() {
  const r = buildReceipt(base);
  if (!r) throw new Error("чек не построился");
  return r;
}

function deps(over: Partial<ReceiptDeps> = {}): Partial<ReceiptDeps> {
  return {
    receiptsEnabled: true,
    settings: () => ({ agentType: "agent", measure: true }),
    loadSupplier: async () => ({ name: "ООО Ромашка", inn: "7707083893", phone: "8 (916) 123-45-67" }),
    loadRefundBase: async () => base,
    ...over,
  };
}

function okFetch(payload: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof okFetch>): { amount?: unknown; receipt?: YooReceipt } {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return JSON.parse(String(init.body));
}

describe("чеки 54-ФЗ для маркетплейса", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("настройки читаются из окружения, неизвестный признак агента игнорируется", () => {
    expect(receiptSettings({ YOOKASSA_AGENT_TYPE: "Agent", YOOKASSA_FFD: "1.2" })).toEqual({ agentType: "agent", measure: true });
    expect(receiptSettings({ YOOKASSA_AGENT_TYPE: "кто-то" })).toEqual({ agentType: undefined, measure: false });
    expect(receiptSettings({})).toEqual({ agentType: undefined, measure: false });
  });

  it("признак агента и ИНН продавца в каждой позиции, мера «штука»", () => {
    const r = applyReceiptSettings(receipt(), { agentType: "agent", measure: true }, { name: "ООО Ромашка", inn: "7707083893", phone: "8 916 123-45-67" });
    expect(r.items).toHaveLength(3);
    for (const item of r.items) {
      expect(item.agent_type).toBe("agent");
      expect(item.supplier).toEqual({ name: "ООО Ромашка", inn: "7707083893", phone: "+79161234567" });
      expect(item.measure).toBe("piece");
    }
  });

  it("без агентского режима чек не меняется", () => {
    const r = applyReceiptSettings(receipt(), { measure: false }, null);
    expect(r).toEqual(receipt());
  });

  it("агентский чек без ИНН продавца не пробивается", () => {
    expect(() => applyReceiptSettings(receipt(), { agentType: "agent", measure: false }, { name: "Иван", inn: null })).toThrow(/ИНН/);
    expect(() => applyReceiptSettings(receipt(), { agentType: "agent", measure: false }, { name: "Иван", inn: "123" })).toThrow(/ИНН/);
  });

  it("частичный возврат: сумма чека ровно равна сумме возврата", () => {
    const full = receipt();
    expect(receiptTotalKopecks(full)).toBe(379_900);
    expect(partialRefundReceipt(full, 379_900)).toBe(full);
    for (const amount of [1, 100, 49_900, 123_457, 379_899]) {
      const part = partialRefundReceipt(full, amount);
      expect(receiptTotalKopecks(part)).toBe(amount);
      for (const item of part.items) expect(item.quantity).toBe("1");
    }
    expect(() => partialRefundReceipt(full, 379_901)).toThrow();
    expect(() => partialRefundReceipt(full, 0)).toThrow();
  });

  it("платёж уходит в ЮKassa с агентским чеком", async () => {
    const fetchMock = okFetch({ id: "pay-12345678", status: "pending", confirmation: { confirmation_url: "https://yoomoney.ru/x" } });
    const p = new YooKassaPaymentProvider("123456", "test_secret", deps());
    await p.createCharge({ orderId: "ord1", amountKopecks: 379_900, currency: "RUB", idempotencyKey: "ord_ord1", receipt: receipt() });
    const body = sentBody(fetchMock);
    expect(body.receipt!.customer).toEqual({ email: "buyer@example.com" });
    expect(body.receipt!.items[0]).toMatchObject({ agent_type: "agent", supplier: { inn: "7707083893" }, measure: "piece" });
  });

  it("возврат идёт с чеком возврата на сумму возврата", async () => {
    const fetchMock = okFetch({ id: "rf1", status: "succeeded" });
    const p = new YooKassaPaymentProvider("123456", "test_secret", deps());
    const r = await p.refund({ paymentProviderRef: "pay-12345678", amountKopecks: 50_000, reason: "возврат", idempotencyKey: "refund-1" });
    expect(r.status).toBe("SUCCEEDED");
    const body = sentBody(fetchMock);
    expect(body.amount).toEqual({ value: "500.00", currency: "RUB" });
    expect(receiptTotalKopecks(body.receipt!)).toBe(50_000);
    expect(body.receipt!.items[0].supplier!.inn).toBe("7707083893");
  });

  it("полный возврат повторяет чек оплаты", async () => {
    const fetchMock = okFetch({ id: "rf2", status: "succeeded" });
    const p = new YooKassaPaymentProvider("123456", "test_secret", deps({ settings: () => ({ measure: false }) }));
    await p.refund({ paymentProviderRef: "pay-12345678", amountKopecks: 379_900, reason: "отмена", idempotencyKey: "refund-2" });
    expect(sentBody(fetchMock).receipt).toEqual(receipt());
  });

  it("без включённых чеков возврат уходит без чека", async () => {
    const fetchMock = okFetch({ id: "rf3", status: "succeeded" });
    const p = new YooKassaPaymentProvider("123456", "test_secret", deps({ receiptsEnabled: false }));
    await p.refund({ paymentProviderRef: "pay-12345678", amountKopecks: 100, reason: "x", idempotencyKey: "refund-3" });
    expect(sentBody(fetchMock).receipt).toBeUndefined();
  });

  it("если заказ для чека не найден, в банк ничего не уходит", async () => {
    const fetchMock = okFetch({ id: "rf4", status: "succeeded" });
    const p = new YooKassaPaymentProvider("123456", "test_secret", deps({ loadRefundBase: async () => null }));
    await expect(p.refund({ paymentProviderRef: "pay-12345678", amountKopecks: 100, reason: "x", idempotencyKey: "refund-4" })).rejects.toThrow(/чека возврата/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
