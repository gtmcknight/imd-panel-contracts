/**
 * The panel renderer as it is stored on Ethereum.
 *
 * This file and the wall's own drawing code it imports are bundled, gzipped and written into contract bytecode, where no
 * one can change or remove them. PanelRenderer reads who holds each of the 2,000 identity.md seats and the wallet's design
 * from PanelDesigns, and returns a page that runs this with nothing else: no server, no font, no library, only a browser.
 *
 * It lays the wall out exactly as imd.fun does, from the owners alone, finds the wallet's module, and draws it as large and
 * as sharp as the screen allows, running, its lamps on. The live activity of the agents behind the seats is the site's to
 * show; the chain's copy is the machine at rest with its power on.
 */
import { WallRenderer } from "../../lib/machine/renderer";
import { drawModule } from "../../lib/machine/module";
import { createPainter } from "../../lib/machine/painter";
import { THEMES, type ThemeName } from "../../lib/machine/palette";
import { decodeDesign, initialsOf } from "../../lib/machine/design";
import { boardSeed, boardSize, glassOf, makeBoard, themeBoard } from "../../lib/machine/board";
import { pixelText, pixelWidth } from "../../lib/machine/pixel-font";
import type { MachineSnapshot } from "../../lib/machine/types";

/** The wall the panel is laid out on: a desktop's, the shape most readers see it at, as the instrument page uses. */
const WALL_W = 1440, WALL_H = 780;

/** The owners, 20 bytes a seat in seat order, zero for none, from base64: identity.md's 2,000 seats. */
function readOwners(b64: string): Array<string | null> {
  const raw = atob(b64), out: Array<string | null> = [];
  for (let i = 0; i < Math.floor(raw.length / 20); i++) {
    let hex = "", zero = true;
    for (let j = 0; j < 20; j++) {
      const b = raw.charCodeAt(i * 20 + j);
      if (b) zero = false;
      hex += b.toString(16).padStart(2, "0");
    }
    out.push(zero ? null : `0x${hex}`);
  }
  return out;
}

