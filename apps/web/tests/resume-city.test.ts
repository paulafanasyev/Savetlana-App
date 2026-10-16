import { describe, expect, it } from "vitest";
import { resumeChatReply } from "../src/lib/ai/resume-command";

const draft = { title: "Водитель", category: "Транспорт", description: "Ищу работу водителем в Казани", attrs: {} };

describe("город в ответе Светланы про резюме", () => {
  it("называет город и не просит выбрать его", () => {
    const reply = resumeChatReply(draft, draft.description, [], "Казань");
    expect(reply).toContain("• Город: Казань");
    expect(reply).toContain("город «Казань» форма выберет сама");
    expect(reply.includes("выберите город")).toBe(false);
  });

  it("без города просит выбрать его, как раньше", () => {
    const reply = resumeChatReply(draft, draft.description);
    expect(reply.includes("• Город:")).toBe(false);
    expect(reply).toContain("проверьте поля, выберите город и опубликуйте");
  });
});
