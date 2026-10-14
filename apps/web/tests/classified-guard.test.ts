import { describe, expect, it } from "vitest";
import { marketReference, median, scanClassified, type ClassifiedForScan } from "../src/lib/domains/classified-guard";

const now = new Date("2026-10-14T12:00:00Z");
const rent: ClassifiedForScan = { vertical: "REAL_ESTATE", dealType: "LONG_RENT", title: "Сдам квартиру", priceKopecks: 0, attrs: {} };
const service: ClassifiedForScan = { vertical: "SERVICE", dealType: "SERVICE_OFFER", title: "Работа", priceKopecks: 0, attrs: {} };
const codes = (ad: ClassifiedForScan, ctx = {}) => scanClassified(ad, { now, ...ctx }).findings.map((f) => f.code);

describe("антифрод объявлений: честные объявления проходят", () => {
  it("обычная аренда с залогом и показом", () => {
    expect(scanClassified({ ...rent, description: "Сдам двушку у метро. Залог 30 000, оплата помесячно. Показ в любое время." }, { now }).verdict).toBe("ok");
  });
  it("Camry 2021 с нормальным пробегом", () => {
    const ad = { vertical: "AUTO", dealType: "SELL", title: "Toyota Camry 2021, один владелец", priceKopecks: 290_000_000, attrs: { brand: "Toyota", model: "Camry", year: 2021, mileageKm: 42_000 } };
    expect(scanClassified(ad, { now }).verdict).toBe("ok");
  });
  it("услуга по оформлению медкнижки не путается с «оплатите медкнижку»", () => {
    expect(scanClassified({ ...service, description: "Помогу оформить медкнижку за 1 день, официально" }, { now }).verdict).toBe("ok");
  });
  it("оплата наличными курьеру при получении только предупреждение", () => {
    expect(scanClassified({ ...service, description: "Доставка по городу, оплата наличными курьеру при получении" }, { now }).verdict).toBe("warn");
  });
  it("телефон в объявлении не повод для проверки", () => {
    expect(scanClassified({ ...rent, dealType: "SELL", description: "Звоните +7 916 123-45-67" }, { now }).verdict).toBe("warn");
  });
});

describe("антифрод объявлений: блокировка", () => {
  it("фишинговая ссылка «безопасной сделки»", () => {
    const v = scanClassified({ ...rent, description: "Оплата через безопасную сделку avito-dostavka.ru" }, { now });
    expect(v.verdict).toBe("block");
  });
  it("вербовка курьеров за наличными у пенсионеров", () => {
    expect(codes({ ...service, description: "Ищем курьеров: забирать наличные у пенсионеров и переводить" })).toContain("MONEY_MULE");
  });
  it("аренда банковской карты", () => {
    expect(scanClassified({ ...service, description: "Сдай карту в аренду, 10 000 в неделю" }, { now }).verdict).toBe("block");
  });
});

describe("антифрод объявлений: на проверку модератору", () => {
  it("бронь аренды только по предоплате на карту", () => {
    expect(codes({ ...rent, description: "Бронь только по предоплате на карту, желающих много" })).toContain("RENT_PREPAYMENT");
  });
  it("задаток до просмотра", () => {
    const v = scanClassified({ ...rent, description: "Задаток 5000 до просмотра, иначе не показываю" }, { now });
    expect(v.verdict).toBe("review");
    expect(v.findings.map((f) => f.code)).toContain("PREPAY_BEFORE_VIEWING");
  });
  it("хозяин за границей, ключи почтой", () => {
    expect(codes({ ...rent, description: "Я сейчас за границей, ключи вышлю почтой после оплаты" })).toContain("RENT_REMOTE_OWNER");
  });
  it("плата за обучение для трудоустройства", () => {
    expect(codes({ ...service, description: "Требуются операторы. Оплатите обучение 2000 руб, потом трудоустройство" })).toContain("JOB_FEE");
  });
  it("лёгкий заработок от 5000 в день", () => {
    expect(codes({ ...service, description: "Лёгкий заработок, доход от 5000 руб в день" })).toContain("EASY_MONEY");
  });
  it("предоплата за машину с доставкой", () => {
    expect(codes({ vertical: "AUTO", dealType: "SELL", title: "Kia Rio", description: "Пригоню из Владивостока, предоплата 50% на карту", priceKopecks: 1, attrs: {} })).toContain("AUTO_PREPAYMENT");
  });
  it("машина без ПТС или в залоге", () => {
    expect(codes({ vertical: "AUTO", dealType: "SELL", title: "Лада Гранта без ПТС", priceKopecks: 1, attrs: {} })).toContain("AUTO_DOCS_RISK");
    expect(codes({ vertical: "AUTO", dealType: "SELL", title: "Kia Rio", description: "Машина в залоге у банка", priceKopecks: 1, attrs: {} })).toContain("AUTO_DOCS_RISK");
  });
  it("подозрительно маленький пробег", () => {
    expect(codes({ vertical: "AUTO", dealType: "SELL", title: "BMW X5 2015", priceKopecks: 1, attrs: { brand: "BMW", model: "X5", year: 2015, mileageKm: 15_000 } })).toContain("MILEAGE_SUSPICIOUS");
  });
  it("чужие фотографии", () => {
    expect(codes(rent, { duplicatePhotoAds: 1 })).toContain("DUPLICATE_PHOTOS");
  });
});

describe("цена-приманка", () => {
  const cars = Array.from({ length: 6 }, (_, i) => ({ priceKopecks: (280 + i * 5) * 1_000_000, attrs: { brand: "toyota", model: "camry", year: 2020 } }));
  const camry = { vertical: "AUTO", dealType: "SELL", title: "Toyota Camry", priceKopecks: 100_000_000, attrs: { brand: "Toyota", model: "Camry", year: 2021 } };

  it("медиана", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it("машина в 2,5 раза дешевле таких же", () => {
    expect(codes(camry, { comparables: cars })).toContain("PRICE_TOO_LOW");
  });
  it("рыночная цена не проверяется, если похожих мало", () => {
    expect(marketReference(camry, cars.slice(0, 4))).toBeNull();
  });
  it("другие модели не считаются похожими", () => {
    const other = cars.map((c) => ({ ...c, attrs: { brand: "kia", model: "rio", year: 2020 } }));
    expect(marketReference(camry, other)).toBeNull();
  });
  it("квартира сравнивается по цене за метр", () => {
    const flats = Array.from({ length: 6 }, (_, i) => ({ priceKopecks: (10 + i) * 1_000_000_000, attrs: { areaTotal: 50, propertyType: "APARTMENT" } }));
    const flat = (price: number) => ({ vertical: "REAL_ESTATE", dealType: "SELL", title: "Квартира", priceKopecks: price, attrs: { areaTotal: 60, propertyType: "APARTMENT" } });
    expect(codes(flat(4_000_000_000), { comparables: flats })).toContain("PRICE_TOO_LOW");
    expect(scanClassified(flat(12_000_000_000), { now, comparables: flats }).verdict).toBe("ok");
  });
});
