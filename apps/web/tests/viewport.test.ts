import { describe, expect, it } from "vitest";
import { DESKTOP_WIDTH, viewportFor } from "../src/lib/viewport";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
// Так представляется Chrome на Android в режиме «Версия для ПК».
const CHROME_DESKTOP_MODE = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
// А так Safari на iPhone после «Запросить настольный веб-сайт».
const SAFARI_DESKTOP_MODE = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe("ширина страницы", () => {
  it("телефон получает адаптивную вёрстку", () => {
    expect(viewportFor(ANDROID).width).toBe("device-width");
    expect(viewportFor(IPHONE).width).toBe("device-width");
  });
  it("«Полная версия» на телефоне получает широкую страницу", () => {
    expect(viewportFor(CHROME_DESKTOP_MODE).width).toBe(DESKTOP_WIDTH);
    expect(viewportFor(SAFARI_DESKTOP_MODE).width).toBe(DESKTOP_WIDTH);
  });
  it("без User-Agent и для автотестов ничего не меняем", () => {
    expect(viewportFor("").width).toBe("device-width");
    expect(viewportFor(null).width).toBe("device-width");
    expect(viewportFor("Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/129.0").width).toBe("device-width");
  });
});
