import { describe, expect, it } from "vitest";
import { parseDraftCommand } from "../src/lib/ai/draft-command";

describe("просьба создать карточку в любом месте сообщения", () => {
  it("в начале", () => {
    expect(parseDraftCommand("Светлана, создай карточку: кроссовки Nike, 7990 ₽")).toEqual({ product: "кроссовки Nike, 7990 ₽", atStart: true });
    expect(parseDraftCommand("Оформи карточку товара чайник Bosch за 2990")).toEqual({ product: "чайник Bosch за 2990", atStart: true });
  });

  it("в конце и в середине", () => {
    expect(parseDraftCommand("Вот кроссовки Nike, 42 размер, 7990 ₽, оформи карточку")).toEqual({ product: "кроссовки Nike, 42 размер, 7990 ₽", atStart: false });
    expect(parseDraftCommand("Привет! Создай карточку: термокружка 450 мл, 990 ₽")).toEqual({ product: "термокружка 450 мл, 990 ₽", atStart: false });
    expect(parseDraftCommand("Продаю чайник Bosch. Сделай из этого карточку, пожалуйста")).toEqual({ product: "Продаю чайник Bosch", atStart: false });
    expect(parseDraftCommand("Кружка белая 300 мл — составь карточку — цена 350 ₽")).toEqual({ product: "Кружка белая 300 мл, цена 350 ₽", atStart: false });
  });

  it("не путает с другими просьбами", () => {
    expect(parseDraftCommand("как добавить товар?")).toBeNull();
    expect(parseDraftCommand("сделай товар дешевле")).toBeNull();
    expect(parseDraftCommand("сделай скидку 10% на товары")).toBeNull();
    expect(parseDraftCommand("оформи товар в корзину")).toBeNull();
    expect(parseDraftCommand("покажи мои карточки")).toBeNull();
    expect(parseDraftCommand("где карточка моего заказа")).toBeNull();
  });
});
