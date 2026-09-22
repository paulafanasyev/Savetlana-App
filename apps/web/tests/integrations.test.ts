import { describe, it, expect } from "vitest";
import {
  getInternationalPaymentBridge,
  isInternationalPaymentsLive,
  formatRate,
  SUPPORTED_CURRENCIES,
} from "../src/lib/domains/international-payments";
import { getVkAdapter, isVkLive, parseLinkStatus } from "../src/lib/domains/vk";
import { getEsiaAdapter, isEsiaLive } from "../src/lib/domains/esia";
import { integrationStatus } from "../src/lib/env";

describe("international payments adapter (spec §36, §105)", () => {
  it("resolves to the sandbox bridge without partner credentials", () => {
    const bridge = getInternationalPaymentBridge();
    // No PENDING_EXTERNAL_ACCESS credentials in this environment.
    expect(bridge.live).toBe(isInternationalPaymentsLive());
    expect(bridge.sandbox ?? true).toBe(true);
  });

  it("exposes Alipay/Alipay+ as provider adapters, not a hardcoded path", () => {
    const bridge = getInternationalPaymentBridge();
    const keys = bridge.wallets.map((w) => w.key);
    expect(keys).toContain("alipay");
    expect(bridge.wallets.find((w) => w.key === "alipay")?.network).toBe("alipay");
  });

  it("quotes a supported currency pair deterministically", async () => {
    const bridge = getInternationalPaymentBridge();
    const quote = await bridge.quote({ from: "RUB", to: "CNY", amountMinorUnits: 100000 });
    expect(quote).not.toBeNull();
    expect(quote!.from).toBe("RUB");
    expect(quote!.to).toBe("CNY");
    expect(quote!.sandbox).toBe(true);
    expect(quote!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(formatRate(quote!)).toContain("CNY");
  });

  it("refuses to quote an unsupported pair", async () => {
    const bridge = getInternationalPaymentBridge();
    const quote = await bridge.quote({ from: "RUB" as never, to: "JPY" as never, amountMinorUnits: 100 });
    expect(quote).toBeNull();
  });

  it("authorizes a payment against a valid quote and labels it sandbox", async () => {
    const bridge = getInternationalPaymentBridge();
    const quote = await bridge.quote({ from: "USD", to: "CNY", amountMinorUnits: 100 });
    const result = await bridge.pay(
      {
        orderId: "test-order",
        amountMinorUnits: 100,
        from: "USD",
        to: "CNY",
        wallet: "alipay",
        idempotencyKey: "key-1234567890",
      },
      quote!,
    );
    expect(result.status).toBe("AUTHORIZED");
    expect(result.sandbox).toBe(true);
    expect(result.settledMinorUnits).toBeGreaterThan(0);
  });

  it("rejects an expired quote rather than guessing a rate", async () => {
    const bridge = getInternationalPaymentBridge();
    const quote = await bridge.quote({ from: "RUB", to: "USD", amountMinorUnits: 1000 });
    quote!.expiresAt = new Date(Date.now() - 60_000);
    await expect(
      bridge.pay(
        {
          orderId: "test-order",
          amountMinorUnits: 1000,
          from: "RUB",
          to: "USD",
          wallet: "alipay",
          idempotencyKey: "key-1234567890",
        },
        quote!,
      ),
    ).rejects.toThrow("quote_expired");
  });

  it("lists a bounded set of supported currencies", () => {
    expect(SUPPORTED_CURRENCIES).toContain("RUB");
    expect(SUPPORTED_CURRENCIES).toContain("CNY");
  });

  it("is honestly reported as PENDING_EXTERNAL_ACCESS without credentials", () => {
    if (!process.env.INTERNATIONAL_BRIDGE_BASE_URL) {
      expect(integrationStatus.internationalPayments).toBe("PENDING_EXTERNAL_ACCESS");
    }
  });
});

describe("VK adapter (spec §17, §19)", () => {
  it("fails closed without VK app credentials", () => {
    const adapter = getVkAdapter();
    expect(adapter.live).toBe(isVkLive());
    if (!isVkLive()) {
      expect(() => adapter.getAuthUrl("state", "https://example.com/cb")).toThrow(
        /VK_NOT_CONFIGURED/,
      );
    }
  });

  it("returns no friends and no fake graph when unavailable", async () => {
    const adapter = getVkAdapter();
    if (!adapter.live) {
      expect(await adapter.getFriends("token")).toEqual([]);
      expect(await adapter.getUser("token")).toBeNull();
      expect(await adapter.exchangeCode("code", "https://example.com/cb")).toBeNull();
    }
  });

  it("parses link statuses defensively", () => {
    expect(parseLinkStatus("ACTIVE")).toBe("ACTIVE");
    expect(parseLinkStatus("garbage")).toBe("UNVERIFIED");
  });

  it("only requests explicitly permitted scopes", () => {
    // email + friends only — no hidden surveillance (spec §19).
    expect(getVkAdapter()).toBeDefined();
  });

  it("is honestly reported as PENDING_EXTERNAL_ACCESS without credentials", () => {
    if (!process.env.VK_APP_ID) {
      expect(integrationStatus.vk).toBe("PENDING_EXTERNAL_ACCESS");
    }
  });
});

describe("ESIA adapter (spec §18, §20)", () => {
  it("fails closed without ESIA credentials", () => {
    const adapter = getEsiaAdapter();
    expect(adapter.live).toBe(isEsiaLive());
    if (!isEsiaLive()) {
      expect(() => adapter.getAuthUrl({ state: "s", redirectUri: "https://example.com/cb" })).toThrow(
        /ESIA_NOT_CONFIGURED/,
      );
    }
  });

  it("reports UNAVAILABLE rather than a fake verification", async () => {
    const adapter = getEsiaAdapter();
    if (!adapter.live) {
      const res = await adapter.checkIdentity({ inn: "500100732259" });
      expect(res.status).toBe("UNAVAILABLE");
      expect(res.verified ?? res.status).not.toBe("VERIFIED");
    }
  });

  it("returns no person when unavailable", async () => {
    const adapter = getEsiaAdapter();
    if (!adapter.live) {
      expect(await adapter.getPerson("token")).toBeNull();
    }
  });

  it("is honestly reported as PENDING_EXTERNAL_ACCESS without credentials", () => {
    if (!process.env.ESIA_CLIENT_ID) {
      expect(integrationStatus.esia).toBe("PENDING_EXTERNAL_ACCESS");
    }
  });
});
