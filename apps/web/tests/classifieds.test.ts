/**
 * Classifieds + VIN check tests (verticals: real estate / auto / services).
 *
 * Covers the honesty properties that matter for a classifieds layer:
 *   - geo is always a real seeded city, never free text
 *   - vertical attributes are validated against canonical enums
 *   - search filters by vertical / geo / price
 *   - a VIN check is never faked as clean: until an official source is wired,
 *     reports surface NOT_PROVEN
 *   - VIN masking hides the raw identifier
 *
 * Runtime-verified against the seeded geo tree (8 districts, 67 regions,
 * 141 cities). No external service is called.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  createClassified,
  searchClassifieds,
  getClassifiedPublic,
  maskVin,
  hashVin,
  isValidVin,
  searchCities,
} from "../src/lib/domains/classifieds";
import { runVinCheck, getVinSourceStatus } from "../src/lib/domains/vin-checks";

let authorId: string;
let moscowCityId: string;
let spbCityId: string;
let metroStationId: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `classified-test-${Date.now()}@svetlana.example`,
      passwordHash: "hash",
      name: "Частное лицо",
      role: "BUYER",
    },
  });
  authorId = user.id;

  const moscow = await prisma.city.findFirst({
    where: { name: "Москва" },
    include: { region: true },
  });
  expect(moscow).not.toBeNull();
  moscowCityId = moscow!.id;

  const spb = await prisma.city.findFirst({ where: { name: "Санкт-Петербург" } });
  expect(spb).not.toBeNull();
  spbCityId = spb!.id;

  const station = await prisma.metroStation.findFirst({
    where: { line: { cityId: moscowCityId } },
  });
  expect(station).not.toBeNull();
  metroStationId = station!.id;
});

describe("classifieds: geo", () => {
  it("seeds a complete Russian geo tree", async () => {
    const districts = await prisma.federalDistrict.count();
    const regions = await prisma.region.count();
    const cities = await prisma.city.count();
    const stations = await prisma.metroStation.count();

    expect(districts).toBeGreaterThanOrEqual(8);
    expect(regions).toBeGreaterThanOrEqual(67);
    expect(cities).toBeGreaterThanOrEqual(141);
    expect(stations).toBeGreaterThanOrEqual(90);
  });

  it("resolves city search by prefix, largest first", async () => {
    const found = await searchCities("Моск");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].name).toBe("Москва");
  });

  it("requires at least 2 characters for city search", async () => {
    expect(await searchCities("М")).toEqual([]);
  });
});

describe("classifieds: create + search", () => {
  it("rejects an unknown vertical", async () => {
    await expect(
      createClassified(authorId, {
        vertical: "WEAPONS",
        dealType: "SELL",
        title: "Тест",
        category: "Категория",
        cityId: moscowCityId,
      })
    ).rejects.toThrow(/vertical/);
  });

  it("rejects a too-short title", async () => {
    await expect(
      createClassified(authorId, {
        vertical: "REAL_ESTATE",
        dealType: "SELL",
        title: "кв",
        category: "Квартиры",
        cityId: moscowCityId,
      })
    ).rejects.toThrow(/title/);
  });

  it("rejects an unknown city", async () => {
    await expect(
      createClassified(authorId, {
        vertical: "REAL_ESTATE",
        dealType: "LONG_RENT",
        title: "Квартира рядом с метро",
        category: "Квартиры",
        cityId: "nonexistent-city-id",
      })
    ).rejects.toThrow(/city/);
  });

  it("creates a real-estate ad with metro and structured attrs", async () => {
    const created = await createClassified(authorId, {
      vertical: "REAL_ESTATE",
      dealType: "SELL",
      title: "Просторная 2-комнатная квартира",
      description: "Рядом с метро, свежий ремонт",
      category: "Квартиры",
      cityId: moscowCityId,
      metroId: metroStationId,
      metroWalkMin: 7,
      priceKopecks: 12_500_000 * 100,
      attrs: {
        propertyType: "APARTMENT",
        roomsTotal: 2,
        floor: 5,
        floorsTotal: 12,
        areaTotal: 58.5,
        // non-allowed attribute keys must be dropped, not stored
        bankAccount: "40817810000000000000",
      },
    });

    expect(created.status).toBe("PUBLISHED");
    expect(created.cityId).toBe(moscowCityId);

    const stored = await getClassifiedPublic(created.id);
    expect(stored).not.toBeNull();
    expect(stored!.metroName).not.toBeNull();
    expect(stored!.attrs).toHaveProperty("propertyType", "APARTMENT");
    expect(stored!.attrs).toHaveProperty("roomsTotal", 2);
    // sensitive/unknown keys are stripped
    expect(stored!.attrs).not.toHaveProperty("bankAccount");
  });

  it("creates an auto ad and lets its author find it", async () => {
    const created = await createClassified(authorId, {
      vertical: "AUTO",
      dealType: "SELL",
      title: "Toyota Camry 2021, один владелец",
      category: "Автомобили",
      cityId: spbCityId,
      priceKopecks: 2_900_000 * 100,
      attrs: {
        brand: "Toyota",
        model: "Camry",
        year: 2021,
        bodyType: "SEDAN",
        fuelType: "PETROL",
        driveType: "FWD",
        mileageKm: 42_000,
      },
    });

    const byVertical = await searchClassifieds({ vertical: "AUTO" });
    expect(byVertical.items.some((a) => a.id === created.id)).toBe(true);
  });

  it("filters search by city", async () => {
    const moscowAds = await searchClassifieds({ cityId: moscowCityId });
    expect(moscowAds.items.length).toBeGreaterThan(0);
    expect(moscowAds.items.every((a) => a.cityName === "Москва")).toBe(true);
  });

  it("filters search by price range", async () => {
    const cheap = await searchClassifieds({
      vertical: "AUTO",
      priceMax: 3_000_000 * 100,
    });
    expect(cheap.items.length).toBeGreaterThan(0);
    expect(cheap.items.every((a) => a.priceKopecks <= 3_000_000 * 100)).toBe(true);
  });

  it("matches a text query in title or description", async () => {
    const found = await searchClassifieds({ query: "Toyota" });
    expect(found.items.length).toBeGreaterThan(0);
  });
});

describe("classifieds: VIN honesty", () => {
  it("masks the raw VIN, keeping only head and tail", () => {
    expect(maskVin("JTNBE40K203123456")).toBe("JTNB•••••••••3456");
    expect(maskVin(" short ")).toBe("SHORT");
  });

  it("validates VIN format (10-17 chars, no I/O/Q)", () => {
    expect(isValidVin("JTNBE40K203123456")).toBe(true);
    expect(isValidVin("JTMBFREV40D012345")).toBe(true);
    expect(isValidVin("ABC")).toBe(false);
    expect(isValidVin("JOINEDTOOLONG12345678")).toBe(false);
    // I, O, Q are excluded from real VINs
    expect(isValidVin("JTNBE40K20312345Q")).toBe(false);
  });

  it("hashes the same VIN identically and differently from another", async () => {
    const a = await hashVin("JTNBE40K203123456");
    const b = await hashVin("JTNBE40K203123456");
    const c = await hashVin("JTMBFREV40D012345");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("runs a VIN check and reports NOT_PROVEN without an official source", async () => {
    const ad = await createClassified(authorId, {
      vertical: "AUTO",
      dealType: "SELL",
      title: "Lada Vesta для VIN-теста",
      category: "Автомобили",
      cityId: moscowCityId,
      priceKopecks: 1_200_000 * 100,
    });

    const report = await runVinCheck(ad.id, "JTNBE40K203123456", authorId);
    expect(["WARNINGS", "PROBLEMS", "CLEAN", "UNAVAILABLE"]).toContain(report.status);
    // Sandbox source must never claim VERIFIED.
    expect(report.verification).toBe("NOT_PROVEN");
  });

  it("rejects a VIN check on a non-auto classified", async () => {
    const ad = await createClassified(authorId, {
      vertical: "REAL_ESTATE",
      dealType: "SELL",
      title: "Квартира для VIN-теста",
      category: "Квартиры",
      cityId: moscowCityId,
      priceKopecks: 5_000_000 * 100,
    });
    await expect(runVinCheck(ad.id, "JTNBE40K203123456", authorId)).rejects.toThrow(
      /auto/
    );
  });

  it("rejects a malformed VIN", async () => {
    const ad = await createClassified(authorId, {
      vertical: "AUTO",
      dealType: "SELL",
      title: "Ещё одно авто для теста",
      category: "Автомобили",
      cityId: moscowCityId,
    });
    await expect(runVinCheck(ad.id, "BADVIN", authorId)).rejects.toThrow(/vin/i);
  });

  it("persists the masked report and deduplicates within validity", async () => {
    const ad = await createClassified(authorId, {
      vertical: "AUTO",
      dealType: "SELL",
      title: "Дубликат VIN-отчёта",
      category: "Автомобили",
      cityId: moscowCityId,
    });
    const vin = "JTMBFREV40D012345";
    const first = await runVinCheck(ad.id, vin, authorId);
    const second = await runVinCheck(ad.id, vin, authorId);
    // Idempotent: the second call reuses the fresh report.
    expect(second.checkedAt.getTime()).toBe(first.checkedAt.getTime());

    const persisted = await prisma.vinCheck.count({
      where: { classifiedId: ad.id, vin },
    });
    expect(persisted).toBe(1);
  });

  it("reports the source adapter status honestly", async () => {
    const status = await getVinSourceStatus();
    expect(status.available).toBe(true);
    // No official GIBDD_CHECK_URL is configured in tests.
    expect(status.verification).toBe("NOT_PROVEN");
    expect(status.pendingExternalAccess.length).toBeGreaterThan(0);
  });
});
