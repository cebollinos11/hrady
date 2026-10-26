import { describe, expect, it } from 'vitest';
import hradyJson from '../hrady.json';
import {
  BoardValidationError,
  formatBoardJson,
  loadHradyBoard,
  parseBoard,
  validateBoard,
  validateGraph,
  validateHradyRules,
  type BoardData,
} from '../src';

const clone = (): BoardData => JSON.parse(JSON.stringify(hradyJson)) as BoardData;

describe('hrady.json', () => {
  const board = loadHradyBoard();

  it('passes all validation', () => {
    expect(validateBoard(hradyJson)).toEqual([]);
  });

  it('has exactly 6 starts numbered 1–6', () => {
    expect(board.starts.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('has 18 castles with unique names and values 1–3', () => {
    expect(board.castles).toHaveLength(18);
    expect(new Set(board.castles.map((c) => c.name)).size).toBe(18);
    for (const c of board.castles) expect([1, 2, 3]).toContain(c.value);
  });

  it('has no dangling edges', () => {
    for (const [a, b] of board.data.edges) {
      expect(board.nodes.has(a), a).toBe(true);
      expect(board.nodes.has(b), b).toBe(true);
    }
  });

  it('is a connected graph', () => {
    expect(validateGraph(board.data)).toEqual([]);
  });

  it('puts every castle next to at least one path marker', () => {
    for (const c of board.castles) {
      const kinds = board.neighbours(c.id).map((id) => board.nodes.get(id)?.type);
      expect(kinds, c.name).toContain('path');
    }
  });

  it('keeps coordinates inside the image', () => {
    for (const n of board.data.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(1);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(1);
    }
  });

  it('maps die rolls to start areas', () => {
    expect(board.startFor(4).number).toBe(4);
    expect(() => board.startFor(7)).toThrow(RangeError);
  });
});

describe('validation catches broken boards', () => {
  it('rejects a missing start number', () => {
    const b = clone();
    const s6 = b.nodes.find((n) => n.type === 'start' && n.number === 6)!;
    if (s6.type === 'start') s6.number = 5;
    expect(validateHradyRules(b).join()).toMatch(/start numbers must be exactly 1–6/);
  });

  it('rejects duplicate castle names and bad values', () => {
    const b = clone();
    const [c1, c2] = b.nodes.filter((n) => n.type === 'castle');
    if (c1?.type === 'castle' && c2?.type === 'castle') {
      c2.name = c1.name;
      c2.value = 4;
    }
    const errors = validateHradyRules(b).join('\n');
    expect(errors).toMatch(/duplicate castle name/);
    expect(errors).toMatch(/value must be 1–3/);
  });

  it('rejects a dangling edge', () => {
    const b = clone();
    b.edges.push(['p01', 'nowhere']);
    expect(validateGraph(b).join()).toMatch(/missing node/);
  });

  it('rejects a disconnected node', () => {
    const b = clone();
    b.nodes.push({ id: 'lonely', type: 'path', x: 0.5, y: 0.5 });
    expect(validateGraph(b).join()).toMatch(/not connected.*lonely/);
  });

  it('rejects a castle without a path marker neighbour', () => {
    const b = clone();
    b.edges = b.edges.filter(([x, y]) => x !== 'valenice' && y !== 'valenice');
    b.edges.push(['s1', 'valenice']);
    expect(validateHradyRules(b).join()).toMatch(/castle valenice is not adjacent/);
  });

  it('rejects malformed shapes', () => {
    expect(validateBoard(null)).toEqual(['board must be an object']);
    expect(
      validateBoard({ version: 1, nodes: [{ id: 'a', type: 'x', x: 2, y: 0 }], edges: [] }),
    ).toEqual([
      'nodes[0].type must be one of start, path, castle',
      'nodes[0].x must be a number in 0..1',
    ]);
  });

  it('parseBoard throws with the list of problems', () => {
    const b = clone();
    b.edges.push(['p01', 'p01']);
    expect(() => parseBoard(b)).toThrow(BoardValidationError);
  });
});

describe('formatBoardJson', () => {
  it('round-trips hrady.json byte for byte', async () => {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(new URL('../hrady.json', import.meta.url), 'utf8');
    expect(formatBoardJson(JSON.parse(text) as BoardData)).toBe(text);
  });
});
