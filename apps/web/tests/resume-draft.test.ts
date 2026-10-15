import { describe, expect, it } from "vitest";
import { fromInstrumental, parseResumeText, resumeExperience, resumeTitle } from "../src/lib/domains/resume-draft";

describe("Светлана составляет резюме", () => {
  it("находит желаемую должность", () => {
    expect(resumeTitle("Ищу работу водителем, опыт 7 лет")).toBe("Водитель");
    expect(resumeTitle("Хочу работать продавцом-консультантом. Опыт 2 года")).toBe("Продавец-консультант");
    expect(resumeTitle("Рассматриваю вакансии в качестве бухгалтера. Стаж 10 лет")).toBe("Бухгалтер");
    expect(resumeTitle("Резюме: оператор колл-центра")).toBe("Оператор колл-центра");
    expect(fromInstrumental("старшим продавцом")).toBe("старший продавец");
  });

  it("стаж только из слов соискателя", () => {
    expect(resumeExperience("опыт 7 лет")).toBe("6+");
    expect(resumeExperience("5 лет опыта в продажах")).toBe("3-6");
    expect(resumeExperience("стаж 2 года")).toBe("1-3");
    expect(resumeExperience("без опыта, быстро учусь")).toBe("none");
    expect(resumeExperience("готов учиться")).toBeUndefined();
  });

  it("раскладывает текст по полям формы", () => {
    const d = parseResumeText("Ищу работу водителем, опыт 7 лет, права B и C, хочу от 80 тыс на руки, график 5/2");
    expect(d.title).toBe("Водитель");
    expect(d.category).toBe("Транспорт");
    expect(d.salaryFrom).toBe(80000);
    expect(d.attrs).toMatchObject({ experience: "6+", schedule: "5/2", salaryTax: "net", salaryPeriod: "month" });
  });

  it("ничего не выдумывает и не ставит прежнего работодателя в поле компании", () => {
    const d = parseResumeText("Работал в компании «Ромашка» кладовщиком, научился работать со сканером. Ищу подработку");
    expect(d.attrs.companyName).toBeUndefined();
    expect(d.attrs.experience).toBeUndefined();
    expect(d.salaryFrom).toBeUndefined();
    expect(d.attrs.employment).toBe("part");
    expect(d.title).toBe("Ищу работу: склад");
  });
});
