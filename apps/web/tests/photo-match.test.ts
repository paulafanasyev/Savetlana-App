import { describe, expect, it } from "vitest";
import { bestDraft, matchScore, planPhotoUpload, translit, words } from "../src/lib/domains/photo-match";

const drafts = [
  { id: "a", title: "Кроссовки Nike Air Max 90, белые", sku: "AI-krossovki-nike-x1y2z3", photos: 0 },
  { id: "b", title: "Чайник электрический Bosch 1,7 л", sku: "KETTLE-001", photos: 6 },
  { id: "c", title: "Кроссовки Adidas Samba", sku: "AI-krossovki-adidas-q9", photos: 0 },
];

describe("фото к черновикам пачкой", () => {
  it("берёт из имени файла только слова", () => {
    expect(words("IMG_2034 кроссовки (2).JPG")).toEqual(["кроссовки"]);
    expect(translit("Чайник")).toBe("chaynik");
  });

  it("узнаёт карточку по названию на русском и латиницей", () => {
    expect(bestDraft("Кроссовки Nike 1.jpg", drafts)).toBe("a");
    expect(bestDraft("krossovki_nike_2.jpeg", drafts)).toBe("a");
    expect(bestDraft("chaynik-bosch.png", drafts)).toBe("b");
    expect(bestDraft("samba.webp", drafts)).toBe("c");
  });

  it("по коду товара в имени файла", () => {
    expect(matchScore("KETTLE-001_front.jpg", drafts[1])).toBe(100);
    expect(bestDraft("kettle-001.jpg", drafts)).toBe("b");
  });

  it("не гадает, когда подходят две карточки или ни одной", () => {
    expect(bestDraft("кроссовки.jpg", drafts)).toBeNull();
    expect(bestDraft("IMG_1234.jpg", drafts)).toBeNull();
  });

  it("раскладывает по порядку и не больше 8 фото на карточку", () => {
    const { groups, overflow } = planPhotoUpload(
      { "nike_10.jpg": "a", "nike_2.jpg": "a", "b1.jpg": "b", "b2.jpg": "b", "b3.jpg": "b", "x.jpg": null, "y.jpg": "zzz" },
      drafts,
    );
    expect(groups).toEqual([
      { productId: "a", files: ["nike_2.jpg", "nike_10.jpg"] },
      { productId: "b", files: ["b1.jpg", "b2.jpg"] },
    ]);
    expect(overflow).toEqual(["b3.jpg"]);
  });
});
