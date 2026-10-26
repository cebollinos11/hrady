import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clampToBoard, type Layout, type Point } from './layout';

/**
 * Camera presets: `overview` looks almost straight down at the whole board,
 * `table` is the view of a player sitting at the board's edge, `focus` zooms
 * in on a point or fits a group of points. Overview and table look from the
 * same side: in a landscape window the river runs left to right, in a
 * portrait one top to bottom.
 */
export type Preset = 'overview' | 'table' | 'focus';

const FOV = 40;
/** Distance of the focus preset on a single point. */
const FOCUS_RADIUS = 4.2;
/** Width of the wooden frame around the board. */
const FRAME = 0.22;
const MIN_POLAR = 0.05;
const MAX_POLAR = 1.25;

interface Pose {
  target: THREE.Vector3;
  radius: number;
  polar: number;
  azimuth: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Shortest turn from angle `a` to `b`. */
const turn = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/**
 * Perspective camera with map-style orbit controls: drag (one finger) pans,
 * right-drag (two fingers) rotates, wheel (pinch) zooms. The target stays
 * over the board and the camera never dips under the horizon.
 */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  readonly controls: OrbitControls;
  private flight: { from: Pose; to: Pose; start: number; duration: number } | null = null;
  /** Preset the camera was last sent to, refitted on resize until the user moves it. */
  private preset: Preset | null = null;
  /** CSS pixels at the top of the view covered by the toolbar, left out when fitting. */
  insetTop = 0;

  constructor(
    private readonly dom: HTMLElement,
    private readonly layout: Layout,
  ) {
    const c = new OrbitControls(this.camera, dom);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.screenSpacePanning = false;
    c.minPolarAngle = MIN_POLAR;
    c.maxPolarAngle = MAX_POLAR;
    c.minDistance = 2.5;
    c.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    c.addEventListener('start', () => {
      this.flight = null;
      this.preset = null;
    });
    this.controls = c;
  }

  get aspect() {
    return this.camera.aspect;
  }

  /** The preset the camera is at, until the user moves it. */
  get current(): Preset | null {
    return this.preset;
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = this.presetPose('overview', []).radius * 1.25;
    if (this.preset && this.preset !== 'focus') this.go(this.preset, [], true);
  }

  private pose(): Pose {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const s = new THREE.Spherical().setFromVector3(offset);
    return {
      target: this.controls.target.clone(),
      radius: s.radius,
      polar: s.phi,
      azimuth: s.theta,
    };
  }

  /** The side the board is seen from: the river runs along the window's long side. */
  private sideAzimuth() {
    return this.camera.aspect > 1.15 ? -Math.PI / 2 : 0;
  }

