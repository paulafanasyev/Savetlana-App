import { describe, expect, it } from "vitest";
import { describeAttrs, fieldsFor, parseAttrs, photoDigests, priceLabel } from "../src/lib/classified-fields";
import { scanClassified } from "../src/lib/domains/classified-guard";

const form = (values: Record<string, string>) => (name: string) => values[name];

describe("характеристики объявления из формы", () => {
  it("берёт только известные поля своей вертикали", () => {
    const attrs = parseAttrs("AUTO", form({ attr_brand: " Toyota ", attr_model: "Camry", attr_year: "2021", attr_mileageKm: "42000", attr_areaTotal: "50", attr_bankAccount: "123" }));
    expect(attrs).toEqual({ brand: "Toyota", model: "Camry", year: 2021, mileageKm: 42000 });
  });

  it("отбрасывает числа вне пределов и чужие значения списков", () => {
    const attrs = parseAttrs("AUTO", form({ attr_year: "1800", attr_mileageKm: "-5", attr_bodyType: "TANK", attr_fuelType: "DIESEL" }));
    expect(attrs).toEqual({ fuelType: "DIESEL" });
  });

  it("площадь с запятой и десятыми", () => {
    expect(parseAttrs("REAL_ESTATE", form({ attr_areaTotal: "58,56", attr_roomsTotal: "2" }))).toEqual({ roomsTotal: 2, areaTotal: 58.6 });
  });

  it("VIN приводится к верхнему регистру без пробелов", () => {
    expect(parseAttrs("AUTO", form({ attr_vin: "jtnbe40k2 03123456" })).vin).toBe("JTNBE40K203123456");
  });

  it("у каждой вертикали свои поля", () => {
    expect(fieldsFor("REAL_ESTATE").some((f) => f.key === "areaTotal")).toBe(true);
    expect(fieldsFor("AUTO").some((f) => f.key === "mileageKm")).toBe(true);
    expect(fieldsFor("SERVICE").some((f) => f.key === "experienceYears")).toBe(true);
    expect(fieldsFor("WEAPONS")).toHaveLength(0);
  });
});

describe("характеристики для покупателя", () => {
  it("русские подписи, единицы и значения списков", () => {
    const rows = describeAttrs("REAL_ESTATE", { propertyType: "APARTMENT", areaTotal: 58.5, furniture: "yes" });
    expect(rows).toEqual([
      { label: "Тип недвижимости", value: "Квартира" },
      { label: "Общая площадь", value: "58,5 м²" },
      { label: "Мебель", value: "Да" },
    ]);
  });

  it("VIN показывается не целиком", () => {
    const rows = describeAttrs("AUTO", { vin: "JTNBE40K203123456" });
    expect(rows[0]?.value).toBe("JTNB•••••••••3456");
  });

  it("подпись цены зависит от сделки", () => {
    expect(priceLabel("LONG_RENT")).toBe("Цена в месяц, ₽");
    expect(priceLabel("DAILY_RENT")).toBe("Цена за сутки, ₽");
    expect(priceLabel("SELL")).toBe("Цена, ₽");
  });
});

describe("фото и антифрод", () => {
  const sha = "a".repeat(64);
  it("хэш фото достаётся из адреса любого хранилища", () => {
    expect(photoDigests([`/api/storage/database/public/classifieds/${sha}`, `https://x.blob.vercel-storage.com/public/classifieds/${sha}-AbC123.jpg`, "/img/no-hash.jpg"])).toEqual([sha]);
  });

  it("ПТС дубликат или без ПТС из формы отправляет на проверку", () => {
    const ad = { vertical: "AUTO", dealType: "SELL", title: "Kia Rio 2018", priceKopecks: 1, attrs: { pts: "duplicate" } };
    expect(scanClassified(ad).findings.map((f) => f.code)).toContain("AUTO_DOCS_RISK");
    expect(scanClassified({ ...ad, attrs: { pts: "original" } }).verdict).toBe("ok");
  });
});
