import { timeAgo } from "@/lib/format";

interface Message {
  id: string;
  body: string;
  createdAt: Date;
  mine: boolean;
}

export function MessageThread({ messages, emptyText }: { messages: Message[]; emptyText: string }) {
  if (messages.length === 0) return <p className="text-sm text-ink-faint">{emptyText}</p>;
  return (
    <ul className="space-y-3" aria-label="Переписка">
      {messages.map((m) => (
        <li key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${m.mine ? "bg-svetlana-50 text-ink" : "bg-surface-muted text-ink"}`}>
            <p className="whitespace-pre-line">{m.body}</p>
            <div className="mt-1 text-right text-[11px] text-ink-faint">{m.mine ? "Вы" : "Собеседник"} · {timeAgo(m.createdAt)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
