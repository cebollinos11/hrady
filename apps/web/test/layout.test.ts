import { loadHradyBoard, parseBoard } from '@hrady/board';
import { describe, expect, it } from 'vitest';
import { testBoardData } from '../../../packages/engine/test/fixtures';
import {
  START_CLEARANCE,
  WATER_Y,
  buildLayout,
  ARROW_TAIL,
  ARROW_TIP,
  clampToBoard,
  distance,
  dotsAlong,
  dotsBetween,
  fitDistance,
  nodeRadius,
  riverDistance,
  segmentDistance,
  toWorld,
} from '../src/game/layout';
import { route } from '../src/game/route';
import { heightAt } from '../src/game/terrain';

const boards = [
  ['Hrady', loadHradyBoard()],
  ['fixture', parseBoard(testBoardData())],
] as const;

describe.each(boards)('layout of the %s board', (_, board) => {
  const layout = buildLayout(board);

  it('places every node on the board, clear of its edge', () => {
    expect(layout.nodes.size).toBe(board.data.nodes.length);
    for (const n of layout.nodes.values()) {
      const r = nodeRadius(n.node);
      expect(Math.abs(n.pos.x) + r).toBeLessThan(layout.width / 2);
      expect(Math.abs(n.pos.z) + r).toBeLessThan(layout.depth / 2);
    }
  });

  it('keeps paths between markers clear of the start areas', () => {
    for (const start of board.starts) {
      const s = layout.nodes.get(start.id)!.pos;
      for (const [a, b] of board.data.edges) {
        const pa = layout.nodes.get(a)!;
        const pb = layout.nodes.get(b)!;
        if (pa.node.type !== 'path' || pb.node.type !== 'path') continue;
        expect(segmentDistance(s, pa.pos, pb.pos).d).toBeGreaterThan(START_CLEARANCE - 1e-6);
      }
    }
  });

  it('keeps every dotted path on the board', () => {
    for (const e of layout.edges)
      for (const d of e.dots) {
        expect(Math.abs(d.x)).toBeLessThan(layout.width / 2 - 0.1);
        expect(Math.abs(d.z)).toBeLessThan(layout.depth / 2 - 0.1);
      }
  });

  it('dots every connection but castle entrances, which get an arrow', () => {
    const access = board.data.edges.filter(([a, b]) =>
      [a, b].some((id) => board.nodes.get(id)!.type === 'castle'),
    );
    expect(layout.entrances).toHaveLength(access.length);
    expect(layout.edges).toHaveLength(board.data.edges.length - access.length);
    for (const e of layout.edges) {
      const a = layout.nodes.get(e.a)!;
      const b = layout.nodes.get(e.b)!;
      for (const dot of e.dots) {
        expect(distance(dot, a.pos)).toBeGreaterThan(nodeRadius(a.node) - 1e-9);
        expect(distance(dot, b.pos)).toBeGreaterThan(nodeRadius(b.node) - 1e-9);
      }
    }
  });

  it('winds the dotted paths round the pieces in their way', () => {
    for (const e of layout.edges) {
      expect(e.path[0]).toEqual(layout.nodes.get(e.a)!.pos);
      expect(e.path.at(-1)).toEqual(layout.nodes.get(e.b)!.pos);
      for (const n of layout.nodes.values()) {
        if (n.id === e.a || n.id === e.b) continue;
        for (const dot of e.dots) expect(distance(dot, n.pos)).toBeGreaterThan(nodeRadius(n.node));
      }
    }
  });

  it('puts entrance arrows in front of the castle, dotted from the marker', () => {
    for (const e of layout.entrances) {
      const m = layout.nodes.get(e.marker)!;
      const c = layout.nodes.get(e.castle)!;
      // The arrow never overlaps the marker, and clears the castle when there is room.
      expect(distance(e.pos, m.pos)).toBeGreaterThan(nodeRadius(m.node) + ARROW_TAIL);
      const room = distance(m.pos, c.pos) - nodeRadius(m.node) - nodeRadius(c.node);
      if (room > ARROW_TAIL + ARROW_TIP + 0.1)
        expect(distance(e.pos, c.pos) - ARROW_TIP).toBeGreaterThan(nodeRadius(c.node));
      for (const dot of e.dots) {
        expect(distance(dot, m.pos)).toBeGreaterThan(nodeRadius(m.node));
        expect(distance(dot, c.pos)).toBeGreaterThan(distance(e.pos, c.pos) + ARROW_TAIL);
      }
    }
  });

  it('turns every castle towards its entrances', () => {
    for (const castle of board.castles) {
      const c = layout.nodes.get(castle.id)!;
      for (const e of layout.entrances.filter((e) => e.castle === castle.id)) {
        const m = layout.nodes.get(e.marker)!.pos;
        const toMarker = Math.atan2(m.x - c.pos.x, m.z - c.pos.z);
        const diff = Math.abs(
          Math.atan2(Math.sin(toMarker - c.facing), Math.cos(toMarker - c.facing)),
        );
        expect(diff).toBeLessThan(Math.PI / 2);
      }
    }
  });

  it('keeps nodes on dry, level ground, also in the river', () => {
    for (const n of layout.nodes.values()) {
      expect(heightAt(layout, n.pos)).toBeCloseTo(0, 5);
      expect(heightAt(layout, n.pos)).toBeGreaterThan(WATER_Y);
    }
  });
});

