import { describe, expect, it } from "vitest";
import { isPerformer, performerFacts, sinceText } from "../src/lib/performer-profile";
import { SERVICE_ADDRESS_PREFIX, serviceAddress } from "../src/lib/service-deal";

const empty = { completed: 0, inWork: 0, disputed: 0, bids: 0 };

describe("профиль исполнителя", () => {
  it("честно говорит, когда сделок ещё нет", () => {
    const facts = performerFacts({ stats: empty, since: new Date(2026, 9, 1) });
    expect(facts[0]).toBe("Завершённых сделок на площадке пока нет");
    expect(facts).toContain("На площадке с октября 2026");
  });

  it("показывает сделки, споры и проверки", () => {
    const facts = performerFacts({ stats: { completed: 3, inWork: 1, disputed: 1, bids: 7 }, npdStatus: "VERIFIED", identityStatus: "UNVERIFIED", since: new Date(2026, 0, 5) });
    expect(facts).toContain("Завершённых сделок через безопасную сделку: 3");
    expect(facts).toContain("Открытых споров: 1");
    expect(facts).toContain("Самозанятый: статус проверен в ФНС");
    expect(facts).not.toContain("Личность подтверждена");
    expect(sinceText(new Date(2026, 0, 5))).toBe("На площадке с января 2026");
  });

  it("оценка только из отзывов заказчиков", () => {
    const facts = performerFacts({ stats: { ...empty, completed: 2 }, since: new Date(2026, 9, 1), ratings: [5, 4] });
    expect(facts[1]).toBe("Оценка 4,5 из 5 · 2 отзыва");
    expect(performerFacts({ stats: empty, since: new Date(2026, 9, 1) }).some((f) => f.startsWith("Оценка"))).toBe(false);
  });

  it("профиль есть только у тех, кто работает исполнителем", () => {
    expect(isPerformer(empty, 0)).toBe(false);
    expect(isPerformer({ ...empty, bids: 1 }, 0)).toBe(true);
    expect(isPerformer(empty, 2)).toBe(true);
  });

  it("заказы услуг находятся по началу поля адреса", () => {
    expect(serviceAddress({ classifiedId: "a", performerId: "u", days: 1, title: "x" }).startsWith(SERVICE_ADDRESS_PREFIX)).toBe(true);
    expect(JSON.stringify({ city: "Москва" }).startsWith(SERVICE_ADDRESS_PREFIX)).toBe(false);
  });
});