  /**
   * `pose` moved and pulled back or in until `points` fill the view with a
   * `margin` (in normalised screen units) all round, centred in the part of
   * the view below `insetTop`.
   */
  private fit(pose: Pose, points: readonly THREE.Vector3[], margin: number): Pose {
    const probe = this.camera.clone();
    const ndc = new THREE.Vector3();
    const bounds = (p: Pose) => {
      this.place(probe, p);
      probe.updateMatrixWorld();
      let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const pt of points) {
        ndc.copy(pt).project(probe);
        minX = Math.min(minX, ndc.x);
        maxX = Math.max(maxX, ndc.x);
        minY = Math.min(minY, ndc.y);
        maxY = Math.max(maxY, ndc.y);
      }
      return { minX, maxX, minY, maxY };
    };
    const inset = (2 * this.insetTop) / Math.max(1, this.dom.clientHeight);
    const spanX = 2 - 2 * margin;
    const spanY = spanX - inset;
    const out = { ...pose, target: pose.target.clone() };
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ray = new THREE.Raycaster();
    const hit = new THREE.Vector3();
    for (let round = 0; round < 3; round++) {
      // The smallest distance at which the points fit, by bisection.
      let [lo, hi] = [0.5, 200];
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        const b = bounds({ ...out, radius: mid });
        if (b.maxX - b.minX <= spanX && b.maxY - b.minY <= spanY) hi = mid;
        else lo = mid;
      }
      out.radius = hi;
      // Move the target to the ground point that puts the middle of the points
      // in the middle of the free part of the view.
      const b = bounds(out);
      ray.setFromCamera(
        new THREE.Vector2((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2 + inset / 2),
        probe,
      );
      if (!ray.ray.intersectPlane(ground, hit)) break;
      out.target.copy(hit);
    }
    return out;
  }

  private place(camera: THREE.PerspectiveCamera, p: Pose) {
    const offset = new THREE.Vector3().setFromSpherical(
      new THREE.Spherical(p.radius, p.polar, p.azimuth),
    );
    camera.position.copy(p.target).add(offset);
    camera.lookAt(p.target);
  }

  /** Corners of the board with its frame. */
  private boardCorners(): THREE.Vector3[] {
    const x = this.layout.width / 2 + FRAME;
    const z = this.layout.depth / 2 + FRAME;
    return [
      [-x, -z],
      [x, -z],
      [-x, z],
      [x, z],
    ].map(([a, b]) => new THREE.Vector3(a, 0, b));
  }

  private presetPose(preset: Preset, focus: readonly Point[]): Pose {
    const azimuth = this.sideAzimuth();
    if (preset === 'overview' || preset === 'table') {
      const polar = preset === 'overview' ? 0.3 : 0.85;
      const pose = { target: new THREE.Vector3(), radius: 20, polar, azimuth };
      return this.fit(pose, this.boardCorners(), preset === 'overview' ? 0.03 : 0.02);
    }
    const pts = focus.length ? focus : [{ x: 0, z: 0 }];
    const centre = clampToBoard(this.layout, {
      x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
      z: pts.reduce((a, p) => a + p.z, 0) / pts.length,
    });
    const pose: Pose = {
      target: new THREE.Vector3(centre.x, 0, centre.z),
      radius: FOCUS_RADIUS,
      polar: 0.75,
      azimuth: this.pose().azimuth,
    };
    if (pts.length < 2) return pose;
    // Several points: fit them with room for the pieces and badges standing on them.
    const pad = 0.6;
    const around = pts.flatMap((p) =>
      [
        [-pad, -pad],
        [pad, -pad],
        [-pad, pad],
        [pad, pad],
      ].flatMap(([dx, dz]) => [0, 0.8].map((y) => new THREE.Vector3(p.x + dx!, y, p.z + dz!))),
    );
    const fitted = this.fit(pose, around, 0.08);
    return fitted.radius < FOCUS_RADIUS ? { ...fitted, radius: FOCUS_RADIUS } : fitted;
  }

  /** Flies to a preset (`focus` needs the points to look at). */
  go(preset: Preset, focus: readonly Point[] = [], instant = false) {
    const to = this.presetPose(preset, focus);
    to.radius = Math.min(Math.max(to.radius, this.controls.minDistance), this.controls.maxDistance);
    this.preset = preset;
    if (instant) {
      this.flight = null;
      this.apply(to);
      return;
    }
    this.flight = { from: this.pose(), to, start: performance.now(), duration: 650 };
  }

  private apply(p: Pose) {
    this.controls.target.copy(p.target);
    this.place(this.camera, p);
  }

  update(now: number) {
    if (this.flight) {
      const { from, to, start, duration } = this.flight;
      const t = ease(Math.min(1, (now - start) / duration));
      this.apply({
        target: from.target.clone().lerp(to.target, t),
        radius: lerp(from.radius, to.radius, t),
        polar: lerp(from.polar, to.polar, t),
        azimuth: from.azimuth + turn(from.azimuth, to.azimuth) * t,
      });
      if (t >= 1) this.flight = null;
      return;
    }
    this.controls.update();
    // Keep the target over the board, moving the camera along with it.
    const t = this.controls.target;
    const c = clampToBoard(this.layout, { x: t.x, z: t.z });
    if (c.x !== t.x || c.z !== t.z || t.y !== 0) {
      const delta = new THREE.Vector3(c.x - t.x, -t.y, c.z - t.z);
      t.add(delta);
      this.camera.position.add(delta);
    }
  }
}
