/**
 * Typed access to the JSON-in-TEXT columns.
 *
 * Prisma's SQLite connector has no Json type, so structured payloads are stored
 * as JSON text. Every read goes through `readJson` (which never throws on
 * corrupt data) and every write through `writeJson`. On PostgreSQL these
 * columns can be promoted to `jsonb` with a migration.
 */

/** Parse a stored JSON column; returns the fallback when the row is malformed. */
export function readJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return (parsed ?? fallback) as T;
  } catch {
    // Corrupt payload: never let it crash a request. Log and degrade safely.
    console.warn("[db] malformed JSON column ignored", { length: value.length });
    return fallback;
  }
}

/** Serialize a value for a JSON column. */
export function writeJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

export function readObject(value: string | null): Record<string, unknown> {
  return readJson<Record<string, unknown>>(value, {});
}

export function readArray<T>(value: string | null): T[] {
  return readJson<T[]>(value, []);
}

export function readNumberArray(value: string | null): number[] {
  return readJson<number[]>(value, []);
}

export function readStringArray(value: string | null): string[] {
  return readJson<string[]>(value, []);
}

/** Merge a partial update into an existing stored object. */
export function mergeJson(
  stored: string | null,
  patch: Record<string, unknown>
): string {
  const current = readObject(stored);
  return writeJson({ ...current, ...patch });
}
