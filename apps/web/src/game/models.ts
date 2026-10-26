import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLAYER_COLOURS } from '../shared/describe';
import { FACE_VALUES } from './dice';
import type { FigureSize } from './figures';

/**
 * Low-poly models of the board pieces, built from three.js primitives. Every
 * geometry and material is created once and shared.
 */

const flat = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });

export const NEUTRAL_COLOUR = '#efe9dc';
export const playerColour = (p: number | null) =>
  p === null ? NEUTRAL_COLOUR : (PLAYER_COLOURS[p] ?? '#777777');

const playerMaterials = new Map<string, THREE.MeshStandardMaterial>();
/** Painted material of a player's pieces; `null` is the neutral colour. */
export function playerMaterial(p: number | null): THREE.MeshStandardMaterial {
  const colour = playerColour(p);
  let m = playerMaterials.get(colour);
  if (!m) playerMaterials.set(colour, (m = flat(colour, { roughness: 0.6 })));
  return m;
}

export const MATERIALS = {
  metal: flat('#c9ccd2', { metalness: 0.35, roughness: 0.45 }),
  wood: flat('#7a5230'),
  stone: flat('#cfc3ad'),
  darkStone: flat('#9d917c'),
  rock: flat('#7f776a'),
  roof: flat('#a5442e'),
  gold: flat('#e2b33c', { metalness: 0.4, roughness: 0.4 }),
  coinRim: flat('#b9862a', { metalness: 0.3, roughness: 0.5 }),
  parchment: flat('#efe2c0'),
  dot: flat('#fbf7ee', { roughness: 1 }),
  water: new THREE.MeshStandardMaterial({
    color: '#4f8fc0',
    transparent: true,
    opacity: 0.78,
    roughness: 0.25,
    metalness: 0.1,
  }),
};

// --- Knights ---------------------------------------------------------------

/** Height of each figure, for stacking labels above them. */
export const FIGURE_HEIGHT: Record<FigureSize, number> = { 1: 0.27, 2: 0.33, 5: 0.41 };

function lathe(points: [number, number][], segments = 7) {
  return new THREE.LatheGeometry(
    points.map(([x, y]) => new THREE.Vector2(x, y)),
    segments,
  );
}

function at(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  g.rotateX(rx).rotateY(ry).rotateZ(rz);
  return g.translate(x, y, z);
}

/**
 * Painted body and metal trim of a knight figure of `size`. The one is a foot
 * knight, the two carries a shield, the five a banner and a plume.
 */
function knightParts(size: FigureSize): { body: THREE.BufferGeometry; trim: THREE.BufferGeometry } {
  const s = FIGURE_HEIGHT[size] / 0.2;
  const body: THREE.BufferGeometry[] = [
    lathe([
      [0, 0],
      [0.07, 0],
      [0.07, 0.025],
      [0.05, 0.035],
      [0.045, 0.1],
      [0.03, 0.13],
      [0, 0.13],
    ]),
  ];
  const trim: THREE.BufferGeometry[] = [
    // Head with a helmet.
    at(new THREE.SphereGeometry(0.035, 7, 5), 0, 0.155, 0),
    at(new THREE.ConeGeometry(0.038, 0.04, 7), 0, 0.19, 0),
    // Sword at the side.
    at(new THREE.BoxGeometry(0.012, 0.11, 0.02), 0.055, 0.08, 0.01),
  ];
  if (size >= 2)
    body.push(at(new THREE.CylinderGeometry(0.045, 0.035, 0.012, 6), 0, 0.07, 0.05, Math.PI / 2));
  if (size === 5) {
    trim.push(at(new THREE.CylinderGeometry(0.006, 0.006, 0.26, 4), -0.06, 0.13, -0.01));
    body.push(at(new THREE.BoxGeometry(0.006, 0.05, 0.075), -0.06, 0.23, -0.05));
    body.push(at(new THREE.ConeGeometry(0.014, 0.05, 5), 0, 0.225, 0, -0.4));
  }
  const merge = (parts: THREE.BufferGeometry[]) => {
    const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
    g.scale(s, s, s);
    g.computeVertexNormals();
    return g;
  };
  return { body: merge(body), trim: merge(trim) };
}

const knightGeometries = new Map<FigureSize, ReturnType<typeof knightParts>>();

