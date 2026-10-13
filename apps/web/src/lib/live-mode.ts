/**
 * Боевой сайт или нет. На боевом тестовые выплаты и тестовый перевозчик запрещены:
 * они создали бы видимость движения денег или посылки, которого нет.
 * Vercel: production. Свой сервер: NODE_ENV=production (можно отключить ALLOW_TEST_MODE=1).
 */
export function isLiveDeployment(): boolean {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === "production";
  return process.env.NODE_ENV === "production" && process.env.ALLOW_TEST_MODE !== "1";
}
