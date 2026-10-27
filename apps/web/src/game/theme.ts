/**
 * Colours of the board: terrain, water, paths, markers and the lighting, so
 * the pieces stand out against it. `?theme=` in the URL picks one of the
 * candidates while we compare them.
 */

type RGB = [number, number, number];

export interface Theme {
  sky: string;
  /** Hemisphere sky and ground colours and intensity, then the sun's intensity. */
  hemi: [number, number, number];
  sun: number;
  ground: { bed: RGB; meadow: RGB; rock: RGB; steep: RGB; low: RGB; high: RGB };
  /** How much each terrain facet's brightness varies. */
  jitter: number;
  water: string;
  waterOpacity: number;
  wood: string;
  table: string;
  /** Path dots and entrance arrows, and how much bigger the dots are drawn. */
  dot: string;
  dotScale: number;
  coinFace: string;
  coinRim: string;
  parchment: string;
  stone: string;
  darkStone: string;
  rock: string;
  roof: string;
  /** Self-lighting of painted pieces (knights, owned roofs and banners), 0..1. */
  glow: number;
  /** A dark disc under every stack of knights, or null. */
  base: string | null;
}

export const THEMES: Record<string, Theme> = {
  /** The original look. */
  current: {
    sky: '#a9c9dc',
    hemi: [0xfff4dd, 0x3a5a2a, 1.3],
    sun: 2.2,
    ground: {
      bed: [0.78, 0.72, 0.52],
      meadow: [0.42, 0.62, 0.27],
      rock: [0.55, 0.52, 0.46],
      steep: [0.46, 0.4, 0.3],
      low: [0.36, 0.56, 0.24],
      high: [0.28, 0.44, 0.2],
    },
    jitter: 0.065,
    water: '#4f8fc0',
    waterOpacity: 0.78,
    wood: '#7a5230',
    table: '#5b4632',
    dot: '#fbf7ee',
    dotScale: 1,
    coinFace: '#e2b33c',
    coinRim: '#b9862a',
    parchment: '#efe2c0',
    stone: '#cfc3ad',
    darkStone: '#9d917c',
    rock: '#7f776a',
    roof: '#5f6670',
    glow: 0,
    base: null,
  },
  /** A: an old map — pale, desaturated parchment land, paths inked in dark brown. */
  parchment: {
    sky: '#d9d0bc',
    hemi: [0xfff8ea, 0x8a7d62, 1.5],
    sun: 1.9,
    ground: {
      bed: [0.8, 0.76, 0.62],
      meadow: [0.84, 0.8, 0.66],
      rock: [0.72, 0.68, 0.6],
      steep: [0.7, 0.64, 0.52],
      low: [0.8, 0.77, 0.63],
      high: [0.74, 0.71, 0.58],
    },
    jitter: 0.03,
    water: '#7fa6b8',
    waterOpacity: 0.85,
    wood: '#4a3020',
    table: '#2f2219',
    dot: '#4a2e1a',
    dotScale: 1.25,
    coinFace: '#6b4a2b',
    coinRim: '#3d2816',
    parchment: '#f7efd9',
    stone: '#a39885',
    darkStone: '#7d725f',
    rock: '#6b6253',
    roof: '#4b5058',
    glow: 0.08,
    base: '#2a1d12',
  },
  /** B: dusk — a dark, low-saturation board under which bright pieces glow. */
  dusk: {
    sky: '#1d2430',
    hemi: [0xc8d4ff, 0x10140c, 1.1],
    sun: 1.9,
    ground: {
      bed: [0.22, 0.24, 0.24],
      meadow: [0.17, 0.22, 0.16],
      rock: [0.26, 0.26, 0.25],
      steep: [0.2, 0.19, 0.16],
      low: [0.16, 0.21, 0.15],
      high: [0.13, 0.17, 0.13],
    },
    jitter: 0.06,
    water: '#1f4a70',
    waterOpacity: 0.9,
    wood: '#3a2a1e',
    table: '#14110e',
    dot: '#f2e3b8',
    dotScale: 1.15,
    coinFace: '#f0c64a',
    coinRim: '#a77d22',
    parchment: '#e8dcbc',
    stone: '#b5aea2',
    darkStone: '#7a756c',
    rock: '#55514b',
    roof: '#333a44',
    glow: 0.35,
    base: null,
  },
  /** C: tabletop print — a flat, light grey-green felt, white coins, black paths. */
  felt: {
    sky: '#cfd6d2',
    hemi: [0xffffff, 0x8a948c, 1.6],
    sun: 1.6,
    ground: {
      bed: [0.7, 0.74, 0.72],
      meadow: [0.66, 0.72, 0.64],
      rock: [0.66, 0.68, 0.64],
      steep: [0.6, 0.64, 0.58],
      low: [0.63, 0.69, 0.61],
      high: [0.58, 0.64, 0.57],
    },
    jitter: 0.02,
    water: '#9fc3d6',
    waterOpacity: 0.9,
    wood: '#3b3b3b',
    table: '#2a2a2a',
    dot: '#222222',
    dotScale: 1.3,
    coinFace: '#fafafa',
    coinRim: '#2b2b2b',
    parchment: '#ffffff',
    stone: '#b9b6ae',
    darkStone: '#8f8c85',
    rock: '#6f6d68',
    roof: '#3d434b',
    glow: 0.12,
    base: '#1a1a1a',
  },
};

const requested =
  typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('theme');

export const THEME: Theme = THEMES[requested ?? ''] ?? THEMES.current!;
