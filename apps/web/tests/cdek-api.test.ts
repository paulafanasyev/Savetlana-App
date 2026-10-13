import { describe, expect, it } from "vitest";
import { buildCdekOrder, cdekDate, cdekPhone, cdekStatusToCanonical, parseCdekTracking } from "../src/lib/domains/carriers/cdek";

const base = {
  orderNumber: "SV-1001",
  fromPointCode: "msk123",
  address: { city: "Москва", street: "ул. Ленина", house: "5", apartment: "12", zip: "101000", recipientName: "Анна", phone: "8 (900) 123-45-67" },
  buyerName: "Анна",
  seller: { name: "Магазин чайников", inn: "7700000000", phone: "+7 901 000-00-00" },
  items: [{ title: "Чайник", productId: "p1", priceKopecks: 250_000, quantity: 2 }],
};

describe("СДЭК: заявка", () => {
  it("собирает заказ «склад-дверь» из данных заказа", () => {
    const body = buildCdekOrder(base);
    expect(body.tariff_code).toBe(137);
    expect(body.shipment_point).toBe("MSK123");
    expect(body.to_location.city).toBe("Москва");
    expect(body.to_location.address).toBe("ул. Ленина, д. 5, кв. 12");
    expect(body.recipient.phones[0].number).toBe("+79001234567");
    expect(body.packages[0].items[0].payment.value).toBe(0);
    expect(body.packages[0].items[0].cost).toBe(2500);
    expect(body.packages[0].weight).toBe(1000);
  });

  it("не отправляет заявку без пункта, адреса или телефона", () => {
    expect(() => buildCdekOrder({ ...base, fromPointCode: "" })).toThrow(/пункта СДЭК/);
    expect(() => buildCdekOrder({ ...base, address: { ...base.address, street: "" } })).toThrow(/адреса/);
    expect(() => buildCdekOrder({ ...base, address: { ...base.address, phone: "123" } })).toThrow(/телефона/);
  });
});

describe("СДЭК: статусы", () => {
  it("переводит коды СДЭК в наши статусы", () => {
    expect(cdekStatusToCanonical("ACCEPTED")).toBe("CREATED");
    expect(cdekStatusToCanonical("RECEIVED_AT_SHIPMENT_WAREHOUSE")).toBe("HANDED_OVER");
    expect(cdekStatusToCanonical("TAKEN_BY_COURIER")).toBe("IN_TRANSIT");
    expect(cdekStatusToCanonical("DELIVERED")).toBe("DELIVERED");
    expect(cdekStatusToCanonical("NOT_DELIVERED")).toBe("FAILED");
  });

  it("строит ленту событий по датам и берёт номер СДЭК", () => {
    const t = parseCdekTracking({
      entity: {
        cdek_number: "1234567890",
        statuses: [
          { code: "DELIVERED", name: "Вручён", date_time: "2026-10-03T15:00:00+0300", city: "Москва" },
          { code: "CREATED", name: "Создан", date_time: "2026-10-01T10:00:00+0300" },
        ],
      },
    });
    expect(t.status).toBe("DELIVERED");
    expect(t.events[0].status).toBe("CREATED");
    expect(t.events[1].description).toBe("Вручён, Москва");
    expect(t.externalNumber).toBe("1234567890");
  });

  it("сообщает об отклонённой заявке", () => {
    const t = parseCdekTracking({ requests: [{ state: "INVALID", errors: [{ message: "Неверный пункт" }] }] });
    expect(t.status).toBe("FAILED");
    expect(t.events[0].description).toBe("СДЭК: Неверный пункт");
  });

  it("понимает телефоны и даты СДЭК", () => {
    expect(cdekPhone("+7 900 123-45-67")).toBe("+79001234567");
    expect(cdekPhone("9001234567")).toBe("+79001234567");
    expect(cdekPhone("12")).toBe(null);
    expect(cdekDate("2026-10-01T10:00:00+0300")?.toISOString()).toBe("2026-10-01T07:00:00.000Z");
  });
});
