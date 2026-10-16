import { describe, expect, it } from "vitest";
import { telegramDiagnostics } from "../src/lib/telegram-diagnostics";

const TOKEN = "123456789:AAEexampleexampleexample_x-y";

describe("диагностика Telegram", () => {
  it("пустое окружение: называет все три переменные", () => {
    const d = telegramDiagnostics({});
    expect(d.status).toBe("NOT_CONFIGURED");
    expect(d.missing.length).toBe(3);
  });

  it("всё задано верно: READY и без значений в ответе", () => {
    const d = telegramDiagnostics({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_BOT_USERNAME: "@aiko_market_bot", TELEGRAM_WEBHOOK_SECRET: "abcdefghijklmnop_123" });
    expect(d.status).toBe("READY");
    expect(d.missing.length).toBe(0);
    expect(d.problems.length).toBe(0);
    expect(JSON.stringify(d).includes("AAEexample")).toBe(false);
  });

  it("короткий секрет выключает бота и объясняет почему", () => {
    const d = telegramDiagnostics({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_BOT_USERNAME: "aiko_bot", TELEGRAM_WEBHOOK_SECRET: "short" });
    expect(d.status).toBe("NOT_CONFIGURED");
    expect(d.problems.length).toBe(1);
  });
});
