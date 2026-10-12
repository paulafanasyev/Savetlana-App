import { describe, it, expect, vi, afterEach } from "vitest";
import {
  YooKassaPaymentProvider,
  buildReceipt,
  kopecksToValue,
  mapYooStatus,
  valueToKopecks,
} from "../src/lib/domains/yookassa";

describe("ЮKassa", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("копейки ↔ строка суммы без float", () => {
    expect(kopecksToValue(123456)).toBe("1234.56");
    expect(kopecksToValue(5)).toBe("0.05");
    expect(kopecksToValue(100)).toBe("1.00");
    expect(valueToKopecks("1234.56")).toBe(123456);
    expect(valueToKopecks("10")).toBe(1000);
    expect(valueToKopecks("10.5")).toBe(1050);
    expect(Number.isNaN(valueToKopecks("abc"))).toBe(true);
  });

  it("статусы: succeeded → SUCCEEDED, canceled → FAILED, остальное ждёт", () => {
    expect(mapYooStatus("succeeded")).toBe("SUCCEEDED");
    expect(mapYooStatus("canceled")).toBe("FAILED");
    expect(mapYooStatus("pending")).toBe("PENDING");
    expect(mapYooStatus("waiting_for_capture")).toBe("PENDING");
  });

  it("без ключей выключена", () => {
    expect(new YooKassaPaymentProvider(undefined, undefined).available).toBe(false);
    expect(new YooKassaPaymentProvider("123", "test_x").available).toBe(true);
  });

  it("создаёт платёж с redirect, Basic-авторизацией и ключом идемпотентности", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ id: "2d3e4f50-000f-5000-9000-1a2b3c4d5e6f", status: "pending", confirmation: { type: "redirect", confirmation_url: "https://yoomoney.ru/checkout/x" } }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const p = new YooKassaPaymentProvider("123456", "test_secret");
    const r = await p.createCharge({ orderId: "ord1", amountKopecks: 199900, currency: "RUB", idempotencyKey: "ord_ord1", returnUrl: "https://aiko.example/orders/ord1" });
    expect(r.status).toBe("PENDING");
    expect(r.confirmationUrl).toBe("https://yoomoney.ru/checkout/x");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.yookassa.ru/v3/payments");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe(`Basic ${Buffer.from("123456:test_secret").toString("base64")}`);
    expect(h["Idempotence-Key"]).toBe("ord_ord1");
    const body = JSON.parse(String(init.body));
    expect(body.amount).toEqual({ value: "1999.00", currency: "RUB" });
    expect(body.capture).toBe(true);
    expect(body.confirmation).toEqual({ type: "redirect", return_url: "https://aiko.example/orders/ord1" });
    expect(body.metadata).toEqual({ order_id: "ord1" });
  });

  it("ошибка ЮKassa превращается в исключение без секретов", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "invalid_credentials", description: "bad" }), { status: 401 })));
    const p = new YooKassaPaymentProvider("123456", "test_secret");
    const err = await p.createCharge({ orderId: "o", amountKopecks: 100, currency: "RUB", idempotencyKey: "k" }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/401/);
    expect((err as Error).message).not.toMatch(/test_secret/);
  });

  it("возврат идёт в /refunds с суммой", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "rf1", status: "succeeded" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const p = new YooKassaPaymentProvider("123456", "test_secret");
    const r = await p.refund({ paymentProviderRef: "pay-12345678", amountKopecks: 50000, reason: "возврат", idempotencyKey: "refund-1" });
    expect(r.status).toBe("SUCCEEDED");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.yookassa.ru/v3/refunds");
    expect(JSON.parse(String(init.body))).toMatchObject({ payment_id: "pay-12345678", amount: { value: "500.00", currency: "RUB" } });
  });

  it("чек 54-ФЗ: позиции + доставка, сумма сходится", () => {
    const r = buildReceipt({
      items: [{ titleSnapshot: "Наушники", quantity: 2, priceKopecks: 150000 }],
      deliveryKopecks: 30000,
      totalKopecks: 330000,
      email: "buyer@example.com",
    });
    expect(r).not.toBeNull();
    expect(r!.items).toHaveLength(2);
    expect(r!.items[0]).toMatchObject({ quantity: "2", amount: { value: "1500.00" }, payment_subject: "commodity" });
    expect(r!.items[1]).toMatchObject({ description: "Доставка", payment_subject: "service" });
    expect(r!.customer.email).toBe("buyer@example.com");
  });

  it("чек не строится, если сумма не сходится или нет контакта", () => {
    expect(buildReceipt({ items: [{ titleSnapshot: "x", quantity: 1, priceKopecks: 100 }], deliveryKopecks: 0, totalKopecks: 90, email: "a@b.c" })).toBeNull();
    expect(buildReceipt({ items: [{ titleSnapshot: "x", quantity: 1, priceKopecks: 100 }], deliveryKopecks: 0, totalKopecks: 100 })).toBeNull();
  });
});
