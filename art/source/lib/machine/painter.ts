/**
 * The brush every module is drawn with.
 *
 * A painter is one canvas context, one cell size and the palette in force. The instrument, tile
 * and device drawings all take one and read their colours through it, so flipping a module to the
 * dark anodised panel is one call rather than an argument threaded through every drawing.
 */
import { INVERTED, LIGHT, type Palette } from "./palette";
import { pixelText, pixelWidth, sevenSegment } from "./pixel-font";

export type Painter = {
  ctx: CanvasRenderingContext2D;
  /** The wall's unit: one seat's square, in CSS pixels. */
  cell: number;
  /** The palette in force. Read it at draw time; never cache it across a call. */
  P: Palette;
  /** Whether the module being drawn is on: 0 resting, 1 on, 2 working now. */
  lit: 0 | 1 | 2;
  /** One plate mark to a module: set to one when a module starts, spent by the first glass or lit mark drawn. */
  lamps: number;


  setInverted(on: boolean): void;
  /** Another scheme for the next drawing, its light and dark faces, or null for the painter's own: a holder's palette. */
  setScheme(scheme: { light: Palette; dark: Palette } | null): void;
  /** The colour lit glass and lamps take. */
  setLamp(colour: string): void;
  /** A face plate of another colour for the next drawing, or null for the scheme's own: the reader's modules are bright. */
  setFace(colour: string | null): void;
  /**
   * A module that is on draws its glass lit: every trace, digit and readout in green phosphor.
   * Working, the plate's own mark blinks. 0 is resting glass, 1 is on, 2 is working now.
   */
  setLit(level: 0 | 1 | 2): void;
  /** A hairline in ink at the given alpha: the dividers a real device would have. */
  hair(x1: number, y1: number, x2: number, y2: number, alpha?: number): void;
  pix(text: string, x: number, y: number, s: number, colour: string): void;
  pixW(text: string, s: number): number;
  seg7(digits: string, x: number, y: number, digitWidth: number, digitHeight: number, colour: string): void;
};

export function createPainter(ctx: CanvasRenderingContext2D, cell: number, light: Palette = LIGHT, dark: Palette = INVERTED): Painter {
  let inverted = false, lit: 0 | 1 | 2 = 0, lamp = light.lit, face: string | null = null, scheme: { light: Palette; dark: Palette } | null = null;
  const pick = () => {
    const base = { ...(inverted ? (scheme?.dark ?? dark) : (scheme?.light ?? light)), lit: lamp, hot: lamp, ...(face ? { face, glass: face } : {}) };
    // working uses the same colour as on; the difference is that its plate mark blinks
    return lit === 0 ? base : { ...base, glass: lamp };
  };
  const p: Painter = {
    ctx,
    cell,
    P: light,
    lit: 0,
    lamps: 1,
    setInverted(on) {
      inverted = on; p.P = pick();
    },
    setScheme(next) {
      scheme = next; p.P = pick();
    },
    setLit(l) {
      lit = l; p.lit = l; p.lamps = 1; p.P = pick();
    },
    setLamp(colour) {
      lamp = colour; p.P = pick();
    },
    setFace(colour) {
      face = colour; p.P = pick();
    },
    hair(x1, y1, x2, y2, alpha = 0.3) {
      ctx.strokeStyle = p.P.stroke;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
    pix: (text, x, y, s, colour) => pixelText(ctx, text, x, y, s, colour),
    pixW: pixelWidth,
    seg7: (digits, x, y, dw, dh, colour) => sevenSegment(ctx, digits, x, y, dw, dh, colour),
  };
  p.P = pick();
  return p;
}

/** A box on the wall, in CSS pixels. */
export type Box = { x: number; y: number; w: number; h: number };

/** The full circle, for `arc`. */
export const TAU = Math.PI * 2;

/**
 * The machine's clock: everything that moves repeats exactly every LOOP_MS, so any panel, drawn anywhere at any time,
 * is the same frame at the same point in the loop, and a loop of it can be recorded seamlessly.
 *
 * Twelve seconds divides into 1, 2, 3, 4, 5, 6, 8, 10, 12, 15… cycles, enough distinct speeds that neighbours never beat
 * together, and long enough that the repeat goes unnoticed on a busy wall. A drawing never divides the clock by a
 * constant of its own; it asks for a cycle about as long as it wants, and gets the nearest one that fits the loop.
 */
export const LOOP_MS = 12_000;

/** The nearest period to `ms` that a whole number of fit in the loop. */
const fit = (ms: number) => LOOP_MS / Math.max(1, Math.round(LOOP_MS / Math.max(1, ms)));

/** A smooth cycle about `ms` long, as an angle in radians: Math.sin(wave(t, 2500)) swings once every ~2.5 s. */
export const wave = (t: number, ms: number) => (TAU * t) / fit(ms);

/** Where in a cycle about `ms` long, from 0 to 1. */
export const phase = (t: number, ms: number) => { const p = fit(ms); return (((t % p) + p) % p) / p; };

/** A step every ~`ms` through `n` states, 0 to n - 1, the n steps together fitting the loop a whole number of times. */
export const beat = (t: number, ms: number, n: number) => Math.min(n - 1, Math.floor(phase(t, ms * n) * n));

/** A count that ticks every ~`ms` and starts over with the loop: for counters and readouts that only go up. */
export const tick = (t: number, ms: number) => { const n = Math.max(1, Math.round(LOOP_MS / Math.max(1, ms))); return beat(t, LOOP_MS / n, n); };
