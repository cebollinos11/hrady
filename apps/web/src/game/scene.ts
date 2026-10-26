import type { Board } from '@hrady/board';
import type { CastleView, PlayerId } from '@hrady/engine';
import * as THREE from 'three';
import type { Marks } from '../shared/marks';
import { CameraRig } from './camera';
import { arrange, compose, startSlots } from './figures';
import {
  START_SIZE,
  WATER_Y,
  buildLayout,
  nodeRadius,
  type Layout,
  type NodeLayout,
  type Point,
} from './layout';
import {
  FIGURE_HEIGHT,
  MATERIALS,
  YARD_Y,
  castle,
  countBadge,
  dot,
  entranceArrow,
  knightFigure,
  marker,
  minPixels,
  nameLabel,
  playerColour,
  playerMaterial,
  popupLabel,
  ring,
  shieldToken,
  startArea,
  swords,
  textTexture,
} from './models';
import type { Trail } from './recent';
import type { Knights } from './steps';
import { groundColour, heightAt } from './terrain';

/** Castles are modelled about 0.5 units wide and scaled to fit between markers. */
const CASTLE_SCALE = 0.78;
/** Top of a marker coin, where figures stand. */
const COIN_TOP = 0.065;
const START_TOP = 0.04;

interface Tween {
  start: number;
  duration: number;
  update: (t: number) => void;
  resolve: () => void;
}

const HIGHLIGHT = {
  selectable: '#ffffff',
  selected: '#fff27a',
  move: '#4ee06a',
  castle: '#ff9a2e',
  field: '#ff4b3e',
  source: '#5aa8ff',
  shield: '#ffd34a',
};

const rotate = (p: Point, angle: number): Point => ({
  x: p.x * Math.cos(angle) + p.z * Math.sin(angle),
  z: -p.x * Math.sin(angle) + p.z * Math.cos(angle),
});

/**
 * The three.js board: terrain, river, markers, start areas and castles built
 * from the graph, the pieces of a game view on it, highlights, picking and
 * the small animations the animator strings together.
 */
