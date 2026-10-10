/**
 * Twelve tiles for a single cell.
 *
 * Half the one-seat modules draw one of these instead of a shrunken instrument: shapes designed
 * for a square the size of a thumbnail, some of them full-bleed with no plate at all, so the wall
 * has rhythm at the small end and not just smaller versions of the big things.
 */
import type { Rng } from "./rng";
import { beat, LOOP_MS, TAU, wave, type Painter } from "./painter";

export const TILE_COUNT = 16;

/** Tiles that run to the edge and take no plate outline. */
export const TILE_BLEED = new Set([0, 1, 9]);

export const TILE_NAMES = [
  "full-bleed dial", "clock", "trace cell", "quad squares", "nine dots", "disc", "ring", "diamond", "cross",
  "half cell", "toggle", "lamp", "square lamp", "filled square", "hollow square", "square clock",
] as const;

export function drawTile(p: Painter, T: number, g: Rng, x: number, y: number, w: number, h: number, live: boolean, tt: number): void {
  const { ctx } = p;
  const C = p.P;
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (!(w >= 2 && h >= 2)) return;
  const cx = x + w / 2, cy = y + h / 2, m = Math.min(w, h);
  const SW = Math.max(1, Math.min(2, Math.round((m / 22) * 2) / 2)), U = m / 20;
  ctx.lineWidth = SW; ctx.strokeStyle = C.stroke; ctx.fillStyle = C.stroke; ctx.lineCap = "round";
  // the drawing's scale on the device (2 on a retina screen, more in the instrument page's close-up): squares are sized in
  // whole device pixels, with the same parity as the cell's, so they sit dead centre with equal margins at any scale
  const tf = ctx.getTransform(), DS = Math.hypot(tf.a, tf.b) || 1;
  const dev = (v: number) => Math.round(v * DS);
  const W = dev(w), H = dev(h);
  /** A box of about `s` across, centred in the cell on whole device pixels: [x, y, size]. */
  const square = (s: number): [number, number, number] => { let a = Math.max(1, dev(s)); if ((W - a) % 2) a -= 1; return [x + (W - a) / 2 / DS, y + (H - a) / 2 / DS, a / DS]; };
  /** An outline wholly inside a box, its width a whole number of device pixels. */
  const ring = (bx: number, by: number, bw: number, bh: number, lw = ctx.lineWidth) => {
    const l = Math.max(1, dev(lw)) / DS; ctx.lineWidth = l; ctx.strokeRect(bx + l / 2, by + l / 2, bw - l, bh - l); ctx.lineWidth = lw;
  };

  if (T === 0) { // full-bleed dial
    ctx.beginPath(); ctx.arc(cx, cy, m * 0.46, 0, TAU); ctx.stroke();
    const a = g() * 6.28 + (live ? Math.sin(wave(tt, 3200)) * 0.8 : 0);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * m * 0.34, cy + Math.sin(a) * m * 0.34); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, U * 1.2, 0, TAU); ctx.fill();
  } else if (T === 1) { // clock, no plate; four ticks where twelve would blur
    const step = m < 16 ? 3 : 1;
    for (let i = 0; i < 12; i += step) {
      const a = (i * Math.PI) / 6, r1 = m * (i % 3 ? 0.4 : 0.34), r2 = m * 0.46;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
    }
    const hr = g() * 6.28 + (live ? wave(tt, LOOP_MS) : 0), mn = g() * 6.28 + (live ? wave(tt, 3000) : 0);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(hr) * m * 0.2, cy + Math.sin(hr) * m * 0.2);
    ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(mn) * m * 0.32, cy + Math.sin(mn) * m * 0.32); ctx.stroke();
  } else if (T === 2) { // a trace on glass: a plate, the glass inset the same all round, the bevel the scopes have
    const gm = Math.max(2, Math.round(U * 2.5)), gx = x + gm, gy = y + gm, gw = w - gm * 2, gh = h - gm * 2;
    ctx.fillStyle = C.screen; ctx.fillRect(gx, gy, gw, gh);
    if (gw > 8 && gh > 8) { ctx.strokeStyle = C.glass; ctx.globalAlpha = 0.22; ctx.lineWidth = 1; ctx.strokeRect(gx + 1.5, gy + 1.5, gw - 3, gh - 3); ctx.globalAlpha = 1; ctx.lineWidth = SW; }
    ctx.save(); ctx.beginPath(); ctx.rect(gx + 1, gy + 1, gw - 2, gh - 2); ctx.clip();
    ctx.strokeStyle = C.glass; ctx.beginPath();
    // the trace starts and ends a little in from the glass edge, so its stroke never sits on the bevel
    const n = 8, inset = Math.max(2, gw * 0.14), gcy = gy + gh / 2;
    for (let i = 0; i <= n; i++) {
      const px = gx + inset + ((gw - inset * 2) * i) / n, py = gcy + (live ? Math.sin(i * 1.1 + wave(tt, 1600)) : g() - 0.5) * gh * 0.22;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.stroke(); ctx.restore();
  } else if (T === 3) { // quad squares
    const on = live ? beat(tt, 400, 4) : Math.floor(g() * 4);
    // the four squares and the gap between them as one block, centred on whole device pixels
    const s2 = Math.max(1, dev(m * 0.36)), [bx, by, bs] = square((s2 * 2 + dev(m * 0.08)) / DS), gap = bs - (s2 * 2) / DS;
    for (let i = 0; i < 4; i++) {
      const px = bx + (i % 2) * (s2 / DS + gap), py = by + Math.floor(i / 2) * (s2 / DS + gap);
      if (i === on || g() < 0.25) ctx.fillRect(px, py, s2 / DS, s2 / DS); else ring(px, py, s2 / DS, s2 / DS);
    }
  } else if (T === 4) { // nine dots
    const st = m * 0.28, r = Math.max(1, U * 1.6);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.arc(cx + i * st, cy + j * st, r, 0, TAU);
      if ((i + j + 3 + (live ? beat(tt, 350, 3) : 0)) % 3 === 0) ctx.fill(); else ctx.stroke();
    }
  } else if (T === 5) { // one big disc
    ctx.beginPath(); ctx.arc(cx, cy, m * 0.36, 0, TAU); ctx.fill();
    ctx.strokeStyle = C.face; ctx.beginPath(); ctx.arc(cx, cy, m * 0.16, 0, TAU); ctx.stroke();
  } else if (T === 6) { // ring
    ctx.lineWidth = Math.max(2, m * 0.12); ctx.beginPath(); ctx.arc(cx, cy, m * 0.3, 0, TAU); ctx.stroke(); ctx.lineWidth = SW;
  } else if (T === 7) { // the diamond
    const r = m * 0.3;
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); ctx.stroke();
  } else if (T === 8) { // cross
    const r = m * 0.3;
    ctx.lineWidth = Math.max(2, m * 0.16); ctx.lineCap = "butt";
    ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke(); ctx.lineWidth = SW;
  } else if (T === 9) { // half-filled cell, full bleed
    const up = live ? beat(tt, 900, 2) === 0 : g() < 0.5;
    ctx.fillRect(x + 1, up ? y + 1 : cy, w - 2, h / 2 - 1);
  } else if (T === 10) { // one toggle
    const up = g() < 0.5 !== (live && beat(tt, 700, 2) === 0);
    // the slot and its lever in whole device pixels: the lever fills the half it is thrown to, inside the slot's line
    let tw = dev(m * 0.34), th = dev(m * 0.62);
    if ((W - tw) % 2) tw -= 1; if ((H - th) % 2) th -= 1;
    const lw = Math.max(1, dev(SW)), tx = x + (W - tw) / 2 / DS, ty = y + (H - th) / 2 / DS, half = Math.floor((th - lw * 2) / 2);
    ring(tx, ty, tw / DS, th / DS);
    ctx.fillRect(tx + lw / DS, ty + (up ? lw : th - lw - half) / DS, (tw - lw * 2) / DS, half / DS);
  } else if (T === 11) { // a lamp in a plain cell
    const on = live ? (beat(tt, 500, 3) + Math.floor(x / 7)) % 3 === 0 : g() < 0.3;
    ctx.beginPath(); ctx.arc(cx, cy, m * 0.14, 0, TAU); if (on) ctx.fill(); else ctx.stroke();
  } else if (T === 12) { // the lamp's square twin
    const on = live ? (beat(tt, 500, 3) + Math.floor(x / 7)) % 3 === 0 : g() < 0.3, [bx, by, bs] = square(m * 0.28);
    if (on) ctx.fillRect(bx, by, bs, bs); else ring(bx, by, bs, bs);
  } else if (T === 13) { // the disc's square twin
    const [bx, by, bs] = square(m * 0.72), [ix, iy, is] = square(m * 0.32);
    ctx.fillRect(bx, by, bs, bs);
    ctx.strokeStyle = C.face; ring(ix, iy, is, is);
  } else if (T === 14) { // the ring's square twin
    // the ring's twin: its line as thick and the square's middle on the ring's radius
    const lw = Math.max(2, m * 0.12), [bx, by, bs] = square(m * 0.6 + lw);
    ring(bx, by, bs, bs, lw);
  } else { // the clock's square twin: ticks on a square face
    const r = m * 0.44, step = m < 16 ? 3 : 1;
    for (let i = 0; i < 12; i += step) {
      const a = (i * Math.PI) / 6, c = Math.cos(a), sn = Math.sin(a), k = r / Math.max(Math.abs(c), Math.abs(sn));
      const r1 = k * (i % 3 ? 0.85 : 0.72);
      ctx.beginPath(); ctx.moveTo(cx + c * r1, cy + sn * r1); ctx.lineTo(cx + c * k, cy + sn * k); ctx.stroke();
    }
    const hr = g() * 6.28 + (live ? wave(tt, LOOP_MS) : 0), mn = g() * 6.28 + (live ? wave(tt, 3000) : 0);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(hr) * m * 0.2, cy + Math.sin(hr) * m * 0.2);
    ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(mn) * m * 0.32, cy + Math.sin(mn) * m * 0.32); ctx.stroke();
  }
  ctx.lineCap = "butt";
}
