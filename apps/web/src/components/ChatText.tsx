import { splitChatLinks } from "@/lib/chat-links";

/** Текст ответа Светланы со ссылками на страницы сайта. */
export function ChatText({ text }: { text: string }) {
  return (
    <span className="whitespace-pre-line">
      {splitChatLinks(text).map((part, index) =>
        "href" in part ? (
          <a key={index} href={part.href} className="font-medium text-svetlana-700 underline">
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}
