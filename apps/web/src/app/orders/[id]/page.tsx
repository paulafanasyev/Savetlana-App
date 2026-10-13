"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { rub, orderStatusLabel, timeAgo } from "@/lib/format";

interface TrackingResponse {
  order: {
    id: string;
    number: string;
    status: string;
    totalKopecks: number;
    subtotalKopecks?: number | null;
    deliveryKopecks?: number | null;
    currency: string;
    items: { id: string; productId: string; titleSnapshot: string; quantity: number; priceKopecks: number }[];
    payment: { status: string; sandbox: boolean } | null;
  };
  reviewedProductIds: string[];
  shipment: {
    id: string;
    carrierName: string;
    trackingNumber: string;
    status: string;
    eta: string | null;
    sandbox: boolean;
    events: { id: string; status: string; description: string; occurredAt: string }[];
  } | null;
  trackingReady: boolean;
}

const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  CREATED: "Отправление создано",
  HANDED_OVER: "Передано перевозчику",
  IN_TRANSIT: "В пути",
  DELIVERED: "Доставлено",
  RETURNED: "Возврат",
  FAILED: "Ошибка доставки",
  CANCELLED: "Отменено",
};

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id ?? "";
  const [data, setData] = useState<TrackingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/orders/${orderId}/tracking`);
      if (!res.ok) {
        setError(res.status === 401 ? "Войдите в аккаунт, чтобы посмотреть заказ" : "Не удалось загрузить заказ");
        return;
      }
      setData((await res.json()) as TrackingResponse);
    } catch {
      setError("Нет связи с сервером. Обновите страницу.");
    }
  }

  useEffect(() => {
    void load();
    // Tracking is carrier-driven; refresh on focus rather than inventing state.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [orderId]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="card p-8 text-center">
          <h1 className="text-xl font-bold text-ink">Заказ не найден</h1>
          <p className="mt-2 text-ink-soft">{error}</p>
          <Link href="/orders" className="btn btn-primary mt-4 inline-flex">
            К списку заказов
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="card animate-pulse p-8 text-center text-ink-soft">Загрузка заказа…</div>
      </div>
    );
  }

  const { order, shipment } = data;
  const needsPayment = order.status === "PAYMENT_PENDING" || order.status === "CREATED";
  const delivered = order.status === "DELIVERED" || order.status === "COMPLETED";
  const subtotal = order.subtotalKopecks ?? order.items.reduce((sum, item) => sum + item.priceKopecks * item.quantity, 0);
  const delivery = order.deliveryKopecks ?? Math.max(0, order.totalKopecks - subtotal);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/orders" className="text-sm text-svetlana-700 hover:underline">
        ← Все заказы
      </Link>

      <div className="card mt-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-mono text-lg font-bold text-ink">{order.number}</h1>
            <p className="text-xs text-ink-soft">Статус: {orderStatusLabel(order.status)}</p>
          </div>
          <div className="text-right">
            <div className="font-bold text-svetlana-700">{rub(order.totalKopecks)}</div>
          </div>
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <h2 className="text-sm font-bold text-ink">Состав заказа</h2>
          <ul className="mt-2 space-y-2">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between text-sm">
                <span className="text-ink">
                  {item.titleSnapshot} × {item.quantity}
                </span>
                <span className="text-ink-soft">{rub(item.priceKopecks * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 border-t border-line pt-2 text-sm">
            <div className="flex justify-between"><dt className="text-ink-soft">Товары</dt><dd>{rub(subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-soft">Доставка</dt><dd>{delivery > 0 ? rub(delivery) : "бесплатно"}</dd></div>
            <div className="flex justify-between font-bold"><dt>Итого</dt><dd>{rub(order.totalKopecks)}</dd></div>
          </dl>
        </div>

        {order.payment?.sandbox && (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            Тестовая оплата: банк ещё не подключён, деньги не списываются.
          </p>
        )}

        {needsPayment && <PayButton orderId={order.id} onPaid={load} />}

        {delivered && <ReturnActions orderId={order.id} onChanged={load} />}
      </div>

      <div className="card mt-3 p-5">
        <h2 className="text-sm font-bold text-ink">Отслеживание доставки</h2>
        {shipment ? (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="chip">{SHIPMENT_STATUS_LABEL[shipment.status] ?? shipment.status}</span>
              {shipment.sandbox && (
                <span className="chip bg-amber-100 text-amber-800">тестовая доставка</span>
              )}
            </div>
            <dl className="mt-3 grid gap-2 text-xs text-ink-soft sm:grid-cols-2">
              <div>Перевозчик: <span className="text-ink">{shipment.carrierName}</span></div>
              <div>
                Трек-номер:{" "}
                <span className="font-mono text-ink">{shipment.trackingNumber || "—"}</span>
              </div>
              <div>
                Ожидаемая доставка:{" "}
                <span className="text-ink">{shipment.eta ? timeAgo(shipment.eta) : "неизвестно"}</span>
              </div>
            </dl>
            {shipment.events.length > 0 && (
              <ol className="mt-4 space-y-3 border-l-2 border-line pl-4">
                {shipment.events.map((ev) => (
                  <li key={ev.id} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-svetlana-600" />
                    <div className="text-sm text-ink">{ev.description}</div>
                    <div className="text-xs text-ink-soft">{timeAgo(ev.occurredAt)}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">
            Продавец ещё не передал заказ в доставку. Отслеживание появится, когда отправление будет создано.
          </p>
        )}
      </div>

      {delivered && (
        <section className="card mt-3 p-5">
          <h2 className="text-lg font-bold text-ink">Отзыв о товаре</h2>
          <p className="mt-1 text-sm text-ink-soft">Отзыв увидят другие покупатели. Он будет отмечен как «покупка подтверждена».</p>
          {order.items.map((item) => (
            <ReviewForm
              key={item.id}
              orderId={order.id}
              productId={item.productId}
              title={item.titleSnapshot}
              already={data.reviewedProductIds.includes(item.productId)}
              onDone={load}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function ReviewForm({ orderId, productId, title, already, onDone }: { orderId: string; productId: string; title: string; already: boolean; onDone: () => void }) {
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (already) {
    return <div className="mt-4 rounded-lg bg-surface-muted p-3 text-sm text-ink-soft">Отзыв на «{title}» уже оставлен. Спасибо!</div>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (body.trim().length < 10) {
      setMessage("Напишите хотя бы 10 символов");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, productId, rating, body: body.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(json?.error ?? "Не удалось отправить отзыв");
        return;
      }
      setMessage("Спасибо за отзыв!");
      onDone();
    } catch {
      setMessage("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-4 border-t border-line pt-4" onSubmit={submit}>
      <div className="text-sm font-medium text-ink">{title}</div>
      <label className="mt-2 block text-sm">
        Оценка{" "}
        <select className="input mt-1" value={rating} onChange={(e) => setRating(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} из 5</option>)}
        </select>
      </label>
      <textarea
        className="input mt-2 min-h-[90px] w-full"
        maxLength={4000}
        placeholder="Что понравилось, что нет? Не меньше 10 символов"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label={`Текст отзыва о товаре ${title}`}
      />
      <button className="btn btn-primary mt-2" disabled={busy}>{busy ? "Отправляем…" : "Отправить отзыв"}</button>
      {message && <p className="mt-2 text-sm text-ink-soft" role="status">{message}</p>}
    </form>
  );
}

const RETURN_REASONS: { value: string; label: string }[] = [
  { value: "ITEM_NOT_AS_DESCRIBED", label: "Не соответствует описанию" },
  { value: "ITEM_DAMAGED", label: "Повреждён" },
  { value: "WRONG_ITEM", label: "Прислали не то" },
  { value: "NO_LONGER_NEEDED", label: "Больше не нужен" },
];

const DISPUTE_REASONS: { value: string; label: string }[] = [
  { value: "ITEM_NOT_RECEIVED", label: "Товар не получен" },
  { value: "ITEM_NOT_AS_DESCRIBED", label: "Не соответствует описанию" },
  { value: "ITEM_DAMAGED", label: "Повреждён при доставке" },
  { value: "PAYMENT_DISPUTE", label: "Спор по оплате" },
  { value: "RETURN_DISPUTE", label: "Спор по возврату" },
  { value: "DELIVERY_DISPUTE", label: "Спор по доставке" },
];

function ReturnActions({ orderId, onChanged }: { orderId: string; onChanged: () => void }) {
  const [open, setOpen] = useState<"none" | "return" | "dispute">("none");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");

  async function submit(kind: "return" | "dispute") {
    if (!reason) {
      setMessage("Выберите причину");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "return" ? { reason } : { reason, description }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body?.error ?? "Не удалось отправить запрос");
        return;
      }
      setMessage(
        kind === "return"
          ? "Запрос на возврат оформлен. Продавец получил уведомление."
          : "Спор открыт. Сбор доказательств начнётся автоматически."
      );
      setOpen("none");
      onChanged();
    } catch {
      setMessage("Не удалось связаться с сервером");
    } finally {
      setBusy(false);
    }
  }

  if (open === "none") {
    return (
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        <button className="btn btn-ghost px-3 py-2 text-sm" onClick={() => setOpen("return")}>
          Оформить возврат
        </button>
        <button className="btn btn-ghost px-3 py-2 text-sm" onClick={() => setOpen("dispute")}>
          Открыть спор
        </button>
        {message && <p className="w-full text-xs text-ink-soft">{message}</p>}
      </div>
    );
  }

  const options = open === "return" ? RETURN_REASONS : DISPUTE_REASONS;

  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="text-sm font-bold text-ink">
        {open === "return" ? "Возврат товара" : "Открытие спора"}
      </h3>
      <div className="mt-3 space-y-3">
        <label className="block text-xs text-ink-soft">
          Причина
          <select className="input mt-1 w-full" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Выберите причину…</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {open === "dispute" && (
          <label className="block text-xs text-ink-soft">
            Опишите проблему
            <textarea
              className="input mt-1 min-h-[80px] w-full"
              placeholder="Минимум 10 символов"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        )}
        <div className="flex gap-2">
          <button className="btn btn-primary px-4 py-2 text-sm" disabled={busy} onClick={() => void submit(open)}>
            {busy ? "Отправляем…" : "Отправить"}
          </button>
          <button className="btn btn-ghost px-4 py-2 text-sm" disabled={busy} onClick={() => setOpen("none")}>
            Отмена
          </button>
        </div>
        {message && <p className="text-xs text-bad">{message}</p>}
      </div>
    </div>
  );
}

/**
 * Две кнопки: карта (страница банка: карты, «Мир», SberPay, T-Pay) и СБП
 * (оплата в приложении своего банка по QR или ссылке). Заказ становится
 * оплаченным только после подтверждения банка.
 */
function PayButton({ orderId, onPaid }: { orderId: string; onPaid: () => void }) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "wait" | "err">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [busyMethod, setBusyMethod] = useState<"card" | "sbp" | null>(null);

  async function pay(method: "card" | "sbp") {
    setState("busy");
    setBusyMethod(method);
    setMessage(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("err");
        setMessage(body?.error ?? "Оплата не удалась");
        return;
      }
      if (body.status !== "SUCCEEDED" && typeof body.confirmationUrl === "string" && body.confirmationUrl.startsWith("https://")) {
        // Оплата на странице банка или в приложении банка (СБП), потом покупатель вернётся сюда.
        setMessage(method === "sbp" ? "Открываем СБП: выберите свой банк и подтвердите оплату…" : "Переходим на защищённую страницу оплаты…");
        window.location.assign(body.confirmationUrl);
        return;
      }
      if (body.status !== "SUCCEEDED") {
        setState("wait");
        setMessage("Ждём подтверждение оплаты от банка. Статус обновится автоматически.");
        onPaid();
        return;
      }
      setState("ok");
      setMessage(
        body.sandbox
          ? "Тестовая оплата прошла: деньги не списывались. Продавец получил заказ."
          : "Оплата подтверждена банком."
      );
      onPaid();
    } catch {
      setState("err");
      setMessage("Не удалось связаться с платёжным сервисом");
    } finally {
      setBusyMethod(null);
    }
  }

  const disabled = state === "busy" || state === "ok";

  return (
    <div className="mt-4 border-t border-line pt-4">
      {state === "ok" ? (
        <button className="btn btn-primary w-full sm:w-auto" disabled>
          ✓ Оплачено
        </button>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button className="btn btn-primary w-full sm:w-auto" disabled={disabled} onClick={() => void pay("card")}>
            {busyMethod === "card" ? "Оплачиваем…" : state === "wait" ? "Проверить оплату" : "Оплатить картой"}
          </button>
          <button className="btn btn-ghost w-full sm:w-auto" disabled={disabled} onClick={() => void pay("sbp")}>
            {busyMethod === "sbp" ? "Открываем СБП…" : "Оплатить через СБП"}
          </button>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-soft">Карты «Мир», Visa, Mastercard, SberPay, T-Pay и СБП. Данные карты вводятся только на странице банка.</p>
      {message && (
        <p className={`mt-2 text-xs ${state === "ok" ? "text-good" : state === "wait" || state === "busy" ? "text-ink-soft" : "text-bad"}`}>{message}</p>
      )}
    </div>
  );
}
