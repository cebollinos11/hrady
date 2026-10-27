import * as THREE from 'three';
import { FACE_VALUES } from './dice';

/** The three.js model of the die the dice canvas shows. */

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
