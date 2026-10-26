/**
 * Seeded PRNG (mulberry32). The whole generator state is one uint32, so it
 * lives in the game state and survives a JSON round trip.
 */

/** Normalises any integer seed to a generator state. */
export function seedRng(seed: number): number {
  if (!Number.isInteger(seed)) throw new RangeError(`seed must be an integer, got ${seed}`);
  return seed >>> 0;
}

/** Next uint32 and the advanced state. */
export function nextUint32(rng: number): [value: number, rng: number] {
  const next = (rng + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [(t ^ (t >>> 14)) >>> 0, next];
}

/** Uniform integer in `0..n-1` and the advanced state. */
export function randomInt(rng: number, n: number): [value: number, rng: number] {
  const [u, next] = nextUint32(rng);
  return [Math.floor((u / 2 ** 32) * n), next];
}
