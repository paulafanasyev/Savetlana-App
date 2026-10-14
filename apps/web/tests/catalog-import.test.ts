import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { parseCsv, parseYml, rowsToItems, fieldOfHeader, parseMoney } from "../src/lib/catalog-import-parse";
import { importCatalogItems, importSku, sanitizeItem } from "../src/lib/domains/catalog-import";

describe("перенос товаров: разбор файлов", () => {
  it("узнаёт колонки Ozon, WB и 1С", () => {
    expect(fieldOfHeader("Цена, руб.*")).toBe("price");
    expect(fieldOfHeader("Цена до скидки (перечеркнутая цена), руб.")).toBe("oldPrice");
    expect(fieldOfHeader("Наименование")).toBe("title");
    expect(fieldOfHeader("Название")).toBe("title");
    expect(fieldOfHeader("Медиафайлы")).toBe("images");
    expect(fieldOfHeader("Штрихкод")).toBe("barcode");
    expect(fieldOfHeader("Себестоимость")).toBeNull();
  });

  it("читает деньги в русском формате", () => {
    expect(parseMoney("1 990,00 ₽")).toBe(1990);
    expect(parseMoney("45,5")).toBe(45.5);
    expect(parseMoney("Введите цену")).toBeUndefined();
  });

  it("находит заголовок ниже пояснений и пропускает строку-подсказку", () => {
    const rows = [
      ["Шаблон. Заполните поля"],
      ["Артикул WB", "Артикул продавца", "Название товара", "Цена, руб.", "Остаток"],
      ["Обязательное", "", "Введите название", "Введите цену", ""],
      ["111", "S-1", "Чайник", "1 500", "3"],
      ["222", "S-2", "Без цены", "", ""],
    ];
    const res = rowsToItems(rows);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ article: "S-1", title: "Чайник", priceRub: 1500, quantity: 3 });
    expect(res.problems).toHaveLength(1);
  });

  it("CSV с точкой с запятой, кавычками и переносом строки", () => {
    const rows = parseCsv('Наименование;Цена;Описание\r\n"Мыло ""Детское""";45,50;"Строка1\nСтрока2"\r\n');
    const res = rowsToItems(rows);
    expect(res.items[0]).toMatchObject({ title: 'Мыло "Детское"', priceRub: 45.5, description: "Строка1\nСтрока2" });
  });

  it("YML: название из typePrefix/vendor/model, CDATA, фото, нет в наличии", () => {
    const res = parseYml(`<offers>
      <offer id="1" available="false"><name>Лампа &amp; абажур</name><price>1500</price><picture>https://x.ru/a.jpg</picture><description><![CDATA[<p>Яркая</p>]]></description></offer>
      <offer id="2"><typePrefix>Ноутбук</typePrefix><vendor>Lenovo</vendor><model>IdeaPad 3</model><price>45000</price><vendorCode>LN-3</vendorCode><count>2</count></offer>
    </offers>`);
    expect(res.items).toHaveLength(2);
    expect(res.items[0]).toMatchObject({ title: "Лампа & абажур", quantity: 0, description: "Яркая", images: ["https://x.ru/a.jpg"] });
    expect(res.items[1]).toMatchObject({ title: "Ноутбук Lenovo IdeaPad 3", article: "LN-3", quantity: 2, brand: "Lenovo" });
  });
});

describe("перенос товаров: проверка на сервере", () => {
  it("не принимает мусор и чужие ссылки на фото", () => {
    expect("error" in sanitizeItem({ title: "ab", priceRub: 10 })).toBe(true);
    expect("error" in sanitizeItem({ title: "Чайник", priceRub: -1 })).toBe(true);
    const ok = sanitizeItem({ title: "Чайник", priceRub: 1990, images: ["https://a.ru/1.jpg", "javascript:alert(1)", "http://a.ru/2.jpg"] });
    expect("item" in ok && ok.item.images).toEqual(["https://a.ru/1.jpg"]);
  });

  it("один и тот же артикул продавца даёт один и тот же код товара", () => {
    const a = importSku("seller-1", { article: "KT-100", title: "Чайник" });
    expect(importSku("seller-1", { article: "KT-100", title: "Другое" })).toBe(a);
    expect(importSku("seller-2", { article: "KT-100", title: "Чайник" })).not.toBe(a);
  });
});

describe("перенос товаров: повторная загрузка", () => {
  it("обновляет цену и остаток, а не создаёт дубль", async () => {
    const tag = `imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const user = await prisma.user.create({ data: { email: `${tag}@test.ru`, passwordHash: "x", role: "SELLER" } });
    const seller = await prisma.sellerProfile.create({ data: { userId: user.id, slug: tag, displayName: "Тест импорта" } });
    const base = { article: "A-1", title: "Чайник для импорта", description: "", images: [] as string[] };
    const run = (priceRub: number, quantity: number, dryRun: boolean) =>
      importCatalogItems({ sellerId: seller.id, actorId: user.id, items: [{ ...base, priceRub, quantity }], dryRun, verified: false });

    expect((await run(1000, 5, false)).created).toBe(1);

    const preview = await run(1200, 7, true);
    expect(preview).toMatchObject({ wouldCreate: 0, wouldUpdate: 1 });
    expect(preview.updates[0]).toMatchObject({ priceFromRub: 1000, priceToRub: 1200, stockFrom: 5, stockTo: 7 });

    expect((await run(1200, 7, false)).updated).toBe(1);
    const products = await prisma.product.findMany({ where: { sellerId: seller.id }, include: { inventory: true } });
    expect(products).toHaveLength(1);
    expect(products[0].priceKopecks).toBe(120_000);
    expect(products[0].inventory?.quantity).toBe(7);

    expect(await run(1200, 7, true)).toMatchObject({ wouldCreate: 0, wouldUpdate: 0, unchanged: 1 });
  });
});
