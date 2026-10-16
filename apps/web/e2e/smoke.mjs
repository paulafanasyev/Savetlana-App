/**
 * Проверка сайта в настоящем браузере (Chromium через Playwright).
 * Запускается в GitHub Actions против собранного сайта на localhost
 * (своя тестовая база, без настоящих ключей и денег).
 *
 * Сценарий: главная, каталог, «Фриланс», регистрация, форма заказа сразу
 * на услуге, выбор города поиском, мой город с погодой в шапке, портфолио
 * (о себе, навыки, работа с фото), публичный профиль исполнителя, удаление
 * работы вместе с фото.
 *
 * Итог пишется в сводку GitHub (GITHUB_STEP_SUMMARY) и в аннотации запуска,
 * скриншоты упавших шагов лежат в артефакте «browser-check».
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const OUT = process.env.E2E_ARTIFACTS ?? "e2e-artifacts";
mkdirSync(OUT, { recursive: true });

// Настоящая картинка 1x1 (PNG): браузер её открывает и уменьшает перед отправкой.
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

const results = [];
let failed = 0;
let shot = 0;

const browser = await chromium.launch();
const context = await browser.newContext({ locale: "ru-RU", viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(15_000);

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message}`));

async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push(`| ✅ | ${name} | ${Date.now() - started} мс |`);
  } catch (error) {
    failed += 1;
    shot += 1;
    const file = `fail-${String(shot).padStart(2, "0")}.png`;
    await page.screenshot({ path: join(OUT, file), fullPage: true }).catch(() => undefined);
    const message = (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 200).replace(/\|/g, "/");
    results.push(`| ❌ | ${name}: ${message} (скриншот ${file}) | ${Date.now() - started} мс |`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function open(path) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  expect(res && res.status() < 400, `${path} ответил ${res?.status()}`);
  return res;
}

const email = `e2e-${Date.now()}@example.com`;
const workTitle = `Лендинг для кофейни ${Date.now() % 10000}`;
let performerHref = "";
let photoUrl = "";

await step("Главная открывается, в шапке есть «Фриланс»", async () => {
  await open("/");
  await page.getByRole("link", { name: "Фриланс" }).first().waitFor();
});

await step("Каталог открывается", async () => {
  await open("/catalog");
});

await step("«Фриланс»: кнопка ведёт на форму сразу на услуге", async () => {
  await open("/freelance");
  await page.getByRole("heading", { name: "Фриланс" }).waitFor();
  const href = await page.getByRole("link", { name: "Разместить заказ" }).getAttribute("href");
  expect(href === "/classifieds/new?vertical=SERVICE&deal=SERVICE_REQUEST", `ссылка кнопки: ${href}`);
});

await step("Регистрация нового пользователя", async () => {
  await open("/register");
  await page.getByLabel("Имя").fill("Проверка Браузером");
  await page.getByLabel("Email").fill(email);
  await page.locator("#register-password").fill("e2e-password-123");
  await page.locator("#register-accept").check();
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/register"), { timeout: 20_000 });
});

await step("Форма объявления открывается сразу на «Нужна услуга»", async () => {
  await open("/classifieds/new?vertical=SERVICE&deal=SERVICE_REQUEST");
  await page.waitForFunction(() => {
    const v = document.querySelector("#vertical");
    const d = document.querySelector("#dealType");
    return v instanceof HTMLSelectElement && d instanceof HTMLSelectElement && v.value === "SERVICE" && d.value === "SERVICE_REQUEST";
  });
});

await step("Город в объявлении выбирается поиском", async () => {
  const field = page.locator("#cityId");
  await field.fill("Каза");
  await page.getByRole("option", { name: /Казань/ }).first().click();
  const label = await field.inputValue();
  expect(label.startsWith("Казань"), `в поле города: ${label}`);
  const id = await page.locator('input[type="hidden"][name="cityId"]').inputValue();
  expect(id.length > 0, "id города не попал в форму");
});

await step("Мой город: выбор поиском, город в шапке и в новом объявлении", async () => {
  await open("/city");
  await page.getByRole("heading", { name: "Мой город" }).waitFor();
  await page.locator("#my-city").fill("Новосиб");
  await page.getByRole("option", { name: /Новосибирск/ }).first().click();
  await page.getByTestId("weather-widget").filter({ hasText: "Новосибирск" }).waitFor();
  const mapPoints = await page.locator('svg [role="button"]').count();
  expect(mapPoints > 100, `точек на карте: ${mapPoints}`);
  await open("/classifieds/new");
  await page.waitForFunction(() => {
    const el = document.querySelector('input[type="hidden"][name="cityId"]');
    return el instanceof HTMLInputElement && el.value.length > 0;
  });
  const label = await page.locator("#cityId").inputValue();
  expect(label.startsWith("Новосибирск"), `в поле города: ${label}`);
});

await step("Портфолио: о себе и навыки сохраняются (дефисы на месте)", async () => {
  await open("/profile/portfolio");
  await page.getByRole("heading", { name: "Портфолио исполнителя" }).waitFor();
  await page.getByLabel("О себе").fill("Делаю сайты для малого бизнеса. Проверка из браузера.");
  await page.getByLabel("Навыки через запятую").fill("UI-дизайн, Figma, веб-вёрстка");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await page.getByText("Сохранено").waitFor();
  const skills = await page.getByLabel("Навыки через запятую").inputValue();
  expect(skills === "UI-дизайн, Figma, веб-вёрстка", `навыки после сохранения: ${skills}`);
});

await step("Портфолио: работа с фото добавляется", async () => {
  await page.getByLabel("Название").fill(workTitle);
  await page.getByLabel("Что сделали").fill("Дизайн и вёрстка за 5 дней");
  await page.getByLabel("Фото работы").setInputFiles({ name: "work.png", mimeType: "image/png", buffer: PNG_1PX });
  await page.getByRole("button", { name: "Добавить работу" }).click();
  await page.getByText("Работа добавлена").waitFor({ timeout: 20_000 });
  photoUrl = (await page.locator(`img[alt="${workTitle}"]`).first().getAttribute("src")) ?? "";
  expect(photoUrl.includes("/portfolio/"), `адрес фото: ${photoUrl}`);
});

await step("Фото работы открывается по ссылке", async () => {
  expect(photoUrl, "нет адреса фото");
  const res = await page.request.get(new URL(photoUrl, BASE).toString());
  expect(res.status() === 200, `фото ответило ${res.status()}`);
  const type = res.headers()["content-type"] ?? "";
  expect(type.startsWith("image/"), `тип файла: ${type}`);
});

await step("Публичный профиль исполнителя показывает портфолио", async () => {
  performerHref = (await page.getByRole("link", { name: "Посмотреть, как видят заказчики" }).getAttribute("href")) ?? "";
  expect(performerHref.startsWith("/performers/"), `ссылка на профиль: ${performerHref}`);
  await open(performerHref);
  await page.getByRole("heading", { name: "Портфолио" }).waitFor();
  await page.getByText(workTitle).waitFor();
  await page.getByText("UI-дизайн", { exact: true }).waitFor();
  const loaded = await page.locator(`img[alt="${workTitle}"]`).first().evaluate((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0);
  expect(loaded, "картинка в профиле не загрузилась");
});

await step("Удаление работы убирает её и фото", async () => {
  await open("/profile/portfolio");
  await page.getByRole("button", { name: "Убрать" }).first().click();
  await page.getByRole("heading", { name: "Мои работы: 0" }).waitFor();
  const res = await page.request.get(new URL(photoUrl, BASE).toString());
  expect(res.status() === 404, `удалённое фото всё ещё отвечает ${res.status()}`);
});

await browser.close();

const lines = [
  "## Проверка сайта в браузере",
  "",
  `Адрес: ${BASE}. Шагов: ${results.length}, упало: ${failed}.`,
  "",
  "| | Шаг | Время |",
  "|---|---|---|",
  ...results,
  "",
];
if (pageErrors.length) {
  lines.push("### Ошибки JavaScript на страницах", "", ...pageErrors.slice(0, 20).map((e) => `- ${e.slice(0, 300)}`), "");
}
const report = lines.join("\n");
writeFileSync(join(OUT, "report.md"), report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
console.log(report);
// Короткий итог в аннотациях GitHub: их видно в API без входа.
console.log(`::notice title=Проверка в браузере::Шагов ${results.length}, упало ${failed}`);
for (const line of results.filter((r) => r.startsWith("| ❌")).slice(0, 9)) {
  console.log(`::error title=Шаг упал::${line.replace(/^\| ❌ \| /, "").replace(/ \|.*$/, "")}`);
}
process.exit(failed > 0 ? 1 : 0);
