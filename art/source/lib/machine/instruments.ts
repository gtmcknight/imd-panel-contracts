/**
 * The instruments, drawn into any box. Seven numbers are retired and left blank so the rest keep theirs.
 *
 * Every drawing is a function of the box and a seeded random source, so the same seat draws the
 * same knobs at the same angles on every visit. `live` moves the needles and lights the keys;
 * `tt` is the clock they move to. Three rules keep a drawing honest at every size:
 *
 * - The stroke follows the box (one to three pixels), so a tiny cell is not drawn with a marker.
 * - The count of any repeated part follows the box: `lvl` 0 is a glyph, 1 simplified, 2 full.
 * - Row-shaped instruments turn to run down a tall panel, and single-shape ones repeat along a
 *   strip rather than sitting tiny in its middle.
 */
import type { Rng } from "./rng";
import { rng } from "./rng";
import { beat, phase, TAU, tick, wave, type Painter } from "./painter";

export const INSTRUMENT_NAMES = [
  "knobs", "sliders", "meter", "scope", "matrix", "switches", "", "dial", "radar", "seven-segment",
  "pad grid", "", "LED column", "rocker toggles", "transport", "", "tape reels", "patch bay",
  "readout", "globe", "thermometer", "warning plate", "linear scale", "vent grille", "", "rotary dial",
  "", "lever", "selector", "dot matrix", "speaker", "spectrum",
  "nixie tubes", "paper tape", "fuse block", "", "compass", "drive bay", "heat sink", "guarded toggles",
  "tally counter", "level bubble", "strip chart", "square gauge", "square button", "sweep scope", "square grille",
  "big board", "plotboard", "threat ladder", "split-flap", "core cartogram", "vector scope", "annunciator",
  "mission clock", "", "register panel",
] as const;

export type InstrumentKind = number;

/** Row-shaped: turned to run down a tall panel. */
// the split-flap lays its board out upright at any shape: turned, its letters would read sideways
const ROT_H = new Set([0, 3, 5, 9, 10, 13, 14, 16, 17, 18, 21, 22, 29, 31, 32, 33, 34, 37, 39, 40, 41, 42, 54, 56]);
/** Column-shaped: turned to run across a wide one. */
// the threat ladder lays its tiles across a wide plate itself: turned, its numerals would read sideways
const ROT_V = new Set([1, 12, 20, 27]);
/** One shape: repeated along a strip instead of sitting tiny in the middle. */
const SINGLE = new Set([2, 7, 8, 19, 25, 28, 30, 36, 43, 44, 45, 46, 51, 52]);
/** Instruments that fill their plate to the edge, or whose glass starts at the top: no plate marks, they would only peek through. */
const PLAIN = new Set([4, 10, 12, 13, 14, 19, 29, 31, 33, 38, 42, 43, 45, 46, 47, 48, 49, 50, 51, 52, 53, 56]);
/** A kind with nothing of its own to light: no glass, no label bar, no corner lamp. A lit module trades one of these for a screen. */
export const blind = (T: InstrumentKind): boolean => PLAIN.has(T) && !GLASS.has(T) && !PLATE_LAMP.has(T);
/** Instruments with no part of their own to light: on, they carry a lamp at the plate's corner. */
const PLATE_LAMP = new Set([23, 30, 33, 38, 46]);
/** The instruments with glass to light: a module that is on always carries one of these. */
export const GLASS = new Set([2, 3, 9, 18, 19, 29, 31, 32, 40, 45, 47, 48, 52, 54]);
/** Mostly black glass; the picker damps these so the wall stays pale. */
const DARK = new Set([2, 3, 8, 9, 18, 19, 29, 31, 21, 45, 32, 40, 47, 48, 52, 54]);

const VOCAB = ["GAIN", "CUE", "SYNC", "IN", "OUT", "DB", "HZ", "LVL", "PAN", "MIX", "AUX", "TRIM", "SEND", "RATE", "ARM", "SUB"];
const WORDS = ["READY", "AUTO", "STANDBY", "ONLINE", "NORMAL", "ACTIVE", "MANUAL", "REMOTE", "LOCAL", "IDLE", "RUN", "LOAD"];
const FONTED = new Set("ABCDEHIKLMNORSTUVWYZ0123456789".split(""));
const TILES = ["ARM", "RUN", "HOLD", "SYNC", "AUX", "MAIN", "LINK", "HEAT", "OIL", "SUB", "NET", "ALT"];
const UNITS = ["°", "IN", "KHZ", "V", "%", "MS"];

/** The continents, coarse, as longitude and latitude rings: enough of each to know the earth at a glance. */
const EARTH: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  // North America
  [[-168, 66], [-140, 70], [-95, 72], [-75, 62], [-60, 47], [-75, 40], [-80, 30], [-97, 26], [-105, 20], [-92, 15], [-84, 9], [-79, 8], [-100, 22], [-115, 30], [-124, 40], [-130, 50], [-150, 60], [-165, 60]],
  // South America
  [[-80, 10], [-62, 10], [-50, 0], [-35, -8], [-39, -20], [-48, -28], [-58, -38], [-66, -48], [-72, -53], [-75, -45], [-71, -30], [-80, -10], [-78, 0]],
  // Europe and Asia
  [[-10, 36], [-10, 44], [0, 50], [10, 55], [25, 60], [30, 70], [60, 72], [100, 76], [140, 72], [170, 68], [180, 64], [160, 60], [140, 52], [130, 40], [120, 30], [108, 20], [100, 10], [104, 2], [97, 6], [88, 22], [78, 8], [72, 20], [60, 25], [50, 30], [45, 13], [35, 30], [28, 36], [20, 40], [12, 40], [0, 38]],
  // Africa
  [[-17, 15], [-10, 30], [0, 36], [12, 34], [30, 31], [40, 12], [51, 11], [43, -2], [40, -15], [35, -25], [30, -34], [18, -34], [12, -18], [9, -2], [5, 5], [-8, 5], [-17, 10]],
  // Australia
  [[114, -22], [122, -18], [136, -12], [146, -19], [153, -26], [150, -37], [140, -38], [130, -32], [116, -34]],
  // Greenland
  [[-55, 60], [-45, 62], [-20, 70], [-25, 82], [-60, 82], [-70, 76], [-60, 68]],
  // Antarctica
  [[-180, -68], [-120, -72], [-60, -68], [0, -70], [60, -66], [120, -66], [180, -68], [180, -90], [-180, -90]],
];

/** The shape sets the picker draws from. Repeats weight the common choice. */
const TINY = [0, 7, 30, 28, 2, 5, 43, 44, 46, 41, 52];
const WIDE = [1, 5, 13, 14, 22, 23, 4, 9, 21, 18, 31, 17, 1, 22, 33, 34, 37, 39, 40, 41, 42, 32, 47, 48, 50, 54, 56];
const TALL = [12, 20, 27, 1, 23, 4, 12, 38, 49, 56];
const MED = [0, 1, 2, 3, 4, 5, 8, 10, 13, 14, 16, 25, 28, 31, 18, 9, 3, 8, 32, 36, 37, 40, 43, 44, 45, 46, 47, 48, 50, 51, 52, 53, 54];
const BIG = [3, 8, 19, 29, 31, 9, 10, 17, 16, 25, 2, 1, 4, 3, 19, 29, 32, 33, 36, 42, 43, 45, 46, 47, 48, 50, 51, 52, 53, 56];
const STRIP = [1, 5, 13, 22, 23, 4, 12, 14, 33, 34, 38, 41, 50, 54, 56];

/** Which instrument fits a box: by its shape and size, not at random. */
/** A screen that suits the box, for a module that is on and would otherwise have no glass. */
export function pickGlass(g: Rng, w: number, h: number, cell: number): InstrumentKind {
  const ar = w / h;
  // an even pick among the screens that fit: weighted, the rare map boards would take most of the lit modules
  const set = fitting(ar >= 1.8 ? [3, 9, 54, 18, 31, 48, 40] : ar <= 0.6 ? [3, 29, 31] : [3, 2, 9, 18, 29, 31, 45, 47, 48, 52, 19], w, h, cell);
  return set[Math.floor(g() * set.length)] as InstrumentKind;
}

/**
 * Where a kind looks right, in cells: the least width and height, and the aspect (wide over tall) it
 * reads well at. Judged shape by shape on the parts page. A row of tiny radars or a column of
 * seven-segment digits is a smear; a transport is a row of buttons and nothing else, so it goes
 * only in a strip. `aMax` is the most plate, in cells, a plain kind can hold: a vent grille or a
 * level bubble across a whole console is an empty panel. A kind not listed looks right anywhere a
 * seat does. Alternatives are listed separately: a warning plate reads wide or, turned, tall,
 * never as a square.
 */
export type Room = { w?: number; h?: number; hMax?: number; aMax?: number; ar?: [number, number] };
export const FIT: Partial<Record<InstrumentKind, Room | Room[]>> = {
  3: { ar: [0.7, 99] },
  4: { w: 2, h: 1.5 },
  8: { ar: [0.5, 2] },
  9: { ar: [0.8, 99] },
  14: { ar: [2.5, 99], hMax: 1.6 },
  16: { w: 2.5, h: 1.5, ar: [1.2, 2.6] },
  17: { w: 3, h: 1.5, ar: [1.2, 3.5] },
  18: { w: 1.5, ar: [1.2, 99] },
  19: { ar: [0.6, 1.8] },
  20: [{ ar: [0, 1.3], aMax: 6 }, { ar: [2.5, 99], hMax: 1.5 }],
  21: [{ w: 2, h: 0.9 }, { h: 2, w: 0.9 }],
  22: [{ w: 2, ar: [1.1, 99], aMax: 6 }, { h: 2, ar: [0, 0.66], aMax: 6 }],
  23: { aMax: 5 },
  25: { ar: [0.6, 1.8] },
  27: [{ ar: [0, 1.2], aMax: 4 }, { ar: [2.5, 99], hMax: 1.6 }],
  28: { ar: [0.5, 2] },
  30: { ar: [0.5, 2] },
  31: [{ w: 1.5, h: 1 }, { h: 1.5, w: 1 }],
  33: [{ w: 2, aMax: 8 }, { h: 2, aMax: 8 }],
  36: { ar: [0.5, 2] },
  37: { w: 2, ar: [1.2, 99] },
  38: { aMax: 5 },
  40: { w: 1.5, ar: [1.2, 99] },
  41: { ar: [1, 99], aMax: 4 },
  42: [{ w: 1.5 }, { h: 1.5 }],
  43: { ar: [0.5, 2] },
  44: { aMax: 3 },
  45: { w: 1.5, ar: [0.6, 1.8] },
  46: { aMax: 6 },
  47: { w: 2, h: 1.5, ar: [0.8, 2.5] },
  48: { w: 2, h: 1.5, ar: [0.8, 2.5] },
  49: [{ w: 1.5, h: 1.5 }, { h: 2.5 }],
  51: { ar: [0.5, 2] },
  52: { ar: [0.5, 2] },
  53: [{ w: 1.5, h: 1.2 }, { w: 2.5, h: 0.8 }],
  54: { w: 2, ar: [1.5, 99] },
};

/**
 * The shapes a holder can pick a kind in beyond those the wall draws it in by itself: every part has a one-cell version,
 * and the few that came in one shape have a second. Only a holder's pick uses these; the wall's own draw never does, so
 * no panel without a design changes.
 */
const ONE_CELL: Room = { aMax: 1.7, ar: [0.6, 1.7] };
/** A squarish panel, medium or big: for the long kinds a holder can mount as a whole bank. */
const PANEL: Room = { w: 2.5, h: 2, ar: [0.8, 2.5] };
export const PICKED: Partial<Record<InstrumentKind, Room | Room[]>> = {
  4: ONE_CELL, 14: [ONE_CELL, PANEL], 16: ONE_CELL, 17: ONE_CELL, 18: ONE_CELL, 21: ONE_CELL, 22: ONE_CELL, 31: ONE_CELL, 33: ONE_CELL,
  37: ONE_CELL, 40: ONE_CELL, 42: ONE_CELL, 45: ONE_CELL, 47: ONE_CELL, 48: ONE_CELL, 49: ONE_CELL, 53: ONE_CELL, 54: [ONE_CELL, { w: 2.5, h: 2, ar: [0.8, 1.5] }],
  // a thermometer bank and a lever quadrant
  20: PANEL, 27: PANEL,
  // the level bubble along a strip, the square button as a bank of keys
  41: { ar: [2.5, 99], hMax: 1.6 },
  44: { ar: [0.5, 2] },
};

/** Whether a holder may mount a kind in a box: where the wall would draw it, or in one of the shapes only a pick allows. */
export function fitsPicked(T: InstrumentKind, w: number, h: number, cell: number): boolean {
  if (fits(T, w, h, cell)) return true;
  const more = PICKED[T];
  if (!more) return false;
  const cw = w / cell + 0.1, ch = h / cell + 0.1, ar = w / h;
  const ok = (r: Room) => (r.w === undefined || cw >= r.w) && (r.h === undefined || ch >= r.h) && (r.hMax === undefined || ch <= r.hMax + 0.1) && (r.aMax === undefined || (w * h) / (cell * cell) <= r.aMax) && (r.ar === undefined || (ar >= r.ar[0] && ar <= r.ar[1]));
  return Array.isArray(more) ? more.some(ok) : ok(more);
}

/** Whether a kind looks right in a box. A tenth of a cell of slack, for the gutters a template takes off a slot. */
export function fits(T: InstrumentKind, w: number, h: number, cell: number): boolean {
  const need = FIT[T];
  if (!need) return true;
  const cw = w / cell + 0.1, ch = h / cell + 0.1, ar = w / h;
  const ok = (r: Room) => (r.w === undefined || cw >= r.w) && (r.h === undefined || ch >= r.h) && (r.hMax === undefined || ch <= r.hMax + 0.1) && (r.aMax === undefined || (w * h) / (cell * cell) <= r.aMax) && (r.ar === undefined || (ar >= r.ar[0] && ar <= r.ar[1]));
  return Array.isArray(need) ? need.some(ok) : ok(need);
}

/**
 * Every pick is weighted so the wall comes out even. A kind's weight is one over the number of pools
 * that offer it, so the knobs and dials in every pool are not drawn ten times as often as a kind in
 * one; and a kind that needs room, which few slots can hold, counts three times when a slot can.
 */
const offered = new Map<InstrumentKind, number>();
export function registerPools(pools: readonly (readonly InstrumentKind[])[]): void {
  for (const pool of pools) for (const T of new Set(pool)) offered.set(T, (offered.get(T) ?? 0) + 1);
}
const roomy = (T: InstrumentKind) => { const r = FIT[T]; return !!r && (Array.isArray(r) ? r : [r]).some((q) => q.w !== undefined || q.h !== undefined); };
export function pickWeighted(g: Rng, pool: readonly InstrumentKind[]): InstrumentKind {
  const ws = pool.map((T) => (roomy(T) ? 3 : 1) / (offered.get(T) ?? 1));
  let r = g() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { r -= ws[i]!; if (r <= 0) return pool[i]!; }
  return pool[pool.length - 1]!;
}
registerPools([TINY, WIDE, TALL, MED, BIG, STRIP]);

/** The kinds that look right at any size: what a slot gets when nothing it was offered fits. */
const ANYWHERE: readonly InstrumentKind[] = [0, 5, 12, 13, 34, 39];

/** Those of a pool that look right in the box; the plain kinds if none does, so a slot is never blank. */
export function fitting(pool: readonly InstrumentKind[], w: number, h: number, cell: number): readonly InstrumentKind[] {
  const ok = pool.filter((T) => fits(T, w, h, cell));
  return ok.length ? ok : ANYWHERE;
}

export function pickInstrument(p: Painter, g: Rng, w: number, h: number): InstrumentKind {
  const { cell } = p;
  const area = (w * h) / (cell * cell);
  const ar = w / h;
  const set = fitting(
    h < cell * 1.15 && ar >= 1.8 ? STRIP
    : h < cell * 1.6 && ar >= 1.8 ? WIDE
    : w < cell * 1.6 && ar <= 0.6 ? TALL
    : area < 1.6 ? TINY
    : area < 5 ? MED
    : BIG, w, h, cell);
  let T = pickWeighted(g, set);
  if (DARK.has(T) && g() < 0.5) {
    const lit = set.filter((t) => !DARK.has(t));
    if (lit.length) T = lit[Math.floor(g() * lit.length)] as number;
  }
  return T;
}

/**
 * Draw instrument `T` into the box. `k` is the module's activity (3 = working) and only colours the
 * meter's needle and the scope's trace. `inner` marks a recursive call and stops the strip and
 * rotation rules from applying twice.
 */
/** A census hook: told of every instrument drawn, with its box, so a survey can count what the wall shows. */
export const census: { drawn?: (T: InstrumentKind, w: number, h: number) => void } = {};

