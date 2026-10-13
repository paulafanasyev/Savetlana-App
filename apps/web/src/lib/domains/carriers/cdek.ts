/**
 * СДЭК: оформление отправлений через API v2 (https://api.cdek.ru/v2).
 *
 * Договор со СДЭК заключает площадка, поэтому заказ оформляется как заказ
 * интернет-магазина (type 1): площадка отправитель по договору, настоящий
 * продавец указывается в блоке seller. Продавец сдаёт посылку в пункт СДЭК,
 * код которого он вводит при отправке, а курьер везёт её до двери покупателя
 * (тариф 137 «Посылка склад-дверь»).
 *
 * Вход по OAuth: CDEK_ACCOUNT (client_id) и CDEK_SECURE_KEY (client_secret)
 * меняются на временный токен, он хранится в памяти до истечения. Можно задать
 * готовый токен CDEK_TOKEN. Тестовая среда СДЭК: CDEK_API_URL=https://api.edu.cdek.ru/v2.
 *
 * ЧЕСТНОСТЬ: без ключей адаптер недоступен и ничего не выдумывает. Трек-номер,
 * статусы и даты берутся только из ответов СДЭК.
 */
import { env } from "../../env";
import { prisma } from "../../prisma";
import type { DeliveryProviderAdapter, ShipmentParams, TrackingEvent } from "../delivery";

export class CarrierApiError extends Error {
  constructor(
    readonly carrier: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CarrierApiError";
  }
}

/** Тариф «Посылка склад-дверь»: продавец сдаёт в пункт, курьер везёт покупателю. */
export const CDEK_TARIFF_WAREHOUSE_DOOR = 137;
const DEFAULT_ITEM_WEIGHT_GRAMS = 500;

function apiBase(): string {
  return (process.env.CDEK_API_URL ?? "https://api.cdek.ru/v2").replace(/\/+$/, "");
}

/** Коды статусов СДЭК → наши статусы отправления. */
export function cdekStatusToCanonical(code: string): string {
  const c = code.toUpperCase();
  if (c === "DELIVERED") return "DELIVERED";
  if (c === "NOT_DELIVERED" || c === "INVALID") return "FAILED";
  if (c === "CANCELLED" || c === "REMOVED") return "CANCELLED";
  if (c.startsWith("RETURNED")) return "RETURNED";
  if (c === "ACCEPTED" || c === "CREATED") return "CREATED";
  if (c === "RECEIVED_AT_SHIPMENT_WAREHOUSE" || c === "READY_TO_SHIP_AT_SENDING_OFFICE" || c === "READY_FOR_SHIPMENT_IN_SENDER_CITY") return "HANDED_OVER";
  return "IN_TRANSIT";
}

/** «+7 (900) 123-45-67», «89001234567» → «+79001234567». */
export function cdekPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 11 && /^[78]/.test(digits)) return `+7${digits.slice(1)}`;
  if (digits.length === 10) return `+7${digits}`;
  return null;
}

/** «2024-05-21T12:34:56+0300» → Date (СДЭК пишет пояс без двоеточия). */
export function cdekDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const fixed = raw.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(fixed);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface CdekAddress {
  city?: string;
  street?: string;
  house?: string;
  apartment?: string;
  zip?: string;
  recipientName?: string;
  phone?: string;
}

export interface CdekOrderInput {
  orderNumber: string;
  fromPointCode: string;
  address: CdekAddress;
  buyerName: string | null;
  seller: { name: string; inn?: string | null; phone?: string | null };
  items: { title: string; productId: string; priceKopecks: number; quantity: number }[];
  weightGrams?: number;
}

