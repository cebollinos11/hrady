/**
 * Bot randomness (mulberry32), seeded and independent of the engine's RNG, so
 * bot games are reproducible from their seeds.
 */
export interface Random {
  /** Uniform float in `[0, 1)`. */
  next(): number;
  /** Uniform integer in `0..n-1`. */
  int(n: number): number;
  /** A random uint32, e.g. to seed a determinized engine RNG. */
  uint32(): number;
}

export function createRandom(seed: number): Random {
  let s = seed >>> 0;
  const uint32 = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  const next = () => uint32() / 2 ** 32;
  return { next, uint32, int: (n) => Math.floor(next() * n) };
}

export const pick = <T>(items: readonly T[], random: Random): T => items[random.int(items.length)]!;

/** Fisher–Yates shuffle of a copy. */
export function shuffled<T>(items: readonly T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = random.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