export function drawInstrument(
  p: Painter,
  T: InstrumentKind,
  g: Rng,
  x: number,
  y: number,
  w: number,
  h: number,
  live: boolean,
  tt: number,
  k: number,
  inner = false,
): void {
  if (!inner) census.drawn?.(T, w, h);
  const { ctx, cell } = p;
  const C = p.P;
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (!(w >= 2 && h >= 2)) return;
  const ar = w / h;

  // one shape repeats along a strip; a slider bank across a wide strip is short faders side by side, not one long fader
  if (!inner && ((SINGLE.has(T) && (ar > 2 || ar < 0.5)) || (T === 1 && ar > 2.5))) {
    const along = ar > 2 ? w : h;
    const across = ar > 2 ? h : w;
    const N = Math.max(2, Math.min(8, Math.round(along / across)));
    const seed = Math.floor(g() * 1e6);
    const step = along / N;
    // each copy's edges rounded once and shared with its neighbour, so the gaps between copies are all the same
    for (let i = 0; i < N; i++) {
      const a0 = Math.round(step * i), a1 = Math.round(step * (i + 1));
      if (ar > 2) drawInstrument(p, T, rng(seed + i), x + a0, y, a1 - a0, h, live, tt + i * 300, k, true);
      else drawInstrument(p, T, rng(seed + i), x, y + a0, w, a1 - a0, live, tt + i * 300, k, true);
    }
    return;
  }
  if (!inner && ((ROT_H.has(T) && h > w * 1.6) || (ROT_V.has(T) && w > h * 1.6))) {
    ctx.save();
    ctx.translate(x, y + h);
    ctx.rotate(-Math.PI / 2);
    drawInstrument(p, T, g, 0, 0, h, w, live, tt, k, true);
    ctx.restore();
    return;
  }

  const SW = Math.max(1, Math.min(3, Math.round((Math.min(w, h) / 22) * 2) / 2));
  // the drawing's scale on the device: 1 on a plain screen, 2 on a retina one, five or ten in the instrument page's close-up.
  // A stroke lands on whole device pixels when it is offset by half of one exactly when its width in them is odd; the
  // offset is that, and nothing at any other width, so an outline and the fill inside it stay centred at every scale
  const tf = ctx.getTransform(), DS = Math.hypot(tf.a, tf.b) || 1;
  const hp = (lw = ctx.lineWidth) => (Math.round(lw * DS) % 2 ? 0.5 / DS : 0);
  /** An outline drawn wholly inside the box at the current width, the same distance in from every side at any scale. */
  const ring = (rx: number, ry: number, rw: number, rh: number) => { const lw = ctx.lineWidth; ctx.strokeRect(rx + lw / 2, ry + lw / 2, rw - lw, rh - lw); };
  const U = Math.max(cell / 20, Math.min(w, h) / 22);
  // the drawings keep margins of two or three units; a box that cannot hold them stays a bare plate
  if (w < U * 6 || h < U * 6) return;
  const lv = (d: number) => (d < cell * 1.15 ? 0 : d < cell * 2.3 ? 1 : 2);
  const lvl = lv(Math.min(w, h)), lvlX = lv(w), lvlY = lv(h);
  const capBy = (L: number) => (b: number) => (L === 2 ? b : L === 1 ? Math.max(2, Math.ceil(b / 2)) : 1);
  const capX = capBy(lvlX), capY = capBy(lvlY);
  ctx.fillStyle = C.stroke; ctx.strokeStyle = C.stroke; ctx.lineWidth = SW;

  /**
   * Black glass with a faint inner bevel. Whatever is drawn after it is clipped to the glass until
   * the instrument is done, so no trace, bar or digit ever runs onto the plate.
   */
  let glasses = 0;
  const scr = (sx: number, sy: number, sw: number, sh: number) => {
    ctx.fillStyle = C.screen; ctx.fillRect(sx, sy, sw, sh);
    if (sw > 8 && sh > 8) {
      ctx.strokeStyle = C.glass; ctx.globalAlpha = 0.22; ctx.lineWidth = 1;
      ctx.strokeRect(sx + 1.5, sy + 1.5, sw - 3, sh - 3);
      ctx.globalAlpha = 1; ctx.lineWidth = SW;
    }
    ctx.fillStyle = C.stroke; ctx.strokeStyle = C.stroke;
    // inside the glass's rim, so what is drawn on it (a scope's trace, a sweep) passes behind the rim and not over it
    const rim = sw > 8 && sh > 8 ? 2 : 1;
    ctx.save(); ctx.beginPath(); ctx.rect(sx + rim, sy + rim, sw - 2 * rim, sh - 2 * rim); ctx.clip(); glasses++;
  };
  /** The shadow a knob throws on its lower right. */
  const shade = (cx: number, cy: number, rr: number) => {
    if (rr < 4) return;
    ctx.strokeStyle = C.stroke; ctx.globalAlpha = 0.35; ctx.lineWidth = SW * 1.6;
    ctx.beginPath(); ctx.arc(cx, cy, rr - SW * 0.9, Math.PI * 0.1, Math.PI * 0.65); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = SW;
  };
  const word = (list: string[]) => list[Math.floor(g() * list.length)] as string;
  /**
   * A plan position indicator, the radar's glass: range rings and bearing lines faint on the black, the sweep
   * bright with its phosphor decaying in a wedge behind it, and blips that glow where the sweep has just been
   * and fade as it goes round. `from` to `to` is the arc it covers: the full circle, or a sector from a corner.
   */
  const ppi = (cx: number, cy: number, rr: number, from: number, to: number, sweep: number, blips: number) => {
    const span = to - from, full = span >= TAU - 0.01, fine = rr >= 12;
    ctx.save(); ctx.beginPath();
    if (full) ctx.arc(cx, cy, rr, 0, TAU); else { ctx.moveTo(cx, cy); ctx.arc(cx, cy, rr, from, to); ctx.closePath(); }
    ctx.clip();
    ctx.strokeStyle = C.glass; ctx.lineWidth = 1;
    // range rings, evenly spaced; bearing lines every thirty degrees; ticks along the rim every ten
    const rings = fine ? 4 : rr >= 6 ? 2 : 1;
    ctx.globalAlpha = 0.3;
    for (let k = 1; k <= rings; k++) { ctx.beginPath(); ctx.arc(cx, cy, (rr * k) / rings, from, to); ctx.stroke(); }
    if (fine) {
      ctx.globalAlpha = 0.18;
      for (let a = from; a <= to + 0.001; a += Math.PI / 6) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); ctx.stroke(); }
      ctx.globalAlpha = 0.5;
      for (let a = from; a <= to + 0.001; a += Math.PI / 18) { ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * rr * 0.94, cy + Math.sin(a) * rr * 0.94); ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); ctx.stroke(); }
    }
    // the decay: a wedge of slices behind the sweep, brightest at the sweep, gone forty degrees back
    if (rr >= 6) {
      const slices = fine ? 18 : 8, wedge = Math.min(span, 0.7);
      ctx.fillStyle = C.glass;
      for (let i = 0; i < slices; i++) {
        const a1 = sweep - (wedge * (i + 1)) / slices, a2 = sweep - (wedge * i) / slices;
        ctx.globalAlpha = 0.28 * (1 - i / slices) ** 1.6;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, rr, a1, a2); ctx.closePath(); ctx.fill();
      }
    }
    // the sweep
    ctx.globalAlpha = 1; ctx.lineWidth = SW; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * rr, cy + Math.sin(sweep) * rr); ctx.stroke();
    // blips: a target glows as the sweep passes it and fades the rest of the way round
    for (let i = 0; i < blips; i++) {
      const ba = from + g() * span, br = rr * (0.25 + g() * 0.65), d = Math.max(1.5, rr * 0.07);
      let age = sweep - ba; if (full) age = ((age % TAU) + TAU) % TAU; else if (age < 0) age += span;
      const glow = Math.max(0.2, 1 - age / (full ? TAU : span));
      const bx = cx + Math.cos(ba) * br, by = cy + Math.sin(ba) * br;
      ctx.fillStyle = C.glass;
      if (fine) { ctx.globalAlpha = glow * 0.3; ctx.beginPath(); ctx.arc(bx, by, d * 1.8, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = glow; ctx.fillRect(bx - d / 2, by - d / 2, d, d);
    }
    ctx.restore(); ctx.globalAlpha = 1; ctx.lineWidth = SW; ctx.fillStyle = C.stroke; ctx.strokeStyle = C.stroke;
  };
  // the part of each instrument that shows it is on: ink at rest, the lit glass colour when the module is on
  // on, the part's own lamps light: the glass, and every LED, pad, filament and fader track it has, each in a black
  // well on the plate. A part with no lamp of its own lights its plate mark instead, one to a module
  const ON = p.lit > 0, LAMP = ON ? C.glass : C.stroke;
  const carry = ON && p.lamps > 0 && !GLASS.has(T);
  if (ON && GLASS.has(T)) p.lamps = 0;
  // a lit mark on the plate sits in a black well, a bezel about a unit wide, so the lamp colour never lies straight on the face
  const rim = ON ? Math.max(1, Math.round(U * 0.6)) : 0;
  const litRect = (rx: number, ry: number, rw: number, rh: number, colour = LAMP) => { if (rim && colour !== C.stroke) { ctx.fillStyle = C.screen; ctx.fillRect(rx - rim, ry - rim, rw + rim * 2, rh + rim * 2); } ctx.fillStyle = colour; ctx.fillRect(rx, ry, rw, rh); ctx.fillStyle = C.stroke; };
  const litDot = (cx: number, cy: number, r: number, colour = LAMP) => { if (rim && colour !== C.stroke) { ctx.fillStyle = C.screen; ctx.beginPath(); ctx.arc(cx, cy, r + rim, 0, TAU); ctx.fill(); } ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); ctx.fillStyle = C.stroke; };
  // an instrument that will carry a corner lamp keeps a strip at the top clear for it
  // the kinds that carry a corner lamp keep the strip for it whether or not they are on, so lighting a module never
  // moves its parts: the wall lit as a show is the same wall, with its glass and its lamps on
  const y0 = y, lampRoom = PLATE_LAMP.has(T) && lvl >= 1 ? U * 2.5 : 0;
  y += lampRoom; h -= lampRoom;

  // The plate's own marks go on first, under whatever the instrument draws over them: a hatched
  // strip on one wide panel in eight, a short label bar on half. None on a box a cell or less
  // across, where they would only collide, and the hatch only where its strokes can be told apart.
  const lb = g(), lbw = 0.2 + g() * 0.3;
  // working now: the plate's mark blinks, the one signal every instrument shares
  const blink = p.lit === 2 && beat(tt, 450, 2) === 0;
  const markColour = carry ? (blink ? C.face : C.glass) : C.stroke;
  // the plain ones and the ones that carry a corner lamp get no label bar; the lamp is their mark
  // glass carries its own proof of being on, and its own blink while working: no extra mark on a screen
  // a mark takes a strip off the top of the box, so a reel or a dial drawn to its edge never runs into it
  let markRoom = 0;
  // a repeat along a strip, or a drawing turned to run down a tall panel, is one instrument: it carries no marks of its own
  if (lvl >= 1 && !inner && !PLAIN.has(T) && !PLATE_LAMP.has(T)) {
    if (lb < 0.12 && w > U * 24 && U >= 2.5 && p.lit === 0) {
      ctx.save(); ctx.beginPath(); ctx.rect(x + U * 2, y + U * 1, w - U * 4, U * 1.6); ctx.clip(); ctx.strokeStyle = C.stroke;
      for (let sx = x - U * 4; sx < x + w; sx += U * 3) { ctx.beginPath(); ctx.moveTo(sx, y + U * 3); ctx.lineTo(sx + U * 3, y); ctx.stroke(); }
      ctx.restore();
      markRoom = U * 2.2;
    } else if (lb < 0.5) {
      // on whole device pixels, so the bar is one crisp weight wherever it is drawn
      const sn = (v: number) => Math.round(v * DS) / DS;
      litRect(sn(x + U * 2), sn(y + U * 1.2), sn(w * lbw), Math.max(1, sn(U * 0.8)), markColour);
      if (carry) p.lamps = 0;
      markRoom = U * 2;
    }
  }
  y += markRoom; h -= markRoom;
  ctx.fillStyle = C.stroke; ctx.strokeStyle = C.stroke; ctx.lineWidth = SW;

  if (T === 0) { // knobs
    const n = Math.max(lvlX ? 2 : 1, Math.min(capX(8), Math.round(w / (U * 10))));
    const labeled = lvl === 2 && h > cell * 1.7 && w / n > 22;
    // only words the wall's face has every letter of, so a legend never prints with a hole in it
    const SAY = VOCAB.filter((v) => [...v.slice(0, 3)].every((c) => FONTED.has(c)));
    // the knob, its ticks and its legend are one group: sized so the ticks keep clear of the next knob and the plate's
    // edge, and set in the middle of the plate by what they actually take up, not by a fraction of it
    // a knob that would have to shrink to keep its ticks clear drops the ticks instead
    const rr0 = Math.max(1.5, Math.min(U * 3.2, h * 0.3)), half = w / n / 2 - U * 0.6;
    const ticked = lvl === 2 && Math.min(rr0, half / 1.5) > 7, reach = ticked ? 1.5 : 1;
    let rr = Math.max(1.5, Math.min(rr0, half / reach));
    // the type follows the knob, small as a legend is
    const ps = labeled ? Math.max(1, Math.floor(rr / 9)) : 0, gap = rr * 0.35;
    const below = (r: number) => r * Math.max(1, reach * 0.71);
    const span = (r: number) => r * reach + below(r) + (labeled ? gap + ps * 5 : 0);
    if (span(rr) > h - U * 2) rr = Math.max(1.5, rr * (h - U * 2) / span(rr));
    const cy = y + (h - span(rr)) / 2 + rr * reach;
    const sn = (v: number) => Math.round(v * DS) / DS;
    for (let i = 0; i < n; i++) {
      const cx = x + (w * (i + 0.5)) / n;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke(); shade(cx, cy, rr);
      const a = g() * 6.28 + (live ? Math.sin(wave(tt, TAU * 400) + i) * 0.9 : 0);
      ctx.strokeStyle = LAMP; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); ctx.stroke(); ctx.strokeStyle = C.stroke;
      if (ticked) {
        ctx.globalAlpha = 0.7; ctx.lineWidth = Math.max(1, SW * 0.5);
        for (let t = 0; t <= 6; t++) {
          const ta = Math.PI * (0.75 + (1.5 * t) / 6);
          ctx.beginPath(); ctx.moveTo(cx + Math.cos(ta) * rr * 1.25, cy + Math.sin(ta) * rr * 1.25);
          ctx.lineTo(cx + Math.cos(ta) * rr * (t % 3 ? 1.38 : 1.5), cy + Math.sin(ta) * rr * (t % 3 ? 1.38 : 1.5)); ctx.stroke();
        }
        ctx.globalAlpha = 1; ctx.lineWidth = SW;
      }
      if (labeled) {
        const wd = word(SAY).slice(0, 3);
        p.pix(wd, sn(cx - p.pixW(wd, ps) / 2), sn(cy + below(rr) + gap), ps, LAMP); ctx.fillStyle = C.stroke;
      }
    }
  } else if (T === 1) { // sliders
    const n = Math.max(lvlX ? 3 : 1, Math.min(capX(12), Math.round(w / (U * 6))));
    // the slot, the bar and the cap share one centre on whole device pixels: each width keeps the slot's odd or even
    // count of them, so the cap sits on the slot exactly and nothing has a soft edge on one side only
    const lw = Math.max(1, Math.round(SW * DS));
    const even = (css: number) => { let d = Math.max(1, Math.round(css * DS)); if ((d - lw) % 2) d++; return d / DS; };
    const sn = (v: number) => Math.round(v * DS) / DS;
    const scale = lvl === 2 && w / n > 14 && h > cell * 2.5;
    for (let i = 0; i < n; i++) {
      const sx = sn(x + (w * (i + 0.5)) / n) + hp();
      ctx.beginPath(); ctx.moveTo(sx, y + U * 3); ctx.lineTo(sx, y + h - U * 3); ctx.stroke();
      // the scale sits in the gutter between two faders, centred in it, so the bank is even from end to end
      if (scale && i < n - 1) {
        ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
        const mx = sn(x + (w * (i + 1)) / n);
        for (let t = 0; t <= 6; t++) { const ty = sn(y + U * 3 + ((h - U * 6) * t) / 6) + hp(); const half = U * (t % 3 ? 0.5 : 0.9); ctx.beginPath(); ctx.moveTo(mx - half, ty); ctx.lineTo(mx + half, ty); ctx.stroke(); }
        ctx.globalAlpha = 1; ctx.lineWidth = SW;
      }
      const ty = sn(y + U * 3 + (live ? 0.5 + 0.5 * Math.sin(wave(tt, TAU * 350) + i * 1.3) : g()) * (h - U * 8));
      // the travel below the cap is a filled bar: what the fader is set to, and what lights when the module is on
      // lit, the bar sits in a black well: it narrows by the well's width so the column never grows wider than the cap
      const bw = even(ON ? Math.max(1, U * 1.4 - rim * 2) : Math.max(2, U * 1.4)), cw = even(U * 3.2), ch = sn(U * 2);
      litRect(sx - bw / 2, ty + ch, bw, sn(y + h - U * 3) - ty - ch);
      ctx.fillRect(sx - cw / 2, ty, cw, ch);
      if (lvl >= 1) { ctx.globalAlpha = 0.35; ctx.fillRect(sx - cw / 2, ty + ch, cw, Math.max(1, sn(U * 0.6))); ctx.globalAlpha = 1; }
    }
  } else if (T === 2) { // meter
    // the glass is inset the same above as below, on whole device pixels; the needle pivots at its bottom edge
    const sn = (v: number) => Math.round(v * DS) / DS, gx = sn(x + U * 2), gy = sn(y + U * 3), gw = sn(x + w - U * 2) - gx, gh = sn(y + h - U * 3) - gy;
    scr(gx, gy, gw, gh);
    const cx = gx + gw / 2, cy = gy + gh, rr = Math.min(gw * 0.46, gh * 0.82, Math.min(w, h) * 0.42);
    ctx.strokeStyle = C.glass; ctx.beginPath(); ctx.arc(cx, cy, rr, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    const a = Math.PI * (1.15 + 0.7 * (live ? 0.5 + 0.45 * Math.sin(wave(tt, TAU * 260) + x) : g()));
    ctx.strokeStyle = C.glass; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * rr * 0.9, cy + Math.sin(a) * rr * 0.9); ctx.stroke();
  } else if (T === 3) { // scope: a graticule on black glass, a waveform drawn as a smooth curve with its phosphor glow
    // in a square box the glass is inset the same all round, so it sits centred; a wide one keeps more bezel top and bottom
    const square = w / h > 0.8 && w / h < 1.25, gm = square ? Math.max(2, Math.round(U * 2.5)) : 0;
    const gx = square ? x + gm : x + U * 2, gy = square ? y + gm : y + U * 3, gw = square ? w - gm * 2 : w - U * 4, gh = square ? h - gm * 2 : h - U * 6;
    scr(gx, gy, gw, gh);
    ctx.save(); ctx.beginPath(); ctx.rect(gx + 2, gy + 2, gw - 4, gh - 4); ctx.clip();
    const fine = Math.min(gw, gh) >= 24;
    // the graticule: a centre line and, on a glass with the room, an even grid with tick marks along the axes
    ctx.strokeStyle = C.glass; ctx.lineWidth = 1;
    const cyy = Math.round(gy + gh / 2) + hp(), cxx = Math.round(gx + gw / 2) + hp();
    if (fine) {
      const div = 8, sx = gw / div, sy = gh / Math.max(4, Math.round(div * gh / gw));
      ctx.globalAlpha = 0.16;
      for (let k = 1; k < div; k++) { const xx = Math.round(gx + sx * k) + hp(); ctx.beginPath(); ctx.moveTo(xx, gy); ctx.lineTo(xx, gy + gh); ctx.stroke(); }
      for (let yy = gy + sy; yy < gy + gh - 1; yy += sy) { const y2 = Math.round(yy) + hp(); ctx.beginPath(); ctx.moveTo(gx, y2); ctx.lineTo(gx + gw, y2); ctx.stroke(); }
      ctx.globalAlpha = 0.45;
      ctx.beginPath(); ctx.moveTo(gx, cyy); ctx.lineTo(gx + gw, cyy); ctx.moveTo(cxx, gy); ctx.lineTo(cxx, gy + gh); ctx.stroke();
      const tk = Math.max(1.5, U * 0.8);
      // the fifths only where they stand three pixels apart; packed closer they ran together into a grey bar along the axis
      const fifths = sx / 5 >= 3;
      for (let k = 1; k < div * 5; k++) { if (k % 5 && !fifths) continue; const xx = Math.round(gx + (sx * k) / 5) + hp(), t = k % 5 ? tk : tk * 2; ctx.beginPath(); ctx.moveTo(xx, cyy - t); ctx.lineTo(xx, cyy + t); ctx.stroke(); }
    } else {
      ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.moveTo(gx, cyy); ctx.lineTo(gx + gw, cyy); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // the trace: a signal built from a few harmonics, chosen by the seat, drawn point by point so it is a curve, not a fold;
    // live, it scrolls, the way a triggered sweep looks with the timebase a touch off the signal
    const f1 = 1 + Math.floor(g() * 3), f2 = f1 * (2 + Math.floor(g() * 2)), a2 = 0.15 + g() * 0.3, f3 = f1 * (3 + Math.floor(g() * 3)), a3 = g() * 0.15, ph0 = g() * TAU;
    const shape = g();
    // live, the signal is not a metronome: it scrolls with a timebase that drifts, breathes in amplitude, and now and
    // then jumps as the trigger slips, so no two seconds look alike
    const jump = live ? tick(tt, 2300) : 0, slip = jump ? rng(jump * 7 + x)() : 0;
    const drift = live ? Math.sin(wave(tt, TAU * 1700)) * 0.35 : 0, breathe = live ? 0.85 + 0.15 * Math.sin(wave(tt, TAU * 830)) + 0.06 * Math.sin(wave(tt, TAU * 190)) : 1;
    const amp = gh * 0.34 * breathe, mid = gy + gh / 2, phase = ph0 + (live ? wave(tt, TAU * 900) + drift + slip * TAU : 0);
    const signal = (t: number) => {
      const a = t * TAU * f1 + phase;
      if (shape < 0.2) return Math.sign(Math.sin(a)) * 0.85;
      if (shape < 0.35) return ((((a / TAU) % 1) + 1) % 1 * 2 - 1) * 0.9;
      if (shape < 0.5) {
        // a heartbeat: a flat line with the P wave, the QRS spike and the T wave in each period
        const u = (((a / TAU) % 1) + 1) % 1, bump = (c: number, wd: number, hgt: number) => hgt * Math.exp(-((u - c) * (u - c)) / (wd * wd));
        return bump(0.2, 0.05, 0.18) - bump(0.4, 0.012, 0.35) + bump(0.44, 0.014, 1.25) - bump(0.48, 0.014, 0.45) + bump(0.66, 0.06, 0.28) - 0.25;
      }
      return Math.sin(a) + a2 * Math.sin(a * (f2 / f1) + 1) + a3 * Math.sin(a * (f3 / f1));
    };
    const n = Math.max(12, Math.round(gw / (fine ? 1 : 2)));
    // a square or a sawtooth drops straight down: the sample just before each edge is drawn too, so the edge is vertical, not a slope
    const edged = shape < 0.35;
    const path = () => {
      ctx.beginPath();
      let first = true;
      const to = (t: number) => { const px = gx + gw * t, py = mid - amp * Math.max(-1.3, Math.min(1.3, signal(t))); if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py); };
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        if (edged && i) {
          // an edge falls where the phase crosses a half period or a full one; step to just before it, then just after
          const p0 = ((i - 1) / n) * f1 + phase / TAU, p1 = t * f1 + phase / TAU, k = shape < 0.2 ? 0.5 : 1;
          if (Math.floor(p0 / k) !== Math.floor(p1 / k)) { const e = (Math.floor(p1 / k) * k - phase / TAU) / f1; to(e - 1e-4); to(e + 1e-4); }
        }
        to(t);
      }
    };
    // the glow under the trace, then the trace itself
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    if (fine) { ctx.strokeStyle = C.glass; ctx.globalAlpha = 0.18; ctx.lineWidth = SW * 3; path(); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.lineWidth = Math.max(1, SW * 0.9); ctx.strokeStyle = C.glass; path(); ctx.stroke();
    ctx.restore(); ctx.lineWidth = SW;
  } else if (T === 4) { // matrix
    // a box the wall never draws this kind in by itself: only a holder's pick reaches it, so no existing panel changes
    if (!inner && w < cell * 1.75 && h < cell * 1.75 && !fits(T, w, h, cell)) {
      // one cell: a three by three block of lamps, a few lit, a chase running through them while working
      const m = Math.min(w, h), mcx = x + w / 2, mcy = y + h / 2, sn = (v: number) => Math.round(v * DS) / DS;
      const pitch = m * 0.27, mr = Math.max(0.8, m * 0.075);
      ctx.lineWidth = Math.max(1, SW * 0.8);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const px = mcx + i * pitch, py = mcy + j * pitch, chase = live && (i + 1 + (j + 1) * 3) === beat(tt, 260, 9);
        if ((g() < 0.4) !== chase) litDot(px, py, mr); else { ctx.strokeStyle = C.stroke; ctx.beginPath(); ctx.arc(px, py, mr, 0, TAU); ctx.stroke(); }
      }
      ctx.lineWidth = SW;
    } else {
      const nx = Math.max(lvlX ? 3 : 1, Math.min(capX(14), Math.round(w / (U * 4)))), ny = Math.max(lvlY ? 3 : 1, Math.min(capY(8), Math.round(h / (U * 5))));
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        // a little plate kept clear round the field, so the outer rings never run against the edge
        const mg = Math.max(1, U * 0.7), mx = x + mg + ((w - mg * 2) * (i + 0.5)) / nx, my = y + mg + ((h - mg * 2) * (j + 0.5)) / ny, mr = Math.max(0.8, U * 1.1);
        if (g() < 0.35 !== (live && (i + j + beat(tt, 500, 7)) % 7 === 0)) litDot(mx, my, mr); else { ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.stroke(); }
      }
    }
  } else if (T === 5) { // switches
    const n = Math.max(lvlX ? 3 : 1, Math.min(capX(12), Math.round(w / (U * 4.5)))), labeled = lvl === 2 && h > cell * 1.5 && w / n > 16;
    // only words the wall's face has every letter of
    const SAY = VOCAB.filter((v) => [...v.slice(0, 3)].every((c) => FONTED.has(c)));
    const sn = (v: number) => Math.round(v * DS) / DS, lw = ctx.lineWidth;
    // the bank keeps a margin at its ends, and the lamp, the switch and its legend are one group set in the middle of the
    // plate by what they take up: they sat high, with the empty plate all below them
    const ix = x + Math.min(U * 1.5, w * 0.06), iw = w - (ix - x) * 2, r = Math.max(0.8, U), bh = h * 0.3, lampGap = h * 0.15;
    const ps = labeled ? Math.max(1, Math.min(Math.floor((iw * 0.7) / n / 12), Math.round(U * 0.5))) : 0;
    const span = r + lampGap + bh + (labeled ? h * 0.07 + ps * 5 : 0), top = y + (h - span) / 2;
    const lampY = top + r, bodyY = sn(lampY + lampGap), bodyH = sn(lampY + lampGap + bh) - bodyY;
    for (let i = 0; i < n; i++) {
      const sx = sn(ix + (iw * (i + 0.15)) / n), sw = sn(ix + (iw * (i + 0.85)) / n) - sx;
      ring(sx, bodyY, sw, bodyH);
      const on = g() < 0.5 !== (live && (beat(tt, 700, 5) + i) % 5 === 0);
      if (on) ctx.fillRect(sx + lw, bodyY + lw, sw - lw * 2, sn((bodyH - lw * 2) / 2));
      if (g() < 0.4 || ON) litDot(sx + sw / 2, lampY, r); else { ctx.beginPath(); ctx.arc(sx + sw / 2, lampY, r, 0, TAU); ctx.stroke(); }
      if (labeled) { const wd = word(SAY).slice(0, 3); p.pix(wd, sn(sx + sw / 2 - p.pixW(wd, ps) / 2), sn(bodyY + bodyH + h * 0.07), ps, C.stroke); ctx.fillStyle = C.stroke; }
    }
  } else if (T === 7) { // dial
    const cx = x + w / 2, cy = y + h / 2, rr = Math.min(w, h) * 0.38;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke(); shade(cx, cy, rr);
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * rr * 0.75, cy + Math.sin(a) * rr * 0.75); ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); ctx.stroke(); }
    const a = g() * 6.28 + (live ? wave(tt, TAU * 900) : 0);
    ctx.strokeStyle = LAMP; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * rr * 0.7, cy + Math.sin(a) * rr * 0.7); ctx.stroke(); ctx.strokeStyle = C.stroke;
  } else if (T === 8) { // radar: a round PPI, the sweep going round with its glow decaying behind it
    const cx = x + w / 2, cy = y + h / 2, rr = Math.min(w, h) * 0.42;
    ctx.fillStyle = C.screen; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.fill();
    // each set turns at its own rate and from its own start, so two on a wall are never in step
    const ph = g() * TAU, rate = 1800 + g() * 1200;
    ppi(cx, cy, rr, 0, TAU, live ? (ph + wave(tt, TAU * rate)) % TAU : ph, lvl ? 3 : 1);
  } else if (T === 9) { // seven-segment counter
    const sn = (v: number) => Math.round(v * DS) / DS, gx = sn(x + U * 2), gy = sn(y + U * 3);
    scr(gx, gy, sn(x + w - U * 2) - gx, sn(y + h - U * 3) - gy);
    const digits = Math.max(lvlX ? 2 : 1, Math.min(capX(6), Math.floor((w - U * 6) / (U * 6))));
    const val = Math.floor((live ? tick(tt, 250) : 0) + g() * 1e6) % 10 ** digits;
    // a digit is two thirds of its pitch wide: the row starts a sixth of a pitch in, so it ends as far from the glass's other side
    const dw = (w - U * 6) / digits, dh = Math.min(h - U * 10, dw * 1.5);
    p.seg7(String(val).padStart(digits, "0"), sn(x + U * 3 + dw * 0.17), sn(y + (h - dh) / 2), dw, dh, C.glass);
  } else if (T === 10) { // pad grid
    const nx = Math.max(lvlX ? 2 : 1, Math.min(capX(6), Math.round(w / (U * 7)))), ny = Math.max(lvlY ? 2 : 1, Math.min(capY(4), Math.round(h / (U * 7))));
    const pw = w / nx, ph = h / ny, hit = live ? beat(tt, 220, nx * ny) : -1;
    // every pad on whole device pixels, its rim a rubber key's and not a frame's, the lit fill flush inside the rim on
    // all four sides and the unlit dot dead centre: its size keeps the pad's odd or even count of pixels each way
    const sn = (v: number) => Math.round(v * DS) / DS;
    const lw = Math.max(1, Math.min(SW, Math.round(Math.min(pw, ph) * 0.06 * 2) / 2));
    const dot = (L: number) => { let d = Math.max(2, Math.round(Math.max(1.5, Math.min(pw, ph) * 0.1) * DS)); if ((Math.round(L * DS) - d) % 2) d++; return d / DS; };
    ctx.lineWidth = lw;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const bx = sn(x + pw * (i + 0.12)), by = sn(y + ph * (j + 0.12)), bw = sn(x + pw * (i + 0.88)) - bx, bh = sn(y + ph * (j + 0.88)) - by;
      const on = g() < 0.3 !== (i + j * nx === hit);
      ctx.strokeStyle = C.stroke; ring(bx, by, bw, bh); ctx.fillStyle = C.stroke;
      // lit, its lamp's black well stays inside the rim: the pad never looks bigger than its neighbours
      if (on) { const k = Math.max(lw, rim); litRect(bx + k, by + k, bw - k * 2, bh - k * 2); }
      else { const dw = dot(bw), dh = dot(bh); ctx.fillRect(bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh); }
    }
    ctx.lineWidth = SW;
  } else if (T === 12) { // LED column, or a bank of them on a wide panel
    const n = Math.max(lvlY ? 4 : 1, Math.min(capY(16), Math.round(h / (U * 2.6))));
    const m = lvlX >= 1 && w > U * 14 ? Math.max(1, Math.min(8, Math.floor(w / (U * 7)))) : 1;
    const bw = Math.min((w / m) * 0.5, U * 6);
    // the segments step by a whole number of device pixels, the stack centred on the plate, so every segment is the
    // same height and every gap the same, crisp at any scale
    const sn = (v: number) => Math.round(v * DS) / DS;
    const P = Math.max(2, Math.floor(((h - U * 4) * DS) / n)), gapD = Math.max(1, Math.round(Math.min(2 * DS, P * 0.3)));
    const top0 = sn(y + (h - (P * n) / DS) / 2), segH = (P - gapD) / DS;
    for (let c = 0; c < m; c++) {
      const lvv = live ? 0.5 + 0.5 * Math.sin(wave(tt, TAU * 330) + x + c * 1.7) : g();
      const bx = sn(x + (w * (c + 0.5)) / m - bw / 2), bww = sn(x + (w * (c + 0.5)) / m + bw / 2) - bx;
      for (let i = 0; i < n; i++) { const by = top0 + ((n - 1 - i) * P + gapD / 2) / DS, up = i / n < lvv; if (up) { ctx.globalAlpha = 1; const k = Math.min(rim, segH / 3); litRect(bx + k, sn(by) + k, bww - k * 2, segH - k * 2); } else { ctx.fillStyle = C.stroke; ctx.globalAlpha = 0.18; ctx.fillRect(bx, sn(by), bww, segH); } }
    }
    ctx.globalAlpha = 1;
  } else if (T === 13) { // rocker toggles
    const n = Math.max(lvlX ? 2 : 1, Math.min(capX(8), Math.round(w / (U * 6)))), tw = w / n;
    for (let i = 0; i < n; i++) {
      const up = g() < 0.5 !== (live && (beat(tt, 600, 3) + Math.round(i * 0.7)) % 3 === 0);
      // the rocker on whole device pixels, the pressed half flush inside its rim, the two halves split on a pixel
      const sn = (v: number) => Math.round(v * DS) / DS, lw = ctx.lineWidth;
      const px = sn(x + tw * (i + 0.25)), py = sn(y + h * 0.2), pw = sn(x + tw * (i + 0.75)) - px, ph = sn(y + h * 0.8) - py;
      const k = Math.max(lw, rim), half = sn((ph - k * 2) / 2);
      ctx.strokeStyle = C.stroke; ring(px, py, pw, ph); litRect(px + k, up ? py + k : py + ph - k - half, pw - k * 2, half);
    }
  } else if (T === 14) { // transport: five buttons across the plate, tall as the box allows, each glyph centred
    // a box the wall never draws this kind in by itself: only a holder's pick reaches it, so no existing panel changes
    if (!inner && w < cell * 1.75 && h < cell * 1.75 && !fits(T, w, h, cell)) {
      // one cell: the play key alone, square, its triangle centred on the triangle's own middle; lit while on, pressed while working
      const m = Math.min(w, h), mcx = x + w / 2, mcy = y + h / 2, sn = (v: number) => Math.round(v * DS) / DS;
      const ks = sn(m * 0.68), kx = sn(mcx - ks / 2), ky = sn(mcy - ks / 2), lw = ctx.lineWidth;
      ctx.strokeStyle = C.stroke; ring(kx, ky, ks, ks);
      const pressed = ON && (!live || beat(tt, 700, 2) === 0);
      if (pressed) { const k = Math.max(lw, rim); litRect(kx + k, ky + k, ks - k * 2, ks - k * 2); }
      const r = ks * 0.22;
      ctx.fillStyle = pressed ? C.screen : C.stroke; ctx.beginPath();
      ctx.moveTo(mcx - r * 0.75, mcy - r); ctx.lineTo(mcx + r * 1.0, mcy); ctx.lineTo(mcx - r * 0.75, mcy + r); ctx.closePath(); ctx.fill();
      ctx.fillStyle = C.stroke;
    } else if (!inner && w >= cell * 2.3 && h >= cell * 1.8 && !fits(T, w, h, cell)) {
      // a panel only a holder's pick reaches: the deck's whole control surface, the five keys large along the bottom, a
      // level meter and the tape counter over them; working, the lit key steps along the row and the counter runs
      const sn = (v: number) => Math.round(v * DS) / DS, lw = ctx.lineWidth;
      const pad = U * 2.5, ix = x + pad, iw = w - pad * 2, iy = y + pad, ih = h - pad * 2, gap = Math.max(1, U * 1.2), vgap = U * 2.5;
      const kw = (iw - gap * 4) / 5, keysH = Math.min(ih * 0.42, kw * 0.85), topH = ih - keysH - vgap;
      const ky = sn(iy + ih - keysH), kh = sn(iy + ih) - ky, hit = live ? beat(tt, 450, 5) : -1;
      ctx.strokeStyle = C.stroke;
      for (let i = 0; i < 5; i++) {
        const kx = sn(ix + (kw + gap) * i), kww = sn(ix + (kw + gap) * i + kw) - kx, cx = kx + kww / 2, cy = ky + kh / 2, r = Math.min(kww, kh) * 0.22;
        ring(kx, ky, kww, kh);
        const lit = i === hit || (ON && hit < 0 && i === 1);
        if (lit) { const k = Math.max(lw, rim); litRect(kx + k, ky + k, kww - k * 2, kh - k * 2); }
        ctx.fillStyle = lit ? (ON ? C.screen : C.face) : C.stroke; ctx.beginPath();
        if (i === 0) { ctx.moveTo(cx + r * 0.1, cy - r); ctx.lineTo(cx - r, cy); ctx.lineTo(cx + r * 0.1, cy + r); ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx, cy); ctx.lineTo(cx + r, cy + r); }
        else if (i === 1) { ctx.moveTo(cx - r * 0.6, cy - r); ctx.lineTo(cx + r * 0.8, cy); ctx.lineTo(cx - r * 0.6, cy + r); }
        else if (i === 2) { ctx.rect(cx - r * 0.85, cy - r, r * 0.6, r * 2); ctx.rect(cx + r * 0.25, cy - r, r * 0.6, r * 2); }
        else if (i === 3) ctx.rect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
        else ctx.arc(cx, cy, r * 0.9, 0, TAU);
        ctx.fill(); ctx.fillStyle = C.stroke;
      }
      // the level meter at the right: two rows of segments, the left and right channels
      const mw = iw * 0.4, mx = ix + iw - mw, segs = 10, sg = Math.max(1, U * 0.8), sw2 = (mw - sg * (segs - 1)) / segs, rowH = Math.max(2, Math.min(U * 2.2, topH * 0.22));
      const lvA = live ? 0.55 + 0.35 * Math.sin(wave(tt, TAU * 210)) : g(), lvB = live ? 0.55 + 0.35 * Math.sin(wave(tt, TAU * 260) + 1) : g();
      for (let r2 = 0; r2 < 2; r2++) {
        const yy = sn(iy + topH / 2 + (r2 ? sg : -sg - rowH)), on = Math.round((r2 ? lvB : lvA) * segs);
        for (let i = 0; i < segs; i++) {
          const sx = sn(mx + (sw2 + sg) * i), sww = sn(mx + (sw2 + sg) * i + sw2) - sx;
          // segments sit on the plate side by side, so a lit one takes the lamp colour without the well a lone lamp gets
          if (i < on) { ctx.fillStyle = LAMP; ctx.fillRect(sx, yy, sww, sn(rowH)); ctx.fillStyle = C.stroke; } else { ctx.globalAlpha = 0.25; ctx.fillRect(sx, yy, sww, sn(rowH)); ctx.globalAlpha = 1; }
        }
      }
      // the tape counter at the left, in glass; drawn last, as the glass keeps what follows it inside
      const cw = iw * 0.48, gy = sn(iy), gh = sn(iy + topH) - gy;
      scr(sn(ix), gy, sn(ix + cw) - sn(ix), gh);
      const dw = Math.min((cw - U * 5) / 3.66, (gh - U * 4) / 1.5), dh = dw * 1.5, val = Math.floor((live ? tick(tt, 160) : 0) + g() * 1e4) % 1e4;
      if (dw >= 2) p.seg7(String(val).padStart(4, "0"), ix + (cw - dw * 3.66) / 2, gy + (gh - dh) / 2, dw, dh, C.glass);
      ctx.fillStyle = C.stroke;
    } else {
      const n = lvlX ? 5 : 1, pad = Math.max(1, Math.min(U * 1.5, h * 0.2, w * 0.1)), bw = (w - pad * 2) / n, bh = Math.max(2, Math.min(h - pad * 2, bw * 1.25)), by = y + (h - bh) / 2, hit = live ? beat(tt, 400, n) : -1;
      ctx.fillStyle = C.stroke; ctx.strokeStyle = C.stroke;
      for (let i = 0; i < n; i++) {
        // each key's edges on whole device pixels from its own share of the row, so the gaps are even end to end; the
        // outline inside the key and a lit key's fill flush inside the outline
        const sn = (v: number) => Math.round(v * DS) / DS, lw = ctx.lineWidth;
        const bx = sn(x + pad + bw * (i + 0.07)), bww = sn(x + pad + bw * (i + 0.93)) - bx, byy = sn(by), bhh = sn(by + bh) - byy;
        const cx = bx + bww / 2, cy = byy + bhh / 2, r = Math.max(0.5, Math.min(bww, bhh) * 0.27);
        ring(bx, byy, bww, bhh);
        if (i === hit || (ON && hit < 0 && (n === 1 || i === 1))) { const k = Math.max(lw, rim); litRect(bx + k, byy + k, bww - k * 2, bhh - k * 2); ctx.fillStyle = ON ? C.screen : C.face; }
        const gi = n === 1 ? 1 : i; ctx.beginPath();
        if (gi === 0) { ctx.moveTo(cx + r * 0.55, cy - r); ctx.lineTo(cx - r * 0.7, cy); ctx.lineTo(cx + r * 0.55, cy + r); }
        else if (gi === 1) { ctx.moveTo(cx - r * 0.55, cy - r); ctx.lineTo(cx + r * 0.7, cy); ctx.lineTo(cx - r * 0.55, cy + r); }
        else if (gi === 2) { ctx.rect(cx - r * 0.9, cy - r, r * 0.65, r * 2); ctx.rect(cx + r * 0.25, cy - r, r * 0.65, r * 2); }
        else if (gi === 3) ctx.rect(cx - r * 0.9, cy - r * 0.9, r * 1.8, r * 1.8);
        else ctx.arc(cx, cy, r * 0.95, 0, TAU);
        ctx.fill(); ctx.fillStyle = C.stroke;
      }
    }
  } else if (T === 16) { // tape reels
    // a box the wall never draws this kind in by itself: only a holder's pick reaches it, so no existing panel changes
    if (!inner && w < cell * 1.75 && h < cell * 1.75 && !fits(T, w, h, cell)) {
      // one cell: a single reel, turning, with the tape running off it to the head below
      const m = Math.min(w, h), mcx = x + w / 2, mcy = y + h / 2, sn = (v: number) => Math.round(v * DS) / DS;
      const rr = m * 0.3, bh = sn(Math.max(1.5, m * 0.08)), gap = m * 0.08, top = mcy - (rr * 2 + gap + bh) / 2, cy = top + rr;
      const a = live ? wave(tt, TAU * 400) : g() * 6.28;
      ctx.strokeStyle = C.stroke; ctx.lineWidth = Math.max(1, SW);
      ctx.beginPath(); ctx.arc(mcx, cy, rr, 0, TAU); ctx.stroke();
      litDot(mcx, cy, rr * 0.3);
      for (let i = 0; i < 3; i++) { const b = a + i * 2.094; ctx.beginPath(); ctx.moveTo(mcx + Math.cos(b) * rr * 0.32, cy + Math.sin(b) * rr * 0.32); ctx.lineTo(mcx + Math.cos(b) * rr * 0.88, cy + Math.sin(b) * rr * 0.88); ctx.stroke(); }
      const hw = sn(m * 0.56), hx = sn(mcx - hw / 2);
      scr(hx, sn(cy + rr + gap), hw, bh);
    } else {
      // two reels side by side with daylight between them (they overlapped on every plate), and the reels and the head
      // under them set as one group in the middle of the plate
      const sn = (v: number) => Math.round(v * DS) / DS;
      const rr = Math.min(w * 0.17, h * 0.34), bh = sn(Math.max(2, h * 0.1)), gap = h * 0.07, top = y + (h - (rr * 2 + gap + bh)) / 2;
      const cy = top + rr, a = live ? wave(tt, TAU * 400) : g() * 6.28;
      // the two reels are never in phase: the take-up's spokes sit half a spoke round from the supply's
      [x + w * 0.3, x + w * 0.7].forEach((cx, k) => {
        ctx.strokeStyle = C.stroke; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
        litDot(cx, cy, rr * 0.28);
        for (let i = 0; i < 3; i++) { const b = a + k * 1.047 + i * 2.094; ctx.beginPath(); ctx.moveTo(cx + Math.cos(b) * rr * 0.3, cy + Math.sin(b) * rr * 0.3); ctx.lineTo(cx + Math.cos(b) * rr * 0.9, cy + Math.sin(b) * rr * 0.9); ctx.stroke(); }
      });
      const hx = sn(x + w * 0.2);
      scr(hx, sn(cy + rr + gap), sn(x + w * 0.8) - hx, bh);
    }
  } else if (T === 17) { // patch bay: rows of jacks that fill the plate, a third of them cabled
    // a box the wall never draws this kind in by itself: only a holder's pick reaches it, so no existing panel changes
    if (!inner && w < cell * 1.75 && h < cell * 1.75 && !fits(T, w, h, cell)) {
      // one cell: two jacks side by side and a cord hanging between them, a plug in each
      const m = Math.min(w, h), mcx = x + w / 2, mcy = y + h / 2, sn = (v: number) => Math.round(v * DS) / DS;
      const jr = Math.max(1.5, m * 0.13), drop = m * 0.74, jy = mcy - (drop / 2 - jr) / 2, ax = mcx - m * 0.22, bx = mcx + m * 0.22;
      ctx.strokeStyle = C.stroke; ctx.lineWidth = Math.max(1, Math.min(SW * 1.5, jr * 0.45));
      const sway = live ? Math.sin(wave(tt, TAU * 900)) * m * 0.03 : 0;
      ctx.beginPath(); ctx.moveTo(ax, jy); ctx.quadraticCurveTo(mcx + sway, jy + drop, bx, jy); ctx.stroke();
      ctx.lineWidth = Math.max(1, SW * 0.8);
      for (const jx of [ax, bx]) { ctx.beginPath(); ctx.arc(jx, jy, jr, 0, TAU); ctx.stroke(); litDot(jx, jy, jr * 0.75); ctx.fillStyle = C.stroke; ctx.beginPath(); ctx.arc(jx, jy, jr * (ON ? 0.45 : 0.6), 0, TAU); ctx.fill(); }
      ctx.lineWidth = SW;
    } else {
      // the field follows the box: more columns across a wide one, more rows down a tall one, so the biggest panel is the fullest
      // jacks stay the size of a real jack on any plate, and the first row clears the plate's label bar
      const jr = Math.max(1.5, Math.min(U * 1.8, cell * 0.24)), top = y + Math.max(h * 0.16, U * 2.5 + jr), bot = y + h * 0.84;
      const n = Math.max(lvlX ? 3 : 1, Math.min(capX(12), Math.round(w / (jr * 4.4)))), m = Math.max(1, Math.min(capY(6), Math.floor((bot - top) / (jr * 4.2)) + 1));
      const px = (i: number) => x + (w * (i + 0.5)) / n, py = (r: number) => (m === 1 ? (top + bot) / 2 : top + ((bot - top) * r) / (m - 1));
      // on, only a jack with a cord in it lights, the collar around the plug; the rest stay ink, and the cords stay cords
      const ring = Math.max(1, SW * 0.8);
      const jack = (jx: number, jyy: number, plugged: boolean) => { ctx.strokeStyle = C.stroke; ctx.lineWidth = ring; ctx.beginPath(); ctx.arc(jx, jyy, jr, 0, TAU); ctx.stroke(); if (plugged) litDot(jx, jyy, jr * 0.75); else { ctx.fillStyle = C.stroke; ctx.beginPath(); ctx.arc(jx, jyy, jr * 0.35, 0, TAU); ctx.fill(); } ctx.fillStyle = C.stroke; ctx.strokeStyle = C.stroke; ctx.lineWidth = SW; };
      // cords go on first and the jacks over them, so a cord sagging across a lower row never hides its rings; then a plug at each end
      const free = [...Array(n * m).keys()];
      for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(g() * (i + 1)); [free[i], free[j]] = [free[j] as number, free[i] as number]; }
      const cords = Math.min(Math.floor(free.length / 2), Math.max(1, Math.round(n * m * 0.16)));
      const ends: Array<[number, number]> = [];
      ctx.strokeStyle = C.stroke; ctx.lineWidth = Math.max(1, Math.min(SW * 1.5, jr * 0.45));
      for (let c = 0; c < cords; c++) {
        const a = free[c * 2] as number, b = free[c * 2 + 1] as number;
        const ax = px(a % n), ay = py(Math.floor(a / n)), bx = px(b % n), by = py(Math.floor(b / n));
        // a cord sags with the span it hangs across; two jacks one above the other take it straight, with no loop below the lower
        const span = Math.abs(ax - bx), low = Math.max(ay, by), droop = Math.min(Math.min(U * 3.5, span * 0.35) + span * 0.1, Math.max(0, y + h - low - jr - U));
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + bx) / 2, low + droop * 2, bx, by); ctx.stroke();
        ends.push([ax, ay], [bx, by]);
      }
      ctx.lineWidth = SW;
      const plugged = new Set(ends.map(([cx, cy]) => `${cx},${cy}`));
      for (let r = 0; r < m; r++) for (let i = 0; i < n; i++) jack(px(i), py(r), plugged.has(`${px(i)},${py(r)}`));
      for (const [cx, cy] of ends) { ctx.beginPath(); ctx.arc(cx, cy, jr * (ON ? 0.45 : 0.6), 0, TAU); ctx.fill(); }
      ctx.lineWidth = SW;
    }
  } else if (T === 18) { // readout: seven-segment digits, a pixel-font unit
    // a box the wall never draws this kind in by itself: only a holder's pick reaches it, so no existing panel changes
    if (!inner && w < cell * 1.75 && h < cell * 1.75 && !fits(T, w, h, cell)) {
      // one cell: two seven-segment digits behind glass, counting while working
      const m = Math.min(w, h), mcx = x + w / 2, mcy = y + h / 2, sn = (v: number) => Math.round(v * DS) / DS;
      const gm = sn(Math.max(2, m * 0.12)), gx = sn(x + gm), gy = sn(mcy - m * 0.3), gw = sn(x + w - gm) - gx, gh = sn(mcy + m * 0.3) - gy;
      scr(gx, gy, gw, gh);
      const val = String((Math.floor(g() * 100) + (live ? tick(tt, 700) : 0)) % 100).padStart(2, "0");
      const dh = gh * 0.62, dw = Math.min(dh / 1.4, (gw * 0.82) / (2 - 0.34));
      // a digit draws in the left two thirds of its pitch: the pair is centred on what shows
      p.seg7(val, sn(mcx - (dw * 2 - dw * 0.34) / 2), sn(mcy - dh / 2), dw, dh, C.glass);
    } else {
      const sn = (v: number) => Math.round(v * DS) / DS, gx = sn(x + U * 2), gy = sn(y + U * 3);
      scr(gx, gy, sn(x + w - U * 2) - gx, sn(y + h - U * 3) - gy);
      const unit = lvl ? word(UNITS) : "", base = Math.floor(g() * 900);
      const val = String((base + (live ? beat(tt, 700, 9) : 0)) % 1000).padStart(3, "0");
      const ps = Math.max(1, Math.floor(Math.min(h * 0.3, w * 0.16) / 5)), uw = unit ? p.pixW(unit, ps) + ps * 2 : 0;
      const dh = Math.min(h - U * 8, ((w - U * 8 - uw) / 3) * 1.4), dw = dh / 1.4;
      // a digit is drawn in the left two thirds of its pitch: with no unit after it the row moves right by the rest, so the
      // last digit ends at the margin; with one, that third is the space before the unit
      p.seg7(val, sn(x + w - U * 4 - uw - dw * 3 + (unit ? 0 : dw * 0.34)), sn(y + (h - dh) / 2), dw, dh, C.glass);
      if (unit) p.pix(unit, sn(x + w - U * 4 - uw + ps * 2), sn(y + h / 2 - ps * 2.5), ps, C.glass);
    }
  } else if (T === 19) { // a world on glass: one of four bodies by the seat, each with its own face, and something in orbit round it
    scr(x + U * 2, y + U * 2, w - U * 4, h - U * 4);
    const cx = x + w / 2, cy = y + h / 2, rr = Math.min(w, h) * 0.32, fine = rr >= 9;
    const body = Math.floor(g() * 5), tilt = (g() - 0.5) * 0.9, spin = live ? wave(tt, TAU * 2400) : g() * TAU;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(tilt); ctx.translate(-cx, -cy);
    ctx.strokeStyle = C.glass; ctx.fillStyle = C.glass; ctx.lineWidth = Math.max(1, SW * 0.8);
    // the limb
    ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, rr - 0.5, 0, TAU); ctx.clip();
    if (body === 0) { // the wireframe earth: meridians turning, parallels, a scatter of land
      ctx.globalAlpha = 0.4;
      const m = fine ? 4 : 2;
      for (let k = 0; k < m; k++) { const f = Math.cos(spin + (k * Math.PI) / m); ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(0.5, Math.abs(f) * rr), rr, 0, 0, TAU); ctx.stroke(); }
      for (const f of fine ? [-0.6, -0.3, 0, 0.3, 0.6] : [0]) { const yy = cy + rr * f, hw = Math.sqrt(1 - f * f) * rr; ctx.beginPath(); ctx.moveTo(cx - hw, yy); ctx.lineTo(cx + hw, yy); ctx.stroke(); }
      if (fine) { ctx.globalAlpha = 0.85; for (let i = 0; i < 7; i++) { const a = g() * TAU + spin * 0.5, d = g() * rr * 0.75, lw = 2 + g() * rr * 0.3; ctx.fillRect(cx + Math.cos(a) * d - lw / 2, cy + Math.sin(a) * d - 1, lw, Math.max(1, rr * 0.08)); } }
    } else if (body === 1) { // a banded giant: stripes of unequal weight, a storm spot
      const bands = fine ? 7 : 3;
      for (let k = 0; k < bands; k++) {
        const f0 = -0.85 + (1.7 * k) / bands, f1 = -0.85 + (1.7 * (k + 1)) / bands, bh = (f1 - f0) * rr * (0.35 + g() * 0.5);
        const yy = cy + ((f0 + f1) / 2) * rr; ctx.globalAlpha = 0.25 + g() * 0.35;
        ctx.fillRect(cx - rr, yy - bh / 2, rr * 2, Math.max(1, bh));
      }
      if (fine) { ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.ellipse(cx + rr * 0.25, cy + rr * 0.3, rr * 0.2, rr * 0.11, 0, 0, TAU); ctx.stroke(); }
    } else if (body === 2) { // a cratered moon: a terminator, the dark side dimmer, craters as rings
      const term = Math.cos(spin);
      ctx.globalAlpha = 0.22; ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(0.5, Math.abs(term) * rr), rr, 0, term > 0 ? -1.5708 : 1.5708, term > 0 ? 1.5708 : 4.7124); ctx.lineTo(cx, cy + (term > 0 ? -rr : rr)); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.6;
      for (let i = 0; i < (fine ? 6 : 2); i++) { const a = g() * TAU, d = g() * rr * 0.7, cr = rr * (0.06 + g() * 0.14); ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, cr, 0, TAU); ctx.stroke(); }
    } else if (body === 3) { // a ringed world: the ball, the ring seen edge-on in front, the far side of it hidden
      ctx.globalAlpha = 0.35; for (const f of fine ? [-0.5, 0, 0.5] : [0]) { const yy = cy + rr * f, hw = Math.sqrt(1 - f * f) * rr; ctx.beginPath(); ctx.moveTo(cx - hw, yy); ctx.lineTo(cx + hw, yy); ctx.stroke(); }
    } else { // the earth itself: the continents, coarse, on an orthographic globe that turns; the far side does not show
      ctx.globalAlpha = 0.85;
      for (const land of EARTH) {
        ctx.beginPath(); let started = false, drawn = 0;
        for (const [lon, lat] of land) {
          const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180 + spin;
          const zz = Math.cos(la) * Math.cos(lo), px = cx + Math.cos(la) * Math.sin(lo) * rr, py = cy - Math.sin(la) * rr;
          if (zz < 0) { started = false; continue; }
          if (started) ctx.lineTo(px, py); else ctx.moveTo(px, py);
          started = true; drawn++;
        }
        if (drawn > 2) { ctx.closePath(); ctx.fill(); }
      }
      if (fine) { ctx.globalAlpha = 0.25; for (const f of [-0.6, -0.3, 0, 0.3, 0.6]) { const yy = cy + rr * f, hw = Math.sqrt(1 - f * f) * rr; ctx.beginPath(); ctx.moveTo(cx - hw, yy); ctx.lineTo(cx + hw, yy); ctx.stroke(); } }
    }
    ctx.restore();
    if (body === 3) {
      ctx.globalAlpha = 0.8;
      for (const f of fine ? [1.35, 1.6, 1.8] : [1.6]) { ctx.beginPath(); ctx.ellipse(cx, cy, rr * f, rr * f * 0.22, 0, 0, Math.PI); ctx.stroke(); }
      ctx.globalAlpha = 0.35;
      for (const f of fine ? [1.35, 1.6, 1.8] : [1.6]) { ctx.beginPath(); ctx.ellipse(cx, cy, rr * f, rr * f * 0.22, 0, Math.PI, TAU); ctx.stroke(); }
    }
    ctx.restore();
    // the orbit and what rides it: a satellite, drawn behind the body when on the far side
    const oa = live ? wave(tt, TAU * 1500) : g() * TAU, tiltO = (g() - 0.5) * 1.2, ox = rr * 1.45, oy = rr * 0.42;
    ctx.strokeStyle = C.glass; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(cx, cy, ox, oy, tiltO, 0, TAU); ctx.stroke();
    const sx = Math.cos(oa) * ox, sy = Math.sin(oa) * oy, px = cx + sx * Math.cos(tiltO) - sy * Math.sin(tiltO), py = cy + sx * Math.sin(tiltO) + sy * Math.cos(tiltO);
    ctx.globalAlpha = Math.sin(oa) < 0 ? 0.45 : 1; ctx.fillStyle = C.glass;
    ctx.beginPath(); ctx.arc(px, py, Math.max(1.2, U * 1.2), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1; ctx.lineWidth = SW; ctx.fillStyle = C.stroke; ctx.strokeStyle = C.stroke;
  } else if (T === 20 && !inner && w >= cell * 2.3 && h >= cell * 1.8 && !fits(T, w, h, cell)) { // thermometer, a bank: tubes side by side on one scale
    // a panel only a holder's pick reaches: three to six tubes, each its own reading, a shared scale down the left
    const sn = (v: number) => Math.round(v * DS) / DS, lw = ctx.lineWidth;
    const n = Math.max(3, Math.min(6, Math.round((w - U * 10) / (U * 6)))), tw = Math.max(4, Math.round(Math.min(U * 3.4, (w - U * 14) / n * 0.4))), br = tw * 0.78;
    const scaleW = U * 4, left = x + U * 3 + scaleW, span = w - U * 6 - scaleW, step = span / n;
    const top = y + U * 3, by = y + h - U * 3 - br, bot = by - br * 0.4, inner2 = bot - top - lw;
    // the scale: ticks the height of the tubes, long every other
    for (let i = 0; i <= 8; i++) { const ty = sn(top + lw + ((bot - top - lw) * i) / 8); ctx.fillRect(sn(x + U * 3 + (i % 2 ? scaleW * 0.45 : 0)), ty, sn(i % 2 ? scaleW * 0.55 : scaleW) - U * 1.2, Math.max(1, Math.round(SW * 0.5 * DS) / DS)); }
    // a fine glass wall, so the column inside reads as much as the tube does
    const tl = Math.max(1, Math.round(SW * 0.6 * DS) / DS);
    for (let i = 0; i < n; i++) {
      const tx = sn(left + step * (i + 0.5)), lvv = live ? 0.5 + 0.4 * Math.sin(wave(tt, TAU * 900) + i * 1.7) : 0.2 + g() * 0.7;
      ctx.strokeStyle = C.stroke; ctx.lineWidth = tl; ring(tx - tw / 2, top, tw, bot - top + tl); ctx.lineWidth = SW;
      const gap2 = tl + Math.max(1, Math.round(tw * 0.12));
      litRect(tx - tw / 2 + gap2, top + gap2 + (inner2 - gap2) * (1 - lvv), tw - gap2 * 2, (inner2 - gap2) * lvv + gap2);
      litDot(tx, by, br);
    }
  } else if (T === 20) { // thermometer
    // the tube, its bulb and its scale centred as one figure; the bulb sits inside the plate's margin, never against its edge
    const lvv = live ? 0.5 + 0.45 * Math.sin(wave(tt, TAU * 700) + x) : g();
    const tw = Math.max(3, Math.round(Math.min(U * 3, w * 0.22))), br = tw * 0.9, scale = lvlX >= 1 && w >= tw + U * 6;
    const gap = Math.max(1, U), tl = U * 2, right = Math.max(br, tw / 2 + (scale ? gap + tl : 0)), left = Math.max(br, tw / 2);
    const tx = Math.round((x + w / 2 - (right - left) / 2) * DS) / DS, top = y + U * 3, by = y + h - U * 2.5 - br, bot = by - br * 0.4;
    const lw = ctx.lineWidth, inner = bot - top - lw;
    ctx.strokeStyle = C.stroke; ring(tx - tw / 2, top, tw, bot - top + lw);
    litRect(tx - tw / 2 + lw, top + lw + inner * (1 - lvv), tw - lw * 2, inner * lvv + lw);
    litDot(tx, by, br);
    // the scale runs down the tube to where the bulb starts, never beside the bulb itself
    const span = by - br - gap - (top + lw);
    if (scale && span > 4) for (let i = 0; i <= 4; i++) ctx.fillRect(tx + tw / 2 + gap, Math.round((top + lw + (span * i) / 4) * DS) / DS, tl, Math.max(1, Math.round(SW * 0.5)));
  } else if (T === 21) { // warning plate
    // a box the wall never draws this kind in by itself: only a holder's pick reaches it, so no existing panel changes
    if (!inner && w < cell * 1.75 && h < cell * 1.75 && !fits(T, w, h, cell)) {
      // one cell: a hazard plate, a warning triangle with its bang cut from it; on, it lights, and while working it blinks
      const m = Math.min(w, h), mcx = x + w / 2, mcy = y + h / 2, sn = (v: number) => Math.round(v * DS) / DS;
      const pm = sn(Math.max(2, m * 0.1)), pw = sn(x + w - pm) - sn(x + pm);
      ctx.fillStyle = C.stroke; ctx.fillRect(sn(x + pm), sn(y + pm), pw, sn(y + h - pm) - sn(y + pm));
      const show = !live || beat(tt, 600, 2) === 0;
      if (show) {
        const tr = m * 0.3, ty = mcy + tr * 0.12;
        ctx.fillStyle = ON ? C.glass : C.face; ctx.beginPath();
        ctx.moveTo(mcx, ty - tr); ctx.lineTo(mcx + tr * 1.1, ty + tr * 0.72); ctx.lineTo(mcx - tr * 1.1, ty + tr * 0.72); ctx.closePath(); ctx.fill();
        const bw = Math.max(1, sn(tr * 0.2));
        ctx.fillStyle = C.stroke; ctx.fillRect(sn(mcx - bw / 2), sn(ty - tr * 0.42), bw, sn(tr * 0.66)); ctx.fillRect(sn(mcx - bw / 2), sn(ty + tr * 0.38), bw, bw);
      }
      ctx.fillStyle = C.stroke;
    } else {
      const base = Math.floor(g() * WORDS.length);
      const wd = lvlX && h >= 12 ? (WORDS[live ? (base + beat(tt, 1400, WORDS.length)) % WORDS.length : base] as string) : "";
      ctx.fillStyle = C.stroke; ctx.fillRect(x + U * 2, y + U * 2, w - U * 4, h - U * 4);
      if (wd) { const ps = Math.max(1, Math.floor(Math.min((h - U * 8) / 5, (w - U * 8) / (wd.length * 4)))); p.pix(wd, x + (w - p.pixW(wd, ps)) / 2, y + (h - ps * 5) / 2, ps, ON ? C.glass : C.face); }
      ctx.strokeStyle = C.face; ctx.globalAlpha = 0.5; ctx.save(); ctx.beginPath();
      ctx.rect(x + U * 2, y + U * 2, w - U * 4, U * 1.4); ctx.rect(x + U * 2, y + h - U * 3.4, w - U * 4, U * 1.4); ctx.clip();
      for (let sx = x - U * 4; sx < x + w; sx += U * 2.5) { ctx.beginPath(); ctx.moveTo(sx, y + h); ctx.lineTo(sx + U * 3, y); ctx.stroke(); }
      ctx.restore(); ctx.globalAlpha = 1;
    }
  } else if (T === 22) { // linear scale
    // a box the wall never draws this kind in by itself: only a holder's pick reaches it, so no existing panel changes
    if (!inner && w < cell * 1.75 && h < cell * 1.75 && !fits(T, w, h, cell)) {
      // one cell: a short rule with five ticks, the ends and the middle taller, and the pointer riding under it
      const m = Math.min(w, h), mcx = x + w / 2, mcy = y + h / 2, sn = (v: number) => Math.round(v * DS) / DS;
      const l = mcx - m * 0.36, r = mcx + m * 0.36, tick = m * 0.26, pt = m * 0.2, gap = m * 0.06, cy = Math.round(mcy + (tick - (gap + pt * 1.2)) / 2) + hp();
      ctx.strokeStyle = C.stroke; ctx.lineWidth = Math.max(1, SW);
      ctx.beginPath(); ctx.moveTo(l, cy); ctx.lineTo(r, cy); ctx.stroke();
      for (let i = 0; i <= 4; i++) { const px = Math.round(l + ((r - l) * i) / 4) + hp(), th = i % 2 === 0 ? tick : tick * 0.55; ctx.beginPath(); ctx.moveTo(px, cy); ctx.lineTo(px, cy - th); ctx.stroke(); }
      const px = l + (r - l) * (live ? 0.5 + 0.32 * Math.sin(wave(tt, TAU * 600) + y) : 0.2 + g() * 0.6);
      ctx.fillStyle = LAMP; ctx.beginPath(); ctx.moveTo(px, cy + gap); ctx.lineTo(px - pt * 0.8, cy + gap + pt * 1.2); ctx.lineTo(px + pt * 0.8, cy + gap + pt * 1.2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = C.stroke;
    } else {
      // the ticks rise three units above the rule and the pointer hangs four below it: the figure is centred, not the rule
      const l = x + U * 3, r = x + w - U * 3, cy = Math.round(y + h / 2 - U * 0.5), n = Math.max(lvlX ? 6 : 1, Math.min(capX(30), Math.round((r - l) / (U * 3))));
      ctx.strokeStyle = C.stroke; ctx.beginPath(); ctx.moveTo(l, cy); ctx.lineTo(r, cy); ctx.stroke();
      for (let i = 0; i <= n; i++) { const px = l + ((r - l) * i) / n, th = i % 5 === 0 ? U * 3 : U * 1.5; ctx.beginPath(); ctx.moveTo(px, cy); ctx.lineTo(px, cy - th); ctx.stroke(); }
      const px = l + (r - l) * (live ? 0.5 + 0.45 * Math.sin(wave(tt, TAU * 600) + y) : g());
      ctx.fillStyle = C.stroke; ctx.beginPath(); ctx.moveTo(px, cy + U * 0.5); ctx.lineTo(px - U * 2, cy + U * 4); ctx.lineTo(px + U * 2, cy + U * 4); ctx.closePath(); ctx.fill(); ctx.fillStyle = C.stroke;
    }
  } else if (T === 23) { // vent grille: slats across, or slots along a strip too low for slats
    ctx.fillStyle = C.stroke; ctx.globalAlpha = 0.8;
    if (lvlY === 0 && w > h * 1.6) {
      const n = Math.max(3, Math.min(30, Math.round((w - U * 6) / (U * 2.6))));
      // each slot centred in its share of the run, so the margins at both ends match
      const sn = (v: number) => Math.round(v * DS) / DS, sw = Math.max(1, sn(U * 0.9));
      for (let i = 0; i < n; i++) ctx.fillRect(sn(x + U * 3 + ((w - U * 6) * (i + 0.5)) / n - sw / 2), y + U * 2, sw, h - U * 4);
    } else {
      const n = Math.max(3, Math.min(Math.max(3, capY(14)), Math.round(h / Math.max(2.5, U * 2.6))));
      // every slat the same thickness and centred in its share, on whole device pixels
      const sn = (v: number) => Math.round(v * DS) / DS, sh = Math.max(1, sn(U * 0.9));
      for (let i = 0; i < n; i++) ctx.fillRect(x + U * 2, sn(y + U * 2 + ((h - U * 4) * (i + 0.5)) / n - sh / 2), w - U * 4, sh);
    }
    ctx.globalAlpha = 1;
  } else if (T === 25) { // rotary dial
    const cx = x + w / 2, cy = y + h / 2, rr = Math.min(w, h) * 0.4, a0 = live ? wave(tt, TAU * 1500) : 0;
    ctx.strokeStyle = C.stroke; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
    litDot(cx, cy, rr * 0.28);
    for (let i = 0; i < 10; i++) { const a = a0 + i * 0.55 + 0.3; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr * 0.68, cy + Math.sin(a) * rr * 0.68, Math.max(1, rr * 0.11), 0, TAU); ctx.stroke(); }
    const fs = Math.max(2, SW * 1.2); ctx.fillRect(cx + rr * 0.75, cy - fs / 2, rr * 0.3, fs);
  } else if (T === 27 && !inner && w >= cell * 2.3 && h >= cell * 1.8 && !fits(T, w, h, cell)) { // lever, a quadrant: levers side by side in their slots
    // a panel only a holder's pick reaches: two to four levers, each in a slot with detents beside it, the handles where the
    // seat left them; working, one lever travels its slot
    const sn = (v: number) => Math.round(v * DS) / DS;
    const n = Math.max(2, Math.min(4, Math.round((w - U * 6) / (U * 8)))), step = (w - U * 6) / n;
    const top = y + U * 3.5, bot = y + h - U * 3.5, sw2 = Math.max(2, sn(U * 1.6)), moving = Math.floor(g() * n);
    for (let i = 0; i < n; i++) {
      const sx = sn(x + U * 3 + step * (i + 0.5));
      // the slot, and its detents: five notches on the left of it
      ctx.fillStyle = C.stroke; ctx.fillRect(sx - sw2 / 2, top, sw2, bot - top);
      for (let d = 0; d < 5; d++) { const dy = sn(top + ((bot - top) * d) / 4); ctx.fillRect(sx - sw2 / 2 - U * 2.6, dy - Math.max(0.5, SW * 0.25), U * 1.6, Math.max(1, SW * 0.5)); }
      const pp = live && i === moving ? 0.5 + 0.45 * Math.sin(wave(tt, TAU * 800) + i) : Math.round(g() * 4) / 4;
      // the handle: a bar across the slot with a lit grip at its end
      const hy = sn(bot - (bot - top) * pp), hw = Math.min(step * 0.62, U * 9), hh = Math.max(3, sn(U * 2.6));
      ctx.fillStyle = C.stroke; ctx.fillRect(sn(sx - hw * 0.3), hy - hh / 2, sn(hw), hh);
      litRect(sn(sx + hw * 0.7 - hh * 1.1), hy - hh / 2 + Math.max(1, hh * 0.25), sn(hh * 0.9), Math.max(1, hh * 0.5));
    }
  } else if (T === 27) { // lever in a slot
    const sx = x + w / 2, top = y + U * 3, bot = y + h - U * 3, pp = live ? 0.5 + 0.45 * Math.sin(wave(tt, TAU * 800) + x) : g();
    ctx.fillStyle = C.stroke; ctx.fillRect(sx - Math.max(1, U * 0.8), top, Math.max(2, U * 1.6), bot - top);
    const ky = bot - (bot - top) * pp;
    ctx.fillStyle = C.stroke; ctx.beginPath(); ctx.arc(sx, ky, Math.max(2.5, Math.min(w * 0.3, U * 4)), 0, TAU); ctx.fill();
    ctx.strokeStyle = C.face; ctx.beginPath(); ctx.arc(sx, ky, Math.max(1, U * 1.5), 0, TAU); ctx.stroke();
  } else if (T === 28) { // selector switch
    // the stops ring the knob from upper left round to upper right over the top: the figure (the stops above, the knob's
    // rim below) is what is centred in the box, so the knob itself sits a touch low
    const rr = Math.min(w, h) * 0.3, dr = Math.max(1, U * 1.1), n = lvl ? 5 + Math.floor(g() * 4) : 3, pos = live ? beat(tt, 700, n) : Math.floor(g() * n);
    const up = rr * 1.35 + dr, down = Math.max(rr + SW / 2, rr * 1.35 * Math.SQRT1_2 + dr);
    const cx = x + w / 2, cy = y + h / 2 + (up - down) / 2;
    for (let i = 0; i < n; i++) { const a = Math.PI * (0.75 + (1.5 * i) / (n - 1)); if (i === pos) litDot(cx + Math.cos(a) * rr * 1.35, cy + Math.sin(a) * rr * 1.35, dr); else { ctx.fillStyle = C.stroke; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr * 1.35, cy + Math.sin(a) * rr * 1.35, dr, 0, TAU); ctx.fill(); } }
    ctx.strokeStyle = C.stroke; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
    const a = Math.PI * (0.75 + (1.5 * pos) / (n - 1));
    ctx.strokeStyle = LAMP; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * rr * 0.95, cy + Math.sin(a) * rr * 0.95); ctx.stroke(); ctx.strokeStyle = C.stroke;
  } else if (T === 29) { // dot matrix
    scr(x + U * 2, y + U * 2, w - U * 4, h - U * 4);
    const nx = Math.max(lvlX ? 8 : 5, Math.min(Math.max(5, capX(40)), Math.floor((w - U * 6) / (U * 1.6))));
    const ny = Math.max(3, Math.min(Math.max(3, capY(9)), Math.floor((h - U * 6) / (U * 1.6))));
    const dw = (w - U * 6) / nx, dh = (h - U * 6) / ny, off = live ? beat(tt, 120, 11) : 0;
    ctx.fillStyle = C.glass;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const kk = ((i + off) * 7 + j * 3 + Math.floor(g() * 2)) % 11;
      // each dot snapped to whole device pixels and the same size as every other, so the field reads as a display, not a blur
      const sn = (v: number) => Math.round(v * DS) / DS, ddw = sn(Math.max(1, dw * 0.6)), ddh = sn(Math.max(1, dh * 0.6));
      if (kk < 4 && j > 0 && j < ny - 1) ctx.fillRect(sn(x + U * 3 + dw * (i + 0.5) - ddw / 2), sn(y + U * 3 + dh * (j + 0.5) - ddh / 2), ddw, ddh);
    }
  } else if (T === 30) { // speaker
    const cx = x + w / 2, cy = y + h / 2, rr = Math.min(w, h) * 0.42;
    ctx.strokeStyle = C.stroke; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
    ctx.fillStyle = C.stroke;
    // the perforations on a grid struck from the cone's centre, so the pattern is the same on every side of it
    const st = Math.max(2.5, U * 2.2), kn = Math.floor(rr / st);
    for (let j = -kn; j <= kn; j++) for (let i = -kn; i <= kn; i++) {
      const px = cx + i * st, py = cy + j * st;
      if ((px - cx) ** 2 + (py - cy) ** 2 < (rr - st) ** 2) { ctx.beginPath(); ctx.arc(px, py, Math.max(0.6, st * 0.22) * (live ? 1 + 0.4 * Math.sin(wave(tt, TAU * 90)) : 1), 0, TAU); ctx.fill(); }
    }
  } else if (T === 32) { // nixie tubes: a row of round-topped tubes, a lit digit in each
    const n = Math.max(lvlX ? 2 : 1, Math.min(capX(6), Math.floor((w - U * 4) / (U * 7)))), tw = (w - U * 4) / n, bh = Math.max(1, U * 1.2), ih = h - U * 4 - bh;
    const base = Math.floor(g() * 1e6), val = String((base + (live ? tick(tt, 400) : 0)) % 10 ** n).padStart(n, "0");
    for (let i = 0; i < n; i++) {
      // the tube and its base together keep the same margin top and bottom
      const tx = x + U * 2 + tw * i + tw * 0.12, tww = tw * 0.76, ty = y + U * 2, r = tww / 2;
      ctx.fillStyle = C.screen; ctx.beginPath(); ctx.moveTo(tx, ty + ih); ctx.lineTo(tx, ty + r); ctx.arc(tx + r, ty + r, r, Math.PI, 0); ctx.lineTo(tx + tww, ty + ih); ctx.closePath(); ctx.fill();
      ctx.fillStyle = C.stroke; ctx.fillRect(tx - Math.max(1, U * 0.5), ty + ih, tww + Math.max(1, U * 0.5) * 2, bh);
      const dw = Math.min(tww * 0.55, (ih - r) / 1.5 * 0.9);
      if (dw >= 3) p.seg7(val[i]!, tx + (tww - dw) / 2, ty + r + ((ih - r) - dw * 1.5) / 2, dw, dw * 1.5, C.glass);
      else { ctx.fillStyle = C.glass; ctx.fillRect(tx + tww / 2 - 1, ty + r, 2, Math.max(2, ih - r - 2)); }
    }
  } else if (T === 33) { // paper tape: sprocket holes along both edges, a code down the middle, advancing
    if (!inner && w < cell * 1.75 && h < cell * 1.75 && !fits(T, w, h, cell)) {
      // one cell: three frames of tape, the small sprocket holes down the middle row and the code punched above and below,
      // stepping along when it runs; the punched holes are what lights when the module is on
      const s = Math.min(w, h), cx = x + w / 2, cy = y + h / 2, st = s * 0.25, hr = Math.max(0.8, s * 0.065);
      // twelve frames of code, about half of them punched, the three in the window stepping along when it runs
      const base = Math.floor(g() * 4096) | 0x249, off = live ? beat(tt, 160, 12) : 0, bit = (k: number) => (base >> (((k % 12) + 12) % 12)) & 1;
      ctx.fillStyle = C.stroke; ctx.globalAlpha = 0.25;
      const ew = Math.max(1 / DS, Math.round(U * 0.6 * DS) / DS);
      ctx.fillRect(x + s * 0.1, Math.round((cy - s * 0.4) * DS) / DS, w - s * 0.2, ew); ctx.fillRect(x + s * 0.1, Math.round((cy + s * 0.4) * DS) / DS - ew, w - s * 0.2, ew);
      ctx.globalAlpha = 1;
      for (let i = -1; i <= 1; i++) {
        const hx = cx + st * i;
        ctx.fillStyle = C.stroke; ctx.beginPath(); ctx.arc(hx, cy, hr * 0.6, 0, TAU); ctx.fill();
        // a hole is punched or it isn't: an unpunched frame is only a faint mark where the hole would go
        for (const [dy, b] of [[-st, bit((i + off) * 2)], [st, bit((i + off) * 2 + 1)]] as const) {
          if (b) litDot(hx, cy + dy, hr); else { ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.arc(hx, cy + dy, hr * 0.8, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
        }
      }
      ctx.fillStyle = C.stroke;
    } else {
      const cols = Math.max(4, Math.floor(w / Math.max(3, U * 2.2))), pw = w / cols, off = live ? beat(tt, 160, 32) : 0;
      ctx.fillStyle = C.stroke; ctx.globalAlpha = 0.25; ctx.fillRect(x, y + U * 1.5, w, Math.max(1, U * 0.6)); ctx.fillRect(x, y + h - U * 2.1, w, Math.max(1, U * 0.6)); ctx.globalAlpha = 1;
      const rows = Math.max(1, Math.min(5, Math.floor((h - U * 8) / Math.max(3, U * 2.2)))), rh = (h - U * 8) / rows, hr = Math.max(0.7, Math.min(pw, rh) * 0.24);
      for (let i = 0; i < cols; i++) {
        const cx = x + pw * (i + 0.5), code = Math.floor(g() * 32);
        ctx.beginPath(); ctx.arc(cx, y + U * 3.2, hr * 0.7, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(cx, y + h - U * 3.2, hr * 0.7, 0, TAU); ctx.fill();
        for (let j = 0; j < rows; j++) if (((code + off + i) >> j) & 1) { ctx.beginPath(); ctx.arc(cx, y + U * 4 + rh * (j + 0.5), hr, 0, TAU); ctx.fill(); }
      }
    }
  } else if (T === 34) { // fuse block: a row of cartridges in clips, one of them gone dark
    const n = Math.max(lvlX ? 3 : 1, Math.min(capX(8), Math.floor(w / (U * 6)))), fw = w / n, blown = Math.floor(g() * n);
    for (let i = 0; i < n; i++) {
      // the fuse and the label strip under it are centred together, so the block sits in the middle of its plate
      const fh = h * 0.45, lg = h * 0.07, lh = Math.max(1, U * 0.7), fy = y + (h - fh - (lvl >= 1 ? lg + lh : 0)) / 2;
      const fx = x + fw * i + fw * 0.2, fww = fw * 0.6, cap = Math.max(1, Math.min(fh * 0.2, U * 1.5)), lw = ctx.lineWidth;
      ctx.fillStyle = C.stroke; ctx.fillRect(fx, fy, fww, cap); ctx.fillRect(fx, fy + fh - cap, fww, cap);
      ctx.strokeStyle = C.stroke; ring(fx, fy + cap - lw, fww, fh - cap * 2 + lw * 2);
      if (i === blown) ctx.fillRect(fx, fy, fww, fh);
      else if (lvl >= 1) { ctx.globalAlpha = ON ? 1 : 0.5; const ew = Math.max(1, fww * 0.16); litRect(fx + (fww - ew) / 2, fy + cap, ew, fh - cap * 2); ctx.globalAlpha = 1; }
      if (lvl >= 1) ctx.fillRect(fx + fww * 0.2, fy + fh + lg, fww * 0.6, lh);
    }
  } else if (T === 36) { // compass: a rose with the four points and a two-tone needle, in a round bezel or a square one
    const cx = x + w / 2, cy = y + h / 2, rr = Math.min(w, h) * 0.38, squareBezel = g() < 0.4;
    ctx.strokeStyle = C.stroke;
    if (squareBezel) {
      // the square card: the bezel a square, the rose inside it, ticks on the bezel's inner edge at the four points
      const side = Math.round(rr * 2.1); ring(Math.round(cx - side / 2), Math.round(cy - side / 2), side, side);
    } else { ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke(); shade(cx, cy, rr); }
    for (let i = 0; i < (lvl ? 8 : 4); i++) { const a = (i * Math.PI) / (lvl ? 4 : 2), f = i % 2 ? 0.82 : 0.7; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * rr * f, cy + Math.sin(a) * rr * f); ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); ctx.stroke(); }
    const a = g() * 6.28 + (live ? Math.sin(wave(tt, TAU * 700)) * 0.6 : 0), nl = rr * 0.72, nw = Math.max(1, rr * 0.16);
    ctx.fillStyle = LAMP; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * nl, cy + Math.sin(a) * nl); ctx.lineTo(cx + Math.cos(a + 1.571) * nw, cy + Math.sin(a + 1.571) * nw); ctx.lineTo(cx + Math.cos(a - 1.571) * nw, cy + Math.sin(a - 1.571) * nw); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.stroke; ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * nl, cy - Math.sin(a) * nl); ctx.lineTo(cx + Math.cos(a + 1.571) * nw, cy + Math.sin(a + 1.571) * nw); ctx.lineTo(cx + Math.cos(a - 1.571) * nw, cy + Math.sin(a - 1.571) * nw); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = C.face; ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, nw * 0.5), 0, TAU); ctx.fill(); ctx.fillStyle = C.stroke;
  } else if (T === 37) { // drive bay: a slot, an activity lamp, an eject button
    if (!inner && w < cell * 1.75 && h < cell * 1.75 && !fits(T, w, h, cell)) {
      // one cell: the slot and its activity lamp under it at the right, the two centred as one group
      const sn = (v: number) => Math.round(v * DS) / DS, s = Math.min(w, h);
      const sw = sn(s * 0.68), sh = Math.max(2, sn(s * 0.17)), lr = Math.max(0.9, s * 0.075), gp = Math.max(1, s * 0.1);
      const sx = sn(x + (w - sw) / 2), sy = sn(y + (h - (sh + gp + lr * 2)) / 2);
      ctx.fillStyle = C.screen; ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeStyle = C.stroke; ring(sx, sy, sw, sh);
      const on = live ? (beat(tt, 130, 4) + Math.round(x)) % 4 !== 0 : g() < 0.5, lx = sx + sw - lr, ly = sy + sh + gp + lr;
      if (on || ON) litDot(lx, ly, lr); else { ctx.beginPath(); ctx.arc(lx, ly, lr, 0, TAU); ctx.stroke(); }
    } else {
      // the slot row and the label under it centred together in the plate
      const sh = Math.max(2, h * 0.16), lg = Math.max(U * 2, h * 0.16), lh = Math.max(1, U * 0.7);
      const sx = x + U * 3, sw = w - U * 6, sy = Math.round(y + (h - sh - (lvl >= 1 ? lg + lh : 0)) / 2);
      // laid out from the right: the eject button, a gap, the lamp, a gap, and the slot takes what is left, so they never touch
      const ew = Math.max(2, sw * 0.08), lr = Math.max(1, U * 1.1), gp = Math.max(1.5, U * 1.4), lcx = sx + sw - ew - gp - lr - SW / 2, slw = lcx - lr - SW / 2 - gp - sx;
      ctx.fillStyle = C.screen; ctx.fillRect(sx, sy, slw, sh);
      ctx.strokeStyle = C.stroke; ring(sx, sy, slw, sh);
      const on = live ? (beat(tt, 130, 4) + Math.round(x)) % 4 !== 0 : g() < 0.5;
      if (on || ON) litDot(lcx, sy + sh / 2, lr); else { ctx.beginPath(); ctx.arc(lcx, sy + sh / 2, lr, 0, TAU); ctx.stroke(); }
      ring(sx + sw - ew, sy, ew, sh);
      if (lvl >= 1) { ctx.globalAlpha = 0.5; ctx.fillRect(sx, sy + sh + lg, sw * 0.4, lh); ctx.globalAlpha = 1; }
    }
  } else if (T === 38) { // heat sink: fins across, thick and even
    const along = w >= h;
    const n = Math.max(3, Math.min(along ? capX(24) : capY(24), Math.round((along ? w : h) / Math.max(3, U * 2.4))));
    ctx.fillStyle = C.stroke;
    // each fin centred in its share of the run, snapped to whole device pixels, so the end gaps match and every fin is the same
    const run = (along ? w : h) - U * 4, fin = Math.max(1, Math.round((run / n) * 0.45 * DS) / DS);
    for (let i = 0; i < n; i++) {
      const at = Math.round((U * 2 + (run * (i + 0.5)) / n - fin / 2) * DS) / DS;
      if (along) ctx.fillRect(x + at, y + U * 2, fin, h - U * 4);
      else ctx.fillRect(x + U * 2, y + at, w - U * 4, fin);
    }
    ctx.globalAlpha = 0.3; if (along) ctx.fillRect(x + U * 2, y + h - U * 3, w - U * 4, Math.max(1, U)); else ctx.fillRect(x + U * 2, y + U * 2, Math.max(1, U), h - U * 4); ctx.globalAlpha = 1;
  } else if (T === 39) { // guarded toggles: switches under hinged covers, one cover lifted
    const n = Math.max(lvlX ? 2 : 1, Math.min(capX(6), Math.round(w / (U * 7)))), tw = w / n, open = Math.floor(g() * n);
    for (let i = 0; i < n; i++) {
      const px = x + tw * i + tw * 0.22, pw = tw * 0.56, py = y + h * 0.25, ph = h * 0.5;
      ctx.strokeStyle = C.stroke; ctx.fillStyle = C.stroke;
      if (i === open) {
        ring(px, py, pw, ph);
        ctx.fillRect(px + pw * 0.3, py + ph * 0.55, pw * 0.4, ph * 0.35);
        litRect(px + pw * 0.42, py + ph * 0.2, pw * 0.16, ph * 0.4);
        ring(px - pw * 0.08, py - Math.max(2, ph * 0.22), pw * 1.16, Math.max(2, ph * 0.18));
      } else {
        ctx.fillRect(px, py, pw, ph);
        ctx.fillStyle = C.face; ctx.fillRect(px + 1, py + ph * 0.45, pw - 2, Math.max(1, U * 0.6)); ctx.fillStyle = C.stroke;
      }
      if (lvl >= 1) ctx.fillRect(px + pw * 0.15, y + h * 0.84, pw * 0.7, Math.max(1, U * 0.7));
    }
  } else if (T === 40) { // tally counter: drums in a window, the last one caught mid-roll
    if (!inner && w < cell * 1.75 && h < cell * 1.75 && !fits(T, w, h, cell)) {
      // one cell: two drums in a window, the window in whole pixels with equal margins, the last drum rolling when it runs
      const s = Math.min(w, h), n = 2, ww = Math.round(s * 0.74 * DS) / DS;
      let wh = Math.round(Math.min(s * 0.54, (ww / n) * 1.5) * DS); if ((Math.round(h * DS) - wh) % 2) wh -= 1; wh /= DS;
      const wx = Math.round((x + (w - ww) / 2) * DS) / DS, wy = y + (h - wh) / 2;
      ctx.fillStyle = C.screen; ctx.fillRect(wx, wy, ww, wh); ctx.strokeStyle = C.stroke; ring(wx, wy, ww, wh);
      const dw = ww / n, base = Math.floor(g() * 100), val = String((base + (live ? tick(tt, 500) : 0)) % 100).padStart(2, "0");
      const fr = ctx.lineWidth;
      ctx.save(); ctx.beginPath(); ctx.rect(wx + fr, wy + fr, ww - fr * 2, wh - fr * 2); ctx.clip();
      for (let i = 0; i < n; i++) {
        const roll = live && i === n - 1 ? phase(tt, 500) * wh * 0.9 : 0, dh = wh * 0.62, dww = Math.min(dw * 0.55, dh / 1.5);
        if (dww >= 2.5) {
          const gx = wx + dw * i + (dw - dww * 0.66) / 2;
          p.seg7(val[i]!, gx, wy + (wh - dh) / 2 - roll, dww, dh, C.glass);
          if (roll) p.seg7(String((Number(val[i]) + 1) % 10), gx, wy + (wh - dh) / 2 - roll + wh * 0.9, dww, dh, C.glass);
        } else { ctx.fillStyle = C.glass; ctx.fillRect(wx + dw * i + dw * 0.35, wy + wh * 0.3, Math.max(1, dw * 0.3), wh * 0.4); }
        if (i) { ctx.strokeStyle = C.stroke; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(wx + dw * i + hp(), wy); ctx.lineTo(wx + dw * i + hp(), wy + wh); ctx.stroke(); ctx.globalAlpha = 1; }
      }
      ctx.restore();
    } else {
      const n = Math.max(lvlX ? 3 : 2, Math.min(capX(6), Math.floor((w - U * 6) / (U * 5)))), wx = Math.round(x + U * 3), ww = w - (wx - x) * 2;
      // the window in whole pixels with the same margin above and below, so it sits on the plate's centre line exactly
      let wh = Math.round(Math.min(h - U * 6, ww / n * 1.5)); if ((h - wh) % 2) wh -= 1;
      const wy = y + (h - wh) / 2;
      ctx.fillStyle = C.screen; ctx.fillRect(wx, wy, ww, wh); ctx.strokeStyle = C.stroke; ring(wx, wy, ww, wh);
      const dw = ww / n, base = Math.floor(g() * 1e5), val = String((base + (live ? tick(tt, 500) : 0)) % 10 ** n).padStart(n, "0");
      const fr = ctx.lineWidth;
      ctx.save(); ctx.beginPath(); ctx.rect(wx + fr, wy + fr, ww - fr * 2, wh - fr * 2); ctx.clip();
      for (let i = 0; i < n; i++) {
        const roll = live && i === n - 1 ? phase(tt, 500) * wh * 0.9 : 0, dh = wh * 0.6, dww = Math.min(dw * 0.55, dh / 1.5);
        if (dww >= 3) {
          // a seven-segment glyph fills two thirds of its box from the left: it is that two thirds that sits on the drum's centre
          const gx = wx + dw * i + (dw - dww * 0.66) / 2;
          p.seg7(val[i]!, gx, wy + (wh - dh) / 2 - roll, dww, dh, C.glass);
          if (roll) p.seg7(String((Number(val[i]) + 1) % 10), gx, wy + (wh - dh) / 2 - roll + wh * 0.9, dww, dh, C.glass);
        } else { ctx.fillStyle = C.glass; ctx.fillRect(wx + dw * i + dw * 0.35, wy + wh * 0.3, Math.max(1, dw * 0.3), wh * 0.4); }
        if (i) { ctx.strokeStyle = C.stroke; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(wx + dw * i + hp(), wy); ctx.lineTo(wx + dw * i + hp(), wy + wh); ctx.stroke(); ctx.globalAlpha = 1; }
      }
      ctx.restore();
    }
  } else if (T === 41) { // level bubble: a vial with a bubble that drifts
    if (!inner && w >= h * 2.5 && !fits(T, w, h, cell)) {
      // a strip, which only a holder's pick asks for: one long vial with graduations along it, the bubble long and drifting
      // close about the two marks at the middle, the way a builder's level reads
      const sn = (v: number) => Math.round(v * DS) / DS, vh = Math.max(3, sn(Math.min(h * 0.42, cell * 0.5))), vx = x + U * 3, vw = w - U * 6, vy = sn(y + (h - vh) / 2), r = vh / 2;
      ctx.strokeStyle = C.stroke; ctx.beginPath(); ctx.moveTo(vx + r, vy); ctx.lineTo(vx + vw - r, vy); ctx.arc(vx + vw - r, vy + r, r, -1.571, 1.571); ctx.lineTo(vx + r, vy + vh); ctx.arc(vx + r, vy + r, r, 1.571, 4.712); ctx.closePath(); ctx.stroke();
      const mid = vx + vw / 2, tw = Math.max(1 / DS, sn(U * 0.5)), over = Math.max(1, U);
      ctx.fillStyle = C.stroke; ctx.globalAlpha = 0.35;
      for (let k = 1; k < 10; k++) if (k !== 4 && k !== 6) { const tx = sn(vx + r + ((vw - r * 2) * k) / 10); ctx.fillRect(tx, vy + vh - Math.max(1, vh * 0.3), tw, Math.max(1, vh * 0.3)); }
      ctx.globalAlpha = 1;
      const bw = Math.min(vw * 0.18, vh * 2.4), gap = bw * 0.55;
      ctx.fillRect(sn(mid - gap), vy - over, tw, vh + over * 2); ctx.fillRect(sn(mid + gap), vy - over, tw, vh + over * 2);
      const bx = mid + vw * (live ? 0.05 * Math.sin(wave(tt, TAU * 900) + x) + 0.02 * Math.sin(wave(tt, TAU * 230)) : (g() - 0.5) * 0.12);
      ctx.fillStyle = LAMP; ctx.beginPath(); ctx.ellipse(bx, vy + r, bw / 2, r * 0.66, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = C.face; ctx.beginPath(); ctx.ellipse(bx - bw * 0.18, vy + r * 0.78, Math.max(0.6, bw * 0.1), Math.max(0.5, r * 0.16), 0, 0, TAU); ctx.fill(); ctx.fillStyle = C.stroke;
    } else {
      const vx = x + U * 3, vw = w - U * 6, vy = y + h * 0.3, vh = Math.max(3, h * 0.4), r = vh / 2;
      ctx.strokeStyle = C.stroke; ctx.beginPath(); ctx.moveTo(vx + r, vy); ctx.lineTo(vx + vw - r, vy); ctx.arc(vx + vw - r, vy + r, r, -1.571, 1.571); ctx.lineTo(vx + r, vy + vh); ctx.arc(vx + r, vy + r, r, 1.571, 4.712); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = C.stroke; ctx.fillRect(vx + vw * 0.44, vy - Math.max(1, U), Math.max(1, U * 0.5), vh + Math.max(1, U) * 2); ctx.fillRect(vx + vw * 0.56, vy - Math.max(1, U), Math.max(1, U * 0.5), vh + Math.max(1, U) * 2);
      const bx = vx + vw * (0.5 + (live ? 0.22 * Math.sin(wave(tt, TAU * 900) + x) : (g() - 0.5) * 0.4)), bw = Math.max(vh * 0.9, Math.min(vw * 0.16, vh * 1.6));
      ctx.fillStyle = LAMP; ctx.beginPath(); ctx.ellipse(bx, vy + r, bw / 2, r * 0.7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = C.face; ctx.beginPath(); ctx.ellipse(bx - bw * 0.12, vy + r * 0.8, Math.max(0.6, bw * 0.12), Math.max(0.5, r * 0.18), 0, 0, TAU); ctx.fill(); ctx.fillStyle = C.stroke;
    }
  } else if (T === 42) { // strip chart: ruled paper, a trace, the pen at the right edge
    if (!inner && w < cell * 1.75 && h < cell * 1.75 && !fits(T, w, h, cell)) {
      // one cell: a square of ruled paper, a few rules running past, the trace and the pen at its right edge
      const sn = (v: number) => Math.round(v * DS) / DS, s = Math.min(w, h), ps = sn(s * 0.72), px0 = sn(x + (w - ps) / 2), py0 = sn(y + (h - ps) / 2);
      ctx.strokeStyle = C.stroke; ctx.globalAlpha = 0.35; ring(px0, py0, ps, ps); ctx.globalAlpha = 0.25; ctx.lineWidth = 1;
      const pen = Math.max(1 / DS, sn(s * 0.06)), rows = 3, gy = ps / rows, off = live ? phase(tt, 40 * gy) * gy : 0;
      for (let k = 0; k <= rows; k++) { const yy = py0 + off + gy * k; if (yy >= py0 + ps - 0.5 || yy <= py0 + 0.5) continue; ctx.beginPath(); ctx.moveTo(px0, Math.round(yy) + hp()); ctx.lineTo(px0 + ps - pen, Math.round(yy) + hp()); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.lineWidth = SW;
      ctx.save(); ctx.beginPath(); ctx.rect(px0, py0, ps - pen, ps); ctx.clip();
      // the trace: newest at the pen's end, wandering across most of the paper's width
      const n = 7; ctx.strokeStyle = LAMP; ctx.lineWidth = Math.max(1, SW); ctx.lineJoin = "round"; ctx.beginPath();
      for (let i = 0; i <= n; i++) { const yy = py0 + (ps * i) / n, xx = px0 + (ps - pen) * (0.5 + 0.34 * (live ? Math.sin(i * 1.3 + wave(tt, TAU * 300)) : Math.sin(i * 1.7 + g() * 6))); if (i) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy); }
      ctx.stroke(); ctx.restore(); ctx.strokeStyle = C.stroke;
      ctx.fillStyle = C.stroke; ctx.fillRect(px0 + ps - pen, py0, pen, ps);
    } else {
      const px0 = x + U * 2, pw = w - U * 4, py0 = y + U * 2, ph = h - U * 4;
      ctx.strokeStyle = C.stroke; ctx.globalAlpha = 0.25; ctx.lineWidth = 1;
      const pen = Math.max(2, U * 1.5), rows = Math.max(2, Math.round(ph / Math.max(3, U * 2.2))), gy = ph / rows, off = live ? phase(tt, 40 * gy) * gy : 0;
      const cols = Math.max(1, Math.round((pw - pen) / (gy * 2))), gx = (pw - pen) / cols;
      for (let k = 0; k <= rows; k++) { const yy = py0 + off + gy * k; if (yy > py0 + ph + 0.01) break; ctx.beginPath(); ctx.moveTo(px0, Math.round(yy) + hp()); ctx.lineTo(px0 + pw, Math.round(yy) + hp()); ctx.stroke(); }
      for (let k = 0; k < cols; k++) { const xx = px0 + gx * k; ctx.beginPath(); ctx.moveTo(Math.round(xx) + hp(), py0); ctx.lineTo(Math.round(xx) + hp(), py0 + ph); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.lineWidth = SW;
      ctx.save(); ctx.beginPath(); ctx.rect(px0, py0, pw, ph); ctx.clip();
      const n = Math.max(8, Math.round(ph / 3)); ctx.strokeStyle = LAMP; ctx.beginPath();
      for (let i = 0; i <= n; i++) { const yy = py0 + (ph * i) / n, xx = px0 + pw * (0.55 + 0.3 * (live ? Math.sin(i * 0.7 + wave(tt, TAU * 300)) : g() - 0.5)); if (i) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy); }
      ctx.stroke(); ctx.restore(); ctx.strokeStyle = C.stroke;
      ctx.fillStyle = C.stroke; ctx.fillRect(px0 + pw - pen, py0, pen, ph);
    }
  } else if (T === 43) { // square gauge: a needle in a squared bezel, ticks along the top
    const bx = x + U * 2.5, by = y + U * 2.5, bw = w - U * 5, bh = h - U * 5;
    ctx.strokeStyle = C.stroke; ring(bx, by, bw, bh);
    const hub = Math.max(1, U * 1.2), cx = bx + bw / 2, cy = by + bh - ctx.lineWidth - hub * 1.6, rr = Math.max(2, Math.min(bw * 0.46, cy - by - ctx.lineWidth - U));
    if (lvl >= 1) for (let i = 0; i <= 6; i++) { const a = Math.PI * (1.15 + (0.7 * i) / 6), f = i % 3 ? 0.88 : 0.8; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * rr * f, cy + Math.sin(a) * rr * f); ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); ctx.stroke(); }
    const a = Math.PI * (1.15 + 0.7 * (live ? 0.5 + 0.45 * Math.sin(wave(tt, TAU * 300) + x) : g()));
    ctx.strokeStyle = LAMP; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * rr * 0.92, cy + Math.sin(a) * rr * 0.92); ctx.stroke(); ctx.strokeStyle = C.stroke;
    ctx.fillStyle = C.stroke; ctx.beginPath(); ctx.arc(cx, cy, hub, 0, TAU); ctx.fill();
  } else if (T === 44 && !inner && (w * h) / (cell * cell) > 3.2) { // square button, a bank: keys in two rows, one of them held down
    const cols = w >= h * 1.12 ? 3 : 2, rows = 2, pad = U * 3, gap = Math.max(2, Math.round(U * 1.8));
    const s2 = Math.floor(Math.min((w - pad * 2 - gap * (cols - 1)) / cols, (h - pad * 2 - gap * (rows - 1)) / rows));
    const gw = s2 * cols + gap * (cols - 1), gh = s2 * rows + gap * (rows - 1), gx = Math.round(x + (w - gw) / 2), gy = Math.round(y + (h - gh) / 2);
    const held = live ? beat(tt, 700, cols * rows) : Math.floor(g() * cols * rows), r = Math.max(1, s2 * 0.12), blw = ctx.lineWidth;
    const rr2 = (px: number, py: number, pw: number, ph: number, rad: number) => { ctx.beginPath(); ctx.moveTo(px + rad, py); ctx.lineTo(px + pw - rad, py); ctx.quadraticCurveTo(px + pw, py, px + pw, py + rad); ctx.lineTo(px + pw, py + ph - rad); ctx.quadraticCurveTo(px + pw, py + ph, px + pw - rad, py + ph); ctx.lineTo(px + rad, py + ph); ctx.quadraticCurveTo(px, py + ph, px, py + ph - rad); ctx.lineTo(px, py + rad); ctx.quadraticCurveTo(px, py, px + rad, py); ctx.closePath(); };
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = j * cols + i, down = k === held, bx = gx + (s2 + gap) * i, by = gy + (s2 + gap) * j;
      // every cap sits at the same inset in its well, so no sliver of the well shows at a corner; the held key is the one whose bar lights
      const inset = s2 * 0.14;
      ctx.strokeStyle = C.stroke; rr2(bx + blw / 2, by + blw / 2, s2 - blw, s2 - blw, r); ctx.stroke();
      ctx.fillStyle = C.stroke; rr2(bx + inset, by + inset, s2 - inset * 2, s2 - inset * 2, r * 0.7); ctx.fill();
      const bar = Math.max(1, U * 0.7);
      ctx.fillStyle = down && ON ? C.glass : C.face; ctx.fillRect(bx + s2 * 0.32, by + s2 * 0.5 - bar, s2 * 0.36, bar * 2);
    }
    ctx.fillStyle = C.stroke;
  } else if (T === 44) { // square button: a keycap with a bar, the round button's square twin
    const s2 = Math.min(w, h) * (0.62 + (live ? 0.04 * Math.sin(wave(tt, TAU * 200)) : 0)), bx = x + (w - s2) / 2, by = y + (h - s2) / 2, r = Math.max(1, s2 * 0.12);
    const rr2 = (px: number, py: number, pw: number, ph: number, rad: number) => { ctx.beginPath(); ctx.moveTo(px + rad, py); ctx.lineTo(px + pw - rad, py); ctx.quadraticCurveTo(px + pw, py, px + pw, py + rad); ctx.lineTo(px + pw, py + ph - rad); ctx.quadraticCurveTo(px + pw, py + ph, px + pw - rad, py + ph); ctx.lineTo(px + rad, py + ph); ctx.quadraticCurveTo(px, py + ph, px, py + ph - rad); ctx.lineTo(px, py + rad); ctx.quadraticCurveTo(px, py, px + rad, py); ctx.closePath(); };
    const blw = ctx.lineWidth; ctx.strokeStyle = C.stroke; rr2(bx + blw / 2, by + blw / 2, s2 - blw, s2 - blw, r); ctx.stroke();
    ctx.fillStyle = C.stroke; rr2(bx + s2 * 0.14, by + s2 * 0.14, s2 * 0.72, s2 * 0.72, r * 0.7); ctx.fill();
    ctx.fillStyle = ON ? C.glass : C.face; ctx.fillRect(bx + s2 * 0.32, by + s2 * 0.5 - Math.max(1, U * 0.7), s2 * 0.36, Math.max(1, U * 0.7) * 2); ctx.fillStyle = C.stroke;
  } else if (T === 45) { // sweep scope: a square screen, a sector PPI pivoting from its corner, the sweep retracing
    if (!inner && w < cell * 1.75 && h < cell * 1.75 && !fits(T, w, h, cell)) {
      // one cell: the harbour radar's quadrant on its own, pivoting from the glass's bottom-left corner, the sweep retracing
      const sn = (v: number) => Math.round(v * DS) / DS, s = Math.min(w, h), gm = sn(Math.max(1.5, s * 0.12));
      const gs = sn(s - gm * 2), gx = sn(x + (w - gs) / 2), gy = sn(y + (h - gs) / 2);
      scr(gx, gy, gs, gs);
      const ph = g(), rate = 3000 + g() * 2000, ip = Math.max(1, gs * 0.12), rr = gs - ip * 2;
      const k = live ? (ph + phase(tt, rate)) % 1 : ph;
      ppi(gx + ip, gy + gs - ip, rr, -1.5708, 0, -1.5708 + 1.5708 * k, 1);
    } else {
      // two kinds of sector scope, by the seat: a quadrant from the bottom-left corner, the harbour radar's, or a half circle
      // from the bottom centre, the air search set's forward sector. The sweep retraces, as a sector scan does
      scr(x + U * 2, y + U * 2, w - U * 4, h - U * 4);
      const half = g() < 0.5, ph = g(), rate = 3000 + g() * 2000;
      const sy = y + h - U * 3.5;
      const sx = half ? x + w / 2 : x + U * 3.5, rr = half ? Math.min((w - U * 7) / 2, h - U * 7) : Math.min(w, h) - U * 7;
      const from = half ? -3.1416 : -1.5708, span = half ? 3.1416 : 1.5708;
      const k = live ? (ph + phase(tt, rate)) % 1 : ph, tri = half ? (k < 0.5 ? k * 2 : 2 - k * 2) : k;
      ppi(sx, sy, rr, from, from + span, from + span * tri, lvl ? 3 : 1);
    }
  } else if (T === 47 && !inner && w < cell * 1.45 && h < cell * 1.45 && !fits(T, w, h, cell)) { // big board, one cell: a single track arcing over the glass to its burst
    const gm = Math.max(2, Math.round(U * 2.5));
    scr(x + gm, y + gm, w - gm * 2, h - gm * 2);
    const mx = x + gm + 1, my = y + gm + 1, mw = w - gm * 2 - 2, mh = h - gm * 2 - 2;
    const flip = g() < 0.5, ax = mx + mw * (flip ? 0.8 : 0.2), bx = mx + mw * (flip ? 0.24 : 0.76), ay = my + mh * 0.8, by = my + mh * (0.64 + g() * 0.08), lift = mh * 0.62;
    // the burst grows no further than the target's nearest edge of the glass, so it lands whole
    const reach = Math.max(1.5, Math.min(bx - mx, mx + mw - bx, by - my, my + mh - by) - 1);
    ctx.save(); ctx.beginPath(); ctx.rect(mx, my, mw, mh); ctx.clip();
    const stage = live ? ((phase(tt, 4200) + g()) % 1) * 1.45 : 0.8 + g() * 0.12, flight = Math.min(1, stage);
    const at = (t: number) => [ax + (bx - ax) * t, ay + (by - ay) * t - Math.sin(t * Math.PI) * lift] as const;
    // the ground: one faint line, so the glass is a map
    ctx.strokeStyle = C.glass; ctx.fillStyle = C.glass; ctx.lineWidth = 1; ctx.globalAlpha = 0.3;
    const ground = Math.round(my + mh * 0.88) + hp(1);
    ctx.beginPath(); ctx.moveTo(mx, ground); ctx.lineTo(mx + mw, ground); ctx.stroke();
    ctx.lineWidth = Math.max(1, SW); ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.globalAlpha = flight < 1 ? 0.9 : Math.max(0.25, 0.9 - (stage - 1) * 1.6);
    const steps = 16, upto = Math.max(1, Math.round(steps * flight));
    ctx.beginPath(); for (let k = 0; k <= upto; k++) { const [px, py] = at(k / steps); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.stroke();
    ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(ax, ay, Math.max(0.8, U * 0.8), 0, TAU); ctx.fill();
    if (flight < 1) { const [hx, hy] = at(flight); ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(hx, hy, Math.max(1.2, U * 1.4), 0, TAU); ctx.fill(); }
    else {
      const burst = stage - 1;
      ctx.lineWidth = 1; ctx.globalAlpha = Math.max(0, 0.9 - burst * 2.2); ctx.beginPath(); ctx.arc(bx, by, Math.min(reach, Math.max(1.5, U * 1.4) + (burst / 0.45) * reach), 0, TAU); ctx.stroke();
      ctx.globalAlpha = Math.max(0.3, 1 - burst * 1.5); ctx.beginPath(); ctx.arc(bx, by, Math.max(1, U * 1.1), 0, TAU); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1; ctx.lineWidth = SW; ctx.lineCap = "butt"; ctx.fillStyle = C.stroke; ctx.strokeStyle = C.stroke;
  } else if (T === 47) { // big board: the war room's wall map, tracks arcing from launch sites, each ending in a burst that fades
    scr(x + U * 2, y + U * 2, w - U * 4, h - U * 4);
    const mx = x + U * 3, my = y + U * 3, mw = w - U * 6, mh = h - U * 6, fine = Math.min(mw, mh) >= 24;
    ctx.save(); ctx.beginPath(); ctx.rect(mx, my, mw, mh); ctx.clip();
    ctx.strokeStyle = C.glass; ctx.globalAlpha = 0.22; ctx.lineWidth = 1;
    const gx = Math.max(4, mw / (lvl === 2 ? 8 : 4)), gy = Math.max(4, mh / (lvl === 2 ? 4 : 2));
    for (let xx = mx + gx; xx < mx + mw - 1; xx += gx) { ctx.beginPath(); ctx.moveTo(Math.round(xx) + hp(), my); ctx.lineTo(Math.round(xx) + hp(), my + mh); ctx.stroke(); }
    for (let yy = my + gy; yy < my + mh - 1; yy += gy) { ctx.beginPath(); ctx.moveTo(mx, Math.round(yy) + hp()); ctx.lineTo(mx + mw, Math.round(yy) + hp()); ctx.stroke(); }
    // two coasts, faint, so the map is a map
    if (fine) {
      ctx.globalAlpha = 0.35;
      for (const side of [0, 1]) {
        ctx.beginPath();
        const x0 = mx + mw * (side ? 0.62 : 0.08), ww = mw * 0.3;
        for (let k = 0; k <= 8; k++) { const px = x0 + (ww * k) / 8, py = my + mh * (0.25 + 0.5 * g()); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1; ctx.lineWidth = SW; ctx.lineJoin = "round"; ctx.lineCap = "round";
    // the tracks: launched from the left in turn, each flying its arc over a few seconds and bursting where it lands;
    // at rest the board shows them at different stages, one still in the air, the last already a ring of fallout
    const n = lvl === 2 ? 4 : lvl === 1 ? 3 : 2, period = 5200;
    for (let i = 0; i < n; i++) {
      const ax = mx + mw * (0.08 + g() * 0.24), ay = my + mh * (0.25 + g() * 0.55), bx = mx + mw * (0.6 + g() * 0.26), by = my + mh * (0.25 + g() * 0.5), lift = Math.max(0, Math.min(mh * (0.35 + g() * 0.35), (ay + by) / 2 - my - mh * 0.1));
      // where this track is in its flight: 0 on the pad, 1 at the target, past 1 the burst spreading
      const stage = live ? ((phase(tt, period) + i / n) % 1) * 1.5 : 0.5 + (i / n) * 1.0 + g() * 0.2;
      const flight = Math.min(1, stage);
      const steps = 24, upto = Math.max(1, Math.round(steps * flight));
      const at = (t: number) => [ax + (bx - ax) * t, ay + (by - ay) * t - Math.sin(t * Math.PI) * lift] as const;
      ctx.strokeStyle = C.glass; ctx.fillStyle = C.glass;
      // the arc, brightest at its head, fading toward the pad once it has flown
      ctx.globalAlpha = flight < 1 ? 0.85 : Math.max(0.2, 0.85 - (stage - 1) * 1.3);
      ctx.beginPath(); for (let k = 0; k <= upto; k++) { const [px, py] = at(k / steps); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.stroke();
      // the pad, and the head while it flies
      ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(ax, ay, Math.max(1, U * 0.9), 0, TAU); ctx.fill();
      if (flight < 1) { const [hx, hy] = at(flight); ctx.beginPath(); ctx.arc(hx, hy, Math.max(1.2, U * 1.2), 0, TAU); ctx.fill(); }
      else {
        // the burst: a ring growing out from the target and fading, a second ring behind it on a big glass
        const burst = stage - 1, r0 = Math.max(2, U * 1.6);
        ctx.lineWidth = Math.max(1, SW * 0.8);
        ctx.globalAlpha = Math.max(0, 0.9 - burst * 1.6); ctx.beginPath(); ctx.arc(bx, by, r0 + burst * mh * 0.32, 0, TAU); ctx.stroke();
        if (fine) { ctx.globalAlpha = Math.max(0, 0.5 - burst * 1.2); ctx.beginPath(); ctx.arc(bx, by, r0 + burst * mh * 0.18, 0, TAU); ctx.stroke(); }
        ctx.globalAlpha = Math.max(0.25, 1 - burst); ctx.beginPath(); ctx.arc(bx, by, Math.max(1.2, U * 1.2), 0, TAU); ctx.fill();
        ctx.lineWidth = SW;
      }
    }
    ctx.restore(); ctx.globalAlpha = 1; ctx.fillStyle = C.stroke; ctx.strokeStyle = C.stroke;
  } else if (T === 48 && !inner && w < cell * 1.45 && h < cell * 1.45 && !fits(T, w, h, cell)) { // plotboard, one cell: the track flown so far, the plan dotted ahead, the craft's reticle
    const gm = Math.max(2, Math.round(U * 2.5));
    scr(x + gm, y + gm, w - gm * 2, h - gm * 2);
    const mx = x + gm + 1, my = y + gm + 1, mw = w - gm * 2 - 2, mh = h - gm * 2 - 2;
    ctx.strokeStyle = C.glass; ctx.fillStyle = C.glass; ctx.lineWidth = 1; ctx.globalAlpha = 0.3;
    const eq = Math.round(my + mh / 2) + hp(1);
    ctx.beginPath(); ctx.moveTo(mx, eq); ctx.lineTo(mx + mw, eq); ctx.stroke();
    // the track climbs across the glass with a slight weave, so at rest the craft's reticle sits in its middle, flown below, plan ahead
    const ph = g() * TAU, at = (t: number) => [mx + mw * (0.16 + 0.68 * t), my + mh * (0.78 - 0.56 * t) + Math.sin(ph + t * TAU) * mh * 0.05] as const;
    ctx.save(); ctx.beginPath(); ctx.rect(mx, my, mw, mh); ctx.clip();
    const now = live ? 0.2 + 0.6 * phase(tt, 7000) : 0.5, n = 16;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.globalAlpha = 0.95; ctx.lineWidth = Math.max(1, SW * 0.8);
    ctx.beginPath(); for (let i = 0; i <= n; i++) { const [px, py] = at((i / n) * now); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.stroke();
    ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.setLineDash([1, Math.max(2, U * 1.6)]);
    ctx.beginPath(); for (let i = 0; i <= n; i++) { const [px, py] = at(now + (i / n) * (1 - now)); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.stroke();
    ctx.setLineDash([]);
    const [cx2, cy2] = at(now), r = Math.max(1.4, U * 1.8);
    ctx.globalAlpha = 1; ctx.lineWidth = Math.max(1, SW * 0.8);
    ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, TAU); ctx.stroke();
    if (r >= 2.5) { ctx.beginPath(); ctx.moveTo(cx2 - r * 1.7, cy2); ctx.lineTo(cx2 - r * 1.2, cy2); ctx.moveTo(cx2 + r * 1.2, cy2); ctx.lineTo(cx2 + r * 1.7, cy2); ctx.moveTo(cx2, cy2 - r * 1.7); ctx.lineTo(cx2, cy2 - r * 1.2); ctx.moveTo(cx2, cy2 + r * 1.2); ctx.lineTo(cx2, cy2 + r * 1.7); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(cx2, cy2, Math.max(0.6, r * 0.32), 0, TAU); ctx.fill();
    ctx.restore();
    ctx.lineWidth = SW; ctx.lineCap = "butt"; ctx.fillStyle = C.stroke; ctx.strokeStyle = C.stroke;
  } else if (T === 48) { // plotboard: the ground track across a gridded map, flown so far in full, the rest as a dotted plan, a reticle at the craft
    scr(x + U * 2, y + U * 2, w - U * 4, h - U * 4);
    const mx = x + U * 3, my = y + U * 3, mw = w - U * 6, mh = h - U * 6, fine = Math.min(mw, mh) >= 24;
    ctx.save(); ctx.beginPath(); ctx.rect(mx, my, mw, mh); ctx.clip();
    // the map: a grid, the equator brighter, with latitude bands faint
    ctx.strokeStyle = C.glass; ctx.lineWidth = 1;
    if (fine) {
      const gxs = Math.max(6, mw / 8), gys = Math.max(6, mh / 4);
      ctx.globalAlpha = 0.14;
      for (let xx = mx + gxs; xx < mx + mw - 1; xx += gxs) { ctx.beginPath(); ctx.moveTo(Math.round(xx) + hp(), my); ctx.lineTo(Math.round(xx) + hp(), my + mh); ctx.stroke(); }
      for (let yy = my + gys; yy < my + mh - 1; yy += gys) { ctx.beginPath(); ctx.moveTo(mx, Math.round(yy) + hp()); ctx.lineTo(mx + mw, Math.round(yy) + hp()); ctx.stroke(); }
    }
    ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(mx, Math.round(my + mh / 2) + hp()); ctx.lineTo(mx + mw, Math.round(my + mh / 2) + hp()); ctx.stroke();
    // the track: one orbit across a wide map, a fraction of one across a square, so the curve is never folded
    const ph = g() * TAU, cycles = Math.max(0.5, Math.min(2, (mw / mh) * 0.7)), amp = Math.max(0, Math.min(mh * 0.3, mh / 2 - Math.max(2, U * 1.6) * 2));
    const at = (t: number) => [mx + mw * t, my + mh / 2 + Math.sin(ph + t * TAU * cycles) * amp] as const;
    const now = live ? phase(tt, 9000) : 0.3 + g() * 0.5;
    const n = Math.max(16, Math.round(mw / 2));
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    // flown: solid, with a glow on a big glass
    const flown = () => { ctx.beginPath(); for (let i = 0; i <= n; i++) { const t = (i / n) * now, [px, py] = at(t); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } };
    if (fine) { ctx.globalAlpha = 0.18; ctx.lineWidth = SW * 3; flown(); ctx.stroke(); }
    ctx.globalAlpha = 0.95; ctx.lineWidth = Math.max(1, SW * 0.9); flown(); ctx.stroke();
    // ahead: dotted
    ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.setLineDash([2, Math.max(3, U * 2)]);
    ctx.beginPath(); for (let i = 0; i <= n; i++) { const t = now + (i / n) * (1 - now), [px, py] = at(t); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.stroke();
    ctx.setLineDash([]);
    // the craft: a reticle, a ring with a gap and a dot, and its tag on a big glass
    const [cx2, cy2] = at(now), r = Math.max(2, U * 1.6);
    ctx.globalAlpha = 1; ctx.lineWidth = Math.max(1, SW * 0.8);
    ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx2 - r * 1.8, cy2); ctx.lineTo(cx2 - r * 0.6, cy2); ctx.moveTo(cx2 + r * 0.6, cy2); ctx.lineTo(cx2 + r * 1.8, cy2); ctx.moveTo(cx2, cy2 - r * 1.8); ctx.lineTo(cx2, cy2 - r * 0.6); ctx.moveTo(cx2, cy2 + r * 0.6); ctx.lineTo(cx2, cy2 + r * 1.8); ctx.stroke();
    ctx.fillStyle = C.glass; ctx.beginPath(); ctx.arc(cx2, cy2, Math.max(0.8, r * 0.3), 0, TAU); ctx.fill();
    if (fine && mw > U * 30) { const ps = 1, tag = word(TILES).slice(0, 3); p.pix(tag, Math.min(mx + mw - p.pixW(tag, ps) - 2, cx2 + r * 2.2), Math.max(my + 2, cy2 - r * 2.6), ps, C.glass); }
    ctx.restore(); ctx.lineWidth = SW; ctx.fillStyle = C.stroke; ctx.globalAlpha = 1;
  } else if (T === 49 && !inner && w < cell * 1.45 && h < cell * 1.45 && !fits(T, w, h, cell)) { // threat ladder, one cell: the live tile alone, its numeral cut from it
    const pad = Math.max(2, Math.round(U * 2.5)), tx = x + pad, ty = y + pad, tw = w - pad * 2, th = h - pad * 2;
    const level = live ? 5 - beat(tt, 1200, 5) : 1 + Math.floor(g() * 5), ink = ON ? C.screen : C.face;
    litRect(tx + rim, ty + rim, tw - rim * 2, th - rim * 2);
    // the numeral in the pixel face, a whole number of device pixels to its pixel, cut cleanly from the tile at every size
    const num = String(level), snap = (v: number) => Math.round(v * DS) / DS, ps = Math.max(1 / DS, Math.floor(((th - rim * 2) * 0.6 * DS) / 5) / DS);
    p.pix(num, snap(tx + (tw - p.pixW(num, ps)) / 2), snap(ty + (th - ps * 5) / 2), ps, ink);
    ctx.fillStyle = C.stroke;
  } else if (T === 49) { // threat ladder: the DEFCON board, five tiles in a column with a gap between, the numeral cut from each, the live one filled
    // on a wide plate the tiles stand side by side, five to one, rather than the column turned on its side with its numerals lying down.
    // The tiles in whole pixels, the same margin each side, so a lit tile and an outlined one are the same box
    const n = 5, pad = Math.round(U * 2), gap = Math.max(2, U * 1.2), across = w > h * 1.6;
    const cw = across ? (w - pad * 2 - gap * (n - 1)) / n : w - pad * 2, ch = across ? h - pad * 2 : (h - pad * 2 - gap * (n - 1)) / n;
    const lit = live ? 4 - beat(tt, 1200, 5) : Math.floor(g() * 5), fine = ch >= 9;
    for (let i = 0; i < n; i++) {
      const on = i === lit;
      // a bar under seven device pixels high is framed in a single device pixel, so the numeral inside it has room
      ctx.strokeStyle = C.stroke; ctx.fillStyle = C.stroke; ctx.lineWidth = !across && Math.floor(ch) * DS < 14 ? 1 / DS : 1;
      // each tile a slim plate with a hairline frame and, on a big board, a rule at its foot for the shadow a real tile throws
      // the live tile lights in place, the same size as its neighbours: its well is drawn inside its own frame
      // down a column every tile is the same whole number of pixels high, the rounding spent in the gaps, so no bar is thinner than the next
      const chR = Math.max(1, Math.floor(ch)), gapR = (h - pad * 2 - chR * n) / (n - 1);
      const tx = across ? Math.round(x + pad + (cw + gap) * i) : x + pad, ty = across ? y + pad : Math.round(y + pad + (chR + gapR) * i);
      const tw = across ? Math.round(x + pad + (cw + gap) * i + cw) - tx : cw, th = across ? ch : chR;
      if (on) { const rm = ON ? 1 : 0; if (rm) { ctx.fillStyle = C.screen; ctx.fillRect(tx, ty, tw, th); } ctx.fillStyle = LAMP; ctx.fillRect(tx + rm, ty + rm, tw - rm * 2, Math.max(1, th - rm * 2)); ctx.fillStyle = C.stroke; }
      else {
        ctx.globalAlpha = 0.75; ring(tx, ty, tw, th); ctx.globalAlpha = 1;
        // the shadow rule sits just inside the frame's foot, a pixel in from either side
        if (fine && th >= 6) { ctx.globalAlpha = 0.25; ctx.fillRect(tx + 1, ty + th - 2, tw - 2, 1); ctx.globalAlpha = 1; }
      }
      // the numeral, and beside it on a wide board the word for the state, so it reads as a board and not a ruler
      // the numerals only where they read: a tile shorter than a dozen pixels is a bar, and a bar with a smudge in it is worse
      // sized from the tile's true height, not its rounded one, so every tile's numeral is the same size and none drops out
      const dh = Math.min(ch * 0.7, cw * (across ? 1.05 : 0.5)), dw = dh / 1.5, ink = on ? (ON ? C.screen : C.face) : C.stroke;
      const label = ["CRIT", "HI", "MID", "LOW", "MIN"][i]!, inset = Math.max(3, Math.round(U * 2.5));
      if (dh >= 9) {
        const wide = !across && fine && tw > dh * 4.5, ps = Math.max(1, Math.floor(Math.min(dh / 5, (tw * 0.5) / 20)));
        const dx = wide ? tx + inset : tx + (tw - dw * 0.66) / 2;
        p.seg7(String(5 - i), dx, ty + (th - dh) / 2, dw, dh, ink);
        if (wide && ps >= 1) p.pix(label, Math.round(tx + tw - inset - p.pixW(label, ps)), Math.round(ty + (th - ps * 5) / 2), ps, ink);
      } else {
        // a bar too low for a seven-segment numeral still carries its number, in the pixel face at the size that fits with
        // a pixel clear above and below its frame; the word goes at the far end where the bar is long enough for both
        // the face's pixel is a whole number of device pixels, down to one: on a retina screen a bar five CSS pixels high still reads
        // and no wider than its tile: side by side, tiles are narrow, and a numeral sized by height alone ran into its neighbours
        const snap = (v: number) => Math.round(v * DS) / DS, ps = Math.floor((Math.min((ch - 2) / 5, (tw - 2) / 3)) * DS) / DS;
        if (ps * DS >= 1) {
          const num = String(5 - i), ny = snap(ty + (th - ps * 5) / 2), wide = !across && tw >= inset * 2 + p.pixW(num, ps) + p.pixW(label, ps) + ps * 6;
          p.pix(num, wide ? tx + inset : snap(tx + (tw - p.pixW(num, ps)) / 2), ny, ps, ink);
          if (wide) p.pix(label, snap(tx + tw - inset - p.pixW(label, ps)), ny, ps, ink);
        }
      }
    }
    ctx.lineWidth = SW; ctx.fillStyle = C.stroke;
  } else if (T === 50) { // split-flap: a board of flap cells, letters that flip when live
    const cw = Math.max(4, U * 5), cols = Math.max(2, Math.min(capX(12), Math.floor((w - U * 4) / cw))), rows = Math.max(1, Math.min(capY(4), Math.floor((h - U * 4) / (cw * 1.3))));
    const cww = (w - U * 4) / cols, chh = (h - U * 4) / rows, ps = Math.max(1, Math.floor(Math.min(cww * 0.5, chh * 0.45) / 5));
    const seat = word(TILES).padEnd(cols, " ");
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const cx = Math.round(x + U * 2 + cww * i + 1), cy = Math.round(y + U * 2 + chh * j + 1), cw2 = Math.round(x + U * 2 + cww * (i + 1) - 1) - cx, ch2 = Math.round(y + U * 2 + chh * (j + 1) - 1) - cy;
      ctx.fillStyle = C.stroke; ctx.fillRect(cx, cy, cw2, ch2);
      ctx.strokeStyle = C.face; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, Math.round(cy + ch2 / 2) + hp()); ctx.lineTo(cx + cw2, Math.round(cy + ch2 / 2) + hp()); ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = SW;
      const flipping = live && (i + j * cols + beat(tt, 350, 9)) % 9 === 0;
      const chr = j === 0 ? (seat[i] as string) : String.fromCharCode(65 + Math.floor(g() * 26));
      if (ps >= 1 && chr !== " " && cw2 >= 5 && ch2 >= 6) {
        const ch3 = FONTED.has(chr) ? chr : "0";
        p.pix(ch3, Math.round(cx + (cw2 - p.pixW(ch3, ps)) / 2), Math.round(cy + (ch2 - ps * 5) / 2), ps, ON ? C.glass : C.face);
        // mid-flip, the upper flap is falling toward the reader: its half of the letter goes dark, the letter stays whole and in place
        if (flipping) { ctx.fillStyle = C.stroke; ctx.globalAlpha = 0.65; ctx.fillRect(cx, cy, cw2, Math.round(ch2 / 2)); ctx.globalAlpha = 1; }
      }
    }
    ctx.fillStyle = C.stroke;
  } else if (T === 51) { // core cartogram: the reactor's channel map, a field of tiny lamps in a round vessel or a square one
    // the vessel's side takes the parity of the box's short side, so the margins either side of it are equal whole pixels
    let fs = Math.round(Math.min(w, h) * 0.84); if ((Math.min(w, h) - fs) % 2) fs -= 1;
    const fx = x + Math.round((w - fs) / 2), fy = y + Math.round((h - fs) / 2), rr = fs / 2, cx = fx + rr, cy = fy + rr;
    const st = Math.max(2, Math.round(U * 1.6)), round = g() < 0.5, lw = ctx.lineWidth;
    ctx.strokeStyle = C.stroke;
    if (round) { ctx.beginPath(); ctx.arc(cx, cy, rr - lw / 2, 0, TAU); ctx.stroke(); }
    else ring(fx, fy, fs, fs);
    ctx.fillStyle = C.stroke;
    // the lattice: a whole number of pixels between lamps, its origin on a whole pixel, so every lamp is the same and evenly spaced
    const d = Math.max(1, Math.round(st * 0.55)), n = Math.floor((rr * 2) / st), ox = Math.round(cx - ((n - 1) * st + d) / 2), oy = Math.round(cy - ((n - 1) * st + d) / 2);
    const lim = rr - lw - d / 2 - Math.max(1, st * 0.4);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const lx = ox + i * st, ly = oy + j * st, px = lx + d / 2, py = ly + d / 2;
      if (round ? (px - cx) ** 2 + (py - cy) ** 2 > lim ** 2 : Math.max(Math.abs(px - cx), Math.abs(py - cy)) > lim) continue;
      const on = g() < 0.18 !== (live && (i * 7 + j * 3 + beat(tt, 400, 23)) % 23 === 0);
      if (on) { ctx.globalAlpha = 1; const k = Math.min(rim, Math.floor((d - 1) / 2)); litRect(lx + k, ly + k, d - k * 2, d - k * 2); } else { ctx.fillStyle = C.stroke; ctx.globalAlpha = 0.22; ctx.fillRect(lx, ly, d, d); }
    }
    ctx.globalAlpha = 1; ctx.fillStyle = C.stroke;
  } else if (T === 52) { // vector scope: a round tube, a track drawn in strokes, a blip with its tag, a cursor
    const cx = x + w / 2, cy = y + h / 2, rr = Math.min(w, h) * 0.44;
    ctx.fillStyle = C.screen; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, rr - 1, 0, TAU); ctx.clip();
    ctx.strokeStyle = C.glass; ctx.globalAlpha = 0.9;
    const a0 = g() * 6.28, n = lvl ? 5 : 3, len = rr * 0.28;
    let px = cx + Math.cos(a0) * rr * 0.6, py = cy + Math.sin(a0) * rr * 0.6;
    ctx.beginPath(); ctx.moveTo(px, py);
    for (let i = 0; i < n; i++) { const a = a0 + Math.PI + (g() - 0.5) * 1.2 + (live ? Math.sin(wave(tt, TAU * 900) + i) * 0.2 : 0); px += Math.cos(a) * len; py += Math.sin(a) * len; ctx.lineTo(px, py); }
    ctx.stroke();
    const bd = Math.max(2, Math.min(rr * 0.1, SW * 2)), to = bd * 1.4;
    ctx.fillStyle = C.glass; ctx.fillRect(px - bd / 2, py - bd / 2, bd, bd);
    if (lvl >= 1) { ctx.globalAlpha = 0.5; ctx.lineWidth = Math.max(1, SW / 2); ctx.beginPath(); ctx.moveTo(px + to, py - to); ctx.lineTo(px + to + Math.max(4, rr * 0.25), py - to); ctx.stroke(); ctx.lineWidth = SW; }
    const kx = cx + (live ? Math.cos(wave(tt, TAU * 1300)) : g() - 0.5) * rr * 0.5, ky = cy + (live ? Math.sin(wave(tt, TAU * 1700)) : g() - 0.5) * rr * 0.5, k = Math.max(2, rr * 0.12);
    ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.moveTo(kx - k, ky); ctx.lineTo(kx + k, ky); ctx.moveTo(kx, ky - k); ctx.lineTo(kx, ky + k); ctx.stroke();
    ctx.restore(); ctx.globalAlpha = 1;
  } else if (T === 53 && !inner && w < cell * 1.45 && h < cell * 1.45 && !fits(T, w, h, cell)) { // annunciator, one cell: a single tile, its word, lit or dark
    const pad = Math.max(2, Math.round(U * 2.2)), fw = Math.max(1, Math.round(SW / 2)), tx = x + pad, ty = y + pad, tw = w - pad * 2, th = h - pad * 2;
    const WORDS3 = ["ARM", "RUN", "OIL", "SUB", "NET", "ALT"], wd = WORDS3[Math.floor(g() * WORDS3.length)]!;
    const on = live ? (beat(tt, 600, 3) + Math.floor(g() * 3)) % 3 !== 0 : g() < 0.6;
    ctx.lineWidth = fw; ctx.strokeStyle = C.stroke; ctx.fillStyle = C.stroke;
    if (on) litRect(tx + rim, ty + rim, tw - rim * 2, th - rim * 2); else ring(tx, ty, tw, th);
    const ink = on ? (ON ? C.screen : C.face) : C.stroke, inner = (v: number) => v - fw * 2 - 2;
    const ps = Math.floor(Math.min(inner(th) / 5, inner(tw) / 11) * DS) / DS, snap = (v: number) => Math.round(v * DS) / DS;
    if (ps * DS >= 1) p.pix(wd, snap(tx + (tw - p.pixW(wd, ps)) / 2), snap(ty + (th - ps * 5) / 2), ps, ink);
    else { ctx.fillStyle = ink; const bw = snap(tw * 0.42), bh = Math.max(1 / DS, snap(th * 0.12)); ctx.fillRect(snap(tx + (tw - bw) / 2), snap(ty + (th - bh) / 2), bw, bh); }
    ctx.lineWidth = SW; ctx.fillStyle = C.stroke;
  } else if (T === 53) { // annunciator: a grid of tiles with a word on each, the lit ones filled
    const cols = Math.max(lvlX ? 2 : 1, Math.min(capX(4), Math.floor((w - U * 4) / (U * 9)))), rows = Math.max(lvlY ? 2 : 1, Math.min(capY(4), Math.floor((h - U * 4) / (U * 5))));
    const cw = (w - U * 4) / cols, ch = (h - U * 4) / rows, lit = live ? beat(tt, 600, cols * rows) : -1;
    // a hairline bezel, lit or not the same box; the words set inside it with a pixel clear all round
    const fw = Math.max(1, Math.round(SW / 2)), room = (side: number) => side - fw * 2 - 2;
    // one type size for the whole board, set by the longest word a tile can carry, so OIL is not larger than MAIN
    const ps = Math.max(1, Math.floor(Math.min(room(ch - 2) / 5, room(cw - 2) / 15)));
    // a board is lettered throughout or not at all: the test is the longest word in the smallest tile rounding can make
    const lettered = ps * 5 <= room(Math.floor(ch) - 3) && ps * 15 <= room(Math.floor(cw) - 3);
    ctx.lineWidth = fw;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const tx = Math.round(x + U * 2 + cw * i + 1), ty = Math.round(y + U * 2 + ch * j + 1), on = g() < 0.3 !== (i + j * cols === lit);
      const tw = Math.round(x + U * 2 + cw * (i + 1) - 1) - tx, th = Math.round(y + U * 2 + ch * (j + 1) - 1) - ty;
      ctx.strokeStyle = C.stroke; ctx.fillStyle = C.stroke;
      if (on) litRect(tx + rim, ty + rim, tw - rim * 2, th - rim * 2); else ring(tx, ty, tw, th);
      // the face has no X: a word it cannot set whole is AUTO, drawn from the same pick so the board's other words stay put
      const w0 = word(TILES), wd = ([...w0].every((c) => FONTED.has(c)) ? w0 : "AUTO").slice(0, 4);
      if (lettered) p.pix(wd, Math.round(tx + (tw - p.pixW(wd, ps)) / 2), Math.round(ty + (th - ps * 5) / 2), ps, on ? (ON ? C.screen : C.face) : C.stroke);
    }
    ctx.lineWidth = SW; ctx.fillStyle = C.stroke;
  } else if (T === 54 && !inner && w < cell * 1.45 && h < cell * 1.45 && !fits(T, w, h, cell)) { // mission clock, one cell: the seconds, the colon before them blinking
    const gm = Math.max(2, Math.round(U * 2.5));
    scr(x + gm, y + gm, w - gm * 2, h - gm * 2);
    const iw = w - gm * 2 - U * 5, ih = h - gm * 2 - U * 5;
    // a seeded time of day whose seconds run with the loop, so the clock repeats with everything else
    const sec = String((Math.floor(g() * 60) + (live ? tick(tt, 1000) : 0)) % 60).padStart(2, "0");
    // one group: the colon's dots, a gap as wide as between the digits, then the two digits, whose glyphs end two thirds into the last box
    const dot = 0.16, gapK = 0.34, dw = Math.min(iw / (dot + gapK + 1.66), ih / 1.5), dh = dw * 1.5, d = Math.max(1, dw * dot);
    const total = d + dw * gapK + dw * 1.66, x0 = x + (w - total) / 2, dy = y + (h - dh) / 2;
    if (dw >= 2) {
      if (!live || beat(tt, 500, 2) === 0) {
        ctx.fillStyle = C.glass;
        ctx.fillRect(x0, dy + dh * 0.3 - d / 2, d, d); ctx.fillRect(x0, dy + dh * 0.7 - d / 2, d, d);
      }
      p.seg7(sec, x0 + d + dw * gapK, dy, dw, dh, C.glass);
    }
    ctx.fillStyle = C.stroke;
  } else if (T === 54 && !inner && w >= cell * 2.3 && h >= cell * 1.8 && !fits(T, w, h, cell)) { // mission clock, stacked: hours and minutes over the seconds
    // a panel only a holder's pick reaches: HH:MM large, the seconds under them smaller, one glass, the colons blinking
    scr(x + U * 2, y + U * 2, w - U * 4, h - U * 4);
    // a seeded time of day whose seconds run with the loop, so the clock repeats with everything else
    const t0 = Math.floor(g() * 86_400) + (live ? tick(tt, 1000) : 0);
    const parts = [Math.floor(t0 / 3600) % 24, Math.floor((t0 % 3600) / 60), t0 % 60].map((v) => String(v).padStart(2, "0"));
    const blink = !live || beat(tt, 500, 2) === 0, rowGap = U * 2;
    // the top row: two groups and a colon gap; glyphs end two thirds into each group's last box
    const dw = Math.min((w - U * 10) / (1.66 * 2 + 0.94), (h - U * 10 - rowGap) / (1.5 + 1.5 * 0.62)), dh = dw * 1.5;
    const sw2 = dw * 0.62, sh = sw2 * 1.5, topW = dw * 1.66 * 2 + dw * 0.94, y0 = y + (h - dh - rowGap - sh) / 2;
    if (dw >= 3) {
      let cx = x + (w - topW) / 2;
      p.seg7(parts[0]!, cx, y0, dw, dh, C.glass); cx += dw * 1.66;
      if (blink) { ctx.fillStyle = C.glass; const q = Math.max(1, dw * 0.14); ctx.fillRect(cx + dw * 0.47 - q / 2, y0 + dh * 0.3 - q / 2, q, q); ctx.fillRect(cx + dw * 0.47 - q / 2, y0 + dh * 0.7 - q / 2, q, q); }
      cx += dw * 0.94;
      p.seg7(parts[1]!, cx, y0, dw, dh, C.glass);
      // the seconds, centred under the minutes and hours as one group with their own colon
      const q = Math.max(1, sw2 * 0.16), secW = q + sw2 * 0.34 + sw2 * 1.66, sx = x + (w - secW) / 2, sy = y0 + dh + rowGap;
      if (blink) { ctx.fillStyle = C.glass; ctx.fillRect(sx, sy + sh * 0.3 - q / 2, q, q); ctx.fillRect(sx, sy + sh * 0.7 - q / 2, q, q); }
      p.seg7(parts[2]!, sx + q + sw2 * 0.34, sy, sw2, sh, C.glass);
    }
    ctx.fillStyle = C.stroke;
  } else if (T === 54) { // mission clock: hours, minutes, seconds in glass, the colons blinking
    scr(x + U * 2, y + U * 3, w - U * 4, h - U * 6);
    const groups = lvlX === 2 && w > U * 30 ? 3 : lvlX ? 2 : 1, digits = groups * 2, gaps = groups - 1;
    const dw = Math.min((w - U * 8) / (digits + gaps * 0.6), ((h - U * 10) / 1.5)), dh = dw * 1.5;
    // a group's glyphs end two thirds into its last box; the gap between groups is measured from there, so the colons sit in its middle
    const grp = dw * 1.66, gap = dw * 0.94, total = grp * groups + gap * gaps;
    // a seeded time of day whose seconds run with the loop, so the wall's clocks repeat with everything else
    const t = (Math.floor(g() * 86_400) + (live ? tick(tt, 1000) : 0)) % 86_400;
    const parts = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].slice(3 - groups).map((v) => String(v).padStart(2, "0"));
    let cx = x + (w - total) / 2;
    if (dw >= 3) for (let gi = 0; gi < groups; gi++) {
      p.seg7(parts[gi]!, cx, y + (h - dh) / 2, dw, dh, C.glass); cx += grp;
      if (gi < gaps) {
        const blink = !live || beat(tt, 500, 2) === 0;
        if (blink) { ctx.fillStyle = C.glass; const d = Math.max(1, dw * 0.14); ctx.fillRect(cx + gap / 2 - d / 2, y + h / 2 - dh * 0.2 - d / 2, d, d); ctx.fillRect(cx + gap / 2 - d / 2, y + h / 2 + dh * 0.2 - d / 2, d, d); }
        cx += gap;
      }
    }
    ctx.fillStyle = C.stroke;
  } else if (T === 56) { // register panel: rows of lamps for a machine's registers, a row of switches beneath
    const rows = Math.max(lvlY ? 2 : 1, Math.min(capY(6), Math.floor((h - U * 6) / (U * 3.2)))), cols = Math.max(lvlX ? 6 : 3, Math.min(capX(24), Math.floor((w - U * 4) / (U * 2.2))));
    const lx = x + U * 2, ly = y + U * 2, lw = w - U * 4, lh = (h - U * 6) * (rows / (rows + 1)), r = Math.max(0.8, Math.min(lw / cols, lh / rows) * 0.3);
    ctx.fillStyle = C.stroke; ctx.strokeStyle = C.stroke;
    for (let j = 0; j < rows; j++) {
      const word32 = Math.floor(g() * 2 ** 24) ^ (live ? (tick(tt, 90) + j * 5) : 0);
      for (let i = 0; i < cols; i++) {
        const px = lx + (lw * (i + 0.5)) / cols, py = ly + (lh * (j + 0.5)) / rows;
        // a dark lamp is a ring the same size as a lit one, its line drawn inside the lamp's edge
        // on, a lit lamp's black well is inside its size, not around it, so lit and dark lamps stay the same and never touch
        if ((word32 >> (i % 24)) & 1) litDot(px, py, Math.max(0.6, r - rim)); else { const rl = Math.max(1, Math.min(SW, r * 0.45)); ctx.lineWidth = rl; ctx.beginPath(); ctx.arc(px, py, Math.max(0.5, r - rl / 2), 0, TAU); ctx.stroke(); ctx.lineWidth = SW; }
      }
    }
    // the switches under the lamps, as far from the plate's foot as the top row of lamps is from its head
    const head = (lh / rows) / 2 - r;
    const sy = ly + lh + U, sh = Math.max(2, h - U * 6 - lh - U + Math.max(0, U * 2 - head)), sn = Math.max(3, Math.min(12, Math.floor(cols / 2)));
    for (let i = 0; i < sn; i++) {
      const sx = lx + (lw * (i + 0.5)) / sn, sw2 = Math.max(2, Math.min(U * 2.2, (lw / sn) * 0.5)), up = g() < 0.5;
      // the toggle's frame inside its box, the lever filling the half it is thrown to, inside the frame
      const bx = Math.round(sx - sw2 / 2), bw = Math.max(2, Math.round(sw2)), by = Math.round(sy), bh = Math.max(2, Math.round(sh)), fl = Math.max(1, Math.min(SW, Math.floor(bw / 4)));
      ctx.lineWidth = fl; ring(bx, by, bw, bh); ctx.lineWidth = SW;
      const half = Math.floor((bh - fl * 2) / 2);
      if (bw > fl * 2 && half >= 1) ctx.fillRect(bx + fl, up ? by + fl : by + bh - fl - half, bw - fl * 2, half);
    }
  } else if (T === 46) { // square grille
    const s2 = Math.min(w, h) * 0.8, gx = x + (w - s2) / 2, gy = y + (h - s2) / 2;
    ctx.strokeStyle = C.stroke; ring(gx, gy, s2, s2);
    ctx.fillStyle = C.stroke; const st = Math.max(2.5, U * 2.2), m = Math.max(1, Math.floor((s2 - ctx.lineWidth * 2 - st) / st)), o = (s2 - (m - 1) * st) / 2;
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) { ctx.beginPath(); ctx.arc(gx + o + i * st, gy + o + j * st, Math.max(0.6, st * 0.22) * (live ? 1 + 0.4 * Math.sin(wave(tt, TAU * 90)) : 1), 0, TAU); ctx.fill(); }
  } else if (T === 31) { // spectrum
    if (!inner && w < cell * 1.75 && h < cell * 1.75 && !fits(T, w, h, cell)) {
      // one cell: four bands in a square of glass, inset the same all round, every bar on whole device pixels
      const sn = (v: number) => Math.round(v * DS) / DS, s = Math.min(w, h), gm = sn(Math.max(1.5, s * 0.13));
      const gs = sn(s - gm * 2), gx = sn(x + (w - gs) / 2), gy = sn(y + (h - gs) / 2);
      scr(gx, gy, gs, gs);
      const ip = Math.max(1 / DS, sn(gs * 0.14)), n = 4, slot = (gs - ip * 2) / n, bw = Math.max(1 / DS, sn(slot * 0.62)), floor = gy + gs - ip;
      ctx.fillStyle = C.glass;
      for (let i = 0; i < n; i++) {
        const v = live ? 0.25 + 0.7 * Math.abs(Math.sin(i * 0.9 + wave(tt, TAU * 180)) * Math.sin(wave(tt, TAU * 900) + i)) : g() * 0.75 + 0.2;
        const bx = sn(gx + ip + slot * i + (slot - bw) / 2), bh = Math.max(1 / DS, sn((gs - ip * 2) * v));
        ctx.fillRect(bx, floor - bh, bw, bh);
      }
    } else {
      scr(x + U * 2, y + U * 2, w - U * 4, h - U * 4);
      const n = Math.max(lvlX ? 6 : 1, Math.min(capX(24), Math.floor((w - U * 6) / (U * 2.2)))), bw = (w - U * 6) / n;
      ctx.fillStyle = C.glass;
      for (let i = 0; i < n; i++) {
        const v = live ? 0.25 + 0.7 * Math.abs(Math.sin(i * 0.8 + wave(tt, TAU * 180)) * Math.sin(wave(tt, TAU * 900) + i)) : g() * 0.8 + 0.1;
        const bh = (h - U * 6) * v;
        const sn = (v: number) => Math.round(v * DS) / DS, bx = sn(x + U * 3 + bw * i + bw * 0.15), bt = sn(y + h - U * 3 - bh);
        ctx.fillRect(bx, bt, Math.max(1, sn(x + U * 3 + bw * i + bw * 0.85) - bx), sn(y + h - U * 3) - bt);
      }
    }
  }
  // the glass is done with: what follows is on the plate
  while (glasses-- > 0) ctx.restore();
  // a grille, a speaker, a heat sink or a tape has nothing of its own to light; on, it carries a lamp at its corner
  if (lampRoom && carry) {
    litDot(x + w - U * 2.6, y0 + U * 2.2, Math.max(1, U * 1.1), markColour);
    p.lamps = 0;
  }
}
