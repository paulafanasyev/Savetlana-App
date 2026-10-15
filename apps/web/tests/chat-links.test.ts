import { describe, expect, it } from "vitest";
import { splitChatLinks, stripChatLinks } from "../src/lib/chat-links";

describe("ссылки в ответах Светланы", () => {
  it("делает ссылками только страницы сайта", () => {
    expect(splitChatLinks("Готово: [Открыть форму](/classifieds/new?resume=%D0%B0). Удачи")).toEqual([
      { text: "Готово: " },
      { text: "Открыть форму", href: "/classifieds/new?resume=%D0%B0" },
      { text: ". Удачи" },
    ]);
    expect(splitChatLinks("[чужой сайт](https://evil.example)")).toEqual([{ text: "[чужой сайт](https://evil.example)" }]);
    expect(splitChatLinks("[тоже чужой](//evil.example)")).toEqual([{ text: "[тоже чужой](//evil.example)" }]);
    expect(splitChatLinks("просто текст")).toEqual([{ text: "просто текст" }]);
  });

  it("для озвучки оставляет только подпись", () => {
    expect(stripChatLinks("Чтобы опубликовать: [Открыть форму резюме](/classifieds/new?resume=abc).")).toBe("Чтобы опубликовать: Открыть форму резюме.");
  });
});