/** Чистая функция: тело запроса POST /orders. Бросает понятную ошибку, если данных не хватает. */
export function buildCdekOrder(input: CdekOrderInput) {
  const point = input.fromPointCode.trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,20}$/.test(point)) {
    throw new CarrierApiError("CDEK", 400, "Укажите код пункта СДЭК, куда сдадите посылку (например, MSK123)");
  }
  const a = input.address;
  if (!a.city?.trim() || !a.street?.trim() || !a.house?.trim()) {
    throw new CarrierApiError("CDEK", 400, "У заказа нет полного адреса покупателя: курьер СДЭК не сможет доставить");
  }
  const phone = cdekPhone(a.phone);
  if (!phone) throw new CarrierApiError("CDEK", 400, "У заказа нет телефона покупателя в формате +7");
  if (input.items.length === 0) throw new CarrierApiError("CDEK", 400, "В заказе нет товаров");

  const totalQty = input.items.reduce((s, i) => s + i.quantity, 0);
  const totalWeight = Math.max(100, Math.round(input.weightGrams ?? totalQty * DEFAULT_ITEM_WEIGHT_GRAMS));
  const perItem = Math.max(1, Math.floor(totalWeight / totalQty));
  const street = [a.street.trim(), `д. ${a.house.trim()}`, a.apartment?.trim() ? `кв. ${a.apartment.trim()}` : ""].filter(Boolean).join(", ");
  const sellerPhone = cdekPhone(input.seller.phone);

  return {
    type: 1,
    number: input.orderNumber,
    tariff_code: CDEK_TARIFF_WAREHOUSE_DOOR,
    shipment_point: point,
    to_location: {
      country_code: "RU",
      city: a.city.trim(),
      address: street,
      ...(a.zip?.trim() ? { postal_code: a.zip.trim() } : {}),
    },
    recipient: {
      name: (a.recipientName?.trim() || input.buyerName?.trim() || "Покупатель").slice(0, 255),
      phones: [{ number: phone }],
    },
    seller: {
      name: input.seller.name.slice(0, 255),
      ...(input.seller.inn ? { inn: input.seller.inn } : {}),
      ...(sellerPhone ? { phone: sellerPhone } : {}),
    },
    packages: [
      {
        number: "1",
        weight: totalWeight,
        length: 30,
        width: 20,
        height: 10,
        items: input.items.map((i) => ({
          name: i.title.slice(0, 255),
          ware_key: i.productId.slice(0, 50),
          // Заказ уже оплачен на площадке: при получении покупатель ничего не платит.
          payment: { value: 0 },
          cost: Math.round(i.priceKopecks) / 100,
          weight: perItem,
          amount: i.quantity,
        })),
      },
    ],
  };
}

interface CdekRequestState {
  type?: string;
  state?: string;
  errors?: { code?: string; message?: string }[];
}

interface CdekOrderEntity {
  uuid?: string;
  cdek_number?: string;
  statuses?: { code?: string; name?: string; date_time?: string; city?: string }[];
}