/** A knight figure for `player`, standing on y = 0 and facing +z. */
export function knightFigure(size: FigureSize, player: number): THREE.Group {
  let parts = knightGeometries.get(size);
  if (!parts) knightGeometries.set(size, (parts = knightParts(size)));
  const g = new THREE.Group();
  const body = new THREE.Mesh(parts.body, playerMaterial(player));
  const trim = new THREE.Mesh(parts.trim, MATERIALS.metal);
  for (const m of [body, trim]) {
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

// --- Board pieces ------------------------------------------------------------

const coinGeometry = new THREE.CylinderGeometry(0.25, 0.27, 0.06, 14);
const coinFaceGeometry = new THREE.CylinderGeometry(0.19, 0.19, 0.065, 14);
const dotGeometry = new THREE.CylinderGeometry(0.028, 0.028, 0.02, 6);

/** A path marker: a gold coin with a raised face. */
export function marker(): THREE.Group {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(coinGeometry, MATERIALS.coinRim);
  rim.position.y = 0.03;
  const face = new THREE.Mesh(coinFaceGeometry, MATERIALS.gold);
  face.position.y = 0.035;
  for (const m of [rim, face]) {
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

export function dot(): THREE.Mesh {
  const m = new THREE.Mesh(dotGeometry, MATERIALS.dot);
  m.receiveShadow = true;
  return m;
}

const arrowShape = new THREE.Shape([
  new THREE.Vector2(0, 0.08),
  new THREE.Vector2(0.06, -0.04),
  new THREE.Vector2(0, -0.01),
  new THREE.Vector2(-0.06, -0.04),
]);
const arrowGeometry = new THREE.ShapeGeometry(arrowShape).rotateX(-Math.PI / 2);

/** A castle entrance arrowhead lying flat, pointing along +z. */
export function entranceArrow(): THREE.Mesh {
  const g = arrowGeometry.clone();
  // ShapeGeometry points along −z after the rotation; turn it to +z.
  g.rotateY(Math.PI);
  const m = new THREE.Mesh(g, MATERIALS.dot);
  return m;
}

const shieldShape = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0.5);
  s.lineTo(0.5, 0.5);
  s.lineTo(0.5, 0.05);
  s.quadraticCurveTo(0.45, -0.4, 0, -0.6);
  s.quadraticCurveTo(-0.45, -0.4, -0.5, 0.05);
  s.closePath();
  return s;
})();

const shieldBody = new THREE.ExtrudeGeometry(shieldShape, {
  depth: 0.12,
  bevelEnabled: false,
  curveSegments: 4,
}).translate(0, 0, -0.06);

/** A start area: a parchment scroll with `number` coats of arms and the number. */
export function startArea(number: number, width: number, depth: number): THREE.Group {
  const g = new THREE.Group();
  const sheet = new THREE.Mesh(new THREE.BoxGeometry(width, 0.04, depth), MATERIALS.parchment);
  sheet.position.y = 0.02;
  sheet.receiveShadow = true;
  g.add(sheet);
  for (const side of [-1, 1]) {
    const roll = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, depth + 0.06, 8).rotateX(Math.PI / 2),
      MATERIALS.parchment,
    );
    roll.position.set((side * width) / 2, 0.045, 0);
    roll.castShadow = true;
    g.add(roll);
  }
  // The die number, painted on the scroll.
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: textTexture(String(number), { colour: '#7a1c16', size: 190, weight: 800 }),
      transparent: true,
      depthWrite: false,
    }),
  );
  label.position.set(0, 0.042, depth / 2 - 0.13);
  g.add(label);
  // Little shields along the back edge, one per pip, in rows of three.
  for (let i = 0; i < number; i++) {
    const shield = new THREE.Mesh(shieldBody, MATERIALS.roof);
    shield.scale.setScalar(0.07);
    shield.rotation.x = -Math.PI / 2;
    const row = Math.floor(i / 3);
    const inRow = Math.min(3, number - row * 3);
    shield.position.set(((i % 3) - (inRow - 1) / 2) * 0.1, 0.05, -depth / 2 + 0.07 + row * 0.08);
    g.add(shield);
  }
  return g;
}

/**
 * A castle of `value` swords: rocky base, curtain wall, a keep and one
 * corner tower per sword, a banner on the keep. Faces +z (its entrance).
 * `group.userData.banner` is the banner mesh to recolour for the owner.
 */
