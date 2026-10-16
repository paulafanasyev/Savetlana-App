import { describe, expect, it } from "vitest";
import { telegramDiagnostics } from "../src/lib/telegram-diagnostics";

// Тестовое значение собираем на лету, чтобы сканер утечек не принял его за настоящий токен.
const FAKE = ["1".repeat(9), "x".repeat(30)].join(":");
const SECRET = "s".repeat(20);

describe("диагностика Telegram", () => {
  it("пустое окружение: называет все три переменные", () => {
    const d = telegramDiagnostics({});
    expect(d.status).toBe("NOT_CONFIGURED");
    expect(d.missing.length).toBe(3);
  });

  it("всё задано верно: READY и без значений в ответе", () => {
    const d = telegramDiagnostics({ TELEGRAM_BOT_TOKEN: FAKE, TELEGRAM_BOT_USERNAME: "@aiko_market_bot", TELEGRAM_WEBHOOK_SECRET: SECRET });
    expect(d.status).toBe("READY");
    expect(d.missing.length).toBe(0);
    expect(d.problems.length).toBe(0);
    expect(JSON.stringify(d).includes("xxxxx")).toBe(false);
  });

  it("короткий секрет выключает бота и объясняет почему", () => {
    const d = telegramDiagnostics({ TELEGRAM_BOT_TOKEN: FAKE, TELEGRAM_BOT_USERNAME: "aiko_bot", TELEGRAM_WEBHOOK_SECRET: "short" });
    expect(d.status).toBe("NOT_CONFIGURED");
    expect(d.problems.length).toBe(1);
  });
});