/** Чистая функция: разбор ответа GET /orders в ленту событий. */
export function parseCdekTracking(res: { entity?: CdekOrderEntity; requests?: CdekRequestState[] }): {
  status: string;
  events: TrackingEvent[];
  externalNumber?: string;
} {
  const invalid = (res.requests ?? []).find((r) => r.state === "INVALID");
  const statuses: { code: string; name?: string; city?: string; at: Date }[] = [];
  for (const raw of res.entity?.statuses ?? []) {
    const at = cdekDate(raw.date_time);
    if (at && raw.code) statuses.push({ code: raw.code, name: raw.name, city: raw.city, at });
  }
  statuses.sort((x, y) => x.at.getTime() - y.at.getTime());
  const events: TrackingEvent[] = statuses.map((s) => ({
    status: cdekStatusToCanonical(s.code),
    description: [s.name ?? s.code, s.city].filter(Boolean).join(", "),
    occurredAt: s.at,
  }));
  if (invalid && events.length === 0) {
    const reason = invalid.errors?.map((e) => e.message).filter(Boolean).join("; ") || "заявка отклонена";
    return { status: "FAILED", events: [{ status: "FAILED", description: `СДЭК: ${reason}`, occurredAt: new Date() }] };
  }
  const last = statuses[statuses.length - 1];
  return {
    status: last ? cdekStatusToCanonical(last.code) : "CREATED",
    events,
    ...(res.entity?.cdek_number ? { externalNumber: String(res.entity.cdek_number) } : {}),
  };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

export class CdekCarrierAdapter implements DeliveryProviderAdapter {
  readonly key = "cdek";
  readonly sandbox = false;
  readonly available: boolean;

  private readonly clientId = env.cdekAccount;
  private readonly clientSecret = env.cdekSecureKey;
  private readonly staticToken = env.cdekToken;

  constructor() {
    this.available = Boolean(this.staticToken || (this.clientId && this.clientSecret));
  }

  get requiredCredential(): string {
    return this.available ? "" : "CDEK_ACCOUNT и CDEK_SECURE_KEY (или CDEK_TOKEN)";
  }

  private async token(): Promise<string> {
    if (this.staticToken) return this.staticToken;
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId ?? "",
      client_secret: this.clientSecret ?? "",
    });
    const res = await fetch(`${apiBase()}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(env.carrierTimeoutMs),
    });
    if (!res.ok) throw new CarrierApiError("CDEK", res.status, "СДЭК не принял ключи доступа");
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new CarrierApiError("CDEK", 500, "СДЭК не выдал токен доступа");
    cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return json.access_token;
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(`${apiBase()}${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await this.token()}` },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(env.carrierTimeoutMs),
    });
    if (res.status === 401) cachedToken = null;
    const json = (await res.json().catch(() => ({}))) as T & { requests?: CdekRequestState[] };
    if (!res.ok) {
      const reason = json.requests?.[0]?.errors?.map((e) => e.message).filter(Boolean).join("; ");
      throw new CarrierApiError("CDEK", res.status, `СДЭК отклонил запрос${reason ? `: ${reason.slice(0, 150)}` : ""}`);
    }
    return json;
  }

  async createShipment(params: ShipmentParams) {
    if (!this.available) throw new CarrierApiError("CDEK", 0, "СДЭК не подключён к площадке");
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: params.orderId },
      select: {
        number: true,
        deliveryAddress: true,
        buyer: { select: { name: true } },
        items: { select: { titleSnapshot: true, productId: true, priceKopecks: true, quantity: true } },
        sellerProfile: { select: { displayName: true, inn: true, user: { select: { profile: { select: { phone: true } } } } } },
      },
    });
    let address: CdekAddress = {};
    try {
      address = JSON.parse(order.deliveryAddress ?? "{}") as CdekAddress;
    } catch {
      address = {};
    }
    const payload = buildCdekOrder({
      orderNumber: order.number,
      fromPointCode: params.fromPointCode ?? "",
      address,
      buyerName: order.buyer.name,
      seller: { name: order.sellerProfile.displayName, inn: order.sellerProfile.inn, phone: order.sellerProfile.user.profile?.phone },
      items: order.items.map((i) => ({ title: i.titleSnapshot, productId: i.productId, priceKopecks: i.priceKopecks, quantity: i.quantity })),
      weightGrams: params.weightGrams,
    });
    const res = await this.request<{ entity?: { uuid?: string }; requests?: CdekRequestState[] }>("/orders", { body: payload });
    const uuid = res.entity?.uuid;
    const rejected = res.requests?.find((r) => r.state === "INVALID");
    if (!uuid || rejected) {
      const reason = rejected?.errors?.map((e) => e.message).filter(Boolean).join("; ");
      throw new CarrierApiError("CDEK", 422, `СДЭК не принял заявку${reason ? `: ${reason.slice(0, 150)}` : ""}`);
    }
    return { trackingNumber: uuid, estimatedDelivery: params.estimatedDelivery, priceKopecks: params.deliveryKopecks ?? 0 };
  }

  /** Заявку можно удалить, пока посылку не приняли в пункте. */
  async cancelShipment(trackingNumber: string) {
    try {
      await this.request(`/orders/${encodeURIComponent(trackingNumber)}`, { method: "DELETE" });
      return { ok: true };
    } catch (err) {
      if (err instanceof CarrierApiError && (err.status === 400 || err.status === 404)) return { ok: false };
      throw err;
    }
  }

  private async orderInfo(trackingNumber: string) {
    // Сначала храним uuid заявки, после регистрации заменяем на номер СДЭК (его видит покупатель).
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(trackingNumber);
    const path = isUuid ? `/orders/${encodeURIComponent(trackingNumber)}` : `/orders?cdek_number=${encodeURIComponent(trackingNumber)}`;
    return this.request<{ entity?: CdekOrderEntity; requests?: CdekRequestState[] }>(path);
  }

  async getTracking(trackingNumber: string) {
    if (!this.available) throw new CarrierApiError("CDEK", 0, "СДЭК не подключён к площадке");
    return parseCdekTracking(await this.orderInfo(trackingNumber));
  }

  async getEta() {
    // СДЭК не отдаёт надёжную дату вручения в карточке заказа: не выдумываем.
    return null;
  }

  /** Стоимость тарифа «склад-дверь» от города продавца (CDEK_FROM_CITY_CODE, по умолчанию Москва). */
  async calculatePrice(params: { weightGrams?: number; city?: string }) {
    if (!this.available || !params.city) return 0;
    try {
      const res = await this.request<{ total_sum?: number }>("/calculator/tariff", {
        body: {
          tariff_code: CDEK_TARIFF_WAREHOUSE_DOOR,
          from_location: { code: Number(process.env.CDEK_FROM_CITY_CODE ?? "44") },
          to_location: { city: params.city, country_code: "RU" },
          packages: [{ weight: Math.max(100, Math.round(params.weightGrams ?? 1000)), length: 30, width: 20, height: 10 }],
        },
      });
      const rub = Number(res.total_sum ?? 0);
      return rub > 0 ? Math.round(rub * 100) : 0;
    } catch {
      return 0;
    }
  }

  /** Пункты СДЭК в городе: продавец выбирает, куда сдать посылку. */
  async getPickupPoints(city?: string) {
    if (!this.available || !city?.trim()) return [];
    try {
      const cities = await this.request<{ code?: number }[]>(`/location/cities?country_codes=RU&size=1&city=${encodeURIComponent(city.trim())}`);
      const code = cities[0]?.code;
      if (!code) return [];
      const points = await this.request<{ code?: string; name?: string; location?: { address?: string } }[]>(
        `/deliverypoints?city_code=${code}&type=PVZ&is_reception=true`,
      );
      return (points ?? []).flatMap((p) => (p.code ? [{ code: p.code, name: p.name ?? p.code, address: p.location?.address ?? "" }] : []));
    } catch {
      return [];
    }
  }
}
