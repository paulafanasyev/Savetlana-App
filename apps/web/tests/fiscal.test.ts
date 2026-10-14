import { describe, expect, it, vi, afterEach } from "vitest";
import { bundleTotal, fiscalReceipt, rbsReceiptConfig, tbankReceiptConfig, toRbsOrderBundle, toTbankReceipt, type ReceiptBase } from "../src/lib/domains/fiscal";
import { TbankPaymentProvider } from "../src/lib/domains/tbank";
import { RbsPaymentProvider } from "../src/lib/domains/rbs";

const base: ReceiptBase = {
  orderId: "ord1",
  items: [
    { titleSnapshot: "Наушники", quantity: 2, priceKopecks: 150_000 },
    { titleSnapshot: "Чехол", quantity: 1, priceKopecks: 49_900 },
  ],
  deliveryKopecks: 30_000,
  totalKopecks: 379_900,
  currency: "RUB",
  email: "buyer@example.com",
  supplier: { name: "ООО Ромашка", inn: "7707083893", phone: "+7 916 123-45-67" },
};

const agent = () => ({ agentType: "agent" as const, measure: true });
const plain = () => ({ measure: false });
const tbankOn = () => ({ enabled: true, taxation: "usn_income", tax: "none" });
const rbsOn = () => ({ enabled: true, taxSystem: "1", taxType: 0 });

