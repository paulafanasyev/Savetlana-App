"use client";

import type { AvatarPhase, Emotion } from "@/lib/avatar-logic";

const sizes = {
  sm: "h-12 w-12",
  md: "h-20 w-20",
  lg: "h-40 w-40",
} as const;

export interface SvetlanaAvatarProps {
  size?: keyof typeof sizes;
  phase?: AvatarPhase;
  emotion?: Emotion;
  showName?: boolean;
  className?: string;
}

const stateLabel: Record<AvatarPhase, string> = {
  idle: "готова помочь",
  thinking: "обдумывает ответ",
  speaking: "говорит",
  listening: "слушает",
};

export function SvetlanaAvatar({
  size = "md",
  phase = "idle",
  emotion = "neutral",
  showName = false,
  className = "",
}: SvetlanaAvatarProps) {
  const emotionClass = emotion === "happy" || emotion === "laughing"
    ? "brightness-110 saturate-110"
    : emotion === "sad" || emotion === "crying"
      ? "brightness-95 saturate-75"
      : emotion === "surprised"
        ? "brightness-105"
        : "";

  return (
    <div className={`relative inline-flex flex-col items-center ${className}`}>
      <div className={`relative shrink-0 overflow-visible rounded-full ${sizes[size]} ${
        phase === "listening" ? "svetlana-avatar-listening" :
        phase === "thinking" ? "svetlana-avatar-thinking" :
        phase === "speaking" ? "svetlana-avatar-speaking" : ""
      }`}>
        <div className="relative h-full w-full overflow-hidden rounded-full border-2 border-svetlana-200 bg-gradient-to-br from-svetlana-100 via-white to-svetlana-200 shadow-card">
          <img
            src="/images/svetlana.jpg"
            alt="Аватар Светланы"
            className={`h-full w-full object-cover transition-[filter] duration-300 ${emotionClass}`}
            onError={(event) => {
              event.currentTarget.style.display = "none";
              event.currentTarget.nextElementSibling?.removeAttribute("hidden");
            }}
          />
          <span hidden className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-svetlana-100 via-white to-svetlana-200 text-2xl font-bold text-svetlana-700" aria-hidden="true">С</span>
          <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-t from-svetlana-700/15 to-transparent" aria-hidden="true" />
        </div>
      </div>
      {showName && <span className="mt-2 rounded-full bg-svetlana-50 px-2.5 py-1 text-xs font-semibold text-svetlana-700">Светлана</span>}
      <span className="sr-only" aria-live="polite">Светлана {stateLabel[phase]}</span>
    </div>
  );
}
