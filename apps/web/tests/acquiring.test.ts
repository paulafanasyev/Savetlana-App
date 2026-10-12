import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { TbankPaymentProvider, tbankToken, mapTbankStatus, attemptOrderId, orderIdFromAttempt } from "../src/lib/domains/tbank";
import { RbsPaymentProvider, mapRbsStatus, rbsChecksum, rbsOrderNumber } from "../src/lib/domains/rbs";

const TB = () => new TbankPaymentProvider("TestTerminal", "secretpass", "https://securepay.example/v2");

describe("Т-Банк", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("подпись: скаляры + Password, по алфавиту, без Token и вложенных объектов", () => {
    const params = { TerminalKey: "T", Amount: 1000, OrderId: "o1", DATA: { a: "b" }, Token: "x", Success: true };
    const expected = createHash("sha256").update("1000" + "o1" + "pw" + "true" + "T").digest("hex");
    expect(tbankToken(params, "pw")).toBe(expected);
  });

  it("статусы: CONFIRMED → оплачен, REJECTED/CANCELED → отказ, остальное ждёт", () => {
    expect(mapTbankStatus("CONFIRMED")).toBe("SUCCEEDED");
    expect(mapTbankStatus("REJECTED")).toBe("FAILED");
    expect(mapTbankStatus("CANCELED")).toBe("FAILED");
    expect(mapTbankStatus("NEW")).toBe("PENDING");
    expect(mapTbankStatus("AUTHORIZED")).toBe("PENDING");
  });

  it("номер попытки уникален и обратимо даёт id заказа", () => {
    const a = attemptOrderId("cmabc123def456ghi789jkl0m", 1700000000000);
    expect(a.length).toBeLessThanOrEqual(36);
    expect(orderIdFromAttempt(a)).toBe("cmabc123def456ghi789jkl0m");
    expect(attemptOrderId("cmabc", 1)).not.toBe(attemptOrderId("cmabc", 2));
  });

  it("без ключей выключен", () => {
    expect(new TbankPaymentProvider(undefined, undefined).available).toBe(false);
    expect(TB().available).toBe(true);
  });

  it("Init: сумма в копейках, подпись, ссылка на оплату", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ Success: true, ErrorCode: "0", PaymentId: "700001", PaymentURL: "https://pay.tbank.example/abc", Status: "NEW" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await TB().createCharge({ orderId: "ord1", amountKopecks: 150050, currency: "RUB", idempotencyKey: "k" });
    expect(r).toMatchObject({ providerRef: "700001", status: "PENDING", confirmationUrl: "https://pay.tbank.example/abc" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://securepay.example/v2/Init");
    const body = JSON.parse(String(init.body));
    expect(body.Amount).toBe(150050);
    expect(body.TerminalKey).toBe("TestTerminal");
    expect(body.DATA).toEqual({ order_id: "ord1" });
    expect(body.Token).toBe(tbankToken(body, "secretpass"));
    expect(body.Password).toBeUndefined();
  });

  it("СБП: после Init берёт ссылку из GetQr", async () => {
    const fetchMock = vi.fn(async (u: string) =>
      String(u).endsWith("/Init")
        ? new Response(JSON.stringify({ Success: true, PaymentId: 77, PaymentURL: "https://pay.tbank.example/x", Status: "NEW" }))
        : new Response(JSON.stringify({ Success: true, Data: "https://qr.nspk.ru/AS1000ABC" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await TB().createCharge({ orderId: "ord2", amountKopecks: 1000, currency: "RUB", idempotencyKey: "k", method: "sbp" });
    expect(r.confirmationUrl).toBe("https://qr.nspk.ru/AS1000ABC");
    expect(String((fetchMock.mock.calls[1] as unknown as [string])[0])).toMatch(/GetQr$/);
  });

  it("ошибка банка → исключение без пароля", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ Success: false, ErrorCode: "204", Message: "Неверный токен" }))));
    const err = await TB().createCharge({ orderId: "o", amountKopecks: 100, currency: "RUB", idempotencyKey: "k" }).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/204/);
    expect((err as Error).message).not.toMatch(/secretpass/);
  });

  it("уведомление: верная подпись принимается, подделка — нет", () => {
    const p = TB();
    const n: Record<string, unknown> = { TerminalKey: "TestTerminal", OrderId: "o_1", Success: true, Status: "CONFIRMED", PaymentId: 700001, Amount: 1000 };
    n.Token = tbankToken(n, "secretpass");
    expect(p.verifyNotification(n)).toBe(true);
    expect(p.verifyNotification({ ...n, Amount: 1 })).toBe(false);
    expect(p.verifyNotification({ ...n, TerminalKey: "Other" })).toBe(false);
  });
});