function okFetch(payload: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function rawBody(fetchMock: ReturnType<typeof okFetch>, call = 0): string {
  const [, init] = fetchMock.mock.calls[call] as unknown as [string, RequestInit];
  return String(init.body);
}

describe("чеки 54-ФЗ: Т-Банк, Сбер, Альфа", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("настройки: по умолчанию выключено, УСН доходы, без НДС", () => {
    expect(tbankReceiptConfig({})).toEqual({ enabled: false, taxation: "usn_income", tax: "none" });
    expect(tbankReceiptConfig({ TBANK_RECEIPTS: "true", TBANK_TAXATION: "osn", TBANK_TAX: "vat20" })).toEqual({ enabled: true, taxation: "osn", tax: "vat20" });
    expect(rbsReceiptConfig("sber", { SBER_RECEIPTS: "true" })).toEqual({ enabled: true, taxSystem: "1", taxType: 0 });
    expect(rbsReceiptConfig("alfa", { SBER_RECEIPTS: "true" }).enabled).toBe(false);
    expect(rbsReceiptConfig("alfa", { ALFA_RECEIPTS: "1", RBS_TAX_SYSTEM: "9", RBS_TAX_TYPE: "6" })).toEqual({ enabled: true, taxSystem: "1", taxType: 6 });
  });

  it("Т-Банк: позиции в копейках, агент и поставщик, ФФД 1.2", () => {
    const r = toTbankReceipt(fiscalReceipt(base, { settings: agent() }), tbankOn());
    expect(r.Email).toBe("buyer@example.com");
    expect(r.Taxation).toBe("usn_income");
    expect(r.FfdVersion).toBe("1.2");
    expect(r.Items).toHaveLength(3);
    expect(r.Items[0]).toMatchObject({ Name: "Наушники", Price: 150_000, Quantity: 2, Amount: 300_000, Tax: "none", PaymentObject: "commodity", MeasurementUnit: "pc" });
    expect(r.Items[0]).toMatchObject({ AgentData: { AgentSign: "another" }, SupplierInfo: { Inn: "7707083893", Name: "ООО Ромашка", Phones: ["+79161234567"] } });
    expect(r.Items[2]).toMatchObject({ Name: "Доставка", PaymentObject: "service" });
    expect(bundleTotal(r.Items)).toBe(379_900);
  });

  it("Т-Банк без агента и ФФД 1.05: лишних полей нет", () => {
    const r = toTbankReceipt(fiscalReceipt(base, { settings: plain() }), tbankOn());
    expect(r.FfdVersion).toBeUndefined();
    expect(r.Items[0].AgentData).toBeUndefined();
    expect(r.Items[0].MeasurementUnit).toBeUndefined();
  });

  it("RBS: корзина orderBundle с агентом и ИНН продавца", () => {
    const b = toRbsOrderBundle(fiscalReceipt(base, { settings: agent() }), rbsOn());
    const items = (b.cartItems as { items: Record<string, unknown>[] }).items;
    expect(b.customerDetails).toEqual({ email: "buyer@example.com" });
    expect(items[0]).toMatchObject({ positionId: "1", name: "Наушники", quantity: { value: 2, measure: "0" }, itemAmount: 300_000, itemPrice: 150_000, tax: { taxType: 0 } });
    const attrs = (items[0].itemAttributes as { attributes: { name: string; value: string }[] }).attributes;
    expect(attrs).toEqual([
      { name: "paymentMethod", value: "4" },
      { name: "paymentObject", value: "1" },
      { name: "agent_info.type", value: "7" },
      { name: "supplier_info.inn", value: "7707083893" },
      { name: "supplier_info.name", value: "ООО Ромашка" },
      { name: "supplier_info.phones", value: "+79161234567" },
    ]);
    expect(bundleTotal(items as { itemAmount: number }[])).toBe(379_900);
  });

  it("агентский чек без ИНН продавца не строится", () => {
    expect(() => fiscalReceipt({ ...base, supplier: { name: "Иван", inn: null } }, { settings: agent() })).toThrow(/ИНН/);
  });

  it("Т-Банк Init уходит с чеком, подпись не зависит от чека", async () => {
    const fetchMock = okFetch({ Success: true, ErrorCode: "0", PaymentId: 777, PaymentURL: "https://pay.tbank.ru/x", Status: "NEW" });
    const p = new TbankPaymentProvider("term", "pass", "https://securepay.tinkoff.ru/v2", { config: tbankOn, settings: agent, loadByOrder: async () => base });
    await p.createCharge({ orderId: "ord1", amountKopecks: 379_900, currency: "RUB", idempotencyKey: "ord_ord1" });
    const body = JSON.parse(rawBody(fetchMock)) as { Receipt: { Items: unknown[] }; Token: string };
    expect(body.Receipt.Items).toHaveLength(3);
    const noReceipt = new TbankPaymentProvider("term", "pass", "https://securepay.tinkoff.ru/v2", { config: () => ({ ...tbankOn(), enabled: false }) });
    const fetch2 = okFetch({ Success: true, ErrorCode: "0", PaymentId: 777, Status: "NEW" });
    await noReceipt.createCharge({ orderId: "ord1", amountKopecks: 379_900, currency: "RUB", idempotencyKey: "ord_ord1" });
    const body2 = JSON.parse(rawBody(fetch2)) as { Receipt?: unknown; OrderId: string };
    expect(body2.Receipt).toBeUndefined();
  });

  it("Т-Банк: сумма платежа не совпала с чеком, в банк ничего не уходит", async () => {
    const fetchMock = okFetch({ Success: true, ErrorCode: "0", PaymentId: 1 });
    const p = new TbankPaymentProvider("term", "pass", "https://securepay.tinkoff.ru/v2", { config: tbankOn, settings: plain, loadByOrder: async () => base });
    await expect(p.createCharge({ orderId: "ord1", amountKopecks: 100, currency: "RUB", idempotencyKey: "k" })).rejects.toThrow(/сумма чека/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Т-Банк Cancel: чек возврата на сумму возврата", async () => {
    const fetchMock = okFetch({ Success: true, ErrorCode: "0", Status: "PARTIAL_REFUNDED" });
    const p = new TbankPaymentProvider("term", "pass", "https://securepay.tinkoff.ru/v2", { config: tbankOn, settings: agent, loadByPayment: async () => base });
    const r = await p.refund({ paymentProviderRef: "777", amountKopecks: 50_000, reason: "возврат", idempotencyKey: "rf" });
    expect(r.status).toBe("SUCCEEDED");
    const body = JSON.parse(rawBody(fetchMock)) as { Amount: number; Receipt: { Items: { Amount: number }[] } };
    expect(body.Amount).toBe(50_000);
    expect(bundleTotal(body.Receipt.Items)).toBe(50_000);
  });

  it("Сбер register.do: orderBundle и taxSystem", async () => {
    const fetchMock = okFetch({ orderId: "rbs-1", formUrl: "https://securepayments.sberbank.ru/x" });
    const p = new RbsPaymentProvider("sber", { userName: "u", password: "p", apiUrl: "https://securepayments.sberbank.ru/payment/rest" }, { config: rbsOn, settings: plain, loadByOrder: async () => base });
    await p.createCharge({ orderId: "ord1", amountKopecks: 379_900, currency: "RUB", idempotencyKey: "k" });
    const form = new URLSearchParams(rawBody(fetchMock));
    expect(form.get("taxSystem")).toBe("1");
    const bundle = JSON.parse(form.get("orderBundle") ?? "{}") as { cartItems: { items: { itemAmount: number }[] } };
    expect(bundleTotal(bundle.cartItems.items)).toBe(379_900);
  });

  it("Альфа без включённых чеков: корзина не передаётся", async () => {
    const fetchMock = okFetch({ orderId: "rbs-2", formUrl: "https://payment.alfabank.ru/x" });
    const p = new RbsPaymentProvider("alfa", { userName: "u", password: "p", apiUrl: "https://payment.alfabank.ru/payment/rest" }, { config: () => ({ ...rbsOn(), enabled: false }) });
    await p.createCharge({ orderId: "ord1", amountKopecks: 379_900, currency: "RUB", idempotencyKey: "k" });
    expect(new URLSearchParams(rawBody(fetchMock)).get("orderBundle")).toBe(null);
  });
});
