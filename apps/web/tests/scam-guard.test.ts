import { describe, expect, it } from "vitest";
import { explainVerdict, extractHosts, luhnOk, scanMessage } from "../src/lib/domains/scam-guard";

const own = { ownDomains: ["aiko.ru", "savetlana-app-web.vercel.app"] };
const codes = (text: string) => scanMessage(text, own).findings.map((f) => f.code);

describe("антифрод переписки", () => {
  it("обычные сообщения проходят", () => {
    for (const text of [
      "Здравствуйте! Есть размер 42?",
      "Отправлю завтра, трек-номер пришлю в заказе",
      "Введите промокод SALE10 при оформлении",
      "Код товара 12345, цвет синий",
      "Посмотрите карточку https://aiko.ru/product/abc",
      "Доставка СДЭК 2-3 дня, т.е. к пятнице",
    ]) {
      expect(scanMessage(text, own).verdict).toBe("ok");
    }
  });

  it("«Мамонт»: ссылка на поддельную доставку или оплату блокируется", () => {
    expect(scanMessage("Оформил доставку, оплатите по ссылке avito-dostavka.ru/pay/123", own).verdict).toBe("block");
    expect(codes("Перейдите на aiko-sdelka.com чтобы получить деньги")).toContain("PHISHING_LINK");
    expect(codes("получите оплату тут: secure-oplata.site")).toContain("PAYMENT_LINK");
    expect(codes("вот ссылка bit.ly/3xYz")).toContain("SHORT_LINK");
    expect(codes("cdek-poluchenie . ru")).toContain("PHISHING_LINK");
  });

  it("подмена букв в адресе не помогает", () => {
    expect(codes("сайт аvitо-delivery.ru")).toContain("PHISHING_LINK");
  });

  it("номер карты и просьбы назвать код блокируются", () => {
    expect(luhnOk("4111111111111111")).toBe(true);
    expect(luhnOk("4111111111111112")).toBe(false);
    expect(codes("Переводите на 4111 1111 1111 1111")).toContain("CARD_NUMBER");
    expect(scanMessage("Продиктуйте код из смс, который пришёл", own).verdict).toBe("block");
    expect(scanMessage("скажите код, банк прислал подтверждение", own).verdict).toBe("block");
    expect(codes("назовите cvv")).toContain("CARD_SECRET");
  });

  it("уход в мессенджер и телефон: предупреждение", () => {
    const v = scanMessage("Давайте в ватсап, мой номер +7 916 123-45-67", own);
    expect(v.verdict).toBe("warn");
    expect(v.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["MESSENGER_LURE", "PHONE"]));
    expect(codes("пиши в w h a t s a p p")).toContain("MESSENGER_LURE");
    expect(codes("мой ник @ivan_seller")).toContain("MESSENGER_CONTACT");
    expect(codes("пишите в тг")).toContain("MESSENGER_LURE");
  });

  it("предоплата на карту по номеру телефона блокируется, просто предоплата: предупреждение", () => {
    expect(scanMessage("Нужна предоплата 50%", own).verdict).toBe("warn");
    expect(scanMessage("Предоплата по СБП на номер 89161234567", own).verdict).toBe("block");
  });

  it("«служба безопасности» и криптовалюта: предупреждение", () => {
    expect(codes("Это служба безопасности, ваш аккаунт взломан")).toContain("IMPERSONATION");
    expect(codes("оплата в USDT")).toContain("CRYPTO");
    expect(codes("кнопка button")).not.toContain("CRYPTO");
  });

  it("ссылки находятся и в «site точка ru»", () => {
    expect(extractHosts("зайди на fake-shop точка ru")).toContain("fake-shop.ru");
    expect(extractHosts("т.е. и т.д.")).toEqual([]);
  });

  it("объяснение берёт главные причины", () => {
    const v = scanMessage("bit.ly/x и код из смс", own);
    expect(explainVerdict(v)).toMatch(/ссылка|код/i);
  });
});
