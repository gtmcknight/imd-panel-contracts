/**
 * A seeded random source.
 *
 * Everything on the wall is drawn from a seed — a seat's number, a wallet's first seat — so the
 * same wall comes back on every visit and a reader can find the same module twice. Math.random
 * would give a different room each load. This is mulberry32 with a hashed seed; small integers
 * as seeds (0, 1, 2 …) would otherwise start too close to each other.
 */
export type Rng = () => number;

export function rng(seed: number): Rng {
  let t = (seed * 2654435761 + 12345) >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with a seeded source, in place. */
export function shuffle<T>(items: T[], g: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(g() * (i + 1));
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
  return items;
}

/** One of the given items, by the seeded source. */
export function pick<T>(items: readonly T[], g: Rng): T {
  return items[Math.floor(g() * items.length)] as T;
}
