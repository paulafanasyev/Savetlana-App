import { describe, expect, it } from "vitest";
import { describeRemoved, removedNote, scrubContacts } from "../src/lib/domains/contact-scrub";
import { resumeChatReply } from "../src/lib/ai/resume-command";

describe("контакты не попадают в текст резюме", () => {
  it("убирает телефон вместе с подписью", () => {
    expect(scrubContacts("Ищу работу водителем, опыт 7 лет, 5/2. Тел.: +7 (912) 345-67-89")).toEqual({
      text: "Ищу работу водителем, опыт 7 лет, 5/2.",
      removed: ["phone"],
    });
    expect(scrubContacts("Звоните: 8 (900) 123-45-67 или 8 900 765 43 21. Ищу работу поваром").text).toBe("Ищу работу поваром");
    expect(scrubContacts("Хочу работать курьером. Мой номер 912 345 67 89").text).toBe("Хочу работать курьером.");
  });

  it("убирает почту, мессенджеры, паспорт и СНИЛС", () => {
    const r = scrubContacts("ищу работу продавцом, звоните 89123456789 или пишите в телеграм @ivan_petrov, почта ivan@mail.ru");
    expect(r.text).toBe("ищу работу продавцом");
    expect(r.removed).toEqual(["phone", "email", "messenger"]);
    expect(scrubContacts("Курьер, whatsapp wa.me/79123456789").removed).toEqual(["messenger"]);
    const docs = scrubContacts("Ищу работу бухгалтером, опыт 10 лет, паспорт 45 12 345678, СНИЛС 123-456-789 01");
    expect(docs.text).toBe("Ищу работу бухгалтером, опыт 10 лет");
    expect(describeRemoved(docs.removed)).toBe("паспортные данные и СНИЛС");
  });

  it("не трогает зарплату, годы и стаж", () => {
    for (const t of ["ищу работу водителем, хочу от 80 000 до 120 000 руб, стаж 12 лет, 2/2", "Опыт с 2015 по 2023 год, зарплата 95000", "Ищу работу, номер заказа 123"]) {
      expect(scrubContacts(t)).toEqual({ text: t, removed: [] });
    }
    expect(removedNote([])).toBeNull();
  });

  it("Светлана говорит в чате, что убрала", () => {
    const reply = resumeChatReply({ title: "Водитель", category: "Транспорт", description: "x", attrs: {} }, "ищу работу водителем", ["phone"]);
    expect(reply).toContain("Убрала из текста телефон");
    expect(reply).toContain("напишут вам через сообщения на сайте");
  });
});
