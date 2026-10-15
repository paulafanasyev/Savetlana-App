import { useId } from "react";

/**
 * Знак АИКО: буква «А» на фиолетовом квадрате и тёплая точка, «искра»
 * помощника. Временный логотип, нарисованный кодом, пока нет файла от
 * владельца. Тот же рисунок лежит в src/app/icon.svg для вкладки браузера.
 */
export function AikoMark({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`aiko-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7d5cb0" />
          <stop offset="1" stopColor="#432c61" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#aiko-${id})`} />
      <path d="M19 47 L32 17 L45 47" fill="none" stroke="#ffffff" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24.5 36.5 H39.5" fill="none" stroke="#ffffff" strokeWidth="5.5" strokeLinecap="round" />
      <circle cx="48" cy="16" r="4.5" fill="#f4b183" />
    </svg>
  );
}

/** Знак и надпись для шапки. */
export function AikoLogo() {
  return (
    <span className="flex items-center gap-2">
      <AikoMark size={32} />
      <span className="text-xl font-extrabold tracking-wide text-svetlana-700">АИКО</span>
    </span>
  );
}
