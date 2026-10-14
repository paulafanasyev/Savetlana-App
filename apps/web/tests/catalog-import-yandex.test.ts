import { describe, expect, it } from "vitest";
import { bestSheet, detectSource, fieldOfHeader, parseCatalogFile, rowsToItems } from "../src/lib/catalog-import-parse";

/** Минимальная книга Excel (zip без сжатия) с листами в заданном порядке. */
function makeXlsx(sheets: { name: string; rows: string[][]; hidden?: boolean }[]): ArrayBuffer {
  const enc = new TextEncoder();
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const col = (i: number) => String.fromCharCode(65 + i);
  const files: [string, string][] = [
    [
      "xl/workbook.xml",
      `<workbook xmlns:r="r"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="ws" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
    ],
    ...sheets.map((s, i): [string, string] => [
      `xl/worksheets/sheet${i + 1}.xml`,
      `<worksheet><sheetData>${s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`,
    ]),
  ];
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of all) { out.set(part, p); p += part.length; }
  return out.buffer;
}

const YANDEX_ROWS = [
  ["Ассортимент магазина на Маркете"],
  ["Ваш SKU *", "SKU на Маркете", "Название товара *", "Ссылка на изображение *", "Описание товара *", "Бренд *", "Штрихкод *", "Цена *", "Цена до скидки", "Доступное количество товара"],
  ["Обязательное поле", "", "Обязательное поле", "", "", "", "", "Введите цену", "", ""],
  ["KR-001", "101234567", "Кружка керамическая 350 мл", "https://img.example/1.jpg, https://img.example/2.jpg", "Белая кружка", "Домик", "4607001234567", "590", "790", "12"],
  ["KR-002", "101234568", "Тарелка 24 см", "https://img.example/3.jpg", "", "Домик", "", "1 200,50", "", "0"],
];

describe("перенос с Яндекс Маркета", () => {
  it("«Ваш SKU» это артикул, а «SKU на Маркете» пропускаем", () => {
    expect(fieldOfHeader("Ваш SKU *")).toBe("article");
    expect(fieldOfHeader("SKU на Маркете")).toBeNull();
    expect(fieldOfHeader("Доступное количество товара")).toBe("quantity");
    expect(fieldOfHeader("Ссылка на изображение *")).toBe("images");
  });

  it("разбирает таблицу ассортимента Маркета", () => {
    const res = rowsToItems(YANDEX_ROWS);
    expect(res.source).toBe("Яндекс Маркет");
    expect(res.problems).toHaveLength(0);
    expect(res.items).toHaveLength(2);
    expect(res.items[0]).toMatchObject({ article: "KR-001", title: "Кружка керамическая 350 мл", priceRub: 590, oldPriceRub: 790, quantity: 12, brand: "Домик", barcode: "4607001234567" });
    expect(res.items[0].images).toEqual(["https://img.example/1.jpg", "https://img.example/2.jpg"]);
    expect(res.items[1]).toMatchObject({ article: "KR-002", priceRub: 1200.5, quantity: 0 });
  });

  it("узнаёт Ozon и Wildberries по заголовкам", () => {
    expect(detectSource(["Артикул", "Ozon ID", "Название товара", "Цена"])).toBe("Ozon");
    expect(detectSource(["Артикул WB", "Артикул продавца", "Название", "Цена"])).toBe("Wildberries");
    expect(detectSource(["Наименование", "Цена"])).toBeUndefined();
  });

  it("в книге Excel берёт лист с товарами, а не инструкцию и не скрытый лист", async () => {
    const buffer = makeXlsx([
      { name: "Инструкция", rows: [["Как заполнить шаблон"], ["Цена указывается в рублях"]] },
      { name: "Списки", hidden: true, rows: [["Название", "Цена"], ["Скрытый", "1"]] },
      { name: "Товары", rows: YANDEX_ROWS },
    ]);
    const res = await parseCatalogFile("assortment.xlsx", buffer);
    expect(res.sheet).toBe("Товары");
    expect(res.items).toHaveLength(2);
    expect(res.items[0].article).toBe("KR-001");
    expect(res.items.some((i) => i.title === "Скрытый")).toBe(false);
  });

  it("из нескольких листов с товарами берёт тот, где их больше", () => {
    const res = bestSheet([
      { name: "Старые", rows: [["Название", "Цена"], ["А", "10"]] },
      { name: "Все", rows: [["Название", "Цена"], ["А", "10"], ["Б", "20"]] },
    ]);
    expect(res.sheet).toBe("Все");
    expect(res.items).toHaveLength(2);
  });

  it("одна страница без названия листа не подписывается", () => {
    const res = bestSheet([{ name: "Лист1", rows: [["Название", "Цена"], ["А", "10"]] }]);
    expect(res.sheet).toBeUndefined();
  });
});
