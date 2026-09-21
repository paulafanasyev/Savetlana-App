"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { rub } from "@/lib/format";

export interface ChatStep {
  tool: string;
  ok: boolean;
  summary?: string;
}
export interface PendingConfirmation {
  toolName: string;
  args: Record<string, unknown>;
  reason?: string;
}
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  steps?: ChatStep[];
  pending?: PendingConfirmation;
  verification?: string;
}

const TOOL_LABELS: Record<string, string> = {
  search_products: "Поиск по каталогу",
  search_cheaper: "Поиск аналогов дешевле",
  compare_products: "Сравнение товаров",
  get_product: "Карточка товара",
  get_order: "Заказы и доставки",
  cart_add: "Добавление в корзину",
  create_order: "Оформление заказа",
  cancel_order: "Отмена заказа",
  wishlist_add: "Список желаний",
  plan_gift: "Подбор подарка",
  analyze_seller_sales: "Анализ продаж",
  confirm_inventory: "Подтверждение наличия",
  extend_listing: "Продление размещения",
  create_product_draft: "Черновик карточки",
  publish_product: "Публикация карточки",
  change_price: "Изменение цены",
  advise_price: "Совет по цене",
  find_competitors: "Анализ конкурентов",
  product_health: "Диагностика карточки",
  upcoming_events: "События",
  remember_preference: "Память предпочтений",
  recall_memory: "Воспоминание",
};

export function SvetlanaChat({
  side = "buyer",
  className = "",
  title = "Светлана",
}: {
  side?: "buyer" | "seller";
  className?: string;
  title?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        side === "seller"
          ? "Здравствуйте! Я Светлана. Помогу с продажами: найду причины спада, проверю карточки, подскажу по ценам и конкурентам."
          : "Здравствуйте! Я Светлана. Помогу найти товар, выбрать подарок, сравнить варианты и оформить заказ. Что вас интересует?",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const send = useCallback(
    async (text: string, confirm?: { toolName: string; args: Record<string, unknown> }) => {
      if (busy) return;
      setBusy(true);
      if (confirm) {
        setMessages((m) => [...m, { role: "user", content: "Подтверждаю действие" }]);
      } else {
        setMessages((m) => [...m, { role: "user", content: text }]);
      }
      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            confirm
              ? { message: text, conversationId: conversationId ?? undefined, side }
              : { message: text, conversationId: conversationId ?? undefined, side }
          ),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Ошибка запроса");
        setConversationId(data.conversationId);
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: data.answer,
            steps: data.steps,
            pending: data.pendingConfirmation,
            verification: data.verification,
          },
        ]);
      } catch (e) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content:
              "Не удалось получить ответ. Попробуйте переформулировать — каталог и корзина работают и без меня.",
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, conversationId, side]
  );

  const confirmAction = useCallback(
    async (pending: PendingConfirmation) => {
      setBusy(true);
      try {
        const res = await fetch("/api/ai/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: conversationId ?? undefined,
            toolName: pending.toolName,
            args: pending.args,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Ошибка выполнения");
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: data.answer,
            steps: data.steps,
            verification: data.verification,
          },
        ]);
      } catch (e) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: "Действие не выполнено. Попробуйте ещё раз." },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [conversationId]
  );

  return (
    <div className={`card flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center gap-3 border-b border-surface-line bg-gradient-to-r from-svetlana-50 to-white px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-svetlana-600 text-white font-semibold">
          Св
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-ink">{title}</div>
          <div className="text-xs text-ink-soft">AI-помощник маркетплейса</div>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ minHeight: 220, maxHeight: 480 }}>
        {messages.map((m, i) => (
          <div key={i}>
            <div className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={`sv-bubble ${m.role === "user" ? "sv-bubble-user" : "sv-bubble-assistant"}`}>
                {m.content}
              </div>
            </div>
            {m.steps && m.steps.length > 0 && (
              <div className="prose-steps">
                {m.steps.map((s, j) => (
                  <div key={j} className="flex items-center gap-1.5">
                    <span>{s.ok ? "✓" : "✕"}</span>
                    <span className="font-medium text-ink">{TOOL_LABELS[s.tool] ?? s.tool}</span>
                    {s.summary && <span className="text-ink-faint truncate">— {s.summary}</span>}
                  </div>
                ))}
              </div>
            )}
            {m.pending && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  className="btn btn-primary px-3 py-1.5 text-xs"
                  onClick={() => confirmAction(m.pending!)}
                  disabled={busy}
                >
                  Подтвердить действие
                </button>
                <span className="text-xs text-ink-soft">{m.pending.reason}</span>
              </div>
            )}
            {m.verification && m.verification !== "VERIFIED" && (
              <div className="mt-1 text-[11px] text-ink-faint">
                статус проверки: {verificationLabel(m.verification)}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="sv-bubble sv-bubble-assistant">
              <span className="inline-flex gap-1">
                <span className="animate-bounce" style={{ animationDelay: "0ms" }}>•</span>
                <span className="animate-bounce" style={{ animationDelay: "120ms" }}>•</span>
                <span className="animate-bounce" style={{ animationDelay: "240ms" }}>•</span>
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="flex gap-2 border-t border-surface-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const text = input.trim();
          if (!text) return;
          setInput("");
          void send(text);
        }}
      >
        <input
          className="input"
          placeholder="Спросите Светлану…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          aria-label="Сообщение для Светланы"
        />
        <button className="btn btn-primary shrink-0" type="submit" disabled={busy || !input.trim()}>
          Отправить
        </button>
      </form>
    </div>
  );
}

function verificationLabel(v: string): string {
  switch (v) {
    case "MOCK_VERIFIED":
      return "проверено в песочнице (внешняя модель не подключена)";
    case "NOT_PROVEN":
      return "результат не подтверждён";
    case "PENDING_EXTERNAL_ACCESS":
      return "ожидается внешний доступ";
    default:
      return v;
  }
}

export { rub };
