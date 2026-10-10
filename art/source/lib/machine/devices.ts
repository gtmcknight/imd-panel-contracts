/**
 * A wallet's module is one device, not a pile of boxes.
 *
 * A template chosen by the module's shape lays instruments out on shared gutters and nothing
 * else: no lines between a mixer's channel strips, a console's screen and control block, or a
 * rack's units. The parts do the dividing; the module's frame is the only border. Each instrument inside gets its own seeded source so the device stays
 * the same across visits and the same across a resize.
 */
import { rng, type Rng } from "./rng";
import { drawInstrument, fits, fitsPicked, fitting, pickWeighted, registerPools } from "./instruments";
import { tileOf } from "./design";

/** A census hook: told of every console drawn, with its template and box. */
export const census: { device?: (kind: DeviceKind, w: number, h: number) => void } = {};
import { beat, type Painter } from "./painter";

/**
 * A holder's parts on their way into a device, and what the device made of them. A part goes into
 * the first open slot it fits, in the order picked; the slot's own pick is still drawn from the
 * seed and then set aside, so every other slot draws exactly what it would have. A slot is open
 * unless the template fixes it: a mixer's channel strips and a patch device's bay.
 */
export type Mount = {
  /** The parts still looking for a slot, in the order picked. */
  queue: number[];
  /** The parts mounted, in the order they found a slot. */
  placed: number[];
  /** Every open slot's box, in cells: where a part could go. */
  slots: Array<[number, number]>;
  /** The templates the device drew, panel by panel. */
  kinds: DeviceKind[];
};

