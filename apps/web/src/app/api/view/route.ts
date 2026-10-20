/**
 * Переключатель «Полная версия» / «Мобильная версия» из подвала.
 * GET /api/view?mode=desktop|mobile|auto&back=/страница
 * Запоминает выбор на год и возвращает на ту же страницу.
 */
import { NextResponse, type NextRequest } from "next/server";
import { VIEW_COOKIE, parseViewPref, safeBack } from "@/lib/viewport";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const mode = parseViewPref(req.nextUrl.searchParams.get("mode"));
  const back = safeBack(req.nextUrl.searchParams.get("back"));
  const res = NextResponse.redirect(new URL(back, req.nextUrl.origin), 303);
  if (mode) {
    res.cookies.set(VIEW_COOKIE, mode, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  } else {
    res.cookies.delete(VIEW_COOKIE);
  }
  res.headers.set("Cache-Control", "no-store");
  return res;
}
