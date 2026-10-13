"use client";

import { useCallback, useEffect, useRef, useState, useReducer } from "react";
import { rub } from "@/lib/format";
import { SvetlanaAvatar } from "@/components/SvetlanaAvatar";
import {
  avatarReducer,
  initialAvatarState,
  type Emotion,
  chunkForSpeech,
  normalizeSpoken,
  parseAssistantEmotion,
  pickRussianVoice,
  speakable,
} from "@/lib/avatar-logic";

export interface ChatStep { tool: string; ok: boolean; summary?: string; }
export interface PendingConfirmation {
  toolName: string; args?: Record<string, unknown>; reason?: string; actionId: string; nonce: string; expiresAt?: string;
}
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  steps?: ChatStep[];
  pending?: PendingConfirmation;
  verification?: string;
  emotion?: Emotion;
}

const TOOL_LABELS: Record<string, string> = {
  search_products: "Поиск по каталогу", search_cheaper: "Поиск аналогов дешевле", compare_products: "Сравнение товаров",
  get_product: "Карточка товара", get_order: "Заказы и доставки", cart_add: "Добавление в корзину", create_order: "Оформление заказа",
  cancel_order: "Отмена заказа", wishlist_add: "Список желаний", plan_gift: "Подбор подарка", analyze_seller_sales: "Анализ продаж",
  confirm_inventory: "Подтверждение наличия", extend_listing: "Продление размещения", create_product_draft: "Черновик карточки",
  publish_product: "Публикация карточки", change_price: "Изменение цены", advise_price: "Совет по цене", find_competitors: "Анализ конкурентов",
  product_health: "Диагностика карточки", upcoming_events: "События", remember_preference: "Память предпочтений", recall_memory: "Воспоминание",
};

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  start: () => void;
  stop: () => void;
}
type RecognitionConstructor = new () => RecognitionLike;

function getRecognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const speechWindow = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

function Icon({ name, className = "h-4 w-4" }: { name: "mic" | "micOff" | "volume" | "volumeOff" | "send" | "refresh"; className?: string }) {
  const paths = {
    mic: <><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" /></>,
    micOff: <><path d="m3 3 18 18M9 5v6a3 3 0 0 0 5.12 2.12M15 5v1M5 11a7 7 0 0 0 11.33 5.5M12 18v4M8 22h8" /></>,
    volume: <><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></>,
    volumeOff: <><path d="m3 3 18 18M4 9v6h4l5 4v-6M13 5l-5 4H4M16 9a4 4 0 0 1 1 3" /></>,
    send: <path d="m3 3 18 9-18 9 3-9-3-9Zm3 9h15" />,
    refresh: <path d="M20 11a8 8 0 1 0 1 5M20 4v7h-7" />,
  };
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function useSpeechSynthesis(onSpeakingChange: (speaking: boolean) => void) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [available, setAvailable] = useState(false);
  const sequence = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    setAvailable(typeof SpeechSynthesisUtterance !== "undefined");
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const stop = useCallback(() => {
    sequence.current += 1;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    onSpeakingChange(false);
  }, [onSpeakingChange]);

  const speak = useCallback((text: string, enabled: boolean) => {
    if (!enabled || !available || typeof window === "undefined") return;
    const chunks = chunkForSpeech(speakable(text));
    if (!chunks.length) return;
    const id = ++sequence.current;
    window.speechSynthesis.cancel();
    onSpeakingChange(false);
    const voice = pickRussianVoice(voices.length ? voices : window.speechSynthesis.getVoices());
    chunks.forEach((chunk, index) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.lang = "ru-RU";
      utterance.rate = 1;
      utterance.pitch = 1.05;
      if (voice) utterance.voice = voice;
      if (index === 0) utterance.onstart = () => { if (sequence.current === id) onSpeakingChange(true); };
      if (index === chunks.length - 1) utterance.onend = () => { if (sequence.current === id) onSpeakingChange(false); };
      utterance.onerror = () => { if (sequence.current === id) onSpeakingChange(false); };
      window.speechSynthesis.speak(utterance);
    });
  }, [available, onSpeakingChange, voices]);

  return { voices, available, speak, stop };
}

