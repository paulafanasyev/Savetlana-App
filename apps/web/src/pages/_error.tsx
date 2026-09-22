import type { NextPageContext } from "next";

/**
 * Legacy error page.
 *
 * The application is App Router first; error.tsx / global-error.tsx handle
 * in-app errors. This file exists only so that Next.js does not synthesise an
 * internal _error page that cannot be prerendered (Next 14.2.35 renders a
 * synthesised _error through _document, which trips the "Html should not be
 * imported outside of pages/_document" guard).
 *
 * getInitialProps makes Next render this page standalone, without the _document
 * wrapper, so prerendering succeeds.
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
