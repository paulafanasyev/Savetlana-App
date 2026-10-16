import { describe, expect, it } from "vitest";
import { cleanWorkReport, isServiceOrder, serviceAddress, serviceCustomerNote, serviceMeta, servicePerformerNote, SERVICE_EXTRA_TRANSITIONS } from "../src/lib/service-deal";
import { canTransition } from "../src/lib/domains/orders";

describe("безопасная сделка для услуг", () => {
  it("метаданные услуги хранятся в заказе и читаются обратно", () => {
    const addr = serviceAddress({ classifiedId: "ad1", performerId: "u2", days: 5, title: "Сайт-визитка" });
    expect(serviceMeta(addr)).toEqual({ kind: "SERVICE", classifiedId: "ad1", performerId: "u2", days: 5, title: "Сайт-визитка" });
    expect(isServiceOrder(addr)).toBe(true);
    expect(isServiceOrder(JSON.stringify({ city: "Москва", deliveryMethod: "PICKUP" }))).toBe(false);
    expect(isServiceOrder("не json")).toBe(false);
  });

  it("сдать работу можно сразу после оплаты, но только у услуги", () => {
    expect(SERVICE_EXTRA_TRANSITIONS.PAID).toContain("DELIVERED");
    expect(canTransition("PAID", "DELIVERED", true)).toBe(true);
    expect(canTransition("PAID", "DELIVERED")).toBe(false);
    expect(canTransition("IN_TRANSIT", "DELIVERED")).toBe(true);
  });

  it("отчёт о работе проверяется", () => {
    expect(cleanWorkReport("готово").ok).toBe(false);
    expect(cleanWorkReport("Сайт готов, ссылка на макет в переписке").ok).toBe(true);
  });

  it("обе стороны видят, где деньги", () => {
    expect(serviceCustomerNote("PAYMENT_PENDING")).toContain("Оплатите");
    expect(serviceCustomerNote("DELIVERED")).toContain("«Работа принята»");
    expect(servicePerformerNote("PAYMENT_PENDING")).toContain("Не начинайте");
    expect(servicePerformerNote("COMPLETED")).toContain("доступны к выплате");
  });
});
