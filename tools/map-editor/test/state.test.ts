import { describe, expect, it } from 'vitest';
import {
  addNode,
  deleteNode,
  emptyBoard,
  findNode,
  moveNode,
  nextId,
  renameNode,
  setNodeType,
  toggleEdge,
} from '../src/state';

describe('map editor state', () => {
  it('adds nodes with sequential ids and type defaults', () => {
    const b = emptyBoard();
    expect(addNode(b, 'path', 0.1, 0.2)).toEqual({ id: 'p01', type: 'path', x: 0.1, y: 0.2 });
    expect(addNode(b, 'path', 0.3, 0.4).id).toBe('p02');
    expect(addNode(b, 'start', 0.5, 0.5)).toMatchObject({ id: 's1', number: 1 });
    expect(addNode(b, 'start', 0.5, 0.5)).toMatchObject({ id: 's2', number: 2 });
    expect(addNode(b, 'castle', 0.5, 0.5)).toMatchObject({ id: 'c01', value: 1 });
  });

  it('reuses freed ids and clamps coordinates', () => {
    const b = emptyBoard();
    addNode(b, 'path', 0, 0);
    addNode(b, 'path', 0, 0);
    deleteNode(b, 'p01');
    expect(nextId(b, 'path')).toBe('p01');
    moveNode(b, 'p02', 1.5, -0.2);
    expect(findNode(b, 'p02')).toMatchObject({ x: 1, y: 0 });
  });

  it('toggles edges and ignores self loops and unknown nodes', () => {
    const b = emptyBoard();
    addNode(b, 'path', 0, 0);
    addNode(b, 'path', 1, 1);
    expect(toggleEdge(b, 'p02', 'p01')).toBe(true);
    expect(b.edges).toEqual([['p01', 'p02']]);
    expect(toggleEdge(b, 'p01', 'p02')).toBe(false);
    expect(b.edges).toEqual([]);
    expect(toggleEdge(b, 'p01', 'p01')).toBe(false);
    expect(toggleEdge(b, 'p01', 'zz')).toBe(false);
    expect(b.edges).toEqual([]);
  });

  it('deletes a node together with its edges', () => {
    const b = emptyBoard();
    for (let i = 0; i < 3; i++) addNode(b, 'path', 0, 0);
    toggleEdge(b, 'p01', 'p02');
    toggleEdge(b, 'p02', 'p03');
    deleteNode(b, 'p02');
    expect(b.nodes.map((n) => n.id)).toEqual(['p01', 'p03']);
    expect(b.edges).toEqual([]);
  });

  it('changes type and renames while keeping edges', () => {
    const b = emptyBoard();
    addNode(b, 'path', 0.2, 0.3);
    addNode(b, 'path', 0, 0);
    toggleEdge(b, 'p01', 'p02');
    setNodeType(b, 'p01', 'castle');
    expect(findNode(b, 'p01')).toMatchObject({ type: 'castle', value: 1, x: 0.2, y: 0.3 });
    expect(renameNode(b, 'p01', 'valenice')).toBe(true);
    expect(b.edges).toEqual([['valenice', 'p02']]);
    expect(renameNode(b, 'valenice', 'p02')).toBe(false);
  });
});
