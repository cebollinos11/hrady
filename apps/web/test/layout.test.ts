import { loadHradyBoard, parseBoard } from '@hrady/board';
import { describe, expect, it } from 'vitest';
import { testBoardData } from '../../../packages/engine/test/fixtures';
import {
  START_CLEARANCE,
  WATER_Y,
  buildLayout,
  clampToBoard,
  distance,
  dotsBetween,
  fitDistance,
  nodeRadius,
  riverDistance,
  segmentDistance,
  toWorld,
} from '../src/game/layout';
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
