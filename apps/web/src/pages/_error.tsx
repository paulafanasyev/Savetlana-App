import type { NextPageContext } from "next";

/**
 * Legacy error page.
 *
 * The application is App Router first; error.tsx / global-error.tsx handle
 * in-app errors. This file exists purely to stop Next from synthesising an
 * internal `_error` page that cannot be prerendered: rendering the synthesised
 * `/500` routes through `_document`, which trips the runtime guard
 * "Html should not be imported outside of pages/_document" and aborts the
 * build.
 *
 * Verified still required on Next 15.5.27 — the upgrade did not fix it.
 * `getInitialProps` makes Next render this page standalone, without the
 * `_document` wrapper, so prerendering succeeds.
 */
Error.getInitialProps = async (ctx: NextPageContext) => {
  return { statusCode: ctx.err?.statusCode ?? 500 };
};

export default function Error({ statusCode }: { statusCode?: number }) {
  return (
    <div style={{ padding: "5rem 1rem", textAlign: "center", fontFamily: "system-ui" }}>
      <h1>{statusCode === 404 ? "Страница не найдена" : "Сервис временно недоступен"}</h1>
      <p>Попробуйте повторить запрос.</p>
      <a href="/">На главную</a>
    </div>
  );
}
