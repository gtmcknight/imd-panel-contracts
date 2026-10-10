/**
 * One module's face, drawn the same wherever it is drawn.
 *
 * The wall paints a module here, and so does the page where a holder designs their own, so the
 * preview is the module and not a picture of it. Everything a module is made of is seeded from
 * its seat: whether it is a tile, an instrument or a wallet's device, which parts it carries, its
 * tone. A holder's design asks for a device kind, mounts its parts first where they fit, stands in
 * for the seat's number in the draws that fill the rest when it carries a seed. The plate and the lamps are always the theme's. With no design every draw is exactly
 * the seat's own.
 *
 * The state around the module (its lamp in the corner, the working frame, the lift under the
 * pointer) is the wall's to draw; this returns what that needs to match.
 */
import type { Design } from "./design";
import { seedOf, tileOf } from "./design";
import { drawDevice, type DeviceKind, type Mount } from "./devices";
import { drawInstrument, fitsPicked, INSTRUMENT_NAMES, pickInstrument } from "./instruments";
import type { Theme } from "./palette";
import { TAU, type Painter } from "./painter";
import { rng } from "./rng";
import { drawTile, TILE_BLEED, TILE_COUNT } from "./tiles";
import type { Activity } from "./types";

/** The reader's face plate: white, the brightest thing on the wall in any theme. */
export const MINE_FACE = "#ffffff";

const NONE: never[] = [];

export type ModuleSpec = {
  /** The module's first seat, whose number seeds its draw. */
  first: number;
  /** How many seats it holds, and its size in cells. */
  n: number;
  cw: number;
  ch: number;
  activity: Activity;
  /** Its glass: 0 dark, 1 on, 2 working now. */
  lit: 0 | 1 | 2;
  /** Moving: drifting, warm, on, or under the pointer. */
  moving: boolean;
  /** The module's own clock, ms. */
  tms: number;
  /** One of the reader's: the bright plate. */
  mine: boolean;
  /** The line around a module in this theme. */
  edge: string;
  theme: Theme;
  design: Design | null;
};

/**
 * What the wall needs to finish the module, whether it took the other batch's plate, and, for a
 * module drawn with a design, what the design made of it: the parts that found a slot, every open
 * slot in cells, and the templates drawn. The editor reads these; the wall needs only the first.
 */
export type ModuleLook = { inverted: boolean; placed: number[]; slots: Array<[number, number]>; kinds: DeviceKind[] };

/**
 * Paint a module's plate, its frame, what is mounted on it and its hardware into the box, in CSS
 * pixels, leaving the painter as it found it.
 */
export function drawModule(p: Painter, x: number, y: number, w: number, h: number, m: ModuleSpec): ModuleLook {
  const { ctx, cell } = p, d = m.design, k = m.activity, n = m.n;
  const s = seedOf(d, m.first);
  // tone: about one module in six is a panel from another batch, a shade off the rest
  // the reader's own modules are the bright ones: a white face plate among the grey, the drawing in ink on top
  const inv = !m.mine && !k && rng(m.first * 41 + 3)() < 0.17;
  // a panel wears the viewer's theme, chosen on the wall's cog; a design carries no colours of its own
  const edge = m.edge;
  p.setInverted(inv); p.setFace(m.mine ? MINE_FACE : null); p.setLamp(m.theme.lamp);
  p.setLit(m.lit);
  const PAL = p.P;
  // a design's parts, those this site has a drawing for; a module with no design keeps no account
  const isTile = (T: number) => tileOf(T) >= 0 && tileOf(T) < TILE_COUNT;
  const mount: Mount | undefined = d ? { queue: d.parts.filter((T) => INSTRUMENT_NAMES[T] || isTile(T)), placed: [], slots: [], kinds: [] } : undefined;
  ctx.fillStyle = PAL.face; ctx.fillRect(x, y, w, h);
  // a one-seat module is one slot: a part that fits it takes it, a tile's square included; a tile part only a single cell takes
  const cellOnly = n === 1 && m.cw === 1 && m.ch === 1;
  const part = n === 1 && mount ? mount.queue.find((T) => (isTile(T) ? cellOnly : fitsPicked(T, w, h, cell))) : undefined;
  if (n === 1 && mount) { mount.slots.push([w / cell, h / cell]); if (part !== undefined) mount.placed.push(part); }
  const pickedTile = part !== undefined && isTile(part) ? tileOf(part) : -1;
  const asTile = pickedTile >= 0 || (cellOnly && part === undefined && rng(s * 23 + 9)() < 0.5);
  const tileT = pickedTile >= 0 ? pickedTile : asTile ? Math.floor(rng(s * 29 + 1)() * TILE_COUNT) : -1;
  // the frame's corners square, whatever join the page draws with: a round join left the plate's light corner showing
  // past it, a white dot at each corner once the panel is drawn large
  const join = ctx.lineJoin; ctx.lineJoin = "miter";
  if (!(asTile && TILE_BLEED.has(tileT))) { ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.globalAlpha = k ? 1 : 0.85; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); ctx.globalAlpha = 1; }
  ctx.lineJoin = join;
  if (asTile) drawTile(p, tileT, rng(s * 7 + 1), x, y, w, h, m.moving, m.tms);
  else if (n === 1) {
    const T = part ?? pickInstrument(p, rng(s * 17), w, h);
    drawInstrument(p, T, rng(s * 7 + 1), x, y, w, h, m.moving, m.tms, k);
  }
  else {
    ctx.lineJoin = "miter"; ctx.strokeStyle = edge; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5); ctx.lineWidth = 1; ctx.lineJoin = join;
    drawDevice(p, rng(s * 5 + 3), x, y, w, h, m.moving, m.tms, k, s, undefined, 0, new Set(), new Set(), d?.kind ?? undefined, mount);
  }
  // hardware: corner screws on anything two cells or wider, rack ears on tall racks
  if (m.cw >= 2 && cell >= 14) {
    const ins = cell * 0.16, sr = Math.max(1, cell * 0.055);
    ctx.strokeStyle = PAL.stroke; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
    for (const [px, py] of [[x + ins, y + ins], [x + w - ins, y + ins], [x + ins, y + h - ins], [x + w - ins, y + h - ins]] as const) {
      ctx.beginPath(); ctx.arc(px, py, sr, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px - sr * 0.7, py + sr * 0.3); ctx.lineTo(px + sr * 0.7, py - sr * 0.3); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  if (m.ch >= 4 && m.cw <= 2 && cell >= 14) {
    const ew = Math.max(2, cell * 0.1);
    ctx.fillStyle = PAL.stroke; ctx.globalAlpha = 0.18; ctx.fillRect(x + 1, y + 1, ew, h - 2); ctx.fillRect(x + w - 1 - ew, y + 1, ew, h - 2); ctx.globalAlpha = 1;
  }
  p.setInverted(false); p.setLit(0); p.setFace(null); p.setScheme(null);
  return mount ? { inverted: inv, placed: mount.placed, slots: mount.slots, kinds: mount.kinds } : { inverted: inv, placed: NONE, slots: NONE, kinds: NONE };
}
