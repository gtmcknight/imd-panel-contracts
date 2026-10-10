/**
 * Where every module sits.
 *
 * Pure: numbers in, a grid out, no canvas. The wall is a grid of square cells, one per seat of
 * area. A wallet's module is as many cells as it holds seats, in a shape chosen once per wallet;
 * a seat with no known holder is one cell. Modules are packed first-fit along a scan pointer, the
 * nodes that have worked first so seat 1 sits top left, the rest in a seeded shuffle with a
 * reserve of singles kept for the end so the last row fills instead of ragging. The operator's
 * monitor is a block reserved before the pack, above where the operator sits.
 *
 * The column count is solved, not chosen: the wall should fill the room under the header without
 * scrolling, so the count that lands closest to the target height without exceeding it wins.
 */
import { rng, shuffle } from "./rng";
import { HAS_WORKED, IDLE, RECENT, WORKING, type Activity, type Block, type Layout, type SeatRecord, type Unit } from "./types";

export type LayoutInput = {
  /** The wall's width in CSS pixels. */
  width: number;
  /** The height the wall should come up to, in CSS pixels. */
  targetHeight: number;
  /** Seats in the collection: one cell of area each. */
  total: number;
  seats: Record<number, SeatRecord>;
  owners?: Array<string | null>;
  /** The monitor's size in cells for a given cell size. Supplied by the renderer, which can measure text. */
  monitorSize: (cell: number, cols: number) => { w: number; h: number };
  /** The sound switch's side in cells, a square beside the cog; 0 for none. */
  playSize?: number;
  /** The cog's side in cells. */
  cogSize?: number;
  /**
   * The wall before the plane has answered: no modules, only bare plates and the blocks, at
   * this many columns, so the first paint is already the size the wall will settle at.
   */
  resting?: number;
  /** Columns of wall to keep either side of the monitor. A phone keeps one, so it stands off the modules. */
  monitorPad?: number;
  /** Tab state carried over from the previous layout, so a resize does not lose the reader's place. */
  previousBlocks?: Block[];
  /**
   * The share of idle single seats to draw, 0 to 1. A phone draws none: every node and every
   * wallet's device still shows, and the one-cell modules between them, too small to read at
   * that width, are left out. A share between keeps every nth by seat number, so the wall is the
   * same on every visit.
   */
  keep?: number;
  /** ms since epoch; `Date.now()` unless a test pins it. */
  now?: number;
};

const RECENT_WINDOW_MS = 7 * 86400e3;
/** Seat 7's shuffle: any constant, kept so the wall is the same room on every visit. */
const SHUFFLE_SEED = 7;
/** A grid cell reserved as a bare plate, nothing mounted: the packer walks around it and the wall draws a blank. */
export const HOLE = -1000;
/** Singles held back for the end of the pack, as a share of the unplaced rest. */
const RESERVE = 0.35;

/** How busy a seat is: working now beats active this week beats has worked. */
export function activityOf(seat: SeatRecord | undefined, now: number): Activity {
  if (!seat) return IDLE;
  if (seat.working) return WORKING;
  // `last` is a moment the seat worked, so it stands on its own: a week of failed runs is still a week at work
  if (seat.last && now - new Date(seat.last).getTime() < RECENT_WINDOW_MS) return RECENT;
  return HAS_WORKED;
}

/** One module per wallet when holders are known, else one per seat. */
function makeUnits(total: number, owners: Array<string | null> | undefined, seats: Record<number, SeatRecord>, now: number): Unit[] {
  const units: Unit[] = [];
  const byOwner = new Map<string, number[]>();
  if (owners?.length) {
    owners.forEach((o, id) => {
      if (o) (byOwner.get(o) ?? byOwner.set(o, []).get(o)!).push(id);
    });
  }
  const seen = new Set<number>();
  for (let id = 0; id < total; id++) {
    if (seen.has(id)) continue;
    const owner = owners?.[id] ?? null;
    const ids = owner ? (byOwner.get(owner) ?? [id]) : [id];
    for (const x of ids) seen.add(x);
    let activity: Activity = IDLE;
    let seat = ids[0] as number;
    let found = false, last = 0;
    for (const x of ids) {
      const a = activityOf(seats[x], now);
      if (seats[x] && !found) { seat = x; found = true; }
      if (a > activity) activity = a;
      const t = seats[x]?.last ? new Date(seats[x]!.last!).getTime() : 0;
      if (t > last) last = t;
    }
    units.push({ owner, ids, first: id, c: 0, r: 0, w: 0, h: 0, activity, node: found, seat, last });
  }
  return units;
}

