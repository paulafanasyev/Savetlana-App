import { describe, expect, it } from "vitest";
import { isValidEnum } from "../src/lib/db/enums";

/**
 * Статусы, которые программа реально пишет в базу, должны быть в справочнике:
 * иначе переход на строгие списки статусов в PostgreSQL сломает запись.
 */
describe("справочник совпадает с тем, что пишет код", () => {
  it("все статусы объявлений из кода", () => {
    for (const s of ["DRAFT", "MODERATION", "PUBLISHED", "REJECTED", "HIDDEN", "SOLD", "CLOSED"]) {
      expect(isValidEnum("ClassifiedStatus", s)).toBe(true);
    }
    expect(isValidEnum("ClassifiedStatus", "что-то")).toBe(false);
  });
  it("каналы доставки, включая Telegram", () => {
    for (const c of ["email", "push", "telegram"]) {
      expect(isValidEnum("DeliveryChannel", c)).toBe(true);
    }
  });
});
