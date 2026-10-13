/** Pure avatar/chat logic. This module intentionally has no browser dependencies. */
export const EMOTIONS = ["neutral", "happy", "sad", "laughing", "crying", "surprised"] as const;
export type Emotion = (typeof EMOTIONS)[number];

export const AVATAR_PHASES = ["idle", "thinking", "speaking", "listening"] as const;
export type AvatarPhase = (typeof AVATAR_PHASES)[number];

export interface AvatarState {
  phase: AvatarPhase;
  emotion: Emotion;
}

export type AvatarAction =
  | { type: "REQUEST_START" }
  | { type: "RESPONSE"; emotion: Emotion }
  | { type: "RESPONSE_ERROR" }
  | { type: "SPEECH_START" }
  | { type: "SPEECH_END" }
  | { type: "LISTEN_START" }
  | { type: "LISTEN_END" }
  | { type: "REQUEST_END" }
  | { type: "RESET_EMOTION" };

export const initialAvatarState: AvatarState = { phase: "idle", emotion: "neutral" };

const isEmotion = (value: string): value is Emotion =>
  (EMOTIONS as readonly string[]).includes(value);

/** Extracts and removes an optional [EMOTION: name] marker from assistant output. */
export function parseAssistantEmotion(input: string): { text: string; emotion: Emotion } {
  const tagged = input.match(/\[\s*EMOTION\s*:\s*([a-zа-яё]+)\s*\]/i);
  const withoutTag = input.replace(/\[\s*EMOTION\s*:\s*[a-zа-яё]+\s*\]/gi, "").trim();
  const tag = tagged?.[1]?.toLowerCase();
  if (tag && isEmotion(tag)) return { text: withoutTag, emotion: tag };

  const lower = withoutTag.toLowerCase();
  if (lower.includes("хаха") || lower.includes("😂") || lower.includes("смешно")) {
    return { text: withoutTag, emotion: "laughing" };
  }
  if (lower.includes("грустн") || lower.includes("жаль") || lower.includes("сочувств")) {
    return { text: withoutTag, emotion: "sad" };
  }
  if (lower.includes("привет") || lower.includes("рада") || lower.includes("отлично")) {
    return { text: withoutTag, emotion: "happy" };
  }
  if (lower.includes("ого") || lower.includes("вау") || lower.includes("удив")) {
    return { text: withoutTag, emotion: "surprised" };
  }
  if (lower.includes("плач") || lower.includes("слёз") || lower.includes("слез")) {
    return { text: withoutTag, emotion: "crying" };
  }
  return { text: withoutTag, emotion: "neutral" };
}

/** Small deterministic state machine used by the chat and by tests. */
export function avatarReducer(state: AvatarState, action: AvatarAction): AvatarState {
  switch (action.type) {
    case "REQUEST_START":
      return { ...state, phase: "thinking" };
    case "RESPONSE":
      return { phase: state.phase === "speaking" || state.phase === "listening" ? state.phase : "idle", emotion: action.emotion };
    case "RESPONSE_ERROR":
      return { phase: "idle", emotion: "sad" };
    case "SPEECH_START":
      return { ...state, phase: "speaking" };
    case "SPEECH_END":
      return { ...state, phase: "idle" };
    case "LISTEN_START":
      return { ...state, phase: "listening" };
    case "LISTEN_END":
      return { ...state, phase: "idle" };
    case "REQUEST_END":
      return state.phase === "thinking" ? { ...state, phase: "idle" } : state;
    case "RESET_EMOTION":
      return { ...state, emotion: "neutral" };
    default:
      return state;
  }
}

export function avatarPhaseForSignals(signals: {
  pending?: boolean;
  speaking?: boolean;
  listening?: boolean;
  emotion?: Emotion;
}): AvatarPhase {
  if (signals.listening) return "listening";
  if (signals.speaking) return "speaking";
  if (signals.pending) return "thinking";
  return "idle";
}