/** Nodes first, in seat order; then the rest shuffled, with a reserve of singles at the end. */
function order(units: Unit[]): Unit[] {
  const lead = units.filter((u) => u.node).sort((a, b) => a.seat - b.seat);
  const rest = shuffle(units.filter((u) => !u.node), rng(SHUFFLE_SEED));
  const fill: Unit[] = [];
  for (let i = rest.length - 1; i >= 0 && fill.length < Math.round(rest.length * RESERVE); i--) {
    if ((rest[i] as Unit).ids.length === 1) fill.push(...rest.splice(i, 1));
  }
  return [...lead, ...rest, ...fill];
}

/** A wallet's shape: a quarter tall racks, a quarter square, half wide. Chosen once per wallet. */
function shapeOf(n: number, seed: number, cols: number): [number, number] {
  const pref = rng(seed)();
  const k = pref < 0.25 ? 0.55 : pref < 0.5 ? 1 : 1.9;
  const h = Math.max(1, Math.round(Math.sqrt(n / k)));
  return [Math.min(cols, Math.ceil(n / h)), h];
}

/** The cells the units will take, by the shapes the packer gives them: a wallet's device is a box, not a count. */
function areaOf(units: Unit[], cols: number): number {
  return units.reduce((t, u) => {
    const n = u.ids.length;
    if (n === 1) return t + 1;
    const [w, h] = shapeOf(n, u.first * 3 + 11, cols);
    return t + Math.min(w, cols) * h;
  }, 0);
}

type Packed = { grid: Array<number | undefined>; rows: number };

/**
 * First fit, in order. A unit near the end that would stand past `limit` rows is turned on its
 * side when that keeps it within them: a tall device placed late is what sticks a lone row of
 * blank plates under the wall.
 */
function pack(units: Unit[], blocks: Block[], cols: number, holes?: Set<number>, limit = Infinity): Packed {
  // Filled to the blocks' last row before anything is written. The blocks sit at the foot of the
  // wall, and an empty array first written that far out is kept as a dictionary, which made every
  // read in the scan below a hash lookup: about half of what a solve cost.
  const grid: Array<number | undefined> = new Array(cols * Math.max(0, ...blocks.map((bk) => bk.r + bk.h))).fill(undefined);
  blocks.forEach((bk, bi) => {
    for (let j = 0; j < bk.h; j++) for (let i = 0; i < bk.w; i++) grid[(bk.r + j) * cols + bk.c + i] = -1 - bi;
  });
  for (const i of holes ?? []) if (grid[i] == null) grid[i] = HOLE;
  // How far the scan can move on from a place that is not free, 0 when it is: past the rightmost
  // taken column in the unit's rows, since every place between overlaps that cell, or to the next
  // row when the unit would run off the wall. First fit lands where it did cell by cell.
  const blocked = (c: number, r: number, w: number, h: number) => {
    if (c + w > cols) return cols - c;
    for (let i = w - 1; i >= 0; i--) for (let j = 0; j < h; j++) if (grid[(r + j) * cols + c + i] != null) return i + 1;
    return 0;
  };
  // Where each shape's last search ended. Cells only ever fill, so every place before it that was
  // not free for that shape still is not, nor for any shape at least as wide and as tall: a search
  // starts from the furthest of those, not from the first empty cell.
  let scan = 0, maxRow = 0;
  const found = new Map<number, number>();
  const firstFit = (w: number, h: number) => {
    // a single cell fits in the first empty one
    if (w === 1 && h === 1) return scan;
    let p = scan;
    for (const [shape, at] of found) if (shape >> 12 <= w && (shape & 4095) <= h && at > p) p = at;
    for (let skip; (skip = blocked(p % cols, Math.floor(p / cols), w, h)); ) p += skip;
    found.set((w << 12) | h, p);
    return p;
  };
  units.forEach((u, ui) => {
    const n = u.ids.length;
    const [w0, h0] = n === 1 ? [1, 1] : shapeOf(n, u.first * 3 + 11, cols);
    let w = Math.min(w0, cols), h = h0;
    while (grid[scan] != null) scan++;
    let p = firstFit(w, h);
    if (h > 1 && h !== w && Math.floor(p / cols) + h > limit && h <= cols) {
      const tw = h, th = w;
      const q = firstFit(tw, th);
      if (Math.floor(q / cols) + th < Math.floor(p / cols) + h) { p = q; w = tw; h = th; }
    }
    u.c = p % cols; u.r = Math.floor(p / cols); u.w = w; u.h = h;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) grid[(u.r + j) * cols + u.c + i] = ui;
    maxRow = Math.max(maxRow, u.r + h);
  });
  const rows = Math.max(maxRow, ...blocks.map((bk) => bk.r + bk.h));
  return { grid, rows };
}

