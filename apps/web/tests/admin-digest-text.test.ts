import { describe, expect, it } from "vitest";
import { digestText } from "../src/lib/admin-digest-text";

const zero = { newUsers: 0, newSellers: 0, applications: 0, queue: 0, newProducts: 0, orders: 0, jobFailures: [] as string[] };

describe("сводка администратору", () => {
  it("ничего не произошло: не шлём", () => {
    expect(digestText(zero)).toBeNull();
  });

  it("считает с правильными окончаниями", () => {
    const d = digestText({ ...zero, newUsers: 3, newSellers: 1, applications: 2, newProducts: 5, orders: 1 })!;
    expect(d.title).toBe("Сводка АИКО за сутки");
    expect(d.body).toContain("3 человека");
    expect(d.body).toContain("1 новый продавец");
    expect(d.body).toContain("2 заявки");
    expect(d.body).toContain("5 новых товаров");
    expect(d.body).toContain("1 заказ");
  });

  it("очередь и ошибки задач выносит в заголовок", () => {
    expect(digestText({ ...zero, queue: 4 })!.title).toContain("ждут проверки 4");
    const failed = digestText({ ...zero, jobFailures: ["tracking_sync"] })!;
    expect(failed.title).toContain("ошибки");
    expect(failed.body).toContain("tracking_sync");
  });
});
