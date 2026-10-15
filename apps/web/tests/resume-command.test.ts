import { describe, expect, it } from "vitest";
import { parseResumeCommand, resumeChatReply, resumeFormLink } from "../src/lib/ai/resume-command";

describe("резюме в чате со Светланой", () => {
  it("узнаёт просьбу и отделяет текст о себе", () => {
    expect(parseResumeCommand("Составь резюме: ищу работу водителем, опыт 7 лет")).toBe("ищу работу водителем, опыт 7 лет");
    expect(parseResumeCommand("Светлана, помоги составить резюме. Хочу работать продавцом")).toBe("Хочу работать продавцом");
    expect(parseResumeCommand("Ищу работу курьером, без опыта. Сделай мне резюме, пожалуйста")).toBe("Ищу работу курьером, без опыта");
    expect(parseResumeCommand("напиши резюме")).toBe("");
    expect(parseResumeCommand("как составить резюме?")).toBeNull();
    expect(parseResumeCommand("найди вакансии водителя")).toBeNull();
  });

  it("показывает, что разложено, и даёт ссылку на форму", () => {
    const text = "ищу работу водителем, опыт 7 лет, хочу от 80 тыс на руки, 5/2";
    const reply = resumeChatReply(
      { title: "Водитель", category: "Транспорт", description: text, salaryFrom: 80000, attrs: { experience: "6+", schedule: "5/2", salaryTax: "net", salaryPeriod: "month" } },
      text,
    );
    expect(reply).toContain("• Должность: Водитель");
    expect(reply).toContain("• Опыт: Больше 6 лет");
    expect(reply).toContain("• График: 5/2");
    expect(reply).toMatch(/80\s000 ₽/);
    expect(reply).not.toContain("Не нашла");
    expect(reply).toContain(`[Открыть форму резюме](${resumeFormLink(text)})`);
    expect(resumeFormLink(text)).toMatch(/^\/classifieds\/new\?resume=/);
    expect(resumeFormLink("опыт (7 лет) водителем")).not.toMatch(/[()]/);
  });

  it("честно говорит, чего нет в тексте", () => {
    const reply = resumeChatReply({ title: "", category: "Другое", description: "x", attrs: {} }, "x".repeat(900));
    expect(reply).toContain("Не нашла в тексте: должность, опыт, желаемую зарплату, график");
    expect(reply).toContain("«Подать объявление»");
  });
});