describe('river and terrain', () => {
  const layout = buildLayout(loadHradyBoard());

  it('runs down the board from top to bottom', () => {
    const size = layout.graph;
    for (const p of layout.river) {
      const centre = toWorld(size, p.x, Math.min(1, Math.max(0, p.y)));
      expect(riverDistance(layout, centre)).toBeLessThan(0);
    }
    expect(riverDistance(layout, toWorld(size, 0.02, 0.5))).toBeGreaterThan(1);
  });

  it('dips under the water away from the nodes', () => {
    const size = layout.graph;
    // Somewhere in the river that is clear of every node.
    const wet = layout.river
      .map((p) => toWorld(size, p.x, p.y))
      .filter((p) => Math.abs(p.z) < layout.graph.depth / 2)
      .find((p) =>
        [...layout.nodes.values()].every((n) => distance(n.pos, p) - nodeRadius(n.node) > 0.4),
      );
    expect(wet).toBeDefined();
    expect(heightAt(layout, wet!)).toBeLessThan(WATER_Y);
  });

  it('is deterministic', () => {
    const p = { x: 1.234, z: -2.5 };
    expect(heightAt(layout, p)).toBe(heightAt(buildLayout(loadHradyBoard()), p));
  });
});

describe('geometry helpers', () => {
  it('spaces dots evenly between the rims', () => {
    const dots = dotsBetween({ x: 0, z: 0 }, { x: 2, z: 0 }, 0.3, 0.3, 0.2);
    expect(dots.length).toBe(6);
    expect(dots[0]!.x).toBeGreaterThan(0.3);
    expect(dots.at(-1)!.x).toBeLessThan(1.7);
    expect(dotsBetween({ x: 0, z: 0 }, { x: 0.5, z: 0 }, 0.3, 0.3)).toEqual([]);
  });

  it('routes straight when nothing is in the way, else round it', () => {
    const a = { x: -2, z: 0 };
    const b = { x: 2, z: 0 };
    const bounds = { width: 8, depth: 8 };
    expect(route(a, b, [{ x: 0, z: 1, r: 0.5 }], bounds)).toEqual([a, b]);
    const castle = { x: 0, z: 0.1, r: 0.5 };
    const path = route(a, b, [castle], bounds);
    expect(path[0]).toEqual(a);
    expect(path.at(-1)).toEqual(b);
    for (let i = 1; i < path.length; i++)
      expect(segmentDistance(castle, path[i - 1]!, path[i]!).d).toBeGreaterThan(castle.r);
    // Round the side the obstacle leaves more room on.
    expect(Math.min(...path.map((p) => p.z))).toBeLessThan(-0.4);
    const dots = dotsAlong(path, 0.3, 0.3);
    expect(dots.length).toBeGreaterThan(20);
    for (const d of dots) expect(distance(d, castle)).toBeGreaterThan(castle.r);
  });

  it('fits the board in view for any aspect', () => {
    const fov = 40;
    const tan = Math.tan((fov * Math.PI) / 360);
    for (const aspect of [0.5, 1, 2]) {
      const d = fitDistance(8, 12, fov, aspect);
      expect(d * tan).toBeGreaterThanOrEqual(6 - 1e-9);
      expect(d * tan * aspect).toBeGreaterThanOrEqual(4 - 1e-9);
    }
  });

  it('clamps camera targets to the board', () => {
    const layout = buildLayout(loadHradyBoard());
    expect(clampToBoard(layout, { x: 100, z: -100 })).toEqual({
      x: layout.width / 2,
      z: -layout.depth / 2,
    });
    expect(clampToBoard(layout, { x: 1, z: 2 })).toEqual({ x: 1, z: 2 });
  });
});
