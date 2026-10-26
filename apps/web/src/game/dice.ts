import { Euler, Quaternion, Vector3 } from 'three';

/**
 * Pip values on the faces of the 3D die, in three.js `BoxGeometry` material
 * order (+x, −x, +y, −y, +z, −z). Opposite faces add up to 7.
 */
export const FACE_VALUES = [3, 4, 1, 6, 2, 5] as const;

const FACE_NORMALS = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];

/** Rotation that turns the face showing `value` up. */
const UPRIGHT: Record<number, Euler> = {
  1: new Euler(0, 0, 0),
  6: new Euler(Math.PI, 0, 0),
  3: new Euler(0, 0, Math.PI / 2),
  4: new Euler(0, 0, -Math.PI / 2),
  2: new Euler(-Math.PI / 2, 0, 0),
  5: new Euler(Math.PI / 2, 0, 0),
};

/** Orientation of a die at rest showing `value` on top, turned by `yaw` around the vertical. */
export function restingRotation(value: number, yaw = 0): Quaternion {
  const upright = UPRIGHT[value];
  if (!upright) throw new RangeError(`no die face ${value}`);
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  return turn.multiply(new Quaternion().setFromEuler(upright));
}

/** The value on top of a die with orientation `q`. */
export function topFace(q: Quaternion): number {
  let best = 0;
  let bestY = -Infinity;
  FACE_NORMALS.forEach((n, i) => {
    const y = n.clone().applyQuaternion(q).y;
    if (y > bestY) {
      bestY = y;
      best = FACE_VALUES[i]!;
    }
  });
  return best;
}
