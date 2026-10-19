import { describe, expect, it } from "vitest";
import { DELIVERY_OPTIONS, deliveryHint, pickupElsewhere } from "../src/lib/delivery-options";

const pickup = DELIVERY_OPTIONS.find((o) => o.method === "PICKUP")!;
const courier = DELIVERY_OPTIONS.find((o) => o.method === "SELLER")!;

describe("доставка и город отгрузки", () => {
  it("самовывоз называет город продавца", () => {
    expect(deliveryHint(pickup, "Казань")).toContain("г. Казань");
    expect(deliveryHint(pickup, null)).toBe(pickup.hint);
    expect(deliveryHint(courier, "Казань")).toBe(courier.hint);
  });
  it("предупреждает про самовывоз в другом городе", () => {
    expect(pickupElsewhere("PICKUP", "Казань", "Москва")).toBe(true);
    expect(pickupElsewhere("PICKUP", "Королёв", "королев")).toBe(false);
    expect(pickupElsewhere("SELLER", "Казань", "Москва")).toBe(false);
    expect(pickupElsewhere("PICKUP", null, "Москва")).toBe(false);
    expect(pickupElsewhere("PICKUP", "Казань", null)).toBe(false);
  });
});
