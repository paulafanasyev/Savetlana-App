import { describe, expect, it } from "vitest";
import { cleanDigits, innHint, ogrnHint } from "../src/lib/requisites-hint";

describe("подсказки к ИНН и ОГРН", () => {
  it("верный ИНН подсказки не даёт", () => {
    expect(innHint("770000000082", "SELF_EMPLOYED")).toBeNull();
    expect(innHint("7700 0000 0082", "IP")).toBeNull();
    expect(innHint("7700000009", "COMPANY")).toBeNull();
  });

  it("длина зависит от типа продавца", () => {
    expect(innHint("7700000009", "SELF_EMPLOYED")).toContain("12 цифр");
    expect(innHint("770000000082", "COMPANY")).toContain("10 цифр");
  });

  it("опечатку видно по контрольной сумме", () => {
    expect(innHint("770000000083", "SELF_EMPLOYED")).toContain("опечатка");
    expect(innHint("77000a000082", "SELF_EMPLOYED")).toBe("В ИНН только цифры");
    expect(innHint("", "IP")).toBe("Укажите ИНН");
  });

  it("ОГРН и ОГРНИП", () => {
    expect(ogrnHint("", "SELF_EMPLOYED")).toBeNull();
    expect(ogrnHint("1027700000008", "COMPANY")).toBeNull();
    expect(ogrnHint("304770000000008", "IP")).toBeNull();
    expect(ogrnHint("1027700000008", "IP")).toContain("15 цифр");
    expect(ogrnHint("1027700000009", "COMPANY")).toContain("опечатка");
  });

  it("чистит пробелы и дефисы", () => {
    expect(cleanDigits(" 77-00 00\u00a000 0082 ")).toBe("770000000082");
  });
});