export class BoardScene {
  readonly layout: Layout;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  private readonly pickables: THREE.Mesh[] = [];
  private readonly stacks = new Map<string, { key: string; group: THREE.Group }>();
  private readonly shields = new Map<string, { key: string; group: THREE.Group }>();
  private readonly banners = new Map<string, THREE.Mesh>();
  private readonly roofs = new Map<string, THREE.Mesh[]>();
  /** A ring round each castle's foot in its owner's colour, hidden while neutral. */
  private readonly ownerRings = new Map<string, THREE.Mesh>();
  private readonly labels = new THREE.Group();
  private readonly highlights = new THREE.Group();
  private readonly effects = new THREE.Group();
  private readonly trails = new THREE.Group();
  private readonly pings = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private tweens: Tween[] = [];
  private knights: Knights = {};

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly board: Board,
  ) {
    this.layout = buildLayout(board);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.rig = new CameraRig(canvas, this.layout);

    const sky = new THREE.Color('#a9c9dc');
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 30, 60);
    this.addLights();
    this.addTerrain();
    this.addBoardPieces();
    this.scene.add(this.labels, this.highlights, this.effects, this.trails, this.pings);
  }

  // --- Static board ---------------------------------------------------------

  private addLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff4dd, 0x3a5a2a, 1.3));
    const sun = new THREE.DirectionalLight(0xfff6e8, 2.2);
    sun.position.set(-5, 12, 6);
    sun.castShadow = true;
    const half = Math.max(this.layout.width, this.layout.depth) / 2 + 0.5;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
  }

  private addTerrain() {
    const { width, depth } = this.layout;
    const seg = 0.1;
    const plane = new THREE.PlaneGeometry(
      width,
      depth,
      Math.round(width / seg),
      Math.round(depth / seg),
    ).rotateX(-Math.PI / 2);
    const pos = plane.attributes.position!;
    for (let i = 0; i < pos.count; i++)
      pos.setY(i, heightAt(this.layout, { x: pos.getX(i), z: pos.getZ(i) }));
    // Faceted look: every triangle gets its own colour from height and slope.
    const geometry = plane.toNonIndexed();
    geometry.computeVertexNormals();
    const p = geometry.attributes.position!;
    const n = geometry.attributes.normal!;
    const colours = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i += 3) {
      const h = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
      const slope = 1 - n.getY(i);
      const [r, g, b] = groundColour(h, slope * 3);
      const jitter = 0.97 + ((i * 7919) % 13) / 200;
      for (let k = 0; k < 3; k++) colours.set([r * jitter, g * jitter, b * jitter], (i + k) * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    const terrain = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
    );
    terrain.receiveShadow = true;
    terrain.castShadow = true;
    this.scene.add(terrain);

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2),
      MATERIALS.water,
    );
    water.position.y = WATER_Y;
    water.receiveShadow = true;
    this.scene.add(water);

    // A wooden frame around the board and a table under it.
    const t = 0.22;
    const frame: [number, number, number, number][] = [
      [0, -depth / 2 - t / 2, width + 2 * t, t],
      [0, depth / 2 + t / 2, width + 2 * t, t],
      [-width / 2 - t / 2, 0, t, depth],
      [width / 2 + t / 2, 0, t, depth],
    ];
    for (const [x, z, w, d] of frame) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, d), MATERIALS.wood);
      m.position.set(x, -0.25, z);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#5b4632', roughness: 1 }),
    );
    table.position.y = -0.6;
    table.receiveShadow = true;
    this.scene.add(table);
  }

  private addBoardPieces() {
    for (const edge of this.layout.edges) {
      for (const p of edge.dots) {
        const d = dot();
        d.position.set(p.x, Math.max(heightAt(this.layout, p), WATER_Y) + 0.012, p.z);
        this.scene.add(d);
      }
    }
    for (const e of this.layout.entrances) {
      const arrow = entranceArrow();
      arrow.position.set(e.pos.x, 0.012, e.pos.z);
      arrow.rotation.y = e.angle;
      this.scene.add(arrow);
    }
    for (const n of this.layout.nodes.values()) {
      const { node, pos } = n;
      let piece: THREE.Object3D;
      if (node.type === 'path') piece = marker();
      else if (node.type === 'start')
        piece = startArea(node.number, START_SIZE.width, START_SIZE.depth);
      else {
        const c = castle(node.value);
        c.scale.setScalar(CASTLE_SCALE);
        c.rotation.y = n.facing;
        const sw = swords(node.value);
        sw.position.set(-0.3, 0.12, 0.33);
        sw.rotation.y = 0.5;
        sw.scale.setScalar(1.25);
        c.add(sw);
        this.banners.set(node.id, c.userData.banner as THREE.Mesh);
        this.roofs.set(node.id, c.userData.roofs as THREE.Mesh[]);
        piece = c;
        const owner = ring(0.5, '#ffffff', 0.09);
        (owner.material as THREE.MeshBasicMaterial).opacity = 1;
        owner.position.set(pos.x, 0.025, pos.z);
        owner.visible = false;
        this.ownerRings.set(node.id, owner);
        this.scene.add(owner);
        const label = nameLabel(node.name, node.value, 0.14);
        label.position.set(pos.x, 1.05, pos.z);
        minPixels(label, 17);
        this.labels.add(label);
      }
      piece.position.set(pos.x, 0, pos.z);
      this.scene.add(piece);

      // An invisible cylinder per node for picking, a bit larger than the piece.
      const r = nodeRadius(node) + 0.06;
      const height = node.type === 'castle' ? 1.1 : 0.5;
      const pick = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, height, 12),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      pick.position.set(pos.x, height / 2, pos.z);
      pick.userData.id = node.id;
      this.pickables.push(pick);
      this.scene.add(pick);
    }
  }

  setLabels(visible: boolean) {
    this.labels.visible = visible;
  }

  // --- Positions --------------------------------------------------------------

  private node(id: string): NodeLayout {
    const n = this.layout.nodes.get(id);
    if (!n) throw new Error(`unknown node ${id}`);
    return n;
  }

  /** Where `player`'s knights stand on a node, given the knights there. */
  standPoint(id: string, player: PlayerId, knights: Knights = this.knights): THREE.Vector3 {
    const n = this.node(id);
    const { pos } = n;
    if (n.node.type === 'path') return new THREE.Vector3(pos.x, COIN_TOP, pos.z);
    if (n.node.type === 'start') {
      const present = (knights[id] ?? []).flatMap((c, p) => (c > 0 || p === player ? [p] : []));
      const slot = startSlots(present, START_SIZE.width).get(player) ?? { x: 0, z: 0 };
      return new THREE.Vector3(pos.x + slot.x, START_TOP, pos.z + slot.z);
    }
    const yard = rotate({ x: 0, z: 0.08 * CASTLE_SCALE }, n.facing);
    return new THREE.Vector3(pos.x + yard.x, YARD_Y * CASTLE_SCALE, pos.z + yard.z);
  }

  /** Figures, arranged, for `count` knights of `player`, with a count badge on top. */
  private figures(player: PlayerId, count: number, spacing: number, badge = true): THREE.Group {
    const g = new THREE.Group();
    let top = 0;
    for (const f of arrange(compose(count), spacing)) {
      const k = knightFigure(f.size, player);
      k.position.set(f.x, 0, f.z);
      g.add(k);
      top = Math.max(top, FIGURE_HEIGHT[f.size]);
    }
    if (badge) {
      const b = countBadge(count, player);
      b.position.y = top + 0.13;
      g.add(b);
    }
    return g;
  }

  private spacingFor(id: string, players: number): number {
    const type = this.node(id).node.type;
    if (type === 'start') return players > 2 ? 0.1 : 0.13;
    if (type === 'castle') return 0.13;
    return 0.17;
  }

  // --- Pieces ---------------------------------------------------------------

  /** Shows the knights per node, rebuilding only the stacks that changed. */
  showKnights(knights: Knights) {
    this.knights = knights;
    const seen = new Set<string>();
    for (const [id, counts] of Object.entries(knights)) {
      if (!counts.some((c) => c > 0) || !this.layout.nodes.has(id)) continue;
      seen.add(id);
      const key = counts.join(',');
      const old = this.stacks.get(id);
      if (old?.key === key) continue;
      if (old) this.scene.remove(old.group);
      const group = new THREE.Group();
      const present = counts.filter((c) => c > 0).length;
      counts.forEach((c, p) => {
        if (!c) return;
        const g = this.figures(p, c, this.spacingFor(id, present));
        g.position.copy(this.standPoint(id, p, knights));
        const n = this.node(id);
        if (n.node.type === 'castle') g.rotation.y = n.facing;
        group.add(g);
      });
      this.stacks.set(id, { key, group });
      this.scene.add(group);
    }
    for (const [id, { group }] of this.stacks)
      if (!seen.has(id)) {
        this.scene.remove(group);
        this.stacks.delete(id);
      }
  }

  /** Castle banners and shields as `castles` shows them. */
  showCastles(castles: Record<string, CastleView>) {
    for (const [id, view] of Object.entries(castles)) {
      const banner = this.banners.get(id);
      if (banner) banner.material = playerMaterial(view.owner);
      for (const roof of this.roofs.get(id) ?? [])
        roof.material = view.owner === null ? MATERIALS.roof : playerMaterial(view.owner);
      const owner = this.ownerRings.get(id);
      if (owner) {
        owner.visible = view.owner !== null;
        (owner.material as THREE.MeshBasicMaterial).color.set(playerColour(view.owner));
      }
      const shield = view.shield;
      const key = shield ? `${view.owner}:${shield.value}:${shield.revealed}` : '';
      const old = this.shields.get(id);
      if (old?.key === key) continue;
      if (old) this.scene.remove(old.group);
      this.shields.delete(id);
      if (!shield || view.owner === null) continue;
      const group = shieldToken(view.owner, shield.value, shield.revealed);
      group.position.copy(this.shieldPoint(id));
      group.rotation.y = this.node(id).facing;
      this.shields.set(id, { key, group });
      this.scene.add(group);
    }
  }

  private shieldPoint(id: string): THREE.Vector3 {
    const n = this.node(id);
    const off = rotate({ x: 0.27, z: 0.27 }, n.facing);
    return new THREE.Vector3(n.pos.x + off.x, 0.2, n.pos.z + off.z);
  }

  // --- Highlights -------------------------------------------------------------

  showMarks(marks: Marks) {
    this.highlights.clear();
    const add = (id: string, colour: string, width = 0.045, pulse = false, scale = 1) => {
      const n = this.layout.nodes.get(id);
      if (!n) return;
      const r = (n.node.type === 'path' ? 0.34 : n.node.type === 'start' ? 0.46 : 0.5) * scale;
      const m = ring(r, colour, width);
      m.position.set(n.pos.x, 0.09, n.pos.z);
      m.userData.pulse = pulse;
      this.highlights.add(m);
    };
    for (const id of marks.selectable)
      if (id !== marks.selected) add(id, HIGHLIGHT.selectable, 0.03);
    if (marks.selected) add(marks.selected, HIGHLIGHT.selected, 0.07);
    for (const id of marks.moves) add(id, HIGHLIGHT.move, 0.06, true);
    for (const id of marks.castles) add(id, HIGHLIGHT.castle, 0.07, true);
    // Targets more than one step away say how many movement points they take.
    for (const [id, cost] of marks.costs) {
      const n = this.layout.nodes.get(id);
      if (!n || cost < 2) continue;
      const colour = marks.castles.has(id) ? HIGHLIGHT.castle : HIGHLIGHT.move;
      const tag = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: textTexture(String(cost), { background: '#1d2a1f', outline: colour, size: 150 }),
          depthTest: false,
        }),
      );
      tag.scale.setScalar(0.16);
      minPixels(tag, 16);
      tag.renderOrder = 11;
      const r = n.node.type === 'castle' ? 0.45 : 0.3;
      tag.position.set(n.pos.x + r * 0.75, 0.2, n.pos.z + r * 0.75);
      this.highlights.add(tag);
    }
    for (const id of marks.fields) add(id, HIGHLIGHT.field, 0.06, true);
    if (marks.target) add(marks.target, HIGHLIGHT.field, 0.09, true, 1.1);
    for (const [id, count] of marks.sources)
      add(id, HIGHLIGHT.source, count ? 0.08 : 0.035, !count);
    if (marks.shield) add(marks.shield, HIGHLIGHT.shield, 0.08, true, 1.15);
  }

  /** Arrows for what the other players did since the viewer's last turn. */
  showTrails(trails: readonly Trail[]) {
    this.trails.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite)
        (o.material as THREE.Material).dispose();
    });
    this.trails.clear();
    for (const t of trails) {
      if (!this.layout.nodes.has(t.from) || !this.layout.nodes.has(t.to)) continue;
      const a = this.standPoint(t.from, t.player);
      const b = this.standPoint(t.to, t.player);
      // Stop short of the target so the arrow head stays visible next to it.
      const end = a.clone().lerp(b, t.kind === 'lost' ? 0.6 : 0.82);
      a.lerp(b, 0.12);
      const lift = 0.25 + a.distanceTo(end) * 0.15;
      const mid = a
        .clone()
        .lerp(end, 0.5)
        .setY(Math.max(a.y, end.y) + lift);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, end);
      const material = new THREE.MeshBasicMaterial({
        color: playerColour(t.player),
        transparent: true,
        opacity: t.kind === 'move' ? 0.7 : 0.9,
        depthWrite: false,
      });
      const width = t.kind === 'move' ? 0.022 : 0.035;
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, width, 5), material);
      const head = new THREE.Mesh(new THREE.ConeGeometry(width * 3.2, width * 7, 8), material);
      head.position.copy(end);
      head.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        curve.getTangent(1).normalize(),
      );
      this.trails.add(tube, head);
      if (t.kind === 'lost') {
        const cross = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: textTexture('✕', { colour: '#ff6b5e', size: 170, weight: 900 }),
            depthTest: false,
          }),
        );
        cross.scale.setScalar(0.3);
        cross.position.copy(end).setY(end.y + 0.12);
        cross.renderOrder = 8;
        this.trails.add(cross);
      }
    }
  }

  setTrailsVisible(visible: boolean) {
    this.trails.visible = visible;
  }

  /** Pulsing white rings on some nodes, e.g. those of the log entry under the mouse. */
  showPings(ids: readonly string[]) {
    this.pings.clear();
    for (const id of ids) {
      const n = this.layout.nodes.get(id);
      if (!n) continue;
      const r = n.node.type === 'path' ? 0.4 : 0.56;
      const m = ring(r, '#ffffff', 0.08);
      m.position.set(n.pos.x, 0.1, n.pos.z);
      m.userData.pulse = true;
      this.pings.add(m);
    }
  }

  // --- Picking ----------------------------------------------------------------

  /** The node under a point of the canvas (client coordinates), if any. */
  pick(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    return (hit?.object.userData.id as string | undefined) ?? null;
  }

  /** Screen position (client coordinates) of a node, for tooltips. */
  screenPoint(id: string): { x: number; y: number } {
    const n = this.node(id);
    const v = new THREE.Vector3(n.pos.x, 0.4, n.pos.z).project(this.rig.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
    };
  }

  /** World position of a node on the ground. */
  nodePoint(id: string): Point {
    return this.node(id).pos;
  }

  // --- Animation primitives ------------------------------------------------------

  /** Runs `update(t)` with t from 0 to 1 over `duration` ms. */
  tween(duration: number, update: (t: number) => void): Promise<void> {
    if (duration <= 0) {
      update(1);
      return Promise.resolve();
    }
    return new Promise((resolve) =>
      this.tweens.push({ start: performance.now(), duration, update, resolve }),
    );
  }

  /** Ends every running tween at once. */
  finishTweens() {
    const tweens = this.tweens;
    this.tweens = [];
    for (const t of tweens) {
      t.update(1);
      t.resolve();
    }
  }

  /**
   * `count` knights of `player` walking from one node to another in a hop.
   * With `back`, they lunge towards the target and return (a castle attack).
   */
  async travel(
    player: PlayerId,
    from: string,
    to: string,
    count: number,
    duration: number,
    back = false,
  ) {
    const g = this.figures(player, count, 0.15);
    const a = this.standPoint(from, player);
    const b = this.standPoint(to, player);
    if (back) b.lerp(a, 0.45);
    const dir = new THREE.Vector3().subVectors(b, a);
    g.rotation.y = Math.atan2(dir.x, dir.z);
    g.position.copy(a);
    this.effects.add(g);
    await this.tween(duration, (t) => {
      const s = back ? Math.sin(t * Math.PI) : t * t * (3 - 2 * t);
      g.position.lerpVectors(a, b, s);
      g.position.y += Math.sin((back ? s : t) * Math.PI) * 0.35;
    });
    this.effects.remove(g);
  }

  /** A flash of light and a ring that grows out of a node. */
  async burst(id: string, colour: string, duration: number) {
    const n = this.node(id);
    const m = ring(0.4, colour, 0.12);
    m.position.set(n.pos.x, 0.12, n.pos.z);
    const light = new THREE.PointLight(colour, 0, 3);
    light.position.set(n.pos.x, 0.8, n.pos.z);
    this.effects.add(m, light);
    const material = m.material as THREE.MeshBasicMaterial;
    await this.tween(duration, (t) => {
      m.scale.setScalar(0.6 + t * 1.4);
      material.opacity = 1 - t;
      light.intensity = Math.sin(t * Math.PI) * 6;
    });
    this.effects.remove(m, light);
  }

  /** Text rising over a node, e.g. a revealed shield. */
  async popup(id: string, text: string, colour: string, duration: number) {
    const n = this.node(id);
    const s = popupLabel(text, colour);
    const y = n.node.type === 'castle' ? 1.2 : 0.75;
    this.effects.add(s);
    await this.tween(duration, (t) => {
      s.position.set(n.pos.x, y + t * 0.35, n.pos.z);
      s.material.opacity = t < 0.8 ? 1 : (1 - t) * 5;
    });
    this.effects.remove(s);
  }

  /** The stack of `player` on a node drops in from above (a new knight). */
  async drop(id: string, player: PlayerId, duration: number) {
    const stack = this.stacks.get(id)?.group;
    const present = (this.knights[id] ?? []).slice(0, player).filter((c) => c > 0).length;
    const g = stack?.children[present];
    if (!g) return;
    const y = g.position.y;
    await this.tween(duration, (t) => {
      g.position.y = y + (1 - t * t) * 1.2;
    });
    g.position.y = y;
  }

  /** A shield in the owner's colour falling onto a castle. */
  async dropShield(castleId: string, player: PlayerId, duration: number) {
    const g = shieldToken(player, null, false);
    const at = this.shieldPoint(castleId);
    g.rotation.y = this.node(castleId).facing;
    this.effects.add(g);
    await this.tween(duration, (t) => {
      g.position.set(at.x, at.y + (1 - t * t) * 1.5, at.z);
    });
    this.effects.remove(g);
  }

  /** Colour used for a player in effects. */
  colour(player: PlayerId | null) {
    return playerColour(player);
  }

  // --- Frame loop ------------------------------------------------------------

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
  }

  render(now: number) {
    const running = this.tweens;
    this.tweens = [];
    for (const t of running) {
      const p = Math.min(1, (now - t.start) / t.duration);
      t.update(p);
      if (p < 1) this.tweens.push(t);
      else t.resolve();
    }
    const pulse = 0.55 + 0.4 * Math.sin(now / 160);
    for (const m of [...this.highlights.children, ...this.pings.children] as THREE.Mesh[])
      if (m.userData.pulse) (m.material as THREE.MeshBasicMaterial).opacity = pulse;
    this.rig.update(now);
    this.sizeSprites();
    this.renderer.render(this.scene, this.rig.camera);
  }

  /** Scales up sprites marked with `minPixels` that would be smaller than that on screen. */
  private sizeSprites() {
    const camera = this.rig.camera;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    // World height of one CSS pixel at distance 1; small screens get smaller minimums.
    const small = Math.min(1, Math.max(0.7, Math.min(w, h) / 700));
    const perPixel = (small * 2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, h);
    const at = new THREE.Vector3();
    const groups = [this.labels, this.highlights, ...[...this.stacks.values()].map((s) => s.group)];
    for (const group of groups)
      group.traverse((o) => {
        const px = o.userData.minPx as number | undefined;
        if (!px || !(o instanceof THREE.Sprite)) return;
        const size = o.userData.size as { x: number; y: number };
        const min = px * perPixel * o.getWorldPosition(at).distanceTo(camera.position);
        const k = Math.max(1, min / size.y);
        o.scale.set(size.x * k, size.y * k, 1);
      });
  }
}
