import { describe, expect, it } from "vitest";
import { buildYml, cdata, xmlEscape, ymlCategoryId, type YmlProduct } from "../src/lib/yml-feed";

const categories = [
  { id: "cat-root", name: "Дом & сад", parentId: null },
  { id: "cat-kitchen", name: "Кухня", parentId: "cat-root" },
  { id: "cat-unused", name: "Авто", parentId: null },
];

function product(over: Partial<YmlProduct> = {}): YmlProduct {
  return {
    id: "p1",
    title: "Чайник \"Ретро\" <1,7 л>",
    description: "Стеклянный. Текст с ]]> внутри.",
    sku: "SKU-1",
    priceKopecks: 199_000,
    oldPriceKopecks: 249_900,
    categoryId: "cat-kitchen",
    attributes: JSON.stringify({ "Бренд": "Polaris", "Артикул продавца": "KT-100" }),
    images: [{ url: "https://cdn.example.ru/1.jpg" }],
    inventory: { quantity: 4, availability: "AVAILABLE" },
    ...over,
  };
}

describe("выгрузка YML для Яндекса", () => {
  it("товар с ценой, старой ценой, брендом и артикулом продавца", () => {
    const { xml, offers } = buildYml({ categories, products: [product()], now: new Date("2026-10-14T11:00:00Z") });
    expect(offers).toBe(1);
    expect(xml).toContain('<yml_catalog date="2026-10-14T14:00+03:00">');
    expect(xml).toContain('<offer id="p1" available="true">');
    expect(xml).toContain("<price>1990</price><oldprice>2499</oldprice><currencyId>RUR</currencyId>");
    expect(xml).toContain("<name>Чайник &quot;Ретро&quot; &lt;1,7 л&gt;</name>");
    expect(xml).toContain("<vendor>Polaris</vendor><vendorCode>KT-100</vendorCode>");
    expect(xml).toContain("<count>4</count>");
  });

  it("только нужные категории, с родителем и стабильными номерами", () => {
    const { xml } = buildYml({ categories, products: [product()] });
    expect(xml).toContain(`<category id="${ymlCategoryId("cat-root")}">Дом &amp; сад</category>`);
    expect(xml).toContain(`<category id="${ymlCategoryId("cat-kitchen")}" parentId="${ymlCategoryId("cat-root")}">Кухня</category>`);
    expect(xml).not.toContain("Авто");
    expect(ymlCategoryId("cat-root")).toMatch(/^\d{1,15}$/);
    expect(ymlCategoryId("cat-root")).toBe(ymlCategoryId("cat-root"));
  });

  it("без остатка: available=false; без фото, цены или категории: не выгружается", () => {
    const res = buildYml({
      categories,
      products: [
        product({ id: "out", inventory: { quantity: 0, availability: "OUT_OF_STOCK" } }),
        product({ id: "nophoto", images: [{ url: "/local.jpg".replace("/", "") }] }),
        product({ id: "free", priceKopecks: 0 }),
        product({ id: "nocat", categoryId: null }),
      ],
    });
    expect(res.offers).toBe(1);
    expect(res.skipped).toBe(3);
    expect(res.xml).toContain('<offer id="out" available="false">');
  });

  it("экранирование не даёт сломать XML", () => {
    expect(xmlEscape("a&b<c>\x01")).toBe("a&amp;b&lt;c&gt;");
    expect(cdata("x]]>y")).toBe("<![CDATA[x]]]]><![CDATA[>y]]>");
  });
});
