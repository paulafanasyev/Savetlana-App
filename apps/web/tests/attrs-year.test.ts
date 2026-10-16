import { describe, expect, it } from "vitest";
import { describeAttrs } from "../src/lib/classified-fields";

const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("год в характеристиках", () => {
  it("год без пробела, пробег с разделителем", () => {
    const rows = describeAttrs("AUTO", { year: 2020, mileageKm: 58000 });
    expect(rows.find((r) => r.label === "Год выпуска")?.value).toBe("2020");
    expect(plain(rows.find((r) => r.label === "Пробег")?.value ?? "")).toBe("58 000 км");
  });
  it("год постройки без пробела", () => {
    const rows = describeAttrs("REAL_ESTATE", { buildingYear: 2024 });
    expect(rows[0]?.value).toBe("2024");
  });
});
