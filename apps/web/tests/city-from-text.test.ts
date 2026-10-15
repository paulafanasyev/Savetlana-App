import { describe, expect, it } from "vitest";
import { cityFromText } from "../src/lib/city-from-text";

const CITIES = [
  { id: "msk", name: "Москва" },
  { id: "spb", name: "Санкт-Петербург" },
  { id: "kzn", name: "Казань" },
  { id: "nn", name: "Нижний Новгород" },
  { id: "ekb", name: "Екатеринбург" },
  { id: "tula", name: "Тула" },
  { id: "rnd", name: "Ростов-на-Дону" },
  { id: "mir", name: "Мирный" },
  { id: "ufa", name: "Уфа" },
];

const id = (text: string) => cityFromText(text, CITIES)?.id;

describe("город из текста объявления", () => {
  it("находит город в разных падежах", () => {
    expect(id("Ищу работу водителем в Казани, опыт 7 лет")).toBe("kzn");
    expect(id("Живу в Нижнем Новгороде, ищу подработку")).toBe("nn");
    expect(id("Я из Екатеринбурга")).toBe("ekb");
    expect(id("г. Тула, опыт 3 года")).toBe("tula");
    expect(id("Город: Москва")).toBe("msk");
    expect(id("Работаю в Ростове-на-Дону")).toBe("rnd");
    expect(id("ищу работу в Уфе")).toBe("ufa");
    expect(id("Ищу курьера в Санкт-Петербурге")).toBe("spb");
  });

  it("понимает короткие названия", () => {
    expect(id("ищу работу в спб")).toBe("spb");
    expect(id("Живу в Питере")).toBe("spb");
    expect(id("курьер, мск, от 80к")).toBeUndefined();
    expect(id("курьер в мск, от 80к")).toBe("msk");
  });

  it("не путает с обычными словами и переездом", () => {
    expect(id("Работаю мирно и спокойно")).toBeUndefined();
    expect(id("Ищу работу продавцом, опыт 2 года")).toBeUndefined();
    expect(id("Готов к переезду в Москву")).toBeUndefined();
    expect(id("Живу в Туле, готов к переезду в Москву")).toBe("tula");
    expect(id("Работал вахтой в Мирном, живу в Казани")).toBe("kzn");
  });

  it("берёт первое упоминание", () => {
    expect(id("Живу в Казани, раньше работал в Москве")).toBe("kzn");
  });
});
