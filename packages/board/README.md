# @hrady/board

The Hrady board as a graph: `hrady.json` plus types, a loader and validation.

```ts
import { loadHradyBoard } from '@hrady/board';

const board = loadHradyBoard(); // validated; throws BoardValidationError otherwise
board.startFor(4); // start scroll for a die roll of 4
board.neighbours('p01'); // adjacent node ids
```

## Format

- `nodes`: `path` (coin markers, ids `p01`…), `start` (scrolls, `s1`…`s6`, with
  `number` = shields on the scroll = die roll) and `castle` (id is the
  name's slug, with `name` and `value` = swords, 1–3).
- `x`, `y` are normalised 0..1 over `docs/board/board-full.jpg` (876×1200).
- `edges` are undirected `[a, b]` pairs. Path/start edges are the dotted lines.
  A castle has an edge to the marker(s) it is attacked/entered from.
- Edit with `pnpm dev:map-editor`; its Export writes this same layout
  (`formatBoardJson`), so diffs stay one line per change.

`validateBoard` checks: 6 starts numbered 1–6, 18 castles with unique names
and values 1–3, no dangling/self/duplicate edges, a connected graph, every
castle and every start adjacent to at least one path marker.

## Tracing notes (first draft, 2026-10-26)

Traced by hand from the photo: 61 path markers, 6 starts, 18 castles, 91
dotted connections and 18 castle-access edges (19 after the owner's
correction below). Every start scroll has exactly four dotted lines, which is
a useful sanity check.

**Castle access.** The small white arrowheads printed next to the paths each
sit between one marker and one castle and point at the castle, so they are
read as "this marker is the castle's entrance". 15 castles have one; each is
connected to only the marker the arrow belongs to. Three castles have no
arrow I could find and got the nearest marker instead:

| Castle   | Access marker | Confidence                                       |
| -------- | ------------- | ------------------------------------------------ |
| Kánovice | `p40`, `p37`  | `p40` a guess; `p37` confirmed by the owner      |
| Olivín   | `p46`         | guess: closest marker; `p46` also enters Chotice |
| Kumburk  | `p48`         | guess: directly below; `p42` above is Prachov's  |

**Uncertain dotted lines** (faint over the river or hidden by artwork):

- `p13`–`p21` and `p21`–`p22`: the line from `p13` runs down the river and
  meets the line to `p22` at a green islet just above `p21`. Read as two
  edges through `p21`; it could instead be one line `p13`–`p22` that skips
  `p21`.
- `p21`–`p37`: long faint river line past Roveň.
- `p36`–`p40` and `p40`–`p58`: long faint river lines on either side of
  Chotice.
- `p37`–`p56`: long faint line down the right bank of the river.
- `p24`–`p27`: only one dot is visible between the two markers.
- `p25` has only two connections (`p16`, `p27`); I found no line from it to
  `p36` below.
- `p12` has a single dotted connection (`p16`) besides Strašecí.

**Sword values.** Each castle's sword was paired with the closest castle. The
two ambiguous pairs: the "3" below the Kánovice island was given to Kánovice
(Chotice then gets the "1" beside it), and the "1" left of Roveň was given to
Roveň.

**Names.** Read from the Fraktur banners; diacritics are best guesses.
"Lomnov" could be read "Comnov"; "Zakubí", "Mukařov" and "Žehrov" may carry
different accents on the board.
