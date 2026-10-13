"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SvetlanaChat } from "@/components/SvetlanaChat";
import { SvetlanaAvatar } from "@/components/SvetlanaAvatar";

/** Страницы, где чат со Светланой уже на экране или не нужен. */
const HIDDEN_ON = new Set(["/", "/svetlana", "/login", "/register"]);
const CHAT_INPUT = 'input[aria-label="Сообщение для Светланы"]';

/**
 * Светлана в углу любой страницы: фото-кнопка открывает чат. Если на странице
 * уже есть встроенный чат, второй не показываем.
 */
export function SvetlanaDock() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => {
    const inputs = Array.from(document.querySelectorAll(CHAT_INPUT));
    setEmbedded(inputs.some((el) => !el.closest("[data-svetlana-dock]")));
    setOpen(false);
  }, [pathname]);

  if (HIDDEN_ON.has(pathname) || pathname.startsWith("/admin") || embedded) return null;
  const side = pathname.startsWith("/seller") ? "seller" : "buyer";

  return (
    <div data-svetlana-dock="" className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {mounted && (
        <div className={open ? "block max-h-[calc(100dvh-6.5rem)] overflow-y-auto rounded-2xl" : "hidden"}>
          <SvetlanaChat side={side} className="w-[min(92vw,380px)] shadow-float" />
        </div>
      )}
      <button
        type="button"
        className="flex items-center gap-2 rounded-full border border-svetlana-200 bg-white py-1 pl-1 pr-4 shadow-float hover:bg-svetlana-50"
        onClick={() => {
          setMounted(true);
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label={open ? "Свернуть чат со Светланой" : "Открыть чат со Светланой"}
      >
        <SvetlanaAvatar size="sm" />
        <span className="text-sm font-semibold text-svetlana-700">{open ? "Свернуть" : "Спросить Светлану"}</span>
      </button>
    </div>
  );
}
