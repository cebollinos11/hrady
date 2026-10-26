import {
  formatBoardJson,
  validateBoard,
  validateShape,
  type BoardData,
  type BoardNode,
  type NodeType,
} from '@hrady/board';
import hradyJson from '@hrady/board/hrady.json';
import photoUrl from '../../../docs/board/board-full.jpg';
import {
  addNode,
  deleteNode,
  findNode,
  moveNode,
  renameNode,
  setNodeType,
  toggleEdge,
} from './state';

type Tool = 'select' | NodeType | 'connect' | 'delete';

const STORAGE_KEY = 'hrady-map-editor-draft';
const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_IMAGE = { src: 'docs/board/board-full.jpg', width: 876, height: 1200 };

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const svg = $<SVGSVGElement>('#board');
const viewport = $<HTMLDivElement>('#viewport');

const fresh = (): BoardData => JSON.parse(JSON.stringify(hradyJson)) as BoardData;

function loadDraft(): BoardData {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (validateShape(parsed).length === 0) return parsed as BoardData;
    }
  } catch {
    // Storage unavailable or corrupt: fall back to the committed board.
  }
  return fresh();
}

let board = loadDraft();
let tool: Tool = 'select';
let selected: string | null = null;
let pending: string | null = null; // first node picked in connect mode
const history: string[] = [];

const image = () => board.image ?? DEFAULT_IMAGE;

/** Snapshot for undo; call before every change. */
function checkpoint() {
  history.push(JSON.stringify(board));
  if (history.length > 200) history.shift();
}

function commit() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  } catch {
    // Draft persistence is a convenience only.
  }
  render();
}

function undo() {
  const previous = history.pop();
  if (!previous) return;
  board = JSON.parse(previous) as BoardData;
  if (selected && !findNode(board, selected)) selected = null;
  pending = null;
  commit();
}

function setTool(next: Tool) {
  tool = next;
  pending = null;
  document.body.className = `mode-${tool}${$<HTMLInputElement>('#labels').checked ? '' : ' hide-labels'}`;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tool]'))
    b.setAttribute('aria-checked', String(b.dataset.tool === tool));
  render();
}

/** Pointer position in normalised board coordinates. */
function boardPoint(e: PointerEvent): { x: number; y: number } {
  const ctm = svg.getScreenCTM()!.inverse();
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm);
  return { x: p.x / image().width, y: p.y / image().height };
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function nodeShape(n: BoardNode, px: number, py: number): SVGElement {
  const cls = `node ${n.type}${n.id === selected ? ' selected' : ''}${n.id === pending ? ' pending' : ''}`;
  const shape =
    n.type === 'path'
      ? el('circle', { cx: px, cy: py, r: 9 })
      : n.type === 'start'
        ? el('rect', { x: px - 11, y: py - 11, width: 22, height: 22 })
        : el('polygon', {
            points: `${px},${py - 14} ${px + 14},${py} ${px},${py + 14} ${px - 14},${py}`,
          });
  shape.setAttribute('class', cls);
  shape.dataset.id = n.id;
  return shape;
}

function nodeLabel(n: BoardNode): string {
  if (n.type === 'start') return `${n.id} (${n.number})`;
  if (n.type === 'castle') return `${n.name} ${'⚔'.repeat(n.value)}`;
  return n.id;
}

function render() {
  const { width, height } = image();
  const zoom = Number($<HTMLInputElement>('#zoom').value);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width * zoom));
  svg.setAttribute('height', String(height * zoom));
  svg.replaceChildren();

  svg.append(
    el('image', {
      href: photoUrl,
      width,
      height,
      opacity: $<HTMLInputElement>('#opacity').value,
    }),
  );

  const pos = new Map(board.nodes.map((n) => [n.id, [n.x * width, n.y * height] as const]));
  const castleIds = new Set(board.nodes.filter((n) => n.type === 'castle').map((n) => n.id));
  for (const [a, b] of board.edges) {
    const pa = pos.get(a);
    const pb = pos.get(b);
    if (!pa || !pb) continue;
    const line = { x1: pa[0], y1: pa[1], x2: pb[0], y2: pb[1] };
    const access = castleIds.has(a) || castleIds.has(b);
    svg.append(el('line', { ...line, class: access ? 'edge access' : 'edge' }));
    const hit = el('line', { ...line, class: 'edge-hit' });
    hit.dataset.edge = `${a}\n${b}`;
    svg.append(hit);
  }

  for (const n of board.nodes) {
    const [px, py] = pos.get(n.id)!;
    svg.append(nodeShape(n, px, py));
    const label = el('text', { x: px + 12, y: py - 10, class: 'label' });
    label.textContent = nodeLabel(n);
    svg.append(label);
  }

  renderPanel();
}