/** Draw `wallet`'s panel into the page, from the owners and the wallet's design word. */
// the chain id is passed by the page and kept in its signature; the page no longer prints it
function panel(ownersB64: string, wallet: string, designWord: string, _chainId: number): void {
  const owners = readOwners(ownersB64), me = wallet.toLowerCase();
  const design = decodeDesign(designWord);
  let T = THEMES.steel, themeName: ThemeName = "steel";
  // set in another page by imd.fun/embed.js (which names its frame) it is only the panel: no words around it, nothing
  // behind it, the full width it is given. Framed any other way, as a marketplace shows a token's page, it is the page
  const framed = window.parent !== window && window.name === "imd-embed";
  document.body.style.cssText = `margin:0;height:100vh;overflow:hidden;background:${framed ? "transparent" : T.light.wall}`;
  const cv = document.createElement("canvas");
  cv.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;display:block";
  document.body.appendChild(cv);
  const ctx = cv.getContext("2d")!;

  // the wall, laid out off screen from the owners alone, as the front page lays it out
  const off = document.createElement("canvas");
  off.style.cssText = `position:fixed;left:-99999px;top:0;width:${WALL_W}px;height:${WALL_H}px`;
  document.body.appendChild(off);
  const snap = { at: 1, health: {}, counts: {}, seats: {}, events: [], owners } as unknown as MachineSnapshot;
  const wall = new WallRenderer(off, { fontFamily: "monospace", onTip: () => {}, onOpen: () => {}, still: true, forget: true });
  wall.update(snap, WALL_W, WALL_H);
  const ids = owners.flatMap((o, i) => (o === me ? [i] : []));
  const mod = ids.length ? wall.moduleOf(ids[0]!) : null;
  off.remove();
  // the wall as it was laid out, kept: the panels around this one, the real holders beside it, to set it among. The
  // renderer is kept too, still, to paint it again in another theme
  const around = off.width ? off : null, wallH = wall.wallHeight || WALL_H;
  // with this panel taken out of its slot, as the wall shows a panel lifted off it: an empty bay, shadowed under its top
  // edge, its four screw holes, so nothing of it shows behind it as it turns
  const cutOut = () => { if (around && mod){
    const a = around.getContext("2d")!, sc = around.width / WALL_W, c = mod.cell;
    const x = mod.c * c + 1, y = mod.r * c + 1, w = mod.w * c - 2, h = mod.h * c - 2, r = Math.max(1.2, c * 0.07), m = c * 0.22;
    a.setTransform(sc, 0, 0, sc, 0, 0);
    a.fillStyle = T.light.wall; a.fillRect(x - 1, y - 1, w + 2, h + 2);
    a.fillStyle = "rgba(0, 0, 0, 0.45)"; a.fillRect(x, y, w, h);
    a.fillStyle = "rgba(0, 0, 0, 0.35)"; a.fillRect(x, y, w, Math.max(2, c * 0.12));
    a.fillStyle = "rgba(0, 0, 0, 0.6)";
    for (const [cx, cy] of [[x + m, y + m], [x + w - m, y + m], [x + m, y + h - m], [x + w - m, y + h - m]]){ a.beginPath(); a.arc(cx!, cy!, r, 0, Math.PI * 2); a.fill() }
    a.setTransform(1, 0, 0, 1, 0, 0);
  } };
  cutOut();

  // the back: the panel's circuit board, the same one imd.fun shows, made the first time the panel is turned over
  let back: { cv: HTMLCanvasElement; g: CanvasRenderingContext2D; img: ImageData; out: Uint32Array; paint: (t: number, out: Uint32Array) => void; pulse: (t: number, seat?: number | null, strength?: number, alert?: boolean) => void; level: (l: number) => void; boot: (t: number) => void; seat: (id: number, st: 0 | 1 | 2) => void } | null = null;
  const backOf = () => {
    if (back || !mod) return back;
    const [BW, BH] = boardSize(mod.w, mod.h), mw = mod.w * mod.cell, mh = mod.h * mod.cell;
    // the front at the board's size, read for the panes of glass the board puts a driver chip behind
    const f = document.createElement("canvas"); f.width = BW; f.height = BH;
    const fg = f.getContext("2d")!; fg.scale(BW / mw, BH / mh); fg.lineJoin = "round"; fg.fillStyle = T.light.wall; fg.fillRect(0, 0, mw, mh);
    drawModule(createPainter(fg, mod.cell, T.light, T.dark), 1, 1, mw - 2, mh - 2, { first: mod.first, n: mod.ids.length, cw: mod.w, ch: mod.h, activity: 1, lit: 1, moving: false, tms: 0, mine: false, edge: T.light.frame ?? T.light.stroke, theme: T, design });
    const fd = fg.getImageData(0, 0, BW, BH);
    const info = { name: `${me.slice(0, 6)}_${me.slice(-4)}`, code: `no. ${mod.first}`, lot: design?.lot ?? null, seats: ids.map(() => 1 as const), ids };
    const b = makeBoard(boardSeed(mod.first), BW, BH, themeBoard(themeName, T), 0.72, info, glassOf(fd.data, BW, BH, 0, 0, BW, BH, BW, BH), initialsOf(design));
    const cvb = document.createElement("canvas"); cvb.width = BW; cvb.height = BH;
    const g = cvb.getContext("2d")!, img = g.createImageData(BW, BH);
    for (const [id, st] of seatsSet) b.seat(id, st);
    if (level != null) b.level(level);
    return (back = { cv: cvb, g, img, out: new Uint32Array(img.data.buffer), paint: b.paint, pulse: b.pulse, level: b.level, boot: b.boot, seat: b.seat });
  };
  // the live input: anything outside may play the board by message. The art fetches nothing and keeps nothing; with no
  // messages it is the board at rest. Sent with postMessage to this page:
  //   { type: "imd:pulse", seat?: number, strength?: 0..1 }   light flows out along every wire from that seat's pad
  //   { type: "imd:alert", seat?: number }                    the same, red
  //   { type: "imd:level", level: 0..1 }                      how busy the board runs; 1 is as it was made
  //   { type: "imd:boot" }                                    the power-up: light races out along every wire
  //   { type: "imd:side", side: "front" | "back" }            turn it to that side
  //   { type: "imd:view", view: "panel" | "wall" }            the panel alone, or among its neighbours on the wall
  //   { type: "imd:seat", seat, state: "idle" | "active" | "working" }   set a seat, held until set again
  //   { type: "imd:theme", theme }                            steel, ivory, night, onyx, slate or olive
  window.addEventListener("message", (e) => {
    const d = e.data as { type?: unknown; seat?: unknown; strength?: unknown; level?: unknown } | null;
    if (!d || typeof d !== "object" || typeof d.type !== "string" || !mod) return;
    if (d.type === "imd:theme"){
      const name = (d as { theme?: unknown }).theme;
      if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(THEMES, name) || name === themeName) return;
      themeName = name as ThemeName; T = THEMES[themeName];
      if (!framed) document.body.style.background = T.light.wall;
      wall.setTheme(themeName); cutOut();
      back = null; if (over) backOf();
      paint(last > 0 ? last : 0); return;
    }
    if (d.type === "imd:seat"){
      const state = (d as { state?: unknown }).state, st = state === "idle" ? 0 : state === "active" ? 1 : state === "working" ? 2 : -1;
      if (!Number.isInteger(d.seat) || st < 0 || !ids.includes(d.seat as number)) return;
      seatsSet.set(d.seat as number, st as 0 | 1 | 2); back?.seat(d.seat as number, st as 0 | 1 | 2);
      if (!live) live = true;
      poke(); return;
    }
    if (d.type === "imd:view"){ view = (d as { view?: unknown }).view === "wall" ? "wall" : "panel"; fitTo(); poke(); return; }
    if (d.type === "imd:side"){ const want = (d as { side?: unknown }).side === "back"; if (want !== over){ backOf(); over = want; turnAt = still ? -1 : performance.now() } poke(); return; }
    // the first real event says so in the corner: from here on the signals are something happening, not a loop
    if (!live && /^imd:(pulse|alert|level|boot)$/.test(d.type)) live = true;
    // the face answers too: a signal brings it to work for a few seconds, its meters running and its lamp lit; how busy the
    // swarm is sets how it rests
    if (d.type === "imd:pulse" || d.type === "imd:alert") hotUntil = performance.now() + 4000;
    else if (d.type === "imd:level"){ rest = typeof d.level === "number" && d.level >= 0.6 ? 2 : 1; level = num(d.level, 1) }
    const b = backOf();
    if (!b) return;
    const seat = typeof d.seat === "number" && Number.isInteger(d.seat) ? d.seat : null;
    if (d.type === "imd:pulse") b.pulse(performance.now(), seat, num(d.strength, 1), false);
    else if (d.type === "imd:alert") b.pulse(performance.now(), seat, 1, true);
    else if (d.type === "imd:level") b.level(num(d.level, 1));
    else if (d.type === "imd:boot") b.boot(performance.now());
    poke();
  });
  const num = (v: unknown, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? v : dflt);
  // the board's busyness as last asked, kept across a change of theme, which makes the board again
  let level: number | null = null;

  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const caption = mod ? `SEAT${ids.length > 1 ? "S" : ""} ${ids.join(" ")}` : "NO SEATS";
  let live = false, hotUntil = 0, rest: 0 | 1 | 2 | 3 = 1;
  // the face rests as busy as the busiest seat set from outside: lit and running while one works
  const seatsSet = new Map<number, 0 | 1 | 2>();
  const restOf = () => { let m = rest; for (const v of seatsSet.values()) m = Math.max(m, v === 2 ? 3 : v === 1 ? 2 : m) as 0 | 1 | 2 | 3; return m };
  // on its own page the panel sits in its place on the wall; set in another page it is the panel alone unless asked
  let view: "panel" | "wall" = framed ? "panel" : "wall";
  // a click or a tap turns it over, or back: one motion, the face squeezing to its edge and opening on the other side
  let over = false, turnAt = -1;
  const TURN = 620;
  cv.style.cursor = "pointer";
  cv.addEventListener("click", () => { if (!mod) return; backOf(); over = !over; turnAt = still ? -1 : performance.now(); poke(); });

  let last = -1e9, woke = performance.now();
  for (const ev of ["pointermove", "pointerdown", "keydown"]) window.addEventListener(ev, () => { woke = performance.now() });
  // where the panel goes and how large: on its own page, a whole number of device pixels to each of the wall's, in the
  // room between the top line and the bottom one, never larger than the instrument page's close-up (a cell at most 150
  // pixels, so a small panel stays a close look and not a poster). Framed, the frame's full width, or 70% of it among
  // its neighbours
  const place = (W: number, H: number, dpr: number) => {
    const m = mod!, mw = m.w * m.cell, mh = m.h * m.cell;
    if (framed){ const f = view === "wall" ? 0.7 : 1, k = Math.min((W * f) / mw, (H * f) / mh); return { k, x: Math.round((W - mw * k) / 2), y: Math.round((H - mh * k) / 2) }; }
    const s = Math.max(2, Math.round(Math.min(W, H) / 260)), top = s * 21, room = H - s * 42;
    const k = Math.max(1, Math.floor(Math.min((W * 0.86) / mw, (room * 0.86) / mh, 150 / m.cell) * dpr)) / dpr;
    return { k, x: Math.round((W - mw * k) / 2), y: Math.round(top + (room - mh * k) / 2) };
  };
  const paint = (t: number) => {
    const dpr = Math.min(3, window.devicePixelRatio || 1), W = window.innerWidth, H = window.innerHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (framed) ctx.clearRect(0, 0, W, H);
    else { ctx.fillStyle = T.light.wall; ctx.fillRect(0, 0, W, H); }
    const g = mod ? place(W, H, dpr) : null;
    // the neighbours: the wall around the panel at the panel's own scale, faded back so the panel reads first
    if (g && mod && view === "wall" && around){
      const c = mod.cell;
      ctx.save(); ctx.imageSmoothingEnabled = true;
      ctx.drawImage(around, g.x - mod.c * c * g.k, g.y - mod.r * c * g.k, WALL_W * g.k, wallH * g.k);
      ctx.fillStyle = T.light.wall; ctx.globalAlpha = 0.55; ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    // the page's words, in the wall's own pixel face: the site at the top left, what a tap does at the top right, the seats along the bottom
    const s = Math.max(2, Math.round(Math.min(W, H) / 260));
    const hint = mod ? (over ? "TAP TO TURN BACK" : "TAP TO TURN OVER") : "";
    // the seats, cut at a whole number with "..." where they run past the page's margin
    const fit = (text: string) => { let t = text; while (t.length > 4 && pixelWidth(t, s) > W - s * 16) t = `${t.slice(0, t.lastIndexOf(" ", t.length - 4))}...`; return t; };
    // the words come up when the page opens or the pointer moves, and fade after three seconds, so what stays is the wall
    const since = performance.now() - woke, words = still ? 1 : since < 3000 ? 1 : Math.max(0, 1 - (since - 3000) / 400);
    ctx.globalAlpha = words;
    // the corner: LIVE with a lit lamp once something outside is playing the board, else the site's name
    if (framed || !words) {}
    else if (live) {
      ctx.fillStyle = T.lamp; ctx.fillRect(s * 8, s * 8, s * 3, s * 5);
      pixelText(ctx, "LIVE", s * 13, s * 8, s, T.light.stroke, true);
    } else pixelText(ctx, "IMD.FUN", s * 8, s * 8, s, T.light.stroke, true);
    if (!framed && words && hint && pixelWidth(hint, s) + pixelWidth("IMD.FUN", s) + s * 24 < W) pixelText(ctx, hint, W - s * 8 - pixelWidth(hint, s), s * 8, s, T.light.stroke, true);
    if (!framed && words) pixelText(ctx, fit(caption), s * 8, H - s * 8 - s * 5, s, T.light.stroke, true);
    ctx.globalAlpha = 1;
    if (!mod) return;
    const mw = mod.w * mod.cell, mh = mod.h * mod.cell, { k, x, y } = g!;
    // the turn: eased in and out; past halfway the other side shows, and each face darkens as it goes edge-on
    const p = turnAt < 0 ? 1 : Math.min(1, (performance.now() - turnAt) / TURN), e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
    const squeeze = Math.max(0.02, Math.abs(Math.cos(e * Math.PI))), showBack = p < 0.5 ? !over : over;
    if (p >= 1) turnAt = -1;
    const cx = x + (mw * k) / 2;
    ctx.save();
    ctx.translate(cx, 0); ctx.scale(squeeze, 1); ctx.translate(-cx, 0);
    if (showBack && back) {
      back.paint(t, back.out); back.g.putImageData(back.img, 0, 0);
      // the board sits in the same frame the face does: the frame holds the panel, so both sides of it show it
      ctx.fillStyle = T.light.frame ?? T.light.stroke; ctx.fillRect(x + k, y + k, (mw - 2) * k, (mh - 2) * k);
      ctx.imageSmoothingEnabled = false; ctx.drawImage(back.cv, x + 2.5 * k, y + 2.5 * k, (mw - 5) * k, (mh - 5) * k);
    } else {
      ctx.translate(x, y); ctx.scale(k, k); ctx.lineJoin = "round";
      drawModule(createPainter(ctx, mod.cell, T.light, T.dark), 1, 1, mw - 2, mh - 2, {
        first: mod.first, n: mod.ids.length, cw: mod.w, ch: mod.h, activity: performance.now() < hotUntil ? 3 : restOf(), lit: performance.now() < hotUntil || restOf() === 3 ? 2 : 1,
        moving: true, tms: t, mine: false, edge: T.light.frame ?? T.light.stroke, theme: T, design,
      });
    }
    ctx.restore();
    if (squeeze < 1) { ctx.fillStyle = "#000"; ctx.globalAlpha = (1 - squeeze) * 0.5; ctx.fillRect(cx - (mw * k * squeeze) / 2, y, mw * k * squeeze, mh * k); ctx.globalAlpha = 1; }
  };
  // still, every change is drawn once, in one step; moving, a frame runs every 33 ms while the page is in view
  const poke = () => { if (still) paint(0); };
  let seen = true;
  const frame = (t: number) => { if (seen && !document.hidden && (t - last > 33 || turnAt >= 0)) { last = t; paint(t); } requestAnimationFrame(frame); };
  paint(0);
  if (!still && mod) requestAnimationFrame(frame);
  // nothing is drawn while the panel is scrolled out of the page that holds it
  if (typeof IntersectionObserver !== "undefined") new IntersectionObserver((es) => { seen = es[es.length - 1]!.isIntersecting; }).observe(cv);
  window.addEventListener("resize", () => { paint(last > 0 ? last : 0); fitTo(); });
  // set in a page as an embed, it tells that page the height it wants for the width it was given, so the page can size it
  // like an image: { type: "imd:size", height }
  // like an image: { type: "imd:size", height }. A wallet with no seats asks for none
  let told = -1;
  function fitTo(){
    if (!framed) return;
    const W = window.innerWidth;
    // the panel's own shape at the width given; among its neighbours, the panel at 70% of it and never a thin band
    const H = mod ? Math.ceil(view === "wall" ? Math.max((W * mod.h) / mod.w / 0.7, W * 0.45) : (W * mod.h) / mod.w) : 0;
    if (H !== told){ told = H; window.parent.postMessage({ type: "imd:size", height: H }, "*") }
  }
  fitTo();
}

// the page the contract returns calls IMD.panel(...) once this has run
(globalThis as unknown as { IMD: { panel: typeof panel } }).IMD = { panel };
