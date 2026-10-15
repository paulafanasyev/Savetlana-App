import { describe, expect, it } from "vitest";
import { fetchOfferPage, listBusinesses, mapOffer, MARKET_API, MarketError, validApiKey } from "../src/lib/domains/yandex-market";

const KEY = "ACMA:secret-key-1234567890";

function fakeFetch(handler: (url: string, init: RequestInit) => { status?: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("перенос с Маркета по ключу", () => {
  it("ключ: без пробелов и разумной длины", () => {
    expect(validApiKey(` ${KEY} `)).toBe(KEY);
    expect(validApiKey("short")).toBeNull();
    expect(validApiKey("has space inside key")).toBeNull();
    expect(validApiKey(42)).toBeNull();
  });

  it("товар Маркета превращается в строку переноса", () => {
    const res = mapOffer({
      offerId: "KR-1",
      name: "Кружка 350 мл",
      description: "Белая",
      pictures: ["https://avatars.mds.yandex.net/a.jpg", "http://bad.ru/b.jpg"],
      vendor: "Домик",
      barcodes: ["4607001234567"],
      basicPrice: { value: 590, currencyId: "RUR", discountBase: 790 },
    });
    expect("item" in res && res.item).toMatchObject({ article: "KR-1", title: "Кружка 350 мл", priceRub: 590, oldPriceRub: 790, brand: "Домик", barcode: "4607001234567", images: ["https://avatars.mds.yandex.net/a.jpg"] });
  });

  it("архивные пропускаем, без цены и не в рублях отмечаем", () => {
    expect(mapOffer({ name: "Старое", archived: true, basicPrice: { value: 1 } })).toEqual({ skip: true });
    expect("problem" in mapOffer({ name: "Без цены" })).toBe(true);
    expect("problem" in mapOffer({ name: "В долларах", basicPrice: { value: 10, currencyId: "USD" } })).toBe(true);
  });

  it("кабинеты продавца без повторов, ключ уходит только на Маркет в заголовке", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: { campaigns: [{ business: { id: 7, name: "Мой бизнес" } }, { business: { id: 7, name: "Мой бизнес" } }, { business: { id: 9, name: "Второй" } }] } }));
    const list = await listBusinesses(KEY, { fetchImpl: impl });
    expect(list).toEqual([{ id: 7, name: "Мой бизнес" }, { id: 9, name: "Второй" }]);
    expect(calls[0].url.startsWith(`${MARKET_API}/`)).toBe(true);
    expect((calls[0].init.headers as Record<string, string>)["Api-Key"]).toBe(KEY);
    expect(calls[0].url.includes(KEY)).toBe(false);
  });

  it("страница товаров с продолжением", async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: {
        status: "OK",
        result: {
          paging: { nextPageToken: "next-1" },
          offerMappings: [
            { offer: { offerId: "A", name: "Товар А", basicPrice: { value: 100, currencyId: "RUR" } } },
            { offer: { offerId: "B", name: "Товар Б" } },
          ],
        },
      },
    }));
    const page = await fetchOfferPage(KEY, 7, "prev-token", { fetchImpl: impl });
    expect(page.items).toHaveLength(1);
    expect(page.problems).toHaveLength(1);
    expect(page.nextPageToken).toBe("next-1");
    expect(calls[0].url).toContain("/v2/businesses/7/offer-mappings?");
    expect(calls[0].url).toContain("page_token=prev-token");
  });

  it("неверный ключ: понятная ошибка без самого ключа", async () => {
    const { impl } = fakeFetch(() => ({ status: 401, body: { status: "ERROR" } }));
    let caught: unknown;
    try {
      await listBusinesses(KEY, { fetchImpl: impl });
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof MarketError).toBe(true);
    expect((caught as MarketError).status).toBe(400);
    expect((caught as MarketError).message.includes(KEY)).toBe(false);
  });
});
