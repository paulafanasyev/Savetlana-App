import { headers } from "next/headers";
import { resolveSession, serverRequest } from "@/lib/auth";
import { needsTermsConsent } from "@/lib/domains/terms-consent";
import { ConsentGate } from "./ConsentGate";

/** Страницы, которые нельзя закрывать окном: сами документы и вход (там свой шаг согласия). */
const OPEN_PATHS = ["/legal", "/privacy", "/contacts", "/login", "/register", "/admin-recovery", "/password-reset", "/reset-password"];

/**
 * Тем, кто уже вошёл, но не принимал текущую версию условий, показываем окно согласия.
 * Гостям ничего не показываем. Ошибка проверки не должна ломать страницу.
 */
export async function ConsentGateServer() {
  try {
    const path = (await headers()).get("x-forwarded-path") ?? "/";
    if (OPEN_PATHS.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`))) return null;
    const { user } = await resolveSession(await serverRequest());
    if (!user) return null;
    if (!(await needsTermsConsent(user.id))) return null;
    return <ConsentGate />;
  } catch {
    return null;
  }
}
