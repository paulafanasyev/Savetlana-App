import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchLivePayment } from "../src/lib/domains/payment-webhooks";
import { TbankPaymentProvider } from "../src/lib/domains/tbank";
import { RbsPaymentProvider } from "../src/lib/domains/rbs";
import { YooKassaPaymentProvider } from "../src/lib/domains/yookassa";

describe("сверка зависших платежей: статус берётся из API банка", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Т-Банк: CONFIRMED → оплачен, заказ из OrderId попытки", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ Success: true, Status: "CONFIRMED", Amount: 150050, OrderId: "cmorder123_abc" }))));
    const tbank = new TbankPaymentProvider("T", "p", "https://tb.example/v2");
    const r = await fetchLivePayment("tbank", "700001", { tbank });
    expect(r).toEqual({ status: "SUCCEEDED", rawStatus: "CONFIRMED", amountKopecks: 150050, orderId: "cmorder123" });
  });

  it("Сбер: orderStatus 6 → отказ", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ errorCode: "0", orderStatus: 6, amount: 1000, merchantOrderParams: [{ name: "order_id", value: "o1" }] }))));
    const sber = new RbsPaymentProvider("sber", { userName: "u", password: "p", apiUrl: "https://sb.example/payment/rest" });
    const r = await fetchLivePayment("sber", "md-0000001", { sber });
    expect(r).toEqual({ status: "FAILED", rawStatus: "status_6", amountKopecks: 1000, orderId: "o1" });
  });

  it("ЮKassa: succeeded и сумма в копейках", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "2d3f-0000-aaaa", status: "succeeded", amount: { value: "1500.50", currency: "RUB" }, metadata: { order_id: "o2" } }))));
    const yookassa = new YooKassaPaymentProvider("shop", "key");
    const r = await fetchLivePayment("yookassa", "2d3f-0000-aaaa", { yookassa });
    expect(r).toEqual({ status: "SUCCEEDED", rawStatus: "succeeded", amountKopecks: 150050, orderId: "o2" });
  });

  it("банк не настроен или неизвестен → null, без запросов", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await fetchLivePayment("tbank", "1", { tbank: new TbankPaymentProvider(undefined, undefined) })).toBeNull();
    expect(await fetchLivePayment("partner-payment", "1", {})).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
