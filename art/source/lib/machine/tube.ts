/**
 * The back of the wall's monitor, for the wall turned over: its tube seen from behind, as an opened case shows it. The
 * glass bell narrowing to its neck, the copper yoke round the neck, the socket board on the neck's end with the heater's
 * glow leaking past it, the anode cap's red lead down to the flyback, all mounted on a chassis board in the wall's
 * colours. Like a panel's board it paints pixels into the 32-bit view of an ImageData, one pixel a CSS pixel.
 */
import { FONT, makeBoard } from "./board";

type RGB = [number, number, number];
/** The board colours it takes from the theme, as themeBoard gives them. */
type Palette = { bg: string; bg2: string; pad: string; silk: string };

const rgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const pack = (c: RGB) => ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
const ramp = (...hs: string[]) => Uint32Array.from(hs, (h) => pack(rgb(h)));
const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round) as RGB;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const TAU = Math.PI * 2;

/** A 4×4 ordered dither: a shade between two steps of a ramp is a pattern of both, the way pixel art shades. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const shade = (r: Uint32Array, v: number, x: number, y: number) => r[Math.min(r.length - 1, Math.floor(clamp01(v) * (r.length - 1) + BAYER[(y & 3) * 4 + (x & 3)]!))]!;

// what the tube is made of: the bell's graphite coat, the band's steel, the yoke's copper and its collar, the rings'
// plastic, the anode's red rubber, the degauss coil's tape, the flyback's black, the neck's glass and the heater's glow
const GLASS = ramp("#050607", "#0b0d10", "#12161a", "#1a2025", "#242b31", "#30393f", "#3f4a52", "#556269", "#73818a", "#a3b0b8");
const STEEL = ramp("#26292c", "#3f4448", "#5c6266", "#80878c", "#a7aeb3", "#cfd5d9");
const COPPER = ramp("#2b1307", "#50270f", "#7a3d18", "#a35724", "#c87637", "#e39955", "#f4c283");
const COLLAR = ramp("#09090a", "#131315", "#1d1d21", "#29292e", "#38383f");
const PLASTIC = ramp("#4f5356", "#777c7f", "#a2a7aa", "#cbcfd1", "#eceeef");
const RUBBER = ramp("#240606", "#460c0c", "#721515", "#a02020", "#c93630", "#ea6656");
const BLACK = ramp("#09090a", "#121214", "#1c1c20", "#28282e", "#37373f", "#4c4c56");
const NECK = ramp("#05070a", "#0a1015", "#111a21", "#1a2731");
const GLOW = ramp("#160f0c", "#311a0f", "#5c2711", "#913a16", "#c65a25", "#ec833a", "#ffb76a", "#ffdca6");
const NYLON = pack(rgb("#e6e0ca")), NYLON_D = pack(rgb("#9d9579")), HOLE_C = pack(rgb("#2a2722"));
const LABEL = pack(rgb("#e7e2d4")), INK = pack(rgb("#4d4a43")), YELLOW = pack(rgb("#f2c230")), KEY = pack(rgb("#141414"));
/** The neck board's leads, and the yoke's two pairs. */
const NECK_WIRES = ["#d23a30", "#1d1d1f", "#e8c547", "#e9e7df"].map((h) => pack(rgb(h)));
const YOKE_WIRES = ["#c0392b", "#2f6fd6", "#e8c547", "#2fbf6a"].map((h) => pack(rgb(h)));
/** The warning on the flyback: a triangle with its mark, K the outline, Y the yellow. */
const WARN = [".....K.....", "....KYK....", "....KYK....", "...KYKYK...", "...KYKYK...", "..KYYKYYK..", "..KYYYYYK..", ".KYYYKYYYK.", ".KYYYYYYYK.", "KKKKKKKKKKK"];

/** The light: from the top left, in front of the wall. */
const LIGHT = ((x: number, y: number, z: number) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l] as const; })(-0.5, -0.66, 0.56);
const HALF = ((x: number, y: number, z: number) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l] as const; })(LIGHT[0], LIGHT[1], LIGHT[2] + 1);