/**
 * Where the monitor is centred, as a share of the wall's width: the middle. The operator sits a
 * little left of it, and the monitor is wide enough that he still sits in front of it.
 */
const OPERATOR_X = 0.5;

function place(units: Unit[], cols: number, cell: number, input: LayoutInput, minRows = 0): { blocks: Block[]; packed: Packed } {
  const prev = input.previousBlocks?.find((b) => b.kind === "monitor");
  const { w, h } = input.monitorSize(cell, cols);
  const block: Block = {
    kind: "monitor", w: Math.min(cols, w + 2 * (input.monitorPad ?? 0)), h, c: 0, r: 0, pad: input.monitorPad ?? 0,
    tab: prev?.tab ?? 0, since: prev?.since ?? 0, pinned: prev?.pinned ?? 0, tabRects: [],
  };
  // The room's two controls, square plates side by side at the wall's top right: the sound switch, then the cog. All the
  // blocks are reserved before the seats are packed, so the seats flow around them.
  const used = areaOf(units, cols);
  const cs = input.cogSize ?? 1, ps = input.playSize ?? 0;
  const blockCells = block.w * block.h + ps * ps + cs * cs;
  block.c = Math.max(0, Math.min(cols - block.w, Math.round(cols * OPERATOR_X - block.w / 2)));
  const listen: Block = { kind: "listen", w: ps, h: ps, c: cols - cs - ps, r: 0, tab: 0, since: 0, pinned: 0, tabRects: [] };
  // the cog: at the wall's top right, where a room's settings would be
  const cog: Block = { kind: "settings", w: cs, h: cs, c: cols - cs, r: 0, tab: 0, since: 0, pinned: 0, tabRects: [] };
  const inBlock = (i: number) => {
    const r = Math.floor(i / cols), c = i % cols;
    return (r >= block.r && r < block.r + block.h && c >= block.c && c < block.c + block.w) || (r < ps && c >= cols - cs - ps && c < cols - cs) || (r < cs && c >= cols - cs);
  };
  // The cells the seats and the blocks leave over would all fall at the end, as a bare last row.
  // Instead most are scattered across the wall as unmounted plates, the way a real wall has a
  // gap here and there, and the last row fills; a few are kept back as slack for the shapes.
  const scatter = (rows: number, count: number) => {
    const holes = new Set<number>(), g = rng(SHUFFLE_SEED + cols);
    // above the last two rows, which are the ones being filled
    for (let tries = 0; holes.size < count && tries < count * 20; tries++) {
      const i = Math.floor(g() * Math.max(1, rows - 2) * cols);
      if (!inBlock(i)) holes.add(i);
    }
    return holes;
  };
  // The row count is settled by packing, not by arithmetic: shapes leave gaps, so the seats need
  // more rows than their area says. Guess from the area, pack, and while the seats run past the
  // blocks, move the blocks down to where the pack ended. Then a few variations are tried: the
  // blank cells of the last row scattered up the wall as unmounted plates, half that, and the
  // blocks one row higher so the seats spill into the last row. The packing with the fewest rows
  // wins, and among equals the one whose last row is fullest.
  const attempt = (rows: number, holes: number) => {
    block.r = Math.max(1, rows - block.h - 1);
    const packed = pack(units, [block, listen, cog], cols, scatter(rows, holes), rows);
    let trailing = 0;
    for (let i = (packed.rows - 1) * cols; i < packed.rows * cols; i++) if (packed.grid[i] == null) trailing++;
    return { packed, block: { ...block }, listen: { ...listen }, trailing, rows, holes };
  };
  type Attempt = ReturnType<typeof attempt>;
  const better = (a: Attempt, b: Attempt | null) => !b || a.packed.rows < b.packed.rows || (a.packed.rows === b.packed.rows && a.trailing < b.trailing);
  let rows = Math.max(minRows, Math.ceil((used + blockCells) / cols));
  let base = attempt(rows, 0);
  for (let pass = 0; base.packed.rows > rows && pass < 4; pass++) { rows = base.packed.rows; base = attempt(rows, 0); }
  let best = base;
  const slack = Math.ceil(cols / 8);
  // and the blocks pulled up by a row at a time while the seats still fit above them: the area's guess runs long
  // when the wall is narrow and the shapes are few, and every row it runs long is a band of bare plates
  for (const [dr, share] of [[0, 1], [0, 0.5], [-1, 0], [-1, 0.5], [-2, 0], [-2, 0.5], [-3, 0], [-4, 0], [-5, 0]] as const) {
    const holes = Math.max(0, Math.round((base.trailing - slack) * share));
    if (dr === 0 && holes === 0) continue;
    if (rows + dr < block.h + 3) continue;
    const a = attempt(rows + dr, holes);
    if (better(a, best)) best = a;
  }
  // a band of bare rows left above the blocks, where the area's guess ran long, is closed: the blocks come up by the
  // band and the wall is packed again, as long as the seats still fit above them
  const band = (a: Attempt) => {
    let n = 0;
    for (let r = a.block.r - 1; r >= 0; r--) {
      let empty = true;
      for (let c = 0; c < cols && empty; c++) if (a.packed.grid[r * cols + c] != null) empty = false;
      if (!empty) break;
      n++;
    }
    return n;
  };
  for (let guard = 0; guard < 6; guard++) {
    const n = band(best);
    if (n < 1 || best.rows - n < block.h + 3) break;
    const a = attempt(best.rows - n, best.holes);
    if (a.packed.rows <= best.packed.rows - n) best = a; else break;
  }
  // every pack writes the units' places; the last one run is not the one chosen, so run the
  // chosen one again, and the units sit where its grid says they do
  Object.assign(block, best.block); Object.assign(listen, best.listen);
  const packed = pack(units, [block, listen, cog], cols, scatter(best.rows, best.holes), best.rows);
  return { blocks: [block, listen, cog], packed };
}

