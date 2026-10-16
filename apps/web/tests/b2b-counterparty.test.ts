import { describe, expect, it, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";
import { checkCounterparty, counterpartyLine, fetchEgrul } from "../src/lib/domains/counterparty-check";

const W = process.env.VITEST_WORKER_ID ?? "0";

function dadata(status: string) {
  let calls = 0;
  const impl = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ suggestions: [{ value: "ПАО Тест", data: { state: { status, registration_date: 1000000000000 }, name: { short_with_opf: "ПАО Тест" } } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls: () => calls };
}

describe("Проверка контрагента в КП", () => {
  let activeId = "";
  let liquidatedId = "";
  let noInnId = "";

  beforeAll(async () => {
    const pass = await hashPassword("password123");
    const mk = async (tag: string, data: Partial<{ isActivated: boolean; identityStatus: string; businessStatus: string; sellerType: string; inn: string; ogrn: string }>) => {
      const u = await prisma.user.create({ data: { email: `cp-${tag}@${W}.test`, name: tag, role: "SELLER", passwordHash: pass } });
      return (await prisma.sellerProfile.create({ data: { userId: u.id, slug: `cp-${tag}-${W}`, displayName: `Продавец ${tag}`, ...data } })).id;
    };
    const verified = { isActivated: true, identityStatus: "VERIFIED", businessStatus: "VERIFIED", sellerType: "COMPANY", inn: "7707083893", ogrn: "1027700132195" };
    activeId = await mk("active", verified);
    liquidatedId = await mk("liq", verified);
    noInnId = await mk("noinn", { isActivated: true });
  });

  it("без ключа DaData в ЕГРЮЛ не ходим и честно пишем «не проверено»", async () => {
    expect(await fetchEgrul("7707083893", { apiKey: "" })).toBeNull();
    const r = (await checkCounterparty(activeId))!;
    expect(r.checks.find((c) => c.id === "requisites")!.status).toBe("OK");
    expect(r.checks.find((c) => c.id === "moderation")!.status).toBe("OK");
    expect(r.checks.find((c) => c.id === "egrul")!.status).toBe("UNKNOWN");
    const rnp = r.checks.find((c) => c.id === "rnp")!;
    expect(rnp.status).toBe("UNKNOWN");
    expect(rnp.url).toContain("7707083893");
    expect(r.verdict).toBe("RECOMMENDED");
    expect(counterpartyLine(r)).toContain("не проверено");
  });

  it("ЕГРЮЛ: действующая компания ✓, ответ кешируется на сутки", async () => {
    const d = dadata("ACTIVE");
    const r = (await checkCounterparty(activeId, { fetchImpl: d.impl, apiKey: "test-key" }))!;
    const egrul = r.checks.find((c) => c.id === "egrul")!;
    expect(egrul.status).toBe("OK");
    expect(egrul.detail).toContain("ПАО Тест");
    expect(r.verdict).toBe("RECOMMENDED");
    await checkCounterparty(activeId, { fetchImpl: d.impl, apiKey: "test-key" });
    expect(d.calls()).toBe(1);
    const rec = await prisma.verificationRecord.findFirst({ where: { sellerId: activeId, kind: "egrul" } });
    expect(rec?.status).toBe("VERIFIED");
  });

  it("ЕГРЮЛ: ликвидирована → сделку не рекомендуем", async () => {
    const r = (await checkCounterparty(liquidatedId, { fetchImpl: dadata("LIQUIDATED").impl, apiKey: "test-key" }))!;
    expect(r.checks.find((c) => c.id === "egrul")!.status).toBe("FAIL");
    expect(r.verdict).toBe("NOT_RECOMMENDED");
  });

  it("продавец без ИНН и без проверки площадкой → осторожно", async () => {
    const r = (await checkCounterparty(noInnId))!;
    expect(r.checks.find((c) => c.id === "requisites")!.status).toBe("UNKNOWN");
    expect(r.checks.some((c) => c.id === "egrul" || c.id === "rnp")).toBe(false);
    expect(r.verdict).toBe("CAUTION");
  });

  it("несуществующий продавец → null", async () => {
    expect(await checkCounterparty("no-such-seller")).toBeNull();
  });
});
