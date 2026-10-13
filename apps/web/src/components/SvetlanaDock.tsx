"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { SvetlanaChat } from "@/components/SvetlanaChat";
import { SvetlanaAvatar } from "@/components/SvetlanaAvatar";

/** Страницы, где чат со Светланой уже на экране или не нужен. */
const HIDDEN_ON = new Set(["/", "/svetlana", "/login", "/register"]);

/** Светлана в углу любой страницы: фото-кнопка открывает чат. */
export function SvetlanaDock() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  if (HIDDEN_ON.has(pathname) || pathname.startsWith("/admin")) return null;
  const side = pathname.startsWith("/seller") ? "seller" : "buyer";

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
      {mounted && (
        <div className={open ? "block" : "hidden"}>
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