export const DEVICE_KINDS = ["mixer", "console", "rack", "station", "synth", "patch", "grid"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

const RACK_UNITS = [3, 1, 0, 23, 13, 31, 22, 12, 5, 17, 10, 21, 16, 4, 9, 14, 18, 8, 29, 32, 34, 40, 42, 37, 39, 47, 50, 54, 56, 38, 33];
// the grid is where the rarer kinds get their seats: a grid has few cells, so the plentiful knobs and dials that every other
// template draws are left out, and each cell goes to a kind that would otherwise be seen once or never
const GRID_POOL = [45, 37, 49, 32, 23, 50, 38, 56, 40, 48, 47, 42, 31, 29, 21, 2, 16, 54, 33, 34, 39, 22, 14, 9, 18, 10, 4, 52, 51, 53, 43, 44, 46, 36, 41, 19, 3, 8];

registerPools([
  RACK_UNITS, GRID_POOL,
  [2, 8, 9, 4, 32, 18, 40, 52], [7, 25, 28, 30, 36, 41, 20],
  [3, 8, 19, 31, 29, 9, 4, 10, 45, 48, 51, 42, 18, 47, 16, 49], [0, 7, 25, 28, 36, 43, 41, 27, 20], [1, 12, 20, 27, 53, 17], [5, 14, 13, 22, 23, 33, 34, 54, 56, 38, 12, 39, 21, 37],
  [8, 3, 19, 29, 31, 16, 17, 4, 10, 49, 47], [0, 7, 28, 25, 16, 27, 20, 36, 41], [5, 13, 14, 53, 39, 12, 34],
  [0, 5, 13, 22, 12, 34, 39],
  [0, 7, 28, 25, 4, 36, 41, 20], [18, 9, 3, 29, 21, 8, 32, 40, 54, 42], [1, 10, 33, 50, 56, 14, 22],
]);

export function drawDevice(
  p: Painter,
  g: Rng,
  x: number,
  y: number,
  w: number,
  h: number,
  live: boolean,
  tt: number,
  k: number,
  seed: number,
  force?: DeviceKind,
  depth = 0,
  // what this device, and the bay it is part of, has already drawn: no panel repeats another's part, and no
  // two panels of a bay take the same template. The mixer's channel strips are the one exception, by design
  used: Set<number> = new Set(),
  seen: Set<DeviceKind> = new Set(),
  // the kind a holder's design asks for: every panel of a bay takes it, where that panel has room for it, so a pick changes the whole rig
  prefer?: DeviceKind,
  // a holder's parts, shared by every panel of the bay
  mount?: Mount,
): void {
  const { ctx, cell } = p;
  const C = p.P;
  const G = Math.max(3, cell * 0.18), ix = x + G, iy = y + G, iw = w - G * 2, ih = h - G * 2, ar = w / h, U = cell / 20;
  const pickFrom = <T,>(arr: readonly T[]) => arr[Math.floor(g() * arr.length)] as T;

  // a big module is a bay of devices, not one template stretched across it: it splits, off centre, into
  // two panels that each take the template their own shape calls for, and a panel still big enough
  // splits once more, so the largest holder's module reads as a rig of consoles, not two parts.
  // No line between them: the panels share one plate, a gutter apart, and their parts do the dividing
  if (!force && depth < 2 && (iw * ih) / (cell * cell) >= 20) {
    const vertical = ar >= 1.3 || (ar > 0.75 && g() < 0.5);
    const along = vertical ? w : h, a = Math.round(along * (0.38 + g() * 0.24)), b = along - a;
    if (Math.min(a, b) - G * 2 >= cell * 2.5) {
      const sa = seed * 7 + 11, sb = seed * 7 + 29;
      // each panel insets by the gutter itself; the second starts a gutter early so one gutter, not two, lies between them
      if (vertical) {
        drawDevice(p, rng(sa), x, y, a, h, live, tt, k, sa, undefined, depth + 1, used, seen, prefer, mount);
        drawDevice(p, rng(sb), x + a - G, y, b + G, h, live, tt + 700, k, sb, undefined, depth + 1, used, seen, prefer, mount);
      } else {
        drawDevice(p, rng(sa), x, y, w, a, live, tt, k, sa, undefined, depth + 1, used, seen, prefer, mount);
        drawDevice(p, rng(sb), x, y + a - G, w, b + G, live, tt + 700, k, sb, undefined, depth + 1, used, seen, prefer, mount);
      }
      return;
    }
  }
  // a slot takes a kind that looks right at its size: the template's pool is narrowed to those that
  // fit before the draw, so a patch bay never lands in a corner and a transport only in a strip
  const ins = (pool: readonly number[], i: number, px: number, py: number, pw: number, ph: number, open = true) => {
    const fit = fitting(pool, pw, ph, cell), fresh = fit.filter((T) => !used.has(T));
    let T = pickWeighted(g, fresh.length ? fresh : fit);
    // a device that is lit has glass to light, one screen: its first instrument, if the template gave it none and no panel before it has
    used.add(T);
    if (mount && open) {
      mount.slots.push([pw / cell, ph / cell]);
      // a tile part is a single cell's picture: no device slot takes one
      const j = mount.queue.findIndex((P) => tileOf(P) < 0 && fitsPicked(P, pw, ph, cell));
      if (j >= 0) { T = mount.queue.splice(j, 1)[0]!; mount.placed.push(T); }
    }
    drawInstrument(p, T, rng(seed * 31 + i * 7 + 1), px, py, pw, ph, live, tt + i * 500, k);
  };
  // a module a seat tall or a seat wide is one part across, not a template: no template has slots that small, and an
  // empty plate is what a template draws into a box it cannot divide
  if (!force && (ih < cell * 1.2 || iw < cell * 1.2)) { ins(RACK_UNITS, 1, ix, iy, iw, ih); return; }
  // a patch bay is the whole of a patch device: a module without the room for one is never a patch device
  const patchRowH = Math.min(ih * 0.28, cell * 1.2), patchOk = fits(17, iw, ih - patchRowH - G, cell);
  const templates = (list: readonly DeviceKind[]) => {
    const room = patchOk ? list : list.filter((d) => d !== "patch"), fresh = room.filter((d) => !seen.has(d));
    return fresh.length ? fresh : room;
  };
  const kind: DeviceKind =
    force ??
    (prefer && (prefer !== "patch" || patchOk) ? prefer
    : ar >= 2.2 ? pickFrom(templates(["mixer", "console", "patch", "grid"]))
    : ar <= 0.6 ? pickFrom(templates(["rack", "rack", "grid"]))
    : pickFrom(templates(["console", "station", "synth", "patch", "grid"])));
  seen.add(kind);
  mount?.kinds.push(kind);
  // the screen to come takes the module's one lamp, so no plate mark before it may
  census.device?.(kind, w, h);

  if (kind === "mixer") {
    // the channel strips run edge to edge, by design; the master section stands a gutter off them, like every other split
    const masterW = Math.min(iw * 0.3, cell * 2.6), n = Math.max(3, Math.min(14, Math.round((iw - masterW - G) / (cell * 0.9)))), chW = (iw - masterW - G) / n;
    for (let i = 0; i < n; i++) {
      const cx = ix + chW * i;
      ins([0], i, cx, iy, chW, ih * 0.24, false); ins([12], i + 20, cx, iy + ih * 0.24, chW, ih * 0.26, false); ins([1], i + 40, cx, iy + ih * 0.5, chW, ih * 0.5, false);
    }
    const mx = ix + iw - masterW;
    ins([2, 8, 9, 4, 32, 18, 40, 52], 60, mx, iy, masterW, ih * 0.5);
    ins([7, 25, 28, 30, 36, 41, 20], 61, mx, iy + ih * 0.5, masterW, ih * 0.5);
  } else if (kind === "console") {
    const headH = Math.min(ih * 0.14, U * 6), bodyH = ih - headH, footH = Math.min(bodyH * 0.24, cell * 1.1), scrW = iw * 0.56;
    ctx.fillStyle = C.stroke; ctx.fillRect(ix + U, iy + headH * 0.35, iw * (0.18 + g() * 0.2), Math.max(1, headH * 0.22));
    // four status lamps, the right one on the head's right edge, a clear lamp's width between each
    const lr = Math.max(1, U * 0.9), lstep = lr * 4;
    ctx.strokeStyle = C.stroke; ctx.lineWidth = Math.max(1, U * 0.5);
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.arc(ix + iw - lr - U - i * lstep, iy + headH * 0.45, lr, 0, Math.PI * 2);
      if (i === (live ? beat(tt, 400, 4) : 1)) ctx.fill(); else ctx.stroke();
    }
    const by = iy + headH + G * 0.5, bh = bodyH - footH - G;
    // a row splits in two only where each part gets real room; a narrow console gives the screen the whole row
    const split = iw - scrW - G >= cell * 1.4;
    ins([3, 8, 19, 31, 29, 9, 4, 10, 45, 48, 51, 42, 18, 47, 16, 49], 1, ix, by, split ? scrW : iw, bh);
    if (split) {
      const rx = ix + scrW + G, rw = iw - scrW - G;
      ins([0, 7, 25, 28, 36, 43, 41, 27, 20], 2, rx, by, rw, bh * 0.45);
      ins([1, 12, 20, 27, 53, 17], 3, rx, by + bh * 0.45, rw, bh * 0.55);
    }
    ins([5, 14, 13, 22, 23, 33, 34, 54, 56, 38, 12, 39, 21, 37], 4, ix, by + bh + G, iw, footH);
  } else if (kind === "rack") {
    // units a hair apart, as racked gear sits, the first at the top gutter and the last at the bottom one
    const n = Math.max(3, Math.min(7, Math.round(ih / (cell * 1.3)))), gap = Math.max(1, Math.round(U * 1.5)), sh = (ih - gap * (n - 1)) / n;
    // the units that read at a rack's width and a unit's height; each drawn once, so no unit repeats down the rack
    const units = fitting(RACK_UNITS, iw, sh, cell);
    for (let i = 0; i < n; i++) {
      ins(units, i, ix, iy + (sh + gap) * i, iw, sh);
    }
  } else if (kind === "station") {
    const scrH = ih * 0.62;
    ins([8, 3, 19, 29, 31, 16, 17, 4, 10, 49, 47], 1, ix, iy, iw, scrH);
    const split = iw * 0.4 >= cell * 1.4, lw = (iw - G) * 0.6;
    ins([0, 7, 28, 25, 16, 27, 20, 36, 41], 2, ix, iy + scrH + G, split ? lw : iw, ih - scrH - G);
    if (split) ins([5, 13, 14, 53, 39, 12, 34], 3, ix + lw + G, iy + scrH + G, iw - lw - G, ih - scrH - G);
  } else if (kind === "patch") {
    const rowH = patchRowH;
    ins([17], 1, ix, iy, iw, ih - rowH - G, false);
    ins([0, 5, 13, 22, 12, 34, 39], 2, ix, iy + ih - rowH, iw, rowH);
  } else if (kind === "grid") {
    // cells a gutter apart, the outer ones on the plate's own gutter
    const nx = Math.max(1, Math.min(4, Math.round(iw / (cell * 2.2)))), ny = Math.max(1, Math.min(4, Math.round(ih / (cell * 2.2))));
    const cw = (iw - G * (nx - 1)) / nx, ch = (ih - G * (ny - 1)) / ny;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      ins(GRID_POOL, j * nx + i + 1, ix + (cw + G) * i, iy + (ch + G) * j, cw, ch);
    }
  } else {
    // the synth's bottom band: a row of faders, pads, a tape or a flap board where the keys once were
    const keysH = Math.max(cell * 0.8, ih * 0.32), topH = ih - keysH - G;
    const split = iw * 0.36 >= cell * 1.4;
    const lw = (iw - G) * 0.63;
    ins([0, 7, 28, 25, 4, 36, 41, 20], 1, ix, iy, split ? lw : iw, topH);
    if (split) ins([18, 9, 3, 29, 21, 8, 32, 40, 54, 42], 2, ix + lw + G, iy, iw - lw - G, topH);
    ins([1, 10, 33, 50, 56, 14, 22], 3, ix, iy + topH + G, iw, keysH);
  }
}