export type MonitorBack = {
  W: number;
  H: number;
  /** The whole picture at t ms on the loop clock; `flare` from 0 to 1 brightens the heater, as a new line landing does. */
  paint(t: number, out: Uint32Array, flare?: number): void;
  /** Only the heater's glow, for the paints between the board's frames, and the box it lives in. */
  glow(t: number, out: Uint32Array, flare?: number): void;
  glowBox: { x: number; y: number; w: number; h: number } | null;
};

export function makeMonitorBack(W: number, H: number, palette: Palette): MonitorBack {
  // the tube and the flyback beside it, as large as the board allows and centred together; the tube keeps its 4:3
  let ay = Math.floor(H * 0.42), ax = Math.round((ay * 4) / 3);
  let fw = Math.max(12, Math.round(ay * 0.42)), fh = Math.max(16, Math.round(ay * 0.7));
  const gap = Math.max(4, Math.round(ay * 0.16)), room = W - 12;
  if (2 * ax + gap + fw > room) {
    const s = Math.max(0.1, (room - gap) / (2 * ax + fw));
    ax = Math.floor(ax * s); ay = Math.floor(ay * s); fw = Math.max(10, Math.round(fw * s)); fh = Math.max(14, Math.round(fh * s));
  }
  // a monitor too small for a tube that reads is chassis board alone
  if (ay < 14) {
    const board = makeBoard("monitor", W, H, palette, 0.6);
    return { W, H, paint: (t, out) => board.paint(t, out), glow: () => {}, glowBox: null };
  }
  const left = Math.round((W - (2 * ax + gap + fw)) / 2), cx = left + ax, cy = Math.floor(H / 2);
  const fx = left + 2 * ax + gap, fy = cy + Math.round(ay * 0.9) - fh;
  const ry = Math.max(5, Math.round(ay * 0.34)), rn = Math.max(3, Math.round(ry * 0.5)), nb = Math.max(2, Math.round(rn * 0.6));
  // the two harness plugs on the chassis under the tube: the neck board's, and the yoke's to its left
  const plugY = Math.min(H - 7, cy + ay + 3), plugN = { x: cx - 5, y: plugY, w: 11, h: 4 }, plugK = { x: cx - Math.round(ay * 0.55) - 5, y: plugY, w: 11, h: 4 };
  const silk = left >= 46 ? { x: 9, y: H - 26, w: 58, h: 12 } : null;
  const clear = [
    { x: cx - ax - 1, y: cy - ay - 1, w: 2 * ax + 3, h: 2 * ay + 3 },
    { x: fx - 1, y: fy - 1, w: fw + 3, h: fh + 4 },
    plugN, plugK, ...(silk ? [silk] : []),
  ];
  const board = makeBoard("monitor", W, H, palette, 0.6, null, null, "", clear);

  const N = W * H, top = new Uint32Array(N), kind = new Uint8Array(N), weight = new Float32Array(N);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const put = (x: number, y: number, c: number) => { if (inside(x, y)) { const i = y * W + x; top[i] = c; kind[i] = 1; } };

  // the bell: each pixel's place between the face's rim (0) and the yoke (1), solved on the cross-sections between them,
  // a rounded rectangle at the face narrowing to the yoke's circle; its height over the face shades it
  const F = (dx: number, dy: number, t: number) => {
    const hx = ax + (ry - ax) * t, hy = ay + (ry - ay) * t, n = 5 - 3 * Math.sqrt(t);
    return (Math.abs(dx) / hx) ** n + (Math.abs(dy) / hy) ** n - 1;
  };
  const tf = new Float32Array(N).fill(-1), D = ay * 0.95;
  const x0 = Math.max(0, cx - ax - 1), x1 = Math.min(W - 1, cx + ax + 1), y0 = Math.max(0, cy - ay - 1), y1 = Math.min(H - 1, cy + ay + 1);
  // the bell is the same in each quarter: solved for one and mirrored, pixel x to 2cx - 1 - x
  const set = (x: number, y: number, t: number) => { if (inside(x, y)) tf[y * W + x] = t; };
  for (let y = cy; y <= cy + ay + 1; y++) for (let x = cx; x <= cx + ax + 1; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    if (F(dx, dy, 0) > 0) continue;
    let t = 2;
    if (dx * dx + dy * dy > ry * ry) {
      let lo = 0, hi = 1;
      for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (F(dx, dy, m) > 0) hi = m; else lo = m; }
      t = lo;
    }
    const mx = 2 * cx - 1 - x, my = 2 * cy - 1 - y;
    set(x, y, t); set(mx, y, t); set(x, my, t); set(mx, my, t);
  }
  const zOf = (i: number) => { const t = tf[i]!; return t > 1 ? D : D * (0.6 * (1 - (1 - t) ** 3) + 0.4 * t); };
  const span = ay - ry, band = 2.4 / span;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x, t = tf[i]!;
    if (t < 0 || t > 1) continue;
    const zc = zOf(i), at = (j: number, ok: boolean) => (ok && tf[j]! >= 0 ? zOf(j) : zc);
    const nx = -(at(i + 1, x < W - 1) - at(i - 1, x > 0)) / 2, ny = -(at(i + W, y < H - 1) - at(i - W, y > 0)) / 2, l = Math.hypot(nx, ny, 1);
    const dif = Math.max(0, (nx * LIGHT[0] + ny * LIGHT[1] + LIGHT[2]) / l), spec = Math.max(0, (nx * HALF[0] + ny * HALF[1] + HALF[2]) / l) ** 12;
    // graphite is near matte: the form is in the diffuse light, with a soft sheen toward the light
    const v = 0.02 + 0.78 * dif * dif + 0.35 * spec;
    // the steel band round the face, darker at its very edge
    put(x, y, t < band ? shade(STEEL, 0.15 + v * 0.95 - (t < 0.9 / span ? 0.3 : 0), x, y) : shade(GLASS, v, x, y));
  }
  // the band's four ears at the corners, each with its screw
  const ear = Math.max(3, Math.round(ay * 0.1)), k5 = 2 ** (-1 / 5);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const ex = Math.round(cx + sx * (ax * k5 + ay * 0.05)), ey = Math.round(cy + sy * (ay * k5 + ay * 0.05));
    for (let v = 0; v < ear; v++) for (let u = 0; u < ear; u++) {
      const x = ex - (ear >> 1) + u, y = ey - (ear >> 1) + v, edge = u === 0 || v === 0 ? 0.25 : u === ear - 1 || v === ear - 1 ? -0.25 : 0;
      put(x, y, shade(STEEL, 0.55 + edge, x, y));
    }
    // the screw: a dark slot in a lit head
    put(ex, ey, STEEL[0]!); put(ex - 1, ey, STEEL[0]!); put(ex, ey - 1, STEEL[5]!);
  }

  // the yoke: its black collar, the copper of its windings (the saddle's two halves meeting top and bottom), and the
  // purity rings on the neck before it; each a ring lit as a torus is
  const torus = (r: number, ph: number, r0: number, r1: number) => {
    const u = clamp01((r - r0) / Math.max(1, r1 - r0)), nr = 2 * u - 1, nz = Math.sqrt(Math.max(0, 1 - nr * nr));
    return Math.max(0, nr * Math.cos(ph) * LIGHT[0] + nr * Math.sin(ph) * LIGHT[1] + nz * LIGHT[2]);
  };
  const turns = Math.round(ry * 2.4), pr = rn * 1.16, tabR = pr + Math.max(2, ry * 0.14);
  for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - ry; x <= cx + ry; x++) {
    if (!inside(x, y)) continue;
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy), ph = Math.atan2(dy, dx);
    if (r > ry) continue;
    const tab = r < tabR && [-0.45, 2.7].some((a) => Math.abs(Math.atan2(Math.sin(ph - a), Math.cos(ph - a))) < 0.16);
    if (r >= ry * 0.8) put(x, y, shade(COLLAR, 0.1 + 0.85 * torus(r, ph, ry * 0.8, ry), x, y));
    else if (r >= pr && !tab) {
      const seam = Math.abs(Math.abs(ph) - Math.PI / 2) < 0.07, turn = Math.floor(((ph + Math.PI) / TAU) * turns) & 1;
      put(x, y, seam ? COLLAR[0]! : shade(COPPER, 0.12 + 0.82 * torus(r, ph, pr, ry * 0.8) - (turn ? 0.1 : 0), x, y));
    } else if (r >= rn) put(x, y, shade(PLASTIC, 0.1 + 0.85 * torus(r, ph, rn, tab ? tabR : pr), x, y));
    else {
      // the neck's glass, the heater glowing through it brightest by the socket
      const i = y * W + x;
      top[i] = shade(NECK, 0.3 + 0.5 * (r / rn), x, y); kind[i] = 2;
      weight[i] = clamp01(1 - (r - nb) / Math.max(1, rn - nb));
    }
  }

  // the anode's lead first, so its cap and the flyback cover its ends: thick red rubber from the cap, out over the bell,
  // down into the flyback's top
  const capA = -0.72, capT = 0.4, cn = 5 - 3 * capT, chx = ax + (ry - ax) * capT, chy = ay + (ry - ay) * capT;
  const capX = cx + chx * Math.sign(Math.cos(capA)) * Math.abs(Math.cos(capA)) ** (2 / cn), capY = cy + chy * Math.sign(Math.sin(capA)) * Math.abs(Math.sin(capA)) ** (2 / cn);
  const rc = Math.max(2, Math.round(ay * 0.08)), th = Math.max(1.2, ay * 0.028);
  const leadTo = [fx + fw / 2, fy + 1] as const;
  const bez = (p: number, a: number, b: number, c: number, d: number) => (1 - p) ** 3 * a + 3 * (1 - p) ** 2 * p * b + 3 * (1 - p) * p * p * c + p ** 3 * d;
  const c1 = [capX + (leadTo[0] - capX) * 0.55, capY - ay * 0.22], c2 = [leadTo[0], leadTo[1] - ay * 0.3];
  const len = Math.hypot(leadTo[0] - capX, leadTo[1] - capY) * 1.6;
  for (let s = 0; s <= len * 2; s++) {
    const p = s / (len * 2), bx = bez(p, capX, c1[0]!, c2[0]!, leadTo[0]), by = bez(p, capY, c1[1]!, c2[1]!, leadTo[1]);
    for (let y = Math.floor(by - th - 1); y <= by + th + 1; y++) for (let x = Math.floor(bx - th - 1); x <= bx + th + 1; x++) {
      const d = Math.hypot(x + 0.5 - bx, y + 0.5 - by);
      if (d <= th) put(x, y, shade(RUBBER, 0.25 + 0.6 * (1 - d / th) + (x + 0.5 < bx && y + 0.5 < by ? 0.12 : 0), x, y));
    }
  }
  // the cap: a red rubber dome on the glass
  for (let y = Math.floor(capY - rc); y <= capY + rc; y++) for (let x = Math.floor(capX - rc); x <= capX + rc; x++) {
    const dx = x + 0.5 - capX, dy = y + 0.5 - capY, r = Math.hypot(dx, dy);
    if (r > rc) continue;
    const u = r / rc, nz = Math.sqrt(Math.max(0, 1 - u * u)), ph = Math.atan2(dy, dx);
    put(x, y, shade(RUBBER, (r > rc - 1 ? -0.1 : 0.12) + 0.9 * Math.max(0, u * Math.cos(ph) * LIGHT[0] + u * Math.sin(ph) * LIGHT[1] + nz * LIGHT[2]), x, y));
  }

  // the socket board on the neck's end, in the chassis's colours, its corners clipped: the socket with its ring of pins,
  // and where there is room a resistor and a capacitor
  const pcb = rgb(palette.bg), gold = pack(rgb(palette.pad)), lit = pack(mixc(pcb, [255, 255, 255], 0.16)), dim = pack(mixc(pcb, [0, 0, 0], 0.35)), base = pack(pcb);
  for (let y = cy - nb; y <= cy + nb; y++) for (let x = cx - nb; x <= cx + nb; x++) {
    const ux = x - cx, uy = y - cy;
    if (Math.abs(ux) === nb && Math.abs(uy) === nb) continue;
    put(x, y, ux === -nb || uy === -nb ? lit : ux === nb || uy === nb ? dim : base);
  }
  const rs = Math.max(1.5, nb * 0.62);
  for (let y = Math.floor(cy - rs); y <= cy + rs; y++) for (let x = Math.floor(cx - rs); x <= cx + rs; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy);
    if (r <= rs) put(x, y, shade(BLACK, 0.2 + 0.7 * torus(r, Math.atan2(dy, dx), 0, rs), x, y));
  }
  if (rs >= 3) for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU - Math.PI / 2; put(Math.round(cx - 0.5 + Math.cos(a) * rs * 0.62), Math.round(cy - 0.5 + Math.sin(a) * rs * 0.62), gold); }
  if (nb >= 6) {
    const tan = pack(rgb("#cdb98e")), bandC = pack(rgb("#7a3d18")), cap = pack(rgb("#2f6fd6"));
    for (let k = 0; k < 3; k++) put(cx - nb + 2 + k, cy - nb + 2, k === 1 ? bandC : tan);
    for (let k = 0; k < 3; k++) put(cx + nb - 2, cy + nb - 4 + k, k === 1 ? bandC : tan);
    put(cx + nb - 3, cy - nb + 2, cap); put(cx + nb - 2, cy - nb + 2, cap);
  }

  // the flyback: a black block, lit from the left, ribbed below, its two knobs on top and its warning label
  const fr = 2;
  for (let y = fy; y < fy + fh; y++) for (let x = fx; x < fx + fw; x++) {
    const u = x - fx, v = y - fy, cu = Math.min(u, fw - 1 - u), cv = Math.min(v, fh - 1 - v);
    if (cu < fr && cv < fr && cu + cv < fr) continue;
    const across = u / Math.max(1, fw - 1), down = v / Math.max(1, fh - 1);
    let s = down < 0.16 ? 0.62 - 0.3 * across : 0.42 - 0.3 * across;
    if (down > 0.42 && v % 3 === 0) s -= 0.18;
    if (u === 0) s += 0.12; else if (u === fw - 1 || v === fh - 1) s -= 0.15;
    put(x, y, shade(BLACK, s, x, y));
  }
  const kr = Math.max(1.5, fw * 0.13);
  for (const [kx, ky, diag] of [[fx + fw * 0.3, fy + fh * 0.3, false], [fx + fw * 0.7, fy + fh * 0.3, true]] as const) {
    for (let y = Math.floor(ky - kr); y <= ky + kr; y++) for (let x = Math.floor(kx - kr); x <= kx + kr; x++) {
      const dx = x + 0.5 - kx, dy = y + 0.5 - ky, r = Math.hypot(dx, dy);
      if (r > kr) continue;
      const slot = kr >= 2.5 && (diag ? Math.abs(dx + dy) < 0.8 : Math.abs(dy) < 0.6) && r < kr - 0.8;
      put(x, y, slot ? BLACK[0]! : shade(PLASTIC, 0.15 + 0.85 * torus(r, Math.atan2(dy, dx), 0, kr), x, y));
    }
  }
  const lx = fx + Math.max(2, Math.round(fw * 0.12)), lw = fw - 2 * (lx - fx), lh = Math.max(5, Math.min(13, Math.round(fh * 0.2))), ly = fy + Math.round(fh * 0.5);
  for (let y = ly; y < ly + lh; y++) for (let x = lx; x < lx + lw; x++) put(x, y, LABEL);
  const warn = lw >= 13 && lh >= 12;
  if (warn) WARN.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== ".") put(lx + 1 + i, ly + 1 + j, ch === "K" ? KEY : YELLOW); }));
  for (let r = 0; r < 3; r++) {
    const ty = ly + 2 + r * 2;
    if (ty >= ly + lh - 1) break;
    for (let x = lx + (warn ? 14 : 2); x < lx + lw - 2; x++) if ((x + r * 3) % 5 !== 4) put(x, ty, INK);
  }
  for (const px of [fx + 3, fx + fw - 4]) { put(px, fy + fh, gold); put(px, fy + fh + 1, gold); }

  // the harnesses: four leads from the socket board down over the glass to their plug, and the yoke's two pairs to theirs
  const plug = (p: { x: number; y: number; w: number; h: number }, xs: number[]) => {
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) put(x, y, x === p.x || y === p.y + p.h - 1 || x === p.x + p.w - 1 ? NYLON_D : NYLON);
    for (const x of xs) put(x, p.y + 1, HOLE_C);
  };
  const neckXs = [0, 1, 2, 3].map((k) => cx - 3 + 2 * k);
  neckXs.forEach((x0, k) => {
    for (let y = cy + nb + 1; y < plugN.y; y++) { const p = (y - cy - nb) / Math.max(1, plugN.y - cy - nb); put(Math.round(x0 + Math.sin(p * Math.PI) * ay * 0.05), y, NECK_WIRES[k]!); }
  });
  plug(plugN, neckXs);
  const yokeXs = [0, 1, 2, 3].map((k) => plugK.x + 2 + 2 * k);
  yokeXs.forEach((xe, k) => {
    const a = 2.15 + 0.1 * k, sx = cx + Math.cos(a) * ry * 0.9, sy = cy + Math.sin(a) * ry * 0.9, mx = sx - ay * 0.12, my = (sy + plugK.y) / 2;
    const steps = Math.ceil(Math.hypot(xe - sx, plugK.y - sy) * 2);
    for (let s = 0; s <= steps; s++) {
      const p = s / steps, bx = (1 - p) ** 2 * sx + 2 * (1 - p) * p * mx + p * p * xe, by = (1 - p) ** 2 * sy + 2 * (1 - p) * p * my + p * p * plugK.y;
      put(Math.round(bx), Math.round(by), YOKE_WIRES[k]!);
    }
  });
  plug(plugK, yokeXs);

  // the chassis's own silkscreen, where the board has the room
  if (silk) {
    const ink = pack(rgb(palette.silk));
    ["IMD SWARM", "CRT 2000 REV 2"].forEach((line, j) => [...line].forEach((ch, k) => {
      const gl = (FONT as Record<string, string>)[ch];
      if (gl) for (let q = 0; q < 15; q++) if (gl[q] === "1") put(silk.x + k * 4 + (q % 3), silk.y + j * 7 + Math.floor(q / 3), ink);
    }));
  }

  // everything mounted over the board casts a shadow on it, away from the light
  const ox = Math.max(2, Math.round(ay * 0.035)), oy = Math.max(2, Math.round(ay * 0.05)), shadow: number[] = [];
  for (let y = oy; y < H; y++) for (let x = ox; x < W; x++) { const i = y * W + x; if (!kind[i] && kind[i - oy * W - ox]) shadow.push(i); }

  const sIdx: number[] = [], sCol: number[] = [], gIdx: number[] = [], gW: number[] = [], gB: number[] = [];
  let gx0 = W, gy0 = H, gx1 = -1, gy1 = -1;
  for (let i = 0; i < N; i++) {
    if (kind[i] === 1) { sIdx.push(i); sCol.push(top[i]!); }
    else if (kind[i] === 2) {
      const x = i % W, y = (i / W) | 0;
      gIdx.push(i); gW.push(weight[i]!); gB.push(BAYER[(y & 3) * 4 + (x & 3)]!);
      gx0 = Math.min(gx0, x); gy0 = Math.min(gy0, y); gx1 = Math.max(gx1, x); gy1 = Math.max(gy1, y);
    }
  }
  const S = Int32Array.from(sIdx), SC = Uint32Array.from(sCol), G = Int32Array.from(gIdx), GW = Float32Array.from(gW), GB = Float32Array.from(gB), SH = Int32Array.from(shadow);
  const glow = (t: number, out: Uint32Array, flare = 0) => {
    // the heater breathes and flickers on the loop clock, and flares as a new line lands
    const I = Math.min(1.25, 0.82 + 0.08 * Math.sin((t / 2000) * TAU) + 0.04 * Math.sin((t / 300) * TAU) + 0.4 * flare), n = GLOW.length - 1;
    for (let k = 0; k < G.length; k++) out[G[k]!] = GLOW[Math.min(n, Math.floor(clamp01(I * GW[k]! ** 0.8) * n + GB[k]!))]!;
  };
  return {
    W, H,
    paint(t, out, flare = 0) {
      board.paint(t, out);
      for (let k = 0; k < SH.length; k++) { const i = SH[k]!; out[i] = ((out[i]! >>> 1) & 0x7f7f7f) | 0xff000000; }
      for (let k = 0; k < S.length; k++) out[S[k]!] = SC[k]!;
      glow(t, out, flare);
    },
    glow,
    glowBox: gx1 < 0 ? null : { x: gx0, y: gy0, w: gx1 - gx0 + 1, h: gy1 - gy0 + 1 },
  };
}