const SB = (secret?: string) => new RbsPaymentProvider("sber", { userName: "api-user", password: "api-pass", apiUrl: "https://3dsec.example/payment/rest", callbackSecret: secret });

describe("Сбербанк / Альфа-Банк (RBS)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("статусы: 2 = оплачен, 3 и 6 = отказ, остальное ждёт", () => {
    expect(mapRbsStatus(2)).toBe("SUCCEEDED");
    expect(mapRbsStatus(6)).toBe("FAILED");
    expect(mapRbsStatus(3)).toBe("FAILED");
    expect(mapRbsStatus(0)).toBe("PENDING");
    expect(mapRbsStatus(1)).toBe("PENDING");
  });

  it("номер заказа для банка ≤ 32 символов и уникален", () => {
    expect(rbsOrderNumber("x".repeat(40), 1).length).toBeLessThanOrEqual(32);
    expect(rbsOrderNumber("abc", 1)).not.toBe(rbsOrderNumber("abc", 2));
  });

  it("register.do: форма с копейками, валютой 643 и нашим id заказа", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ orderId: "70906e55-7114-41d6-8332-4609dc6590f4", formUrl: "https://3dsec.example/payment/merchants/x/payment_ru.html?mdOrder=1" })));
    vi.stubGlobal("fetch", fetchMock);
    const r = await SB().createCharge({ orderId: "ord9", amountKopecks: 250000, currency: "RUB", idempotencyKey: "k" });
    expect(r).toMatchObject({ providerRef: "70906e55-7114-41d6-8332-4609dc6590f4", status: "PENDING" });
    expect(r.confirmationUrl).toMatch(/^https:\/\//);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://3dsec.example/payment/rest/register.do");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("amount")).toBe("250000");
    expect(form.get("currency")).toBe("643");
    expect(form.get("userName")).toBe("api-user");
    expect(JSON.parse(form.get("jsonParams") ?? "{}")).toEqual({ order_id: "ord9" });
  });

  it("ошибка банка (errorCode ≠ 0) → исключение", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ errorCode: "5", errorMessage: "Доступ запрещён" }))));
    await expect(SB().createCharge({ orderId: "o", amountKopecks: 100, currency: "RUB", idempotencyKey: "k" })).rejects.toThrow(/5/);
  });

  it("статус берёт сумму и наш заказ из merchantOrderParams", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ errorCode: "0", orderStatus: 2, amount: 250000, merchantOrderParams: [{ name: "order_id", value: "ord9" }] }))));
    const p = await SB().getPayment("70906e55-7114-41d6-8332-4609dc6590f4");
    expect(p).toEqual({ orderStatus: 2, amountKopecks: 250000, orderId: "ord9" });
  });

  it("checksum callback: HMAC-SHA256, верхний регистр", () => {
    const params = { mdOrder: "m1", orderNumber: "n1", operation: "deposited", status: "1" };
    const data = "mdOrder;m1;operation;deposited;orderNumber;n1;status;1;";
    const expected = createHmac("sha256", "cb-secret").update(data).digest("hex").toUpperCase();
    expect(rbsChecksum(params, "cb-secret")).toBe(expected);
    const p = SB("cb-secret");
    expect(p.verifyCallback({ ...params, checksum: expected })).toBe(true);
    expect(p.verifyCallback({ ...params, checksum: "00" })).toBe(false);
    expect(SB().verifyCallback(params)).toBe(true);
  });

  it("Альфа-Банк — отдельный провайдер с тем же протоколом", () => {
    const a = new RbsPaymentProvider("alfa", { userName: "u", password: "p", apiUrl: "https://alfa.example/payment/rest" });
    expect(a.key).toBe("alfa");
    expect(a.available).toBe(true);
    expect(new RbsPaymentProvider("alfa", { apiUrl: "https://alfa.example/payment/rest" }).available).toBe(false);
  });
});
