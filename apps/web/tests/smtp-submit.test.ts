import net from "net";
import type { AddressInfo } from "net";
import { describe, expect, it } from "vitest";
import { submitSmtp } from "../src/lib/notification-delivery";
import { hasChannelConsent } from "../src/lib/notification-delivery";

/** Простой фейковый SMTP-сервер: отвечает на EHLO двумя кусками и без STARTTLS. */
function fakeServer(): Promise<{ port: number; lines: string[]; close: () => void }> {
  const lines: string[] = [];
  const server = net.createServer((sock) => {
    sock.write("220-привет\r\n220 готов\r\n");
    let buf = "";
    sock.on("data", (c) => {
      buf += c.toString();
      let i = buf.indexOf("\r\n");
      while (i >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        lines.push(line);
        if (line.startsWith("EHLO")) {
          sock.write("250-hello\r\n");
          setTimeout(() => sock.write("250-SIZE 1000\r\n250 AUTH LOGIN\r\n"), 20);
        } else {
          sock.write("502 не поддерживается\r\n");
        }
        i = buf.indexOf("\r\n");
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ port, lines, close: () => server.close() });
    });
  });
}

describe("отправка почты", () => {
  it("без STARTTLS не отправляет пароль открытым текстом", async () => {
    const srv = await fakeServer();
    try {
      const result = await submitSmtp(
        { host: "127.0.0.1", port: srv.port, secure: false, user: "u", pass: "secret" },
        "Subject: t\r\n\r\nbody",
        "x@example.com"
      );
      expect(result).toEqual({ ok: false, error: "smtp-starttls-unavailable" });
      // Многострочные ответы собраны целиком: AUTH даже не пытались отправить.
      expect(srv.lines.some((l) => l.startsWith("AUTH"))).toBe(false);
    } finally {
      srv.close();
    }
  });

  it("служебные письма безопасности не требуют согласия на рекламу", async () => {
    await expect(hasChannelConsent("no-such-user", "email", "security")).resolves.toBe(true);
  });
});
