import * as THREE from 'three';
import { restingRotation } from './dice';
import { die } from './models';

/**
 * The 3D die in its own small canvas in the HUD, so it stays in view whatever
 * the board camera does. It only renders while it moves.
 */
export class DieView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private readonly die = die();
  private roll: {
    start: number;
    duration: number;
    from: THREE.Quaternion;
    to: THREE.Quaternion;
    spin: THREE.Vector3;
    resolve: () => void;
  } | null = null;
  private dirty = true;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x666655, 1.6));
    const light = new THREE.DirectionalLight(0xffffff, 1.6);
    light.position.set(2, 4, 3);
    this.scene.add(light);
    this.camera.position.set(0, 3.2, 2.2);
    this.camera.lookAt(0, 0, 0);
    this.die.quaternion.copy(restingRotation(6, 0.5));
    this.scene.add(this.die);
  }

  /** Shows `value` at rest, without rolling. */
  show(value: number) {
    this.roll?.resolve();
    this.roll = null;
    this.die.position.set(0, 0, 0);
    this.die.quaternion.copy(restingRotation(value, 0.4));
    this.dirty = true;
  }

  /** Tumbles the die and lands it on `value`. Resolves when it is at rest. */
  throw(value: number, duration: number): Promise<void> {
    this.roll?.resolve();
    if (duration <= 0) {
      this.show(value);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const r = Math.random;
      this.roll = {
        start: performance.now(),
        duration,
        from: this.die.quaternion.clone(),
        to: restingRotation(value, (r() - 0.5) * 1.2),
        spin: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(),
        resolve,
      };
    });
  }

  update(now: number) {
    const roll = this.roll;
    if (roll) {
      const t = Math.min(1, (now - roll.start) / roll.duration);
      // Spin fast at first, settling into the final face.
      const spin = new THREE.Quaternion().setFromAxisAngle(roll.spin, (1 - t) ** 2 * 14);
      this.die.quaternion.copy(roll.to).premultiply(spin);
      // Bounces that die down.
      this.die.position.y = Math.abs(Math.sin(t * Math.PI * 3)) * (1 - t) * 0.9;
      this.dirty = true;
      if (t >= 1) {
        this.die.quaternion.copy(roll.to);
        this.die.position.y = 0;
        this.roll = null;
        roll.resolve();
      }
    }
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
      this.dirty = true;
    }
    if (this.dirty && w > 0) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
  }
}