const UNITS: Record<string, number> = {
  ноль: 0, один: 1, одна: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5,
  шесть: 6, семь: 7, восемь: 8, девять: 9,
};
const TEENS: Record<string, number> = {
  десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14,
  пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
};
const TENS: Record<string, number> = {
  двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60,
  семьдесят: 70, восемьдесят: 80, девяносто: 90,
};
const HUNDREDS: Record<string, number> = {
  сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500,
  шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
};

/** Russian spoken numbers used by voice commands, kept pure for browser and tests. */
export function wordsToNumbers(text: string): string {
  const out: string[] = [];
  let value = 0;
  let active = false;
  const flush = () => { if (active) out.push(String(value)); value = 0; active = false; };
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    const match = token.match(/^([а-яё]+)([^а-яё\d]*)$/i);
    const word = match?.[1]?.toLowerCase().replace(/ё/g, "е");
    const tail = match?.[2] ?? "";
    let handled = true;
    if (word && word in HUNDREDS) value += HUNDREDS[word];
    else if (word && word in TEENS) value += TEENS[word];
    else if (word && word in TENS) value += TENS[word];
    else if (word && word in UNITS) value += UNITS[word];
    else if (word && /^тысяч[аиу]?$/.test(word)) value = (value || 1) * 1000;
    else if (word && /^миллион(а|ов)?$/.test(word)) value = (value || 1) * 1_000_000;
    else handled = false;
    if (!handled) { flush(); out.push(token); }
    else if (tail) { flush(); out[out.length - 1] = (out[out.length - 1] ?? "") + tail; }
    else active = true;
  }
  flush();
  return out.join(" ");
}

export function normalizeSpoken(raw: string): string {
  let text = raw.trim().replace(/^\s*(?:эй\s*,?\s*)?(?:светлана|света|светик)(?![а-яё])[\s,.!:-]*/i, "");
  text = wordsToNumbers(text).replace(/(\d)\s+(?=\d{3}(?!\d))/g, "$1");
  text = text.replace(/(^|\s)((?:в|на|к|с)\s+)(\d{1,2})\s+(00|[0-5]\d)(?!\d)/gi,
    (match, before: string, prefix: string, hour: string, minute: string) => Number(hour) <= 23 ? `${before}${prefix}${hour}:${minute}` : match);
  text = text.replace(/(\d)\s*(?:рублей|рубля|рубль|руб\.?)(?![а-яёa-z])/gi, "$1").replace(/\s+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

export function speakable(text: string, maxChars = 600): string {
  let value = text.replace(/https?:\/\/\S+/g, "ссылка на экране")
    .replace(/[\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF]/gu, "")
    .replace(/\uFE0F|\u200D/g, "").replace(/^[\s•\-*]+/gm, "")
    .replace(/(\d)\s?₽/g, "$1 рублей").replace(/₽/g, "рублей").replace(/№\s?/g, "номер ")
    .replace(/[–—]/g, ", ").replace(/\n+/g, ". ").replace(/\s+/g, " ").trim();
  if (value.length > maxChars) value = `${value.slice(0, maxChars).trim()}… Остальное на экране.`;
  return value;
}

export function chunkForSpeech(text: string, max = 180): string[] {
  const parts = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  const result: string[] = [];
  let buffer = "";
  for (const part of parts.map((item) => item.trim()).filter(Boolean)) {
    if ((buffer + " " + part).trim().length > max && buffer) { result.push(buffer); buffer = part; }
    else buffer = (buffer + " " + part).trim();
  }
  if (buffer) result.push(buffer);
  return result.flatMap((item) => item.length <= max ? [item] : (item.match(new RegExp(`.{1,${max}}(\\s|$)`, "g")) ?? [item]).map((v) => v.trim()));
}

export function pickRussianVoice<T extends { lang: string; name: string }>(voices: T[]): T | undefined {
  const russian = voices.filter((voice) => voice.lang.toLowerCase().startsWith("ru"));
  const preferred = /(svetlana|dariya|irina|milena|alena|алена|алёна|милена|ирина|светлана|female|жен)/i;
  return russian.find((voice) => preferred.test(voice.name)) ?? russian.find((voice) => /google/i.test(voice.name)) ?? russian[0];
}
