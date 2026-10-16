import { describe, expect, it } from "vitest";
import { classifiedIntent, classifiedSearchStems, normalizeDealType, normalizeVertical } from "../src/lib/classified-intent";

describe("что человек ищет в объявлениях", () => {
  it("работа и вакансии", () => {
    expect(classifiedIntent("Найди мне работу")).toEqual({ vertical: "JOB", dealType: "VACANCY" });
    expect(classifiedIntent("есть вакансии водителя в Казани?")).toEqual({ vertical: "JOB", dealType: "VACANCY" });
    expect(classifiedIntent("ищу подработку на выходные")).toEqual({ vertical: "JOB", dealType: "VACANCY" });
  });

  it("работодатель ищет людей", () => {
    expect(classifiedIntent("ищу сотрудника на склад")).toEqual({ vertical: "JOB", dealType: "RESUME" });
    expect(classifiedIntent("покажи резюме")).toEqual({ vertical: "JOB", dealType: "RESUME" });
  });

  it("услуги и фриланс", () => {
    expect(classifiedIntent("нужен мастер по ремонту ванной")).toEqual({ vertical: "SERVICE", dealType: "SERVICE_OFFER" });
    expect(classifiedIntent("найди фрилансера на логотип")).toEqual({ vertical: "SERVICE", dealType: "SERVICE_OFFER" });
    expect(classifiedIntent("ищу заказы на дизайн сайтов")).toEqual({ vertical: "SERVICE", dealType: "SERVICE_REQUEST" });
  });

  it("товары не трогает", () => {
    expect(classifiedIntent("найди наушники до 5000")).toEqual({});
    expect(classifiedIntent("где мой заказ")).toEqual({});
  });

  it("основы слов для поиска", () => {
    expect(classifiedSearchStems("работу водителем")).toEqual(["водител"]);
    expect(classifiedSearchStems("работа курьером в Казани", ["Казань"])).toEqual(["курьер"]);
    expect(classifiedSearchStems("найди мне работу")).toEqual([]);
    expect(classifiedSearchStems("ремонт ванной")).toEqual(["ремонт", "ванн"]);
  });

  it("разделы и типы сделки от модели", () => {
    expect(normalizeVertical("job")).toBe("JOB");
    expect(normalizeVertical("Работа")).toBe("JOB");
    expect(normalizeVertical("SERVICE")).toBe("SERVICE");
    expect(normalizeVertical("фриланс")).toBe("SERVICE");
    expect(normalizeVertical("что-то")).toBeUndefined();
    expect(normalizeDealType("vacancy")).toBe("VACANCY");
    expect(normalizeDealType("xxx")).toBeUndefined();
  });
});
