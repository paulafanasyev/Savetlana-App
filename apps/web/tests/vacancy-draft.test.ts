import { describe, expect, it } from "vitest";
import { mergeModelDraft, parseVacancyText } from "../src/lib/domains/vacancy-draft";

describe("Светлана составляет вакансию", () => {
  it("раскладывает текст по полям и не выдумывает", () => {
    const d = parseVacancyText("Ищем курьера на авто компании, 80-100 тыс на руки, 5/2, без опыта, по ТК");
    expect(d.title).toBe("Курьер на авто компании");
    expect(d.category).toBe("Доставка");
    expect(d.salaryFrom).toBe(80000);
    expect(d.attrs).toEqual({ schedule: "5/2", experience: "none", contract: "tk", salaryTax: "net", salaryTo: "100000", salaryPeriod: "month" });
    expect(d.description).toContain("80-100 тыс");
  });

  it("зарплата за смену и в час", () => {
    const shift = parseVacancyText("Нужен повар, 3500 за смену, сменный график, официальное трудоустройство");
    expect(shift.salaryFrom).toBe(3500);
    expect(shift.attrs.salaryPeriod).toBe("shift");
    expect(shift.attrs.contract).toBe("tk");
    const hour = parseVacancyText("Удаленно оператор колл-центра, частичная занятость, 300 руб в час");
    expect(hour.salaryFrom).toBe(300);
    expect(hour.attrs).toMatchObject({ salaryPeriod: "hour", employment: "part", workFormat: "remote" });
  });

  it("без зарплаты в тексте зарплату не ставит", () => {
    const d = parseVacancyText("Требуется продавец в магазин одежды, график 2/2");
    expect(d.salaryFrom).toBeUndefined();
    expect(d.attrs.salaryPeriod).toBeUndefined();
    expect(d.attrs.schedule).toBe("2/2");
    const hours = parseVacancyText("Нужен администратор в салон, работа с 9 до 18, опыт от 1 года");
    expect(hours.salaryFrom).toBeUndefined();
    expect(hours.attrs.salaryTo).toBeUndefined();
  });

  it("ответ модели проверяется: чужие значения и безумные суммы отбрасываются", () => {
    const base = parseVacancyText("Ищем курьера на авто компании, 80-100 тыс на руки, 5/2, без опыта, по ТК");
    const merged = mergeModelDraft(base, { employment: "лучшая работа", schedule: "2/2", salaryTo: 999999999, title: "Курьер на автомобиле компании", description: "коротко" });
    expect(merged.attrs.employment).toBeUndefined();
    expect(merged.attrs.schedule).toBe("2/2");
    expect(merged.attrs.salaryTo).toBe("100000");
    expect(merged.title).toBe("Курьер на автомобиле компании");
    expect(merged.description).toBe(base.description);

    const noSalary = mergeModelDraft(parseVacancyText("Требуется продавец в магазин одежды, график 2/2"), { salaryFrom: 90000, salaryPeriod: "month" });
    expect(noSalary.salaryFrom).toBeUndefined();
    expect(noSalary.attrs.salaryPeriod).toBeUndefined();
  });
});
