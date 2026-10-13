/**
 * Настоящий адрес посетителя для ограничения частоты запросов.
 *
 * Заголовок X-Forwarded-For браузер может прислать сам, поэтому первому
 * значению верить нельзя: так обходили бы ограничение на попытки входа.
 * Каждый прокси дописывает адрес в конец, значит доверяем значению,
 * которое добавил наш ближайший прокси: TRUSTED_PROXY_HOPS-е с конца
 * (по умолчанию 1: Vercel или nginx на своём сервере).
 */
export function pickClientIp(
  forwardedFor: string | null | undefined,
  realIp: string | null | undefined,
  trustedHops: number = trustedProxyHops(),
): string {
  const parts = (forwardedFor ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 0 && trustedHops > 0) {
    const index = Math.max(0, parts.length - trustedHops);
    return parts[index];
  }
  const real = realIp?.trim();
  return real || "unknown";
}

export function trustedProxyHops(): number {
  const raw = Number(process.env.TRUSTED_PROXY_HOPS ?? "1");
  return Number.isInteger(raw) && raw >= 0 && raw <= 5 ? raw : 1;
}

export function requestIp(request: Request): string {
  return pickClientIp(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip"));
}