export function solveLayout(input: LayoutInput): Layout {
  const now = input.now ?? Date.now();
  const W = Math.max(280, input.width);
  const target = Math.max(240, input.targetHeight);
  if (input.resting) {
    // nothing to mount yet: the blocks on a wall of blank plates, as many rows as the height allows
    const cols = Math.max(20, Math.round(input.resting));
    const cell = W / cols;
    const result = place([], cols, cell, input, Math.max(6, Math.floor(target / cell)));
    return { cols, rows: result.packed.rows, cell, units: [], grid: result.packed.grid, blocks: result.blocks };
  }
  const keep = input.keep ?? 1;
  const units = order(makeUnits(input.total, input.owners, input.seats, now).filter((u) => keep >= 1 || u.node || u.ids.length > 1 || (keep > 0 && u.first % Math.round(1 / keep) === 0)));
  // The seats' cells plus roughly the monitor's; the column count that fills the target height.
  const area = areaOf(units, 60) + 620;
  const c0 = Math.max(24, Math.round(Math.sqrt((area * W) / target)));
  // Among the column counts that fit, the tallest whose last row is mostly modules: a count that
  // leaves the last row all blank plates reads as an empty shelf, and a neighbouring count fills it.
  const trailing = (packed: Packed, c: number) => {
    let blank = 0;
    for (let i = (packed.rows - 1) * c; i < packed.rows * c; i++) if (packed.grid[i] == null) blank++;
    return blank / c;
  };
  let best: { cols: number; height: number; full: boolean } | null = null;
  for (let c = Math.max(20, c0 - 8); c <= c0 + 10; c++) {
    const cell = W / c;
    const { packed } = place(units, c, cell, input);
    const height = packed.rows * cell;
    if (height > target) continue;
    const full = trailing(packed, c) < 0.5;
    if (!best || (full && !best.full) || (full === best.full && height > best.height)) best = { cols: c, height, full };
  }
  let cols = best ? best.cols : c0 + 10;
  let cell = W / cols;
  let result = place(units, cols, cell, input);
  if (!best) {
    while (result.packed.rows * cell > target && cols < 160) { cols += 2; cell = W / cols; result = place(units, cols, cell, input); }
  }
  return { cols, rows: result.packed.rows, cell, units, grid: result.packed.grid, blocks: result.blocks };
}
