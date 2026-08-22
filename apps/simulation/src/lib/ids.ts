/**
 * Two id strategies, deliberately separate.
 *
 * UI-created entities use `createId`, which is random. Generated scenarios use
 * `createIdFactory`, which is a pure counter — a seeded generator that emitted
 * random ids would not actually be reproducible.
 */

export function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}`;
}

export interface IdFactory {
  (prefix: string): string;
}

export function createIdFactory(): IdFactory {
  const counters = new Map<string, number>();

  return (prefix: string): string => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}${String(next).padStart(3, "0")}`;
  };
}
