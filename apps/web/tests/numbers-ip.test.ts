import { describe, expect, it } from "vitest";
import { numberWordsToDigits } from "../src/lib/ai/number-words";
import { pickClientIp } from "../src/lib/client-ip";

describe("числа словами", () => {
  it("переводит цены в цифры", () => {
    expect(numberWordsToDigits("наушники до пяти тысяч")).toBe("наушники до 5000");
    expect(numberWordsToDigits("чайник за триста рублей")).toBe("чайник за 300 рублей");
    expect(numberWordsToDigits("бюджет сто двадцать тысяч")).toBe("бюджет 120000");
    expect(numberWordsToDigits("полторы тысячи")).toBe("1500");
    expect(numberWordsToDigits("до двух с половиной тысяч")).toBe("до 2500");
    expect(numberWordsToDigits("три тысячи пятьсот")).toBe("3500");
    expect(numberWordsToDigits("подарок маме до тысячи")).toBe("подарок маме до 1000");
  });

  it("не трогает обычные слова и порядковые числа", () => {
    expect(numberWordsToDigits("сравни эти два")).toBe("сравни эти два");
    expect(numberWordsToDigits("один из них")).toBe("один из них");
    expect(numberWordsToDigits("кроссовки сорок второго размера")).toBe("кроссовки сорок второго размера");
    expect(numberWordsToDigits("до 3000")).toBe("до 3000");
  });
});

describe("адрес посетителя", () => {
  it("не верит адресу, который прислал сам браузер", () => {
    expect(pickClientIp("6.6.6.6, 10.0.0.5", null, 1)).toBe("10.0.0.5");
    expect(pickClientIp("1.2.3.4", null, 1)).toBe("1.2.3.4");
    expect(pickClientIp("6.6.6.6, 5.5.5.5, 10.0.0.5", null, 2)).toBe("5.5.5.5");
    expect(pickClientIp(null, "9.9.9.9", 1)).toBe("9.9.9.9");
    expect(pickClientIp(null, null, 1)).toBe("unknown");
  });
});