export function SvetlanaChat({ side = "buyer", className = "", title = "Светлана" }: { side?: "buyer" | "seller"; className?: string; title?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", content: side === "seller" ? "Здравствуйте! Я Светлана. Помогу с продажами: найду причины спада, проверю карточки, подскажу по ценам и конкурентам." : "Здравствуйте! Я Светлана. Помогу найти товар, выбрать подарок, сравнить варианты и оформить заказ. Что вас интересует?", emotion: "happy" }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const [recognitionAvailable, setRecognitionAvailable] = useState(false);
  const [avatar, dispatch] = useReducer(avatarReducer, { ...initialAvatarState, emotion: "happy" });
  const endRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const sendRef = useRef<(text: string) => Promise<void>>(async () => undefined);
  const emotionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSpeakingChange = useCallback((speaking: boolean) => dispatch({ type: speaking ? "SPEECH_START" : "SPEECH_END" }), []);
  const speech = useSpeechSynthesis(onSpeakingChange);
  const { speak: speakText, stop: stopSpeaking } = speech;

  useEffect(() => {
    try { setVoiceEnabled(localStorage.getItem("svetlana_tts_enabled") === "1"); } catch { /* privacy mode */ }
    const constructor = getRecognitionConstructor();
    setRecognitionAvailable(Boolean(constructor));
    return () => { recognitionRef.current?.stop(); stopSpeaking(); if (emotionTimer.current) clearTimeout(emotionTimer.current); };
  }, [stopSpeaking]);

  useEffect(() => {
    try { localStorage.setItem("svetlana_tts_enabled", voiceEnabled ? "1" : "0"); } catch { /* privacy mode */ }
    if (!voiceEnabled) stopSpeaking();
  }, [voiceEnabled, stopSpeaking]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  const resetEmotionSoon = useCallback(() => {
    if (emotionTimer.current) clearTimeout(emotionTimer.current);
    emotionTimer.current = setTimeout(() => dispatch({ type: "RESET_EMOTION" }), 6000);
  }, []);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    dispatch({ type: "REQUEST_START" });
    setMessages((items) => [...items, { role: "user", content: trimmed }]);
    setInput("");
    try {
      const response = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: trimmed, conversationId: conversationId ?? undefined, side }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Ошибка запроса");
      setConversationId(data.conversationId);
      const parsed = parseAssistantEmotion(String(data.answer ?? ""));
      setMessages((items) => [...items, { role: "assistant", content: parsed.text, emotion: parsed.emotion, steps: data.steps, pending: data.pendingConfirmation, verification: data.verification }]);
      dispatch({ type: "RESPONSE", emotion: parsed.emotion });
      resetEmotionSoon();
      speakText(parsed.text, voiceEnabled);
    } catch {
      const errorMessage = "Не удалось получить ответ. Попробуйте переформулировать: каталог и корзина работают и без меня.";
      setMessages((items) => [...items, { role: "assistant", content: errorMessage, emotion: "sad" }]);
      dispatch({ type: "RESPONSE_ERROR" });
      resetEmotionSoon();
    } finally {
      setBusy(false);
      dispatch({ type: "REQUEST_END" });
    }
  }, [busy, conversationId, resetEmotionSoon, side, speakText, voiceEnabled]);

  useEffect(() => { sendRef.current = send; }, [send]);

  const toggleListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setListening(false);
      dispatch({ type: "LISTEN_END" });
      return;
    }
    const Constructor = getRecognitionConstructor();
    if (!Constructor || busy || (typeof window !== "undefined" && window.speechSynthesis?.speaking)) return;
    const recognition = new Constructor();
    recognition.lang = "ru-RU";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => { setListening(true); dispatch({ type: "LISTEN_START" }); };
    recognition.onresult = (event) => {
      const final = Array.from(event.results).filter((item) => item.isFinal).map((item) => item[0].transcript).join(" ");
      if (final) { recognition.stop(); void sendRef.current(normalizeSpoken(final)); }
    };
    recognition.onerror = () => { setListening(false); recognitionRef.current = null; dispatch({ type: "LISTEN_END" }); };
    recognition.onend = () => { setListening(false); recognitionRef.current = null; dispatch({ type: "LISTEN_END" }); };
    recognitionRef.current = recognition;
    try { recognition.start(); } catch { recognitionRef.current = null; setListening(false); dispatch({ type: "LISTEN_END" }); }
  }, [busy]);

  const confirmAction = useCallback(async (pending: PendingConfirmation) => {
    if (busy) return;
    setBusy(true);
    dispatch({ type: "REQUEST_START" });
    try {
      const response = await fetch("/api/ai/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: conversationId ?? undefined, actionId: pending.actionId, nonce: pending.nonce }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Ошибка выполнения");
      const parsed = parseAssistantEmotion(String(data.answer ?? ""));
      setMessages((items) => [...items, { role: "assistant", content: parsed.text, emotion: parsed.emotion, steps: data.steps, verification: data.verification }]);
      dispatch({ type: "RESPONSE", emotion: parsed.emotion });
      resetEmotionSoon();
      speakText(parsed.text, voiceEnabled);
    } catch {
      setMessages((items) => [...items, { role: "assistant", content: "Действие не выполнено. Попробуйте ещё раз.", emotion: "sad" }]);
      dispatch({ type: "RESPONSE_ERROR" });
      resetEmotionSoon();
    } finally { setBusy(false); dispatch({ type: "REQUEST_END" }); }
  }, [busy, conversationId, resetEmotionSoon, speakText, voiceEnabled]);

  return (
    <div className={`card flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-surface-line bg-gradient-to-r from-svetlana-50 to-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-3"><SvetlanaAvatar size="sm" phase={avatar.phase} emotion={avatar.emotion} /><div className="min-w-0"><div className="text-sm font-bold text-ink">{title}</div><div className="text-xs text-ink-soft">ИИ-помощник площадки</div></div></div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className={`rounded-lg p-2 ${voiceEnabled ? "bg-svetlana-100 text-svetlana-700" : "text-ink-soft hover:bg-surface-muted"}`} onClick={() => setVoiceEnabled((value) => !value)} aria-label={voiceEnabled ? "Выключить озвучивание ответов" : "Включить озвучивание ответов"} title="Озвучивать ответы"><Icon name={voiceEnabled ? "volume" : "volumeOff"} /></button>
          {recognitionAvailable && <button type="button" className={`rounded-lg p-2 ${listening ? "bg-bad/10 text-bad" : "text-ink-soft hover:bg-surface-muted"}`} onClick={toggleListening} aria-label={listening ? "Остановить запись голоса" : "Сказать голосом"} title={listening ? "Остановить запись" : "Сказать голосом"}><Icon name={listening ? "micOff" : "mic"} /></button>}
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ minHeight: 220, maxHeight: 480 }}>
        {messages.map((message, index) => <div key={index}>
          <div className={message.role === "user" ? "flex justify-end" : "flex justify-start"}><div className={`sv-bubble ${message.role === "user" ? "sv-bubble-user" : "sv-bubble-assistant"}`}>
            {message.role === "assistant" && message.emotion && <span className="mb-1 block text-xs" aria-label={`Эмоция: ${message.emotion}`}>{message.emotion === "happy" ? "😊" : message.emotion === "sad" || message.emotion === "crying" ? "😢" : message.emotion === "laughing" ? "😂" : message.emotion === "surprised" ? "😮" : "😐"}</span>}
            <span className="whitespace-pre-line">{message.content}</span>
          </div></div>
          {message.steps && message.steps.length > 0 && <div className="prose-steps">{message.steps.map((step, stepIndex) => <div key={stepIndex} className="flex items-center gap-1.5"><span aria-hidden="true">{step.ok ? "✓" : "✕"}</span><span className="font-medium text-ink">{TOOL_LABELS[step.tool] ?? step.tool}</span>{step.summary && <span className="truncate text-ink-faint">· {step.summary}</span>}</div>)}</div>}
          {message.pending && <div className="mt-2 flex flex-wrap items-center gap-2"><button className="btn btn-primary px-3 py-1.5 text-xs" onClick={() => void confirmAction(message.pending!)} disabled={busy}>Подтвердить действие</button><span className="text-xs text-ink-soft">{message.pending.reason}</span></div>}
          {message.verification && message.verification !== "VERIFIED" && <div className="mt-1 text-[11px] text-ink-faint">статус проверки: {verificationLabel(message.verification)}</div>}
        </div>)}
        {busy && <div className="flex justify-start"><div className="sv-bubble sv-bubble-assistant" aria-live="polite"><span className="inline-flex gap-1"><span className="svetlana-dot" /> <span className="svetlana-dot" /> <span className="svetlana-dot" /></span></div></div>}
        <div ref={endRef} />
      </div>
      <form className="flex gap-2 border-t border-surface-line p-3" onSubmit={(event) => { event.preventDefault(); void send(input); }}>
        <input className="input" placeholder={listening ? "Слушаю…" : "Спросите Светлану…"} value={input} onChange={(event) => setInput(event.target.value)} disabled={busy || listening} aria-label="Сообщение для Светланы" />
        <button className="btn btn-primary shrink-0" type="submit" disabled={busy || listening || !input.trim()} aria-label="Отправить сообщение"><Icon name="send" /><span className="sr-only">Отправить</span></button>
      </form>
    </div>
  );
}

function verificationLabel(value: string): string {
  switch (value) {
    case "MOCK_VERIFIED": return "тестовый режим: внешняя модель пока не подключена";
    case "NOT_PROVEN": return "результат не подтверждён";
    case "PENDING_EXTERNAL_ACCESS": return "ожидается внешний доступ";
    default: return value;
  }
}

export { rub };