function renderPanel() {
  const counts = { path: 0, start: 0, castle: 0 };
  for (const n of board.nodes) counts[n.type]++;
  $('#stats').textContent =
    `${counts.path} path markers, ${counts.start} starts, ${counts.castle} castles, ` +
    `${board.edges.length} edges`;

  const problems = validateBoard(board);
  const list = $<HTMLUListElement>('#problems');
  list.replaceChildren(
    ...(problems.length ? problems : ['All checks pass.']).map((p) => {
      const li = document.createElement('li');
      li.textContent = p;
      if (!problems.length) li.className = 'ok';
      return li;
    }),
  );

  const section = $<HTMLElement>('#selection');
  const node = selected ? findNode(board, selected) : undefined;
  if (!node) {
    section.innerHTML = '<h2>Selection</h2><p>Nothing selected.</p>';
    return;
  }
  const neighbours = board.edges
    .filter(([a, b]) => a === node.id || b === node.id)
    .map(([a, b]) => (a === node.id ? b : a));
  section.innerHTML = `
    <h2>Selection</h2>
    <label>Id <input name="id" /></label>
    <label>Type <select name="type">
      <option value="path">path</option>
      <option value="start">start</option>
      <option value="castle">castle</option>
    </select></label>
    ${node.type === 'start' ? '<label>Number <input name="number" type="number" min="1" max="6" /></label>' : ''}
    ${node.type === 'castle' ? '<label>Name <input name="name" /></label><label>Value <input name="value" type="number" min="1" max="3" /></label>' : ''}
    <p>x ${node.x.toFixed(4)}, y ${node.y.toFixed(4)}</p>
    <p>Neighbours: ${neighbours.join(', ') || 'none'}</p>`;

  const field = (name: string) => section.querySelector<HTMLInputElement>(`[name="${name}"]`);
  field('id')!.value = node.id;
  field('type')!.value = node.type;
  if (node.type === 'start') field('number')!.value = String(node.number);
  if (node.type === 'castle') {
    field('name')!.value = node.name;
    field('value')!.value = String(node.value);
  }
}

$<HTMLElement>('#selection').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const node = selected ? findNode(board, selected) : undefined;
  if (!node) return;
  checkpoint();
  const value = input.value.trim();
  if (input.name === 'id') {
    if (renameNode(board, node.id, value)) selected = value;
    else alert(`Id "${value}" is empty or already used.`);
  } else if (input.name === 'type') setNodeType(board, node.id, value as NodeType);
  else if (input.name === 'number' && node.type === 'start') node.number = Number(value);
  else if (input.name === 'name' && node.type === 'castle') node.name = value;
  else if (input.name === 'value' && node.type === 'castle') node.value = Number(value);
  commit();
});

let drag: { id: string; moved: boolean } | null = null;

svg.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const target = e.target as SVGElement;
  const id = target.dataset.id;
  const edge = target.dataset.edge?.split('\n') as [string, string] | undefined;

  if (tool === 'select') {
    selected = id ?? null;
    if (id) {
      drag = { id, moved: false };
      svg.setPointerCapture(e.pointerId);
    }
    render();
  } else if (tool === 'path' || tool === 'start' || tool === 'castle') {
    if (id) {
      selected = id;
    } else {
      checkpoint();
      const { x, y } = boardPoint(e);
      selected = addNode(board, tool, x, y).id;
    }
    commit();
  } else if (tool === 'connect') {
    if (edge) {
      checkpoint();
      toggleEdge(board, ...edge);
    } else if (id && pending && id !== pending) {
      checkpoint();
      toggleEdge(board, pending, id);
      pending = null;
    } else {
      pending = id ?? null;
    }
    commit();
  } else if (tool === 'delete') {
    if (!id && !edge) return;
    checkpoint();
    if (id) {
      deleteNode(board, id);
      if (selected === id) selected = null;
    } else if (edge) toggleEdge(board, ...edge);
    commit();
  }
});

svg.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved) checkpoint();
  drag.moved = true;
  const { x, y } = boardPoint(e);
  moveNode(board, drag.id, x, y);
  render();
});

svg.addEventListener('pointerup', () => {
  if (drag?.moved) commit();
  drag = null;
});

document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, select, textarea')) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  const shortcuts: Record<string, Tool> = {
    v: 'select',
    p: 'path',
    s: 'start',
    c: 'castle',
    e: 'connect',
    d: 'delete',
  };
  const next = shortcuts[e.key.toLowerCase()];
  if (next && !e.ctrlKey && !e.metaKey) setTool(next);
  else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
    checkpoint();
    deleteNode(board, selected);
    selected = null;
    commit();
  } else if (e.key === 'Escape') {
    selected = null;
    pending = null;
    render();
  }
});

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tool]'))
  b.addEventListener('click', () => setTool(b.dataset.tool as Tool));

$('#zoom').addEventListener('input', () => {
  // Keep the centre of the view in place while zooming.
  const cx = (viewport.scrollLeft + viewport.clientWidth / 2) / svg.clientWidth;
  const cy = (viewport.scrollTop + viewport.clientHeight / 2) / svg.clientHeight;
  render();
  viewport.scrollLeft = cx * svg.clientWidth - viewport.clientWidth / 2;
  viewport.scrollTop = cy * svg.clientHeight - viewport.clientHeight / 2;
});
$('#opacity').addEventListener('input', render);
$('#labels').addEventListener('change', () => setTool(tool));
$('#undo').addEventListener('click', undo);

$('#reset').addEventListener('click', () => {
  if (!confirm('Discard the draft and reload packages/board/hrady.json?')) return;
  checkpoint();
  board = fresh();
  selected = pending = null;
  commit();
});

$<HTMLInputElement>('#import').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const parsed: unknown = JSON.parse(await file.text());
    const problems = validateShape(parsed);
    if (problems.length) throw new Error(problems.join('\n'));
    checkpoint();
    board = parsed as BoardData;
    selected = pending = null;
    commit();
  } catch (err) {
    alert(`Could not import ${file.name}:\n${err instanceof Error ? err.message : String(err)}`);
  }
});

$('#export').addEventListener('click', () => {
  const blob = new Blob([formatBoardJson({ ...board, image: image() })], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'hrady.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

setTool('select');
