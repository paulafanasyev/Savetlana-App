/**
 * Раздел «Работа»: вакансии и резюме как объявления, свои поля и антифрод.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { createClassified, searchClassifieds } from "../src/lib/domains/classifieds";
import { scanClassified, type ClassifiedForScan } from "../src/lib/domains/classified-guard";
import { describeAttrs, parseAttrs, priceLabel, priceText } from "../src/lib/classified-fields";
import { dealTypeLabel, verticalLabel } from "../src/lib/verticals";

function vacancy(over: Partial<ClassifiedForScan> = {}): ClassifiedForScan {
  return {
    vertical: "JOB",
    dealType: "VACANCY",
    title: "Продавец-консультант в магазин техники",
    description: "Работа в торговом центре, обучение за счёт компании, оформление по ТК РФ.",
    priceKopecks: 70_000 * 100,
    attrs: { employment: "full", experience: "none", salaryPeriod: "month" },
    ...over,
  };
}

const codes = (ad: ClassifiedForScan, comparables: { priceKopecks: number; attrs: Record<string, unknown> }[] = []) =>
  scanClassified(ad, { comparables }).findings.map((f) => f.code);

describe("раздел «Работа»: поля", () => {
  it("подписи раздела и типов", () => {
    expect(verticalLabel("JOB")).toBe("Работа");
    expect(dealTypeLabel("VACANCY")).toBe("Вакансия");
    expect(dealTypeLabel("RESUME")).toBe("Резюме");
    expect(priceLabel("VACANCY")).toBe("Зарплата от, ₽");
    expect(priceLabel("RESUME")).toBe("Желаемая зарплата, ₽");
  });

  it("форма принимает только известные поля и значения", () => {
    const form: Record<string, string> = {
      attr_employment: "full",
      attr_schedule: "2/2",
      attr_salaryTo: "120000",
      attr_contract: "tk",
      attr_workFormat: "space",
      attr_bankCard: "2200000000000000",
    };
    const attrs = parseAttrs("JOB", (n) => form[n]);
    expect(attrs).toEqual({ employment: "full", schedule: "2/2", salaryTo: 120000, contract: "tk" });
    const rows = describeAttrs("JOB", attrs);
    expect(rows.find((r) => r.label === "Оформление")?.value).toBe("Трудовой договор (ТК РФ)");
    expect(rows.find((r) => r.label === "Зарплата до")?.value).toBe(`${(120000).toLocaleString("ru-RU")} ₽`);
  });

  it("зарплата в карточке: от и до, за период", () => {
    expect(priceText("VACANCY", { salaryTo: 90000, salaryPeriod: "month" }, "70 000 ₽")).toBe(`от 70 000 ₽ до ${(90000).toLocaleString("ru-RU")} ₽ в месяц`);
    expect(priceText("SELL", {}, "5 ₽")).toBe("5 ₽");
  });
});

describe("раздел «Работа»: антифрод", () => {
  it("обычная вакансия проходит", () => {
    expect(scanClassified(vacancy()).verdict).toBe("ok");
  });

  it("большие деньги без опыта уходят на проверку", () => {
    expect(codes(vacancy({ priceKopecks: 350_000 * 100 }))).toContain("EASY_MONEY");
    expect(codes(vacancy({ priceKopecks: 30_000 * 100, attrs: { experience: "none", salaryPeriod: "shift" } }))).toContain("EASY_MONEY");
    expect(codes(vacancy({ priceKopecks: 350_000 * 100, attrs: { experience: "6+", salaryPeriod: "month" } }))).not.toContain("EASY_MONEY");
  });

  it("зарплата в разы выше похожих вакансий города", () => {
    const market = Array.from({ length: 6 }, () => ({ priceKopecks: 60_000 * 100, attrs: { salaryPeriod: "month" } }));
    const res = scanClassified(vacancy({ priceKopecks: 200_000 * 100, attrs: { experience: "1-3", salaryPeriod: "month" } }), { comparables: market });
    expect(res.findings.map((f) => f.code)).toContain("SALARY_TOO_HIGH");
    expect(res.findings.find((f) => f.code === "SALARY_TOO_HIGH")?.reason).toContain("3 раза");
    // Мало похожих вакансий: не судим.
    expect(codes(vacancy({ priceKopecks: 200_000 * 100, attrs: { experience: "1-3" } }), market.slice(0, 3))).not.toContain("SALARY_TOO_HIGH");
  });

  it("просьба прислать паспорт заранее уходит на проверку", () => {
    expect(codes(vacancy({ description: "Для анкеты пришлите фото паспорта и СНИЛС в личные сообщения." }))).toContain("PASSPORT_REQUEST");
    expect(codes(vacancy({ description: "Оформление в первый день, с собой паспорт и СНИЛС." }))).not.toContain("PASSPORT_REQUEST");
    expect(codes(vacancy({ description: "Отправьте длинное резюме на почту отдела кадров." }))).not.toContain("PASSPORT_REQUEST");
  });

  it("плата за обучение и вербовка дропов", () => {
    expect(codes(vacancy({ description: "Перед началом нужно оплатить обучение 3000 рублей." }))).toContain("JOB_FEE");
    expect(scanClassified(vacancy({ title: "Курьер, забирать наличные у пенсионеров" })).verdict).toBe("block");
  });

  it("без оформления: только предупреждение", () => {
    const res = scanClassified(vacancy({ attrs: { experience: "1-3", contract: "none" } }));
    expect(res.verdict).toBe("warn");
    expect(res.findings.map((f) => f.code)).toEqual(["JOB_NO_CONTRACT"]);
  });
});

describe("раздел «Работа»: публикация и поиск", () => {
  it("вакансия создаётся с полями и находится в разделе", async () => {
    const user = await prisma.user.create({
      data: { email: `job-test-${Date.now()}@svetlana.example`, passwordHash: "hash", name: "Работодатель", role: "BUYER" },
    });
    const city = await prisma.city.findFirst({ where: { name: "Москва" } });
    expect(city).not.toBeNull();
    const created = await createClassified(user.id, {
      vertical: "JOB",
      dealType: "VACANCY",
      title: "Кладовщик на склад, график 2/2",
      description: "Приёмка и выдача товара, оформление по ТК РФ.",
      category: "Склад",
      cityId: city!.id,
      priceKopecks: 65_000 * 100,
      attrs: { employment: "full", schedule: "2/2", contract: "tk", salaryPeriod: "month", vin: "SHOULD-BE-DROPPED" },
    });
    expect(created.status).toBe("PUBLISHED");
    const found = await searchClassifieds({ vertical: "JOB", dealType: "VACANCY" });
    const ad = found.items.find((a) => a.id === created.id);
    expect(ad).toBeDefined();
    expect(ad!.attrs).toEqual({ employment: "full", schedule: "2/2", contract: "tk", salaryPeriod: "month" });
  });
});
