"use client";

import { useEffect, useRef, useState } from "react";

interface Step {
  copied: number;
  failed: number;
  failures: { url: string; reason: string }[];
  nextCursor: string | null;
  remaining: number;
}

/**
 * Копирует фото перенесённых товаров к нам порциями: сервер за раз скачивает
 * несколько картинок, страница вызывает его, пока фото не закончатся.
 */
export function ImportPhotoCopy({ autoStart = false }: { autoStart?: boolean }) {
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(0);
  const [failures, setFailures] = useState<Step["failures"]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);
  const started = useRef(false);

  const run = async () => {
    if (started.current && running) return;
    started.current = true;
    stop.current = false;
    setRunning(true); setDone(false); setError(null); setCopied(0); setFailures([]); setRemaining(null);
    let after: string | null = null;
    try {
      for (let guard = 0; guard < 1000 && !stop.current; guard++) {
        const res = await fetch("/api/seller/products/import/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ after }),
        });
        const data = (await res.json().catch(() => null)) as (Step & { error?: string }) | null;
        if (!res.ok || !data) throw new Error(data?.error ?? "Сервер не ответил. Нажмите «Проверить ещё раз» через минуту.");
        setCopied((n) => n + data.copied);
        if (data.failures.length) setFailures((f) => [...f, ...data.failures].slice(0, 200));
        setRemaining(data.remaining);
        if (!data.nextCursor) { setDone(true); break; }
        after = data.nextCursor;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось скопировать фото");
    } finally {
      setRunning(false);
    }
  };

  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (autoStart && !started.current) void runRef.current();
  }, [autoStart]);

  return (
    <div className="space-y-2 rounded-xl border border-surface-line p-4 text-sm">
      <p className="font-medium text-ink">Фото товаров к нам на сайт</p>
      <p className="text-ink-soft">
        Фото из файла пока открываются с чужого сайта. Копируем их к нам, чтобы карточки не остались без картинок, если тот сайт их уберёт.
      </p>
      {(running || done || copied > 0 || failures.length > 0) && (
        <p className="text-ink">
          Скопировано: <b>{copied}</b>
          {failures.length > 0 && <>, не получилось: <b>{failures.length}</b></>}
          {running && remaining !== null && <>, осталось: {remaining}</>}
          {running && "…"}
          {done && ". Готово."}
        </p>
      )}
      {failures.length > 0 && (
        <details className="text-ink-soft">
          <summary className="cursor-pointer">Что не скопировалось (эти фото остались ссылками и продолжают открываться, пока их не уберёт тот сайт)</summary>
          <ul className="mt-2 list-disc pl-5">
            {failures.slice(0, 20).map((f, i) => <li key={i} className="break-all">{f.reason}: {f.url}</li>)}
            {failures.length > 20 && <li>и ещё {failures.length - 20}</li>}
          </ul>
        </details>
      )}
      {error && <div className="rounded-xl bg-red-50 p-3 text-bad" role="alert">{error}</div>}
      {!running && (
        <button className="btn btn-ghost" onClick={() => void run()}>
          {done || copied > 0 || error ? "Проверить ещё раз" : "Скопировать фото"}
        </button>
      )}
      {running && (
        <button className="btn btn-ghost" onClick={() => { stop.current = true; }}>Остановить</button>
      )}
    </div>
  );
}