export function castle(value: number): THREE.Group {
  const g = new THREE.Group();
  const shadow = (m: THREE.Mesh) => {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const base = shadow(
    new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 0.14, 7), MATERIALS.rock),
  );
  base.position.y = 0.05;

  // Courtyard floor where the garrison stands, in front.
  const yard = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.62), MATERIALS.darkStone));
  yard.position.set(0, 0.13, 0);

  // Back wall and side walls (the front stays open so figures are visible).
  const wallH = 0.16;
  const walls: [number, number, number, number][] = [
    [0, -0.29, 0.62, 0.06],
    [-0.29, -0.06, 0.06, 0.5],
    [0.29, -0.06, 0.06, 0.5],
  ];
  for (const [x, z, w, d] of walls) {
    const wall = shadow(new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), MATERIALS.stone));
    wall.position.set(x, 0.15 + wallH / 2, z);
  }

  // Keep at the back with a pointed roof.
  const keepH = 0.32 + value * 0.1;
  const keep = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.24, keepH, 0.2), MATERIALS.stone));
  keep.position.set(0, 0.15 + keepH / 2, -0.2);
  const roof = shadow(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.22, 4), MATERIALS.roof));
  roof.rotation.y = Math.PI / 4;
  roof.position.set(0, 0.15 + keepH + 0.11, -0.2);

  // Corner towers, one per sword.
  const corners: [number, number][] = [
    [-0.29, -0.29],
    [0.29, -0.29],
    [-0.29, 0.2],
  ];
  for (const [x, z] of corners.slice(0, value)) {
    const h = 0.3;
    const tower = shadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, h, 7), MATERIALS.stone),
    );
    tower.position.set(x, 0.15 + h / 2, z);
    const cap = shadow(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.16, 7), MATERIALS.roof));
    cap.position.set(x, 0.15 + h + 0.08, z);
  }

  // Banner on a pole on top of the roof.
  const poleTop = 0.15 + keepH + 0.22 + 0.22;
  const pole = shadow(
    new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 4), MATERIALS.wood),
  );
  pole.position.set(0, poleTop - 0.13, -0.2);
  const banner = shadow(
    new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.01), playerMaterial(null)),
  );
  banner.position.set(0.085, poleTop - 0.06, -0.2);
  g.userData.banner = banner;
  return g;
}

/** Height of the courtyard floor the garrison stands on. */
export const YARD_Y = 0.15;

const swordGeometry = (() => {
  const blade = new THREE.BoxGeometry(0.03, 0.22, 0.008).translate(0, 0.11, 0);
  const guard = new THREE.BoxGeometry(0.1, 0.02, 0.02).translate(0, 0.0, 0);
  const grip = new THREE.BoxGeometry(0.018, 0.06, 0.018).translate(0, -0.035, 0);
  const pommel = new THREE.SphereGeometry(0.016, 5, 4).translate(0, -0.07, 0);
  const parts = [blade, guard, grip, pommel].map((p) => p.toNonIndexed());
  const g = mergeGeometries(parts)!;
  // Point down, planted in the ground.
  g.rotateZ(Math.PI);
  g.computeVertexNormals();
  return g;
})();

/** The castle's swords: `value` swords planted in a row, hilts up. */
export function swords(value: number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < value; i++) {
    const s = new THREE.Mesh(swordGeometry, MATERIALS.metal);
    s.castShadow = true;
    s.position.set((i - (value - 1) / 2) * 0.09, 0.18, 0);
    s.rotation.z = (i - (value - 1) / 2) * 0.25;
    g.add(s);
  }
  return g;
}

// --- Shields -------------------------------------------------------------------

/**
 * A defender shield standing upright, facing +z: the owner's colour on the
 * back side, a white face with its value when shown. `value` is `null` when the
 * viewer may not see it; a face-down shield the viewer owns shows "(value)".
 */
export function shieldToken(owner: number, value: number | null, revealed: boolean): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(shieldBody, revealed ? MATERIALS.parchment : playerMaterial(owner));
  body.castShadow = true;
  g.add(body);
  const text = revealed ? String(value ?? '?') : value === null ? '?' : `(${value})`;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.9),
    new THREE.MeshBasicMaterial({
      map: textTexture(text, {
        colour: revealed ? '#222' : '#fff',
        size: 150,
        weight: revealed ? 800 : 700,
      }),
      transparent: true,
      depthWrite: false,
    }),
  );
  face.position.set(0, -0.02, 0.065);
  g.add(face);
  g.scale.setScalar(0.22);
  return g;
}

// --- Labels ----------------------------------------------------------------

const textures = new Map<string, THREE.CanvasTexture>();

interface TextStyle {
  colour?: string;
  size?: number;
  weight?: number;
  background?: string;
  outline?: string;
}

