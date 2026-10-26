import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clampToBoard, fitDistance, type Layout, type Point } from './layout';

/**
 * Camera presets: `overview` looks almost straight down at the whole board
 * (turned so its long side follows the screen's long side), `table` is the
 * view of a player sitting at the bottom edge, `focus` zooms in on a point.
 */
export type Preset = 'overview' | 'table' | 'focus';

const FOV = 40;
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

  constructor(
    dom: HTMLElement,
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

  resize(width: number, height: number) {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    const { width: w, depth: d } = this.layout;
    this.controls.maxDistance = fitDistance(w, d, FOV, Math.min(1, this.camera.aspect)) * 1.4;
    if (this.preset && this.preset !== 'focus') this.go(this.preset, null, true);
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

  private presetPose(preset: Preset, focus: Point | null): Pose {
    const { width, depth } = this.layout;
    const landscape = this.camera.aspect > 1.15;
    if (preset === 'overview') {
      // In landscape the board is turned so the river flows left to right.
      const [w, d] = landscape ? [depth, width] : [width, depth];
      return {
        target: new THREE.Vector3(0, 0, 0),
        radius: fitDistance(w * 1.08, d * 1.12, FOV, this.camera.aspect),
        polar: 0.3,
        azimuth: landscape ? -Math.PI / 2 : 0,
      };
    }
    if (preset === 'table') {
      const polar = 0.85;
      // Seen at an angle the board's depth shrinks; fit its width and most of its depth.
      return {
        target: new THREE.Vector3(0, 0, depth * 0.06),
        radius: fitDistance(width * 1.18, depth * 0.78, FOV, this.camera.aspect),
        polar,
        azimuth: 0,
      };
    }
    const p = clampToBoard(this.layout, focus ?? { x: 0, z: 0 });
    return {
      target: new THREE.Vector3(p.x, 0, p.z),
      radius: 4.2,
      polar: 0.75,
      azimuth: this.pose().azimuth,
    };
  }

  /** Flies to a preset (`focus` needs the point to look at). */
  go(preset: Preset, focus: Point | null = null, instant = false) {
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
    const offset = new THREE.Vector3().setFromSpherical(
      new THREE.Spherical(p.radius, p.polar, p.azimuth),
    );
    this.camera.position.copy(p.target).add(offset);
    this.camera.lookAt(p.target);
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
