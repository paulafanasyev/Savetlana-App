/**
 * Page-prop plumbing for the App Router.
 *
 * Next 15 made `params` and `searchParams` asynchronous: a page receives
 * Promises and must await them. Doing that inline in every page is noisy and
 * easy to forget, so pages call these helpers instead and always work with
 * plain objects.
 *
 * Both helpers tolerate a plain object as well, which keeps them usable from
 * tests and from any future runtime that passes the synchronous shape.
 */

/** Route params of a dynamic segment, e.g. `{ id: "..." }`. */
export type RouteParams = Record<string, string | string[] | undefined>;

/** Query string of a page request, e.g. `{ q: "...", page: "2" }`. */
export type SearchParams = Record<string, string | string[] | undefined>;

/** Reads the first value of a possibly repeated query key. */
function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return Boolean(value) && typeof (value as PromiseLike<T>).then === "function";
}

/** Awaits `params` and returns it as a plain object. */
export async function resolveParams<T extends RouteParams>(params: T | PromiseLike<T>): Promise<T> {
  return (isPromiseLike<T>(params) ? await params : params) ?? ({} as T);
}

/** Awaits `searchParams` and returns it as a plain object. */
export async function resolveSearchParams<T extends SearchParams>(
  searchParams: T | PromiseLike<T>,
): Promise<T> {
  return (isPromiseLike<T>(searchParams) ? await searchParams : searchParams) ?? ({} as T);
}

/** Convenience readers that normalise repeated keys to a single string. */
export const readParam = (params: RouteParams, key: string): string | undefined => first(params[key]);
export const readQuery = (query: SearchParams, key: string): string | undefined => first(query[key]);