/** A square canvas texture with centred text, cached by content and style. */
export function textTexture(text: string, style: TextStyle = {}): THREE.CanvasTexture {
  const key = JSON.stringify([text, style]);
  let t = textures.get(key);
  if (t) return t;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  if (style.background) {
    ctx.fillStyle = style.background;
    ctx.beginPath();
    ctx.arc(128, 128, 118, 0, Math.PI * 2);
    ctx.fill();
    if (style.outline) {
      ctx.lineWidth = 14;
      ctx.strokeStyle = style.outline;
      ctx.stroke();
    }
  }
  ctx.font = `${style.weight ?? 700} ${style.size ?? 140}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = style.colour ?? '#fff';
  ctx.fillText(text, 128, 138);
  t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textures.set(key, t);
  return t;
}

/** A round count badge in a player's colour, always facing the camera. */
export function countBadge(count: number, player: number): THREE.Sprite {
  const map = textTexture(String(count), {
    background: playerColour(player),
    outline: '#ffffff',
    size: count > 99 ? 100 : 140,
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: false }));
  s.scale.setScalar(0.17);
  s.renderOrder = 10;
  return s;
}

const labelTextures = new Map<string, { texture: THREE.CanvasTexture; aspect: number }>();

/** Draws a small sword, point up, centred on (x, y), `h` pixels long and tilted by `angle`. */
function drawSword(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, angle: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.translate(0, -h / 2);
  ctx.beginPath(); // blade with a point
  ctx.moveTo(0, 0);
  ctx.lineTo(3, 6);
  ctx.lineTo(3, h * 0.66);
  ctx.lineTo(-3, h * 0.66);
  ctx.lineTo(-3, 6);
  ctx.fill();
  ctx.fillRect(-9, h * 0.66, 18, 4); // guard
  ctx.fillRect(-2, h * 0.66 + 4, 4, h * 0.24); // grip
  ctx.beginPath(); // pommel
  ctx.arc(0, h * 0.95, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * A banner sprite with a castle's name and its swords (castle value), or any
 * other text when `swords` is 0. `height` is in world units.
 */
export function nameLabel(text: string, swords = 0, height = 0.17): THREE.Sprite {
  const key = `${text}|${swords}`;
  let entry = labelTextures.get(key);
  if (!entry) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const font = '600 44px Georgia, "Times New Roman", serif';
    ctx.font = font;
    const swordsWidth = swords ? 14 + swords * 20 : 0;
    const w = Math.ceil(ctx.measureText(text).width) + 40 + swordsWidth;
    canvas.width = w;
    canvas.height = 64;
    ctx.font = font;
    ctx.fillStyle = 'rgba(122, 28, 22, 0.88)';
    ctx.beginPath();
    ctx.roundRect(2, 6, w - 4, 52, 10);
    ctx.fill();
    ctx.fillStyle = '#fff6e0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, (w - swordsWidth) / 2, 34);
    ctx.fillStyle = '#f2d27a';
    for (let i = 0; i < swords; i++)
      drawSword(ctx, w - swordsWidth + 6 + i * 20, 32, 40, i % 2 ? -0.3 : 0.3);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    entry = { texture, aspect: w / 64 };
    labelTextures.set(key, entry);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: entry.texture, depthTest: false }));
  s.scale.set(height * entry.aspect, height, 1);
  s.renderOrder = 9;
  return s;
}

/** A flat floating text sprite, e.g. "Shield 2" over a castle under attack. */
export function popupLabel(text: string, colour: string): THREE.Sprite {
  const s = nameLabel(text, 0, 0.26);
  s.material = s.material.clone();
  s.material.color = new THREE.Color(colour);
  return s;
}

// --- Die -----------------------------------------------------------------------

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.27, 0.27],
    [0.73, 0.73],
  ],
  3: [
    [0.27, 0.27],
    [0.5, 0.5],
    [0.73, 0.73],
  ],
  4: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  5: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.5, 0.5],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  6: [
    [0.27, 0.25],
    [0.73, 0.25],
    [0.27, 0.5],
    [0.73, 0.5],
    [0.27, 0.75],
    [0.73, 0.75],
  ],
};

function dieFace(value: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fbf7ee';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = value === 1 ? '#b3261e' : '#222';
  for (const [x, y] of PIPS[value]!) {
    ctx.beginPath();
    ctx.arc(x * 128, y * 128, value === 1 ? 17 : 12, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A die whose faces follow {@link FACE_VALUES}. */
export function die(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const materials = FACE_VALUES.map(
    (v) => new THREE.MeshStandardMaterial({ map: dieFace(v), roughness: 0.5 }),
  );
  return new THREE.Mesh(geometry, materials);
}

// --- Highlights ----------------------------------------------------------------

const ringGeometries = new Map<number, THREE.RingGeometry>();

/** A flat glowing ring of outer radius `r`, lying on the ground. */
export function ring(r: number, colour: string, width = 0.05): THREE.Mesh {
  const key = Math.round(r * 1000) * 1000 + Math.round(width * 1000);
  let geometry = ringGeometries.get(key);
  if (!geometry)
    ringGeometries.set(
      key,
      (geometry = new THREE.RingGeometry(r - width, r, 32).rotateX(-Math.PI / 2)),
    );
  const m = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  m.renderOrder = 5;
  return m;
}
