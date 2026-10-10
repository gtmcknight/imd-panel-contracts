// @ts-nocheck
/**
 * The back of a panel: a pixel circuit board, seeded by the panel's first seat. The generator is Board Fab's (real
 * fabrication vocabulary: copper pour under the mask, parts by the board's job, and a power wave that runs out from
 * the main chip along every trace), laid out around the holder's title block and the driver chip behind each pane of
 * glass on the front. Its 3 s loop runs four times in the wall's 12 s one.
 */

const LOOP = 60;  // a board's loop is 60 frames: 3 s, four times in the wall's 12 s

const TAU = Math.PI * 2;

const SLOT_NAMES = ['BG','BG2','POUR','TR','TR2','TRD','PAD','PADH','PADD','BODY','BODYH','BODYD','MARK','PIN','PIND','SILK','MET','METH','METD','HOLE','VOID','SHADOW','EDGEH','EDGEL','SUB','GLOW','GLOW2','SPK','SPK2','SPK3','SPK4','SGLOW','POW'];

const SL = {}; SLOT_NAMES.forEach((n, i) => SL[n] = i);

const {BG,BG2,POUR,TR,TR2,TRD,PAD,PADH,PADD,BODY,BODYH,BODYD,MARK,PIN,PIND,SILK,MET,METH,METD,HOLE,VOID,SHADOW,EDGEH,EDGEL,SUB,GLOW,GLOW2,SPK,SPK2,SPK3,SPK4,SGLOW,POW} = SL;

const A0 = SLOT_NAMES.length, AD0 = A0 + 8, AH0 = A0 + 16, AG0 = A0 + 24, NS = A0 + 32;

const A = i => A0 + (i & 7), AD = i => AD0 + (i & 7), AH = i => AH0 + (i & 7), AG = i => AG0 + (i & 7);  // lit, unlit, highlight, glow on the mask

// component colors (what real parts look like): 0 cyan, 1 magenta, 2 amber, 3 green, 4 beige, 5 uv, 6 red, 7 blue
const MASKISH = new Uint8Array(NS); for (const s of [BG, BG2, POUR, TRD]) MASKISH[s] = 1;

function hash32(str){ let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) } h ^= h >>> 16; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16; return h >>> 0 }

class Rng {
  constructor(seed){ this.a = (typeof seed === 'number' ? seed : hash32(String(seed))) >>> 0 }
  next(){ const a = (this.a = (this.a + 0x6D2B79F5) >>> 0); let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  u32(){ return (this.next() * 4294967296) >>> 0 }
  int(a, b){ return b <= a ? a : a + Math.floor(this.next() * (b - a + 1)) }
  range(a, b){ return a + this.next() * (b - a) }
  chance(p){ return this.next() < p }
  pick(a){ return a[Math.floor(this.next() * a.length)] }
  weighted(list){ let t = 0; for (const e of list) t += e[1]; let x = this.next() * t; for (const e of list){ if ((x -= e[1]) < 0) return e[0] } return list[list.length - 1][0] }
  shuffle(a){ for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(this.next() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t } return a }
}

const hex = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];

const mix = (a, b, t) => [Math.round(a[0] + (b[0]-a[0])*t), Math.round(a[1] + (b[1]-a[1])*t), Math.round(a[2] + (b[2]-a[2])*t)];

const pack = c => ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;

const lum = c => (0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2]) / 255;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const WHITE = [255,255,255], BLACK = [0,0,0];

class Board {
  constructor(W, H){
    this.W = W; this.H = H; this.N = W * H;
    this.buf = new Uint8Array(this.N);
    this.occ = new Uint8Array(this.N);   // 0 free, 1 part, 2 trace, 3 glow, 4 keep-out, 5 print
    this.own = new Int32Array(this.N);   // lane id that wrote a trace cell
    this.reg = new Uint8Array(this.N);   // 0 cut away, 1 panel rail or tab, 2+k board k
    this.lanes = 0; this.groups = 0;
    this.boards = []; this.paths = []; this.leds = []; this.fans = []; this.screens = []; this.segs = []; this.bars = []; this.glows = []; this.pulses = []; this.letters = null;
  }
  free(x, y, w, h, bx0 = 0, by0 = 0, bx1 = this.W, by1 = this.H){
    const x0 = Math.max(x, bx0, 0), y0 = Math.max(y, by0, 0), x1 = Math.min(x + w, bx1, this.W), y1 = Math.min(y + h, by1, this.H);
    if (x0 >= x1 || y0 >= y1) return false;
    const occ = this.occ, W = this.W;
    for (let yy = y0; yy < y1; yy++){ let i = yy * W + x0; for (let xx = x0; xx < x1; xx++, i++) if (occ[i]) return false }
    return true;
  }
  reserve(x, y, w, h, v){
    const x0 = Math.max(x, 0), y0 = Math.max(y, 0), x1 = Math.min(x + w, this.W), y1 = Math.min(y + h, this.H);
    for (let yy = y0; yy < y1; yy++){ let i = yy * this.W + x0; for (let xx = x0; xx < x1; xx++, i++) if (!this.occ[i] || v === 1) this.occ[i] = v }
  }
  dot(x, y, c, o = 1){ if (x < 0 || y < 0 || x >= this.W || y >= this.H) return; const i = y * this.W + x; this.buf[i] = c; if (o) this.occ[i] = o }
}

// Drawing context: components draw in their own unit grid; each unit is s×s logical pixels.
class G {
  constructor(B){ this.B = B; this.cap = null; this.idx = 0 }
  at(x0, y0, s, rot, w, h){ this.x0 = x0; this.y0 = y0; this.s = s; this.rot = rot; this.w = w; this.h = h; return this }
  p(x, y, c){
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    let X = x, Y = y; if (this.rot){ X = this.h - 1 - y; Y = x }
    const s = this.s, B = this.B, W = B.W, px = this.x0 + X * s, py = this.y0 + Y * s;
    for (let dy = 0; dy < s; dy++){
      const yy = py + dy; if (yy < 0 || yy >= B.H) continue;
      for (let dx = 0; dx < s; dx++){
        const xx = px + dx; if (xx < 0 || xx >= W) continue;
        const i = yy * W + xx; B.buf[i] = c; B.occ[i] = 1; if (this.cap) this.cap.push(i);
      }
    }
  }
  r(x, y, w, h, c){ for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.p(x + i, y + j, c) }
  hl(x, y, w, c){ this.r(x, y, w, 1, c) }
  vl(x, y, h, c){ this.r(x, y, 1, h, c) }
  o(x, y, w, h, c){ this.hl(x, y, w, c); this.hl(x, y + h - 1, w, c); this.vl(x, y, h, c); this.vl(x + w - 1, y, h, c) }
  disc(cx, cy, rad, c){ const r2 = rad * rad; for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++){ const dx = x + .5 - cx, dy = y + .5 - cy; if (dx*dx + dy*dy <= r2) this.p(x, y, c) } }
  ring(cx, cy, r0, r1, c){ const a = r0*r0, b = r1*r1; for (let y = Math.floor(cy - r1); y <= Math.ceil(cy + r1); y++) for (let x = Math.floor(cx - r1); x <= Math.ceil(cx + r1); x++){ const dx = x + .5 - cx, dy = y + .5 - cy, d = dx*dx + dy*dy; if (d > a && d <= b) this.p(x, y, c) } }
  px(x, y){ let X = x, Y = y; if (this.rot){ X = this.h - y; Y = x } return [this.x0 + X * this.s, this.y0 + Y * this.s] }
  capture(){ this.cap = [] }
  take(){ const c = this.cap; this.cap = null; return c }
}

export const FONT = {'0':'111101101101111','1':'010110010010111','2':'111001111100111','3':'111001111001111','4':'101101111001001','5':'111100111001111','6':'111100111101111','7':'111001010010010','8':'111101111101111','9':'111101111001111',
  A:'010101111101101',B:'110101110101110',C:'011100100100011',D:'110101101101110',E:'111100110100111',F:'111100110100100',G:'011100101101011',H:'101101111101101',I:'111010010010111',J:'001001001101010',K:'101101110101101',L:'100100100100111',M:'101111111101101',N:'110101101101101',O:'010101101101010',P:'110101110100100',Q:'010101101110011',R:'110101110101101',S:'011100010001110',T:'111010010010010',U:'101101101101111',V:'101101101101010',W:'101101111111101',X:'101101010101101',Y:'101101010010010',Z:'111001010100111','+':'000010111010000','-':'000000111000000','.':'000000000000010','/':'001001010100100','#':'101111101111101',':':'000010000010000',',':'000000000010100','_':'000000000000111'};

const LABELS = ['R','C','U','L','D','Q','J','TP','SW','Y','LED','FB','IC'];

const WORDS = ['+5V','GND','3V3','VCC','CLK','RX','TX','RST','SDA','SCL','IO7','EN','VIN','A0','MISO','MOSI','DNP','BOOT'];

function silkText(B, x, y, str, fs, c = SILK, o = 1){
  [...str].forEach((ch, k) => { const gl = FONT[ch]; if (!gl) return; for (let j = 0; j < 15; j++) if (gl[j] === '1') for (let a = 0; a < fs; a++) for (let b = 0; b < fs; b++) B.dot(x + (k * 4 + (j % 3)) * fs + a, y + ((j / 3) | 0) * fs + b, c, o) });
}

function textRuns(g, x0, y, x1, c, q){ let x = x0; while (x < x1){ const run = q.int(1, 3); for (let i = 0; i < run && x < x1; i++, x++) g.p(x, y, c); x += 1 } }

// A chip's marking in Morse: a dot one pixel, a dash three, one dark between them, three between letters and seven
// between words, wrapped at the words into rows two pixels apart (a word too long for a row breaks between letters), the
// block centred on the chip. Given several lines, the first that fits
const mw = (ch) => [...MORSE[ch]].reduce((m, c) => m + (c === '-' ? 3 : 1), 0) + MORSE[ch].length - 1;
function morseRows(words, w){
  const rows = []; let row = [], len = 0;
  for (const word of words){
    const cs = [...word].filter((ch) => MORSE[ch]);
    const wlen = cs.reduce((n, ch, k) => n + mw(ch) + (k ? 3 : 0), 0);
    if (row.length && len + 7 + wlen <= w){ row.push(' ', ...cs); len += 7 + wlen; continue }
    if (row.length){ rows.push(row); row = []; len = 0 }
    for (const ch of cs){ const add = mw(ch) + (row.length ? 3 : 0); if (row.length && len + add > w){ rows.push(row); row = []; len = 0 } len += mw(ch) + (row.length ? 3 : 0); row.push(ch) }
  }
  if (row.length) rows.push(row);
  return rows;
}
function morseMark(g, x, y, w, h, say, ink){
  const cap = Math.floor((h + 1) / 2);
  let rows = null;
  // a line another chip on the panel already says only when nothing else fits
  // wrapped to three quarters of the chip, so the block shows margin either side; the full width only for a line that
  // needs it to fit
  for (const pass of [0, 1]) for (const words of say.lines){
    if (rows || (!pass && say.used.has(words))) continue;
    for (const ww of [Math.round(w * .75), w]){ const rs = morseRows(words, ww); if (rs.length <= cap){ rows = rs; say.used.add(words); break } }
  }
  if (!rows) return false;
  // centred on the chip's whole face below its lit top edge (a row above the marking area to a row and a half below), an
  // odd row over going above, as a short last row already leaves the bottom lighter
  const y0 = y - 1 + Math.ceil((h + 3 - (rows.length * 2 - 1)) / 2);
  // rows flush left, as a chip's lines of marking are, the block as a whole centred on the chip
  const lens = rows.map((row) => row.reduce((n, ch, k) => n + (ch === ' ' ? 4 : mw(ch) + (k ? 3 : 0)), 0));
  const left = x + Math.max(0, Math.floor((w - Math.max(...lens)) / 2));
  rows.forEach((row, i) => {
    let cx = left;
    row.forEach((ch, k) => {
      if (ch === ' '){ cx += 4; return }
      if (k) cx += 3;
      [...MORSE[ch]].forEach((c, j) => { if (j) cx++; for (let n = 0; n < (c === '-' ? 3 : 1); n++, cx++) if (cx < x + w) g.p(cx, y0 + i * 2, ink) });
    });
  });
  return true;
}

function chipMark(g, x, y, w, h, kind, ink, body, q){
  if (w < 5 || h < 5) return;
  const cx = x + w / 2, cy = y + h / 2;
  if (kind === 'text'){ const rows = Math.max(1, Math.min(3, Math.floor((h - 3) / 3))); const y0 = Math.round(cy - rows); for (let i = 0; i < rows; i++) textRuns(g, x + 2, y0 + i * 2, x + w - 2, ink, q) }
  else if (kind === 'grid'){ const st = w >= 16 ? 3 : 2; for (let yy = y + 2; yy < y + h - 2; yy += st) for (let xx = x + 2; xx < x + w - 2; xx += st) g.p(xx, yy, body === BODY ? BODYH : ink) }
  else if (kind === 'die'){ const ins = Math.max(2, Math.floor(w * .24)); g.o(x + ins, y + ins, w - 2*ins, h - 2*ins, ink) }
  else if (kind === 'dimple'){ g.disc(cx, cy, Math.min(w, h) * .18, body === BODY ? BODYD : ink) }
  else if (kind === 'molds'){
    // the ejector marks: a larger round one by pin one, a smaller one in the far corner, each a shallow dish
    const mn = Math.min(w, h), dish = body === BODY ? BODYD : ink;
    const big = Math.max(1.6, mn * .1), small = Math.max(1.1, mn * .065);
    for (const [ox, oy, rr] of [[x + 2 + big, y + 2 + big, big], [x + w - 2 - small, y + h - 2 - small, small]]) g.disc(ox, oy, rr, dish);
  }
  else if (kind === 'dm'){
    // a Data Matrix in the corner: solid along its left and bottom edges, alternating along the top and right, its cells inside
    const D = Math.min(14, Math.max(8, (Math.round(Math.min(w, h) * .32) >> 1) << 1)), x0 = x + w - 2 - D, y0 = y + h - 2 - D;
    for (let j = 0; j < D; j++) for (let i = 0; i < D; i++){
      const on = i === 0 || j === D - 1 ? true : j === 0 ? i % 2 === 0 : i === D - 1 ? j % 2 === 1 : q.chance(.5);
      if (on) g.p(x0 + i, y0 + j, ink);
    }
  }
}

const LIB = {
  qfp(r, mw, mh, opt){
    const lim = Math.min(mw, mh, 44); if (lim < 8) return null;
    const N = opt?.N ?? r.int(8, lim), style = r.weighted([['dark',6],['gray',1],['finish',.8]]);
    const drawn = r.weighted([['text',3],['grid',1],['die',1],['dimple',1],['plain',1]]), seed = r.u32();
    // a panel's other main chips carry no lines of marking, so the one chip whose lines say something is the only one with any
    const mark = opt?.quiet && drawn === 'text' ? 'die' : drawn;
    return { w:N, h:N, pins:true, draw(g){
      const q = new Rng(seed), pl = N >= 20 ? 2 : 1, b = pl, bs = N - 2*pl;
      // a blank main chip shows what a real one does without its lines: the outline of its die, the two round marks of its
      // mould, or a small 2D code, the panel handing them out in turn so no two of its chips match
      const blank = opt?.quiet ? opt.blank : null;
      for (let i = pl + 1; i < N - pl - 1; i += 2) for (let k = 0; k < pl; k++){ g.p(i,k,PIN); g.p(i,N-1-k,PIN); g.p(k,i,PIN); g.p(N-1-k,i,PIN) }
      const body = style === 'finish' ? PAD : style === 'gray' ? MET : BODY; let ink;
      g.r(b, b, bs, bs, body);
      if (style === 'finish'){ g.o(b, b, bs, bs, PADD); ink = PADD }
      else if (style === 'gray'){ g.hl(b,b,bs,METH); g.vl(b,b,bs,METH); g.hl(b,b+bs-1,bs,METD); g.vl(b+bs-1,b,bs,METD); ink = METD }
      // a moulded package is raised: lit along its top and left edges, in shadow along its bottom and right
      else { g.hl(b,b,bs,BODYH); g.vl(b,b,bs,BODYH); g.hl(b + 1,b + bs - 1,bs - 1,BODYD); g.vl(b + bs - 1,b + 1,bs - 1,BODYD); ink = MARK }
      // the pin-one corner chamfered, as a moulded package is, with its dot beside it
      g.p(b, b, style === 'dark' ? BODYD : style === 'gray' ? METD : PADD);
      // (not on a chip whose marking is Morse, where a lone dot by the text reads as one more letter)
      // (nor where the mould's own round mark by pin one does the job)
      if (bs >= 6 && !opt?.morse && blank !== 'molds') g.p(b + 2, b + 2, ink);
      // a small chip still carries its marking: a line or two of laser-etched code rather than a lone square
      const m = blank ?? (bs < 12 && mark !== 'text' ? 'text' : mark);
      if (opt?.morse && bs >= 12 && morseMark(g, b + 2, b + 2, bs - 4, bs - 4, opt.morse, ink)){}
      else if (bs < 12 && bs >= 6){ textRuns(g, b + 2, b + Math.round(bs / 2) - 1, b + bs - 2, ink, q); if (bs >= 9) textRuns(g, b + 2, b + Math.round(bs / 2) + 1, b + bs - 3, ink, q) }
      else chipMark(g, b + 1, b + 1, bs - 2, bs - 2, m, ink, body, q);
    }};
  },
  bga(r, mw, mh){
    const lim = Math.min(mw, mh, 30); if (lim < 8) return null;
    const pop = r.chance(.6), N = r.int(8, pop ? lim : Math.min(lim, 16));
    return { w:N, h:N, draw(g){
      if (pop){ g.r(0,0,N,N,BODY); g.hl(0,0,N,BODYH); g.vl(0,0,N,BODYH); g.p(2,2,MARK); for (let y = 4; y < N - 3; y += 2) for (let x = 4; x < N - 3; x += 2) g.p(x, y, BODYH) }
      else { for (let y = 1; y < N - 1; y += 2) for (let x = 1; x < N - 1; x += 2) g.p(x, y, PAD); g.hl(0,0,3,SILK); g.vl(0,0,3,SILK) }
    }};
  },
  soic(r, mw, mh){
    if (mw < 6 || mh < 4) return null;
    const H = r.int(4, Math.min(mh, 10)), L = r.int(Math.max(H + 2, 6), Math.min(mw, 30)); if (L > mw) return null;
    const style = r.weighted([['dark',6],['gray',1]]), txt = r.chance(.65), seed = r.u32();
    return { w:L, h:H, draw(g){
      const q = new Rng(seed), pl = H >= 8 ? 2 : 1, bh = H - 2*pl;
      for (let i = 1; i < L - 1; i += 2) for (let k = 0; k < pl; k++){ g.p(i, k, PIN); g.p(i, H - 1 - k, PIN) }
      const body = style === 'gray' ? MET : BODY, hi = style === 'gray' ? METH : BODYH, ink = style === 'dark' ? MARK : BODYD;
      g.r(0, pl, L, bh, body); g.hl(0, pl, L, hi);
      if (bh >= 3){ const m = pl + (bh >> 1); g.p(0, m, BODYD); if (bh >= 5){ g.p(0, m - 1, BODYD); g.p(1, m, BODYD) } }
      if (txt && bh >= 3 && L >= 9) textRuns(g, 3, pl + (bh >> 1), L - 2, ink, q);
    }};
  },
  sot(r, mw, mh){
    if (mw < 3 || mh < 3) return null;
    const w = mw >= 5 && r.chance(.4) ? 5 : 3;
    return { w, h:3, draw(g){ g.hl(0, 1, w, BODY); if (w === 3){ g.p(1,0,PIN); g.p(0,2,PIN); g.p(2,2,PIN) } else { g.p(0,0,PIN); g.p(2,0,PIN); g.p(4,0,PIN); g.p(1,2,PIN); g.p(3,2,PIN) } } };
  },
  smd(r, mw, mh){
    const opts = [[2,1],[3,1],[3,2],[4,2],[5,2],[6,3],[8,4],[5,3]].filter(([w,h]) => w <= mw && h <= mh); if (!opts.length) return null;
    const [w, h] = r.pick(opts), kind = r.weighted([['res',3],['cap',3],['ind',1],['tant',1]]);
    const end = r.chance(.7) ? PIN : PAD, capC = r.pick([MET, A(4), METH, MET, AD(4)]);
    return { w, h, draw(g){
      if (w === 2){ g.p(0, 0, end); g.p(1, 0, PIND); if (h > 1) g.r(0, 1, 2, h - 1, end); return }
      const e = w >= 6 ? 2 : 1, body = kind === 'res' ? BODY : kind === 'ind' ? METD : kind === 'tant' ? A(2) : capC;
      g.r(0, 0, e, h, end); g.r(w - e, 0, e, h, end); g.r(e, 0, w - 2*e, h, body);
      if (kind === 'res' && w >= 5 && h >= 2) for (let x = e + 1; x < w - e - 1; x += 2) g.p(x, h >> 1, MARK);
      if (kind === 'tant' && w - 2*e >= 2) g.vl(w - e - 1, 0, h, AD(2));
      if (kind === 'ind' && h >= 3) g.r(e + 1, 1, w - 2*e - 2, h - 2, MET);
    }};
  },
  res(r, mw, mh){
    if (mw < 8 || mh < 3) return null;
    const h = mh >= 5 && r.chance(.45) ? 5 : 3, w = r.int(8, Math.min(mw, 16)), lead = Math.max(1, Math.min(3, Math.floor((w - 6) / 2)));
    const bodyC = r.weighted([[A(4),3],[A(7),1.2],[METH,.6]]), bw = w - 2*lead, nb = bw >= 8 ? 4 : 3, bands = [];
    for (let i = 0; i < nb; i++) bands.push(i === nb - 1 && r.chance(.6) ? PAD : r.pick([A(6), BODY, A(2), AD(3), A(7), A(1), SILK]));
    return { w, h, draw(g){
      g.hl(0, h >> 1, w, PIN);
      g.r(lead, 1, bw, h - 2, bodyC); g.r(lead + 1, 0, bw - 2, h, bodyC);
      const pos = nb === 4 ? [2, 4, 6, bw - 3] : [2, 4, bw - 3];
      bands.forEach((c, i) => { const x = lead + pos[i]; if (x > lead && x < lead + bw - 1) g.vl(x, 0, h, c) });
    }};
  },
  diode(r, mw, mh){
    if (mw < 6 || mh < 3) return null;
    const w = r.int(6, Math.min(mw, 12)), glass = r.chance(.35);
    return { w, h:3, draw(g){ g.hl(0, 1, w, PIN); const l = w >= 9 ? 2 : 1; g.r(l, 0, w - 2*l, 3, glass ? A(6) : BODY); g.vl(w - l - 2, 0, 3, glass ? BODY : METH) } };
  },
  capTop(r, mw, mh){
    const lim = Math.min(mw, mh, 24); if (lim < 4) return null;
    const D = r.int(4, lim), style = D < 6 ? 'cer' : r.weighted([['alu',3],['cer',1]]), acc = r.pick([7, 7, 0, 5, 3]);
    return { w:D, h:D, draw(g){
      const c = D / 2;
      if (style === 'alu'){
        g.r(1, 0, D - 2, D, BODY); g.r(0, 1, D, D - 2, BODY);
        const R = c - .7;
        for (let y = 0; y < D; y++) for (let x = 0; x < D; x++){
          const dx = x + .5 - c, dy = y + .5 - c; if (dx*dx + dy*dy > R*R) continue;
          const t = (dx + dy) / R; let col = t < -.6 ? METH : t > .65 ? METD : MET;
          if (dy < -R * .5) col = AD(acc);
          g.p(x, y, col);
        }
        if (D >= 9){ const k = Math.max(1, Math.round(D / 6)), ci = Math.floor(c); for (let i = -k; i <= k; i++){ g.p(ci + i, ci + i, METD); g.p(ci + i, ci - i, METD) } }
      } else {
        g.r(1, 0, D - 2, D, A(4)); g.r(0, 1, D, D - 2, A(4)); g.hl(1, D - 1, D - 2, AD(4)); g.vl(D - 1, 1, D - 2, AD(4)); g.p(1, 1, AH(4));
      }
    }};
  },
  led(r, mw, mh, opt){
    const opts = [[3,2],[4,2],[4,3],[5,3],[3,3]].filter(([w,h]) => w <= mw && h <= mh); if (!opts.length) return null;
    const [w, h] = r.pick(opts), acc = opt?.acc ?? r.pick([0, 1, 2, 3, 5, 6, 7]), spec = opt?.spec ?? blinkSpec(r);
    return { w, h, draw(g){
      g.vl(0, 0, h, PAD); g.vl(w - 1, 0, h, PAD);
      g.capture(); g.r(1, 0, w - 2, h, A(acc)); const cells = g.take();
      g.capture(); g.p(1, 0, AH(acc)); const hi = g.take();
      addLed(g, cells, hi, [acc], spec);
    }};
  },
  ledrgb(r, mw, mh, opt){
    const lim = Math.min(mw, mh, 8); if (lim < 4) return null;
    const D = opt?.D ?? r.int(4, lim), accs = opt?.acc != null ? [opt.acc] : r.shuffle([0,1,2,3,5,6,7]).slice(0, 3);
    const spec = opt?.spec ?? { pat:[0,1,2], k:r.pick([4,5,10,20]), phase:r.int(0, 59), chase:r.chance(.6) ? r.int(1, 4) : 0 };
    return { w:D, h:D, draw(g){
      g.r(0, 0, D, D, METH); g.hl(0, D - 1, D, MET);
      g.capture(); if (D <= 5) g.r(1, 1, D - 2, D - 2, A(accs[0])); else g.disc(D / 2, D / 2, D / 2 - 1, A(accs[0])); const cells = g.take();
      g.capture(); g.p(Math.floor(D / 2) - 1, Math.floor(D / 2) - 1, AH(accs[0])); const hi = g.take();
      addLed(g, cells, hi, opt?.mono ? [accs[0]] : accs, spec);
    }};
  },
  xtal(r, mw, mh){
    if (mw < 6 || mh < 3) return null;
    const h = r.int(3, Math.min(mh, 6)), w = r.int(Math.max(6, h * 2), Math.min(mw, 16)); if (w > mw) return null;
    const smd = r.chance(.35);
    return { w, h, draw(g){
      if (smd){ g.r(0, 0, w, h, MET); g.hl(0, 0, w, METH); g.hl(0, h - 1, w, METD); g.p(0,0,PAD); g.p(w-1,0,PAD); g.p(0,h-1,PAD); g.p(w-1,h-1,PAD) }
      else { g.r(1, 0, w - 2, h, MET); g.r(0, 1, w, h - 2, MET); g.hl(2, h > 3 ? 1 : 0, w - 4, METH); g.hl(1, h - 1, w - 2, METD) }
    }};
  },
  ind(r, mw, mh){
    const lim = Math.min(mw, mh, 20); if (lim < 6) return null;
    const D = r.int(6, lim), copper = r.chance(.35);
    return { w:D, h:D, draw(g){
      const c = D / 2;
      if (!copper){ g.r(1, 0, D - 2, D, METD); g.r(0, 1, D, D - 2, METD); g.disc(c, c, D * .42, BODY); if (D >= 10) g.ring(c, c, D * .34, D * .42, BODYH); g.disc(c, c, D * .22, MET); g.p(Math.floor(c) - 1, Math.floor(c) - 1, METH); if (D >= 12){ const q = Math.floor(c); g.hl(q - 1, q, 3, METD) } }
      else {
        g.r(1, 0, D - 2, D, BODY); g.r(0, 1, D, D - 2, BODY); const n = Math.max(8, Math.round(D * 1.2));
        for (let y = 0; y < D; y++) for (let x = 0; x < D; x++){ const dx = x + .5 - c, dy = y + .5 - c, d = Math.hypot(dx, dy); if (d < D * .2 || d > D * .44) continue; const a = Math.atan2(dy, dx) / TAU * n; g.p(x, y, a - Math.floor(a) < .5 ? PAD : PADD) }
      }
    }};
  },
  toroid(r, mw, mh){
    const lim = Math.min(mw, mh, 30); if (lim < 9) return null;
    // a toroid is wound in copper; a grey one read as a fan that would not turn. The draw stays, so layouts do not move
    const D = r.int(9, lim), n = r.int(10, 22), wire = (r.chance(.7), PAD);
    return { w:D, h:D, draw(g){
      const c = D / 2, r0 = D * .22, r1 = D / 2 - .3;
      for (let y = 0; y < D; y++) for (let x = 0; x < D; x++){
        const dx = x + .5 - c, dy = y + .5 - c, d = Math.hypot(dx, dy); if (d < r0 || d > r1) continue;
        const a = Math.atan2(dy, dx) / TAU * n, f = a - Math.floor(a);
        let col = f < .55 ? wire : (wire === PAD ? PADD : METD); if (d > r1 - .9 && f < .55) col = wire === PAD ? PADD : METD; if (f < .12) col = wire === PAD ? PADH : METH;
        g.p(x, y, col);
      }
      g.disc(c, c, r0, BODYD);
    }};
  },
  btn(r, mw, mh){
    const lim = Math.min(mw, mh, 12); if (lim < 5) return null;
    const D = r.int(5, lim), acc = r.pick([6, 2, 3, 7]), colored = r.chance(.3);
    return { w:D, h:D, draw(g){
      g.p(0, 1, PIN); g.p(D - 1, 1, PIN); g.p(0, D - 2, PIN); g.p(D - 1, D - 2, PIN);
      g.r(1, 0, D - 2, D, METH); g.hl(1, D - 1, D - 2, MET);
      // a coloured cap is plastic, not light: its colour muted, a white glint where it catches the light
      g.disc(D / 2, D / 2, D * .3, colored ? AD(acc) : BODY);
      if (D >= 7) g.p(Math.floor(D / 2) - 1, Math.floor(D / 2) - 1, colored ? SPK : BODYH);
    }};
  },
  header(r, mw, mh){
    const rows = mh >= 5 && r.chance(.4) ? 2 : 1, h = rows * 2 + 1; if (h > mh || mw < 5) return null;
    const n = r.int(2, Math.min(20, Math.floor((mw - 1) / 2))), w = n * 2 + 1, fem = r.chance(.3);
    return { w, h, draw(g){ g.r(0, 0, w, h, BODY); for (let i = 0; i < n; i++) for (let j = 0; j < rows; j++) g.p(1 + 2*i, 1 + 2*j, fem ? HOLE : (i === 0 && j === 0 ? PAD : PADH)) } };
  },
  conn(r, mw, mh){
    if (mw < 6 || mh < 4) return null;
    const h = r.int(4, Math.min(mh, 7)), w = r.int(6, Math.min(mw, 18));
    // connector housings come black, or the white of a wire-to-board plug; a bare grey slab read as a placeholder
    const body = r.weighted([[BODY,2.6],[SILK,1.2]]);
    const lit = body === BODY ? BODYH : SILK, well = body === BODY ? BODYD : MARK;
    return { w, h, draw(g){
      if (h >= 5 && w >= 8){
        // a shrouded header: the wall, lit along its top, a well inside it, two rows of pins standing in the well, a key
        // notch in the top wall and the pin-one triangle in the corner
        g.r(0, 0, w, h, body); g.hl(0, 0, w, lit);
        g.r(1, 1, w - 2, h - 2, well);
        const mid = w >> 1; g.r(mid - 1, 0, 2, 1, well);
        for (let x = 2; x < w - 2; x += 2){ g.p(x, 2, METH); if (h >= 6) g.p(x, h - 3, METH); else g.p(x, 3, MET) }
        g.p(1, 1, PADH);
        return;
      }
      g.r(0, 0, w, h - 1, body); g.hl(0, 0, w, lit);
      for (let x = 1; x < w - 1; x += 2){ g.p(x, 1, well); if (h >= 4) g.p(x, 2, well); g.p(x, h - 1, PIN) }
    } };
  },
  usb(r, mw, mh){
    if (mw < 8 || mh < 4) return null;
    const w = r.int(8, Math.min(mw, 12)), h = r.int(4, Math.min(mh, 6));
    return { w, h, draw(g){ g.r(0, 0, w, h, METH); g.o(0, 0, w, h, MET); g.r(1, 1, w - 2, h - 2, BODY); g.hl(2, h >> 1, w - 4, MET) } };
  },
  sink(r, mw, mh){
    if (mw < 8 || mh < 8) return null;
    const w = r.int(8, Math.min(mw, 34)), h = r.int(8, Math.min(mh, 34)), vert = r.chance(.5);
    return { w, h, draw(g){
      g.r(0, 0, w, h, METD);
      if (vert){ for (let x = 1; x < w - 1; x++) g.vl(x, 1, h - 2, x % 2 ? METH : METD); g.hl(0, 0, w, MET); g.hl(0, h - 1, w, MET) }
      else { for (let y = 1; y < h - 1; y++) g.hl(1, y, w - 2, y % 2 ? METH : METD); g.vl(0, 0, h, MET); g.vl(w - 1, 0, h, MET) }
    }};
  },
  can(r, mw, mh){
    if (mw < 8 || mh < 6) return null;
    const w = r.int(8, Math.min(mw, 34)), h = r.int(6, Math.min(mh, 26));
    // an RF shield can: a pressed lid with a lip, its solder tabs down the sides, a smooth square in the middle where the
    // pick-and-place nozzle lifts it, the maker's mark etched on that, vent holes staggered round it, a dimpled corner
    const seed = r.u32();
    return { w, h, draw(g){
      const q = new Rng(seed);
      g.r(0, 0, w, h, METD);
      g.r(1, 1, w - 2, h - 2, MET); g.hl(1, 1, w - 2, METH); g.vl(1, 1, h - 2, METH); g.hl(1, h - 2, w - 2, METD); g.vl(w - 2, 1, h - 2, METD);
      for (let x = 3; x < w - 3; x += 4){ g.p(x, 0, PIN); g.p(x, h - 1, PIN) }
      for (let y = 3; y < h - 3; y += 4){ g.p(0, y, PIN); g.p(w - 1, y, PIN) }
      const pw = Math.max(4, Math.round(w * .38)), ph = Math.max(3, Math.round(h * .38)), px = Math.round((w - pw) / 2), py = Math.round((h - ph) / 2);
      for (let y = 3; y < h - 3; y += 3) for (let x = 3 + ((y / 3) & 1); x < w - 3; x += 3){ if (x >= px - 1 && x <= px + pw && y >= py - 1 && y <= py + ph) continue; g.p(x, y, METD) }
      g.r(px, py, pw, ph, METH); g.hl(px, py + ph - 1, pw, MET);
      if (pw >= 6 && ph >= 4) for (let y = py + 1; y < py + ph - 1; y += 2) textRuns(g, px + 1, y, px + pw - 1, METD, q);
      g.p(2, 2, METD); g.p(3, 2, METD); g.p(2, 3, METD);
    } };
  },
  coin(r, mw, mh){
    const lim = Math.min(mw, mh, 28); if (lim < 10) return null;
    const D = r.int(10, lim);
    return { w:D, h:D, draw(g){
      const c = D / 2, ci = Math.floor((D - 1) / 2), a = Math.max(1, Math.floor(D / 8));
      g.r(ci - 1, 0, 3, D, PIN); g.disc(c, c, c - .5, METH); g.ring(c, c, c - 2.4, c - 1.3, MET);
      g.hl(ci - a, ci, 2*a + 1, METD); g.vl(ci, ci - a, 2*a + 1, METD);
    }};
  },
  to220(r, mw, mh){
    const w = r.int(6, Math.min(mw, 10)), h = Math.round(w * 2); if (w < 6 || w > mw || h > mh) return null;
    return { w, h, norot:true, draw(g){
      const th = Math.round(h * .32), bh = Math.round(h * .4);
      g.r(0, 0, w, th, METH); g.hl(0, th - 1, w, MET); g.disc(w / 2, th * .5, Math.max(1, w * .18), HOLE);
      g.r(0, th, w, bh, BODY); g.hl(0, th, w, BODYH);
      for (const x of [1, w >> 1, w - 2]) g.vl(x, th + bh, h - th - bh, PIN);
    }};
  },
  to92(r, mw, mh){
    if (mw < 5 || mh < 6) return null;
    return { w:5, h:6, norot:true, draw(g){ g.r(1, 0, 3, 1, BODY); g.r(0, 1, 5, 2, BODY); g.hl(0, 2, 5, BODYH); g.vl(0, 3, 3, PIN); g.vl(2, 3, 3, PIN); g.vl(4, 3, 3, PIN) } };
  },
  label(r, mw, mh){
    if (mw < 7 || mh < 4) return null;
    const w = r.int(7, Math.min(mw, 20)), h = r.int(4, Math.min(mh, 9)), kind = r.pick(['bar','bar','text']), seed = r.u32();
    return { w, h, draw(g){
      const q = new Rng(seed); g.r(0, 0, w, h, METH);
      if (kind === 'bar'){ for (let x = 1; x < w - 1; x++) if (q.chance(.55)) g.vl(x, 1, h - 2, BODY) }
      else for (let y = 1; y < h - 1; y += 2) textRuns(g, 1, y, w - 1, BODY, q);
    }};
  },
  // Do-not-populate footprint: bare pads where a part was left off
  fp(r, mw, mh){
    const lim = Math.min(mw, mh, 16); if (lim < 6) return null;
    const D = r.int(6, lim), kind = r.pick(['qfn','soic','pair']);
    return { w:D, h:D, draw(g){
      if (kind === 'qfn'){ for (let i = 2; i < D - 2; i += 2){ g.p(i, 0, PAD); g.p(i, D - 1, PAD); g.p(0, i, PAD); g.p(D - 1, i, PAD) } const c = Math.floor(D * .3); g.r(c, c, D - 2*c, D - 2*c, PAD); g.p(0, 0, SILK) }
      else if (kind === 'soic'){ for (let i = 1; i < D - 1; i += 2){ g.vl(i, 0, 2, PAD); g.vl(i, D - 2, 2, PAD) } g.p(0, Math.floor(D / 2), SILK) }
      else { const pw = Math.max(1, Math.floor(D * .3)); g.r(0, 1, pw, D - 2, PAD); g.r(D - pw, 1, pw, D - 2, PAD); g.hl(pw + 1, 0, D - 2*pw - 2, SILK); g.hl(pw + 1, D - 1, D - 2*pw - 2, SILK) }
    }};
  },
  jumper(r, mw, mh){
    if (mw < 5 || mh < 3) return null;
    const closed = r.chance(.3);
    return { w:5, h:3, draw(g){ g.r(0, 0, 2, 3, PAD); g.r(3, 0, 2, 3, PAD); if (closed) g.p(2, 1, PADH) } };
  },
  // Meander antenna: a printed serpentine trace
  antenna(r, mw, mh){
    if (mw < 12 || mh < 6) return null;
    const w = r.int(12, Math.min(mw, 34)), h = r.int(6, Math.min(mh, 12));
    return { w, h, draw(g){
      g.hl(0, h - 1, 2, TR2); let up = true;
      for (let x = 1; x < w - 1; x += 2){ g.vl(x, 0, h, TR2); if (x + 2 < w - 1) up ? g.hl(x, 0, 3, TR2) : g.hl(x, h - 1, 3, TR2); up = !up }
      g.p(0, h - 1, PAD);
    }};
  },
  seg(r, mw, mh){
    let n = r.int(1, 4); while (n > 1 && n * 4 + 1 > mw) n--;
    const w = n * 4 + 1, h = 7; if (w > mw || h > mh) return null;
    const acc = r.pick([6, 6, 3, 0, 2]), k = r.pick([5, 6, 10, 12, 15, 20, 30]), seq = [];
    for (let i = 0; i < LOOP / k; i++) seq.push(Array.from({ length:n }, () => r.int(0, 9)));
    return { w, h, norot:true, draw(g){
      g.r(0, 0, w, h, BODY);
      const [x, y] = g.px(1, 1);
      g.B.segs.push({ x, y, s:g.s, n, lit:A(acc), unlit:BODYH, seq, k, idx:g.idx || 0 });
    }};
  },
  bar(r, mw, mh){
    const n = r.int(5, 12), w = n * 2 + 1, h = r.pick([3, 4, 5]); if (w > mw || h > mh) return null;
    const a = r.int(1, 3), b = r.int(4, 7), p1 = r.range(0, TAU), p2 = r.range(0, TAU);
    return { w, h, draw(g){
      g.r(0, 0, w, h, BODY); const cols = [], on = [], off = [];
      for (let i = 0; i < n; i++){ const f = i / n, ai = f < .6 ? 3 : f < .85 ? 2 : 6; g.capture(); g.vl(1 + 2*i, 1, h - 2, A(ai)); cols.push(Int32Array.from(g.take())); on.push(A(ai)); off.push(AD(ai)) }
      g.B.bars.push({ cols, on, off, n, a, b, p1, p2 });
    }};
  },
  fan(r, mw, mh){
    const lim = Math.min(mw, mh, 44); if (lim < 12) return null;
    const D = r.int(12, lim), frame = r.chance(.6) ? BODY : METD, blades = r.int(5, 9), m = r.int(1, 3) * (r.chance(.5) ? 1 : -1), twist = r.range(.5, 1.3);
    return { w:D, h:D, norot:true, draw(g){
      g.r(1, 0, D - 2, D, frame); g.r(0, 1, D, D - 2, frame);
      const hs = D >= 18 ? 2 : 1; for (const [x, y] of [[1,1],[D-1-hs,1],[1,D-1-hs],[D-1-hs,D-1-hs]]) g.r(x, y, hs, hs, HOLE);
      const c = D / 2, R = D / 2 - 1.2; g.disc(c, c, R, BODYD); g.ring(c, c, R - .9, R, frame === BODY ? BODYH : MET);
      const [cx, cy] = g.px(c, c);
      g.B.fans.push({ cx, cy, R:(R - 1) * g.s, hub:R * .3 * g.s, blades, m, twist });
    }};
  },
  // Display module: black glass on a carrier with its header pins
  screen(r, mw, mh){
    if (mw < 14 || mh < 10) return null;
    const w = r.int(14, Math.min(mw, 56)), h = Math.min(mh, r.int(Math.round(w * .5), Math.round(w * .75))); if (h < 10) return null;
    const scene = r.weighted([['scope',2],['bars',1.5],['term',2.2]]), ph = r.pick([3, 3, 0, 2]), seed = r.u32();
    return { w, h, norot:true, glow:true, draw(g){
      g.r(0, 0, w, h, BODYD); g.o(0, 0, w, h, BODYH);
      for (let x = 2; x < Math.min(w - 2, 12); x += 2) g.p(x, 1, PIN);
      const [x, y] = g.px(2, 3);
      g.B.screens.push({ x, y, w:(w - 4) * g.s, h:(h - 5) * g.s, s:g.s, scene, seed, ph });
    }};
  },
};

function blinkSpec(r){
  const t = r.weighted([['steady',3],['blink',3],['wink',2]]);
  if (t === 'steady') return { pat:[1], k:60, phase:0, chase:0 };
  if (t === 'blink'){ const k = r.pick([3, 5, 6, 10, 15]); return { pat:[1, 0], k, phase:r.int(0, 59), chase:r.chance(.5) ? r.int(1, 3) : 0 } }
  const k = r.pick([4, 5, 10, 20]); return { pat:r.chance(.5) ? [1, 0, 0] : [1, 1, 0], k, phase:r.int(0, 59), chase:r.chance(.5) ? k : 0 };
}

function addLed(g, cells, hi, accs, spec){
  const B = g.B; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (const i of cells){ const x = i % B.W, y = (i / B.W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  if (x1 < 0) return;
  const a0 = accs[0];
  // a lit LED: its colour, and a white glint where the light catches its dome, so it reads as a lamp and not a square
  const states = spec.pat.map(v => accs.length > 1 ? { c:A(accs[v]), h:SPK, g:AG(accs[v]) } : v ? { c:A(a0), h:SPK, g:AG(a0) } : { c:AD(a0), h:AD(a0), g:-1 });
  B.leds.push({ cells, hi, states, k:spec.k, phase:spec.phase + (g.idx || 0) * spec.chase, box:[x0, y0, x1, y1], hr:g.s, halo:null,
    off:{ c:AD(a0), h:AD(a0), g:-1 }, flash:{ c:AH(a0), h:SPK, g:AG(a0) } });
}

// a panel's back faces the wall, so it carries no displays: no screens and no digit readouts, only what works behind
// them. Lamps stay; real boards have status LEDs on both sides
const LISTS = {
  SMALL: [['smd',6],['sot',2],['led',2.2],['capTop',2],['btn',1.2],['soic',2.2],['res',1.6],['xtal',1],['ledrgb',1.2],['fp',.7],['header',.8],['conn',.8],['label',.3],['ind',.8],['to220',.4],['bar',.5],['qfp',1.4],['diode',.8],['to92',.5],['usb',.3],['bga',.3],['jumper',.7]],
  ARRAY: [['smd',3],['res',2.4],['led',2],['ledrgb',1.2],['btn',1],['capTop',1.6],['soic',1.6],['sot',1],['xtal',.6],['to220',.5],['fp',.6],['header',.4],['bar',.5],['qfp',.8],['ind',.6],['diode',.8]],
  FEATURE: [['qfp',3],['fan',1.4],['sink',1],['can',1],['toroid',1],['coin',.6],['ind',.8],['bga',1.2],['antenna',.8]],
};

// Each board in a panel gets a job; the job biases what it is made of.
const STYLES = {
  logic:  { zw:{ chip:1.5, bus:1.7, array:.9 }, bias:{ qfp:1.8, soic:2, bga:1.6, sot:1.3, xtal:1.4 } },
  dense:  { dens:.12, zw:{ pack:1.4, empty:.4 }, bias:{ smd:1.6, sot:1.4, led:1.2 } },
  chunky: { dens:-.06, s2:.55, s3:.25, zw:{ feature:1.6 }, bias:{ sink:2, can:1.8, ind:2, toroid:1.8, fan:1.6, coin:1.4 } },
  lights: { zw:{ array:1.7 }, bias:{ led:3, ledrgb:3, bar:2.6, seg:2.6, screen:2.2 } },
  power:  { zw:{ feature:1.4 }, bias:{ ind:3, toroid:2.6, coin:1.6, to220:3, sink:2, capTop:2.4 } },
};

function make(ctx, list, mw, mh, tries = 6){
  const L = ctx.lists[list];
  for (let t = 0; t < tries; t++){
    const type = ctx.r.weighted(L); const c = LIB[type](ctx.r, mw, mh);
    // a long, flat heat sink reads as a ribbon cable, and a panel has real ones
    if (c && ctx.panel && type === 'sink' && Math.max(c.w, c.h) > Math.min(c.w, c.h) * 1.6) continue;
    // and a fan too small to draw its blades is a grey smudge
    if (c && ctx.panel && type === 'fan' && Math.min(c.w, c.h) < 16) continue;
    if (c){ c.type = type; return c }
  }
  return null;
}

function drawComp(ctx, c, x, y, s, rot, idx){
  const w = (rot ? c.h : c.w) * s, h = (rot ? c.w : c.h) * s;
  ctx.B.reserve(x, y, w, h, 1);
  ctx.g.at(x, y, s, rot, c.w, c.h); ctx.g.idx = idx || 0; c.draw(ctx.g);
}

function noteSource(ctx, x, y, size){ if (ctx.board && size > (ctx.best || 0)){ ctx.best = size; ctx.board.src = [x + size / 2, y + size / 2] } }

// A trace walks unit steps; each unit is s one-pixel sub-steps of an s×s brush. Stops cleanly on contact.
function trace(ctx, x, y, s, steps, slot, o = {}){
  const B = ctx.B, W = B.W, occ = B.occ, own = B.own, bd = o.bounds;
  const bx0 = bd ? bd.x : 0, by0 = bd ? bd.y : 0, bx1 = bd ? bd.x + bd.w : B.W, by1 = bd ? bd.y + bd.h : B.H;
  const id = ++B.lanes, grace = o.grace ?? 0; const path = [];
  const ok = (nx, ny, clear) => {
    if (nx < bx0 || ny < by0 || nx + s > bx1 || ny + s > by1) return false;
    for (let yy = ny; yy < ny + s; yy++){ let i = yy * W + nx; for (let k = 0; k < s; k++, i++) if (occ[i] && own[i] !== id) return false }
    if (clear){
      const x0 = nx - 1, y0 = ny - 1, x1 = nx + s, y1 = ny + s;
      for (let yy = y0; yy <= y1; yy++){
        if (yy < 0 || yy >= B.H) continue;
        const edge = yy === y0 || yy === y1;
        for (let xx = x0; xx <= x1; xx += (edge ? 1 : x1 - x0)){ if (xx < 0 || xx >= W) continue; const i = yy * W + xx; if (occ[i] && own[i] !== id) return false }
      }
    }
    return true;
  };
  const put = (nx, ny) => { for (let yy = ny; yy < ny + s; yy++){ let i = yy * W + nx; for (let k = 0; k < s; k++, i++){ B.buf[i] = slot; occ[i] = 2; own[i] = id } } path.push(ny * W + nx) };
  if (!ok(x, y, grace <= 0)) return null;
  put(x, y); let cx = x, cy = y, n = 1;
  outer: for (const st of steps){ for (let k = 0; k < s; k++){ const nx = cx + st[0], ny = cy + st[1]; if (!ok(nx, ny, n >= grace)) break outer; cx = nx; cy = ny; put(cx, cy); n++ } }
  const res = { path, x:cx, y:cy, s, id, group:o.group || 0, done:n };
  if (path.length >= 6) B.paths.push(res);
  return res;
}

function via(ctx, cx, cy, s, id, dot){
  const B = ctx.B, W = B.W, x0 = cx - 1, y0 = cy - 1, d = s + 2;
  for (let y = y0; y < y0 + d; y++) for (let x = x0; x < x0 + d; x++){ if (x < 0 || y < 0 || x >= W || y >= B.H) return false; const i = y * W + x; if (B.occ[i] && B.own[i] !== id) return false }
  for (let y = y0; y < y0 + d; y++) for (let x = x0; x < x0 + d; x++){
    if (s >= 2 && (x === x0 || x === x0 + d - 1) && (y === y0 || y === y0 + d - 1)) continue;
    const i = y * W + x, inner = x >= cx && x < cx + s && y >= cy && y < cy + s;
    B.buf[i] = inner ? (dot ? PADH : HOLE) : PAD; B.occ[i] = 1;
  }
  return true;
}

function subdivide(ctx, x, y, w, h, depth, out){
  const { r, Z } = ctx, mx = Math.max(w, h);
  const stop = mx < Z * .9 || (mx < Z * 2.4 && r.chance(.42)) || (depth >= 2 && mx < Z * 4 && r.chance(.07));
  if (stop || mx < 12){ out.push({ x, y, w, h }); return }
  const vert = w > h * 1.25 ? true : h > w * 1.25 ? false : r.chance(.5);
  const gap = r.chance(ctx.gapP) ? r.int(1, 2) : 0, L = vert ? w : h, t = Math.round(L * r.range(.28, .72));
  if (vert){ subdivide(ctx, x, y, t, h, depth + 1, out); subdivide(ctx, x + t + gap, y, w - t - gap, h, depth + 1, out) }
  else { subdivide(ctx, x, y, w, t, depth + 1, out); subdivide(ctx, x, y + t + gap, w, h - t - gap, depth + 1, out) }
}

function fillZone(ctx, z){
  const r = ctx.r; if (z.w < 3 || z.h < 3) return;
  const big = Math.min(z.w, z.h); let s = 1;
  if (big >= 34 && r.chance(ctx.s2)) s = 2; if (big >= 70 && r.chance(ctx.s3)) s = 3;
  const uw = Math.floor(z.w / s), uh = Math.floor(z.h / s), mn = Math.min(uw, uh), mx = Math.max(uw, uh), zw = ctx.zw;
  const kind = r.weighted([
    // a board with its main chip down takes few other big ones: one centre of attention to a board
    ['chip', (mn >= 12 ? 3 : 0) * (zw.chip ?? 1) * (ctx.board?.hero ? .15 : 1)], ['feature', (mn >= 14 ? 2.3 : 0) * (zw.feature ?? 1)], ['array', (mn >= 4 ? 2.6 : 0) * (zw.array ?? 1)],
    ['bus', (mx >= 10 && mn >= 4 ? 1.1 : 0) * (zw.bus ?? 1)], ['pack', 2.6 * (zw.pack ?? 1)], ['pour', mn >= 6 && mx <= 48 ? .2 : 0], ['empty', ((1 - ctx.dens) * 3.5 + .15) * (zw.empty ?? 1)],
  ]);
  if (kind === 'chip') fillChip(ctx, z, s);
  else if (kind === 'feature') fillFeature(ctx, z, s);
  else if (kind === 'array') fillArray(ctx, z, s);
  else if (kind === 'bus') fillBus(ctx, z, 1);
  else if (kind === 'pour') fillPour(ctx, z);
  else if (kind === 'empty') fillEmpty(ctx, z);
  else fillPack(ctx, z, 1, s);
}

function escapes(ctx, x, y, N, s, bounds){
  const r = ctx.r, pl = N >= 20 ? 2 : 1, pins = [];
  for (let i = pl + 1; i < N - pl - 1; i += 2) pins.push(i);
  const slot = r.chance(.7) ? TR : TR2, group = ++ctx.B.groups;
  for (let side = 0; side < 4; side++){
    if (!r.chance(.82)) continue;
    const mode = r.weighted([['fan',3],['straight',1.2],['bend',1.5]]), every = r.chance(.3) ? 2 : 1;
    const use = pins.filter((_, k) => k % every === 0), n = use.length, half = n / 2;
    const base = r.int(1, 3), J = r.int(2, 7), bendDir = r.chance(.5) ? 1 : -1, stub = r.chance(.45);
    use.forEach((pin, k) => {
      let jog = 0, jogAt = 0;
      if (mode === 'fan'){ if (k < half){ jog = -J; jogAt = base + k } else { jog = J; jogAt = base + (n - 1 - k) } }
      else if (mode === 'bend'){ jog = bendDir * J; jogAt = base + (jog > 0 ? n - 1 - k : k) }
      const len = stub && r.chance(.6) ? jogAt + Math.abs(jog) + r.int(1, 6) : 400;
      const steps = [];
      for (let t = 0; t < len; t++){ const dv = jog && t >= jogAt && t < jogAt + Math.abs(jog) ? Math.sign(jog) : 0; steps.push(side === 0 ? [dv, -1] : side === 1 ? [1, dv] : side === 2 ? [dv, 1] : [-1, dv]) }
      const sx = side === 0 || side === 2 ? x + pin * s : side === 1 ? x + N * s : x - s;
      const sy = side === 1 || side === 3 ? y + pin * s : side === 0 ? y - s : y + N * s;
      const res = trace(ctx, sx, sy, s, steps, slot, { bounds, grace:s + 1, group });
      if (res && res.done >= 4 && len < 400 && r.chance(.8)) via(ctx, res.x, res.y, s, res.id, r.chance(.3));
    });
  }
}

// What the biggest chip on a panel says, in Morse
const LINES = ['ETHEREUM FOREVER', 'FROM ZERO TO A BILLION', 'THE SWARM IS WARMING', 'KEEP BUILDING', 'SURF CODE REPEAT',
  'IF IT ALL GOES UP YEEHAW IF IT DOESNT I HAD SOME FUN', 'THE SWARM NEVER SLEEPS', 'WE ARE EARLY', 'THE FUTURE IS ASYNC',
  'THE COMPANY IS THE NETWORK', 'A FACTORY THAT NEVER CLOSES', 'COMPANIES RUN BY THE SWARM', 'RUN THE DAEMON', 'AGENTS ALL THE WAY DOWN'].map((l) => l.split(' '));

// International Morse, letters and digits
const MORSE = { A:'.-', B:'-...', C:'-.-.', D:'-..', E:'.', F:'..-.', G:'--.', H:'....', I:'..', J:'.---', K:'-.-', L:'.-..', M:'--',
  N:'-.', O:'---', P:'.--.', Q:'--.-', R:'.-.', S:'...', T:'-', U:'..-', V:'...-', W:'.--', X:'-..-', Y:'-.--', Z:'--..',
  0:'-----', 1:'.----', 2:'..---', 3:'...--', 4:'....-', 5:'.....', 6:'-....', 7:'--...', 8:'---..', 9:'----.' };

// A status LED that blinks the holder's letters in Morse, IMD when they set none: beside the letters where they are
// etched, else beside the biggest board's main chip. Its on and off, one entry a unit: a dot is one, a dash three, a
// unit dark inside a letter, three between letters, seven before it starts over
function morseLed(ctx, text, big){
  const B = ctx.B, W = B.W;
  if (!big) return;
  const pat = [];
  for (const ch of text){ const code = MORSE[ch]; if (!code) continue; for (const m of code){ for (let k = 0; k < (m === '-' ? 3 : 1); k++) pat.push(1); pat.push(0) } pat.push(0, 0) }
  pat.push(0, 0, 0, 0);
  let box = null;
  if (B.letters?.cells.length){ let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; for (const i of B.letters.cells){ const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) } box = [x0, y0, x1, y1] }
  else if (big.hero && big.src){ const h = big.hero / 2; box = [big.src[0] - h, big.src[1] - h, big.src[0] + h, big.src[1] + h].map(Math.round) }
  if (!box) return;
  const [x0, y0, x1, y1] = box, my = Math.round((y0 + y1) / 2) - 1, mx = Math.round((x0 + x1) / 2) - 1;
  // a 3×3 lamp with its pads either side, clear of what it sits by
  const spots = [];
  for (const d of [7, 10, 14, 20]) spots.push([x1 + d, my], [x0 - d - 2, my], [mx, y1 + d], [mx, y0 - d - 2], [x1 + d, y0], [x1 + d, y1 - 2], [x0 - d - 2, y0], [x0 - d - 2, y1 - 2]);
  for (const [x, y] of spots){
    if (!B.free(x - 4, y - 3, 11, 9) || B.reg[y * W + x] < 2) continue;
    B.reserve(x - 3, y - 2, 9, 7, 1);
    for (let k = 0; k < 3; k++){ B.dot(x - 1, y + k, PIN); B.dot(x + 3, y + k, PIN) }
    const cells = [];
    for (let v = 0; v < 3; v++) for (let u = 0; u < 3; u++){ const c = (y + v) * W + x + u; B.buf[c] = AD(1); if (u || v) cells.push(c) }
    // the glow: a line of lit mask above and below it, between its pads
    const halo = [];
    for (const yy of [y - 1, y + 3]) for (let xx = x; xx <= x + 2; xx++) halo.push(yy * W + xx);
    B.morse = { pat, glint:y * W + x, cells:Int32Array.from(cells), halo:Int32Array.from(halo) };
    return;
  }
}

// Every board of a panel has its main chip, placed before anything else so nothing crowds it out: a QFP or a BGA about a
// third of the board's short side, somewhere off its middle, its pins fanning out
function heroChip(ctx, b, words = null){
  const B = ctx.B, r = new Rng(ctx.key + ':hero:' + b.k), M = Math.min(b.w, b.h), N = Math.round(clamp(M * r.range(.26, .34), 14, 44)), pad = Math.max(6, N >> 2);
  if (M < 50) return;
  for (let t = 0; t < 30; t++){
    const x = Math.round(b.x + b.w * r.range(.2, .8) - N / 2), y = Math.round(b.y + b.h * r.range(.22, .78) - N / 2);
    if (!B.free(x - pad, y - pad, N + 2 * pad, N + 2 * pad) || B.reg[y * B.W + x] !== 2 + b.k || B.reg[(y + N) * B.W + x + N] !== 2 + b.k) continue;
    const hctx = { ...ctx, r, lists:LISTS, dens:ctx.dens, board:b, best:0 };
    fillChip(hctx, { x:x - pad, y:y - pad, w:N + 2 * pad, h:N + 2 * pad }, 1, pad, words);
    if (hctx.best){ b.hero = hctx.best; return }
  }
}

function fillChip(ctx, z, s, margin = 0, morse = null){
  const { B, r } = ctx, uw = Math.floor(z.w / s), uh = Math.floor(z.h / s), mn = Math.min(uw, uh);
  // `margin`: a board's main chip, filling its zone but for that margin, always a QFP with its pins fanning out
  const m = margin || r.int(2, Math.max(2, Math.floor(mn * .28))), maxN = mn - 2 * m;
  if (maxN < 8) return fillPack(ctx, z, 1, 1);
  const c = margin ? LIB.qfp(r, maxN, maxN, { N:maxN, morse, quiet:!morse, blank:ctx.blank }) : r.chance(.82) ? LIB.qfp(r, maxN, maxN) : LIB.bga(r, maxN, maxN); if (!c) return fillPack(ctx, z, 1, 1);
  const N = c.w, x = z.x + Math.floor((uw - N) / 2) * s, y = z.y + Math.floor((uh - N) / 2) * s;
  if (!B.free(x - 1, y - 1, N * s + 2, N * s + 2)) return fillPack(ctx, z, 1, 1);
  B.reserve(x, y, N * s, N * s, 1); noteSource(ctx, x, y, N * s);
  // pin one: a silkscreen dot off the chip's corner, as every footprint carries
  if (B.free(x - 3, y - 3, 2, 2)) B.dot(x - 2, y - 2, SILK);
  if (c.pins) escapes(ctx, x, y, N, s, z);
  drawComp(ctx, c, x, y, s, 0);
  fillPack(ctx, z, .8, 1);
}

function fillFeature(ctx, z, s){
  const { B, r } = ctx, uw = Math.floor(z.w / s), uh = Math.floor(z.h / s);
  const m = r.int(1, 3), c = make(ctx, 'FEATURE', uw - 2 * m, uh - 2 * m, 8);
  if (!c) return fillPack(ctx, z, 1, s);
  const x = z.x + Math.floor((uw - c.w) / 2 + r.int(-1, 1) * Math.min(m - 1, 1)) * s, y = z.y + Math.floor((uh - c.h) / 2) * s;
  const gm = c.glow ? 2 * s : 0;
  if (!B.free(x - gm - 1, y - gm - 1, c.w * s + 2 * gm + 2, c.h * s + 2 * gm + 2)) return fillPack(ctx, z, 1, s);
  if (c.glow){ B.reserve(x - gm, y - gm, c.w * s + 2 * gm, c.h * s + 2 * gm, 3); B.glows.push({ x, y, w:c.w * s, h:c.h * s, m:gm }) }
  if (c.pins){ B.reserve(x, y, c.w * s, c.h * s, 1); noteSource(ctx, x, y, c.w * s); escapes(ctx, x, y, c.w, s, z) }
  drawComp(ctx, c, x, y, s, 0);
  fillPack(ctx, z, .8, 1);
}

function fillArray(ctx, z, s){
  const { B, r } = ctx, uw = Math.floor(z.w / s), uh = Math.floor(z.h / s);
  const gap = r.weighted([[1,3],[2,2],[3,1]]);
  const c = make(ctx, 'ARRAY', Math.max(2, Math.min(uw - 2, r.chance(.5) ? 10 : 18)), Math.max(2, Math.min(uh - 2, 18)));
  if (!c) return fillPack(ctx, z, 1, s);
  const rot = !c.norot && c.w !== c.h && r.chance(.45) ? 1 : 0, cw = rot ? c.h : c.w, ch = rot ? c.w : c.h;
  let cols = Math.floor((uw - 1 + gap) / (cw + gap)), rows = Math.floor((uh - 1 + gap) / (ch + gap));
  cols = Math.min(cols, r.int(2, 9)); rows = Math.min(rows, r.int(1, 6));
  while (cols * rows > 32) cols > rows ? cols-- : rows--;
  if (cols * rows < 2) return fillPack(ctx, z, 1, s);
  const tw = cols * cw + (cols - 1) * gap, th = rows * ch + (rows - 1) * gap;
  const ox = z.x + Math.floor((uw - tw) / 2) * s, oy = z.y + Math.floor((uh - th) / 2) * s;
  if (r.chance(.38)){
    const slot = r.chance(.6) ? TR : TR2, group = ++B.groups;
    if (rows > 1 && (cols === 1 || r.chance(.6))){ for (let j = 0; j < rows - 1; j++){ const yy = oy + ((j + 1) * (ch + gap) - gap + (gap >> 1)) * s; trace(ctx, z.x, yy, s, Array(uw).fill([1, 0]), slot, { bounds:z, grace:1e9, group }) } }
    else if (cols > 1){ for (let i = 0; i < cols - 1; i++){ const xx = ox + ((i + 1) * (cw + gap) - gap + (gap >> 1)) * s; trace(ctx, xx, z.y, s, Array(uh).fill([0, 1]), slot, { bounds:z, grace:1e9, group }) } }
  }
  let idx = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++){
    const x = ox + i * (cw + gap) * s, y = oy + j * (ch + gap) * s;
    if (B.free(x, y, cw * s, ch * s)) drawComp(ctx, c, x, y, s, rot, idx);
    idx++;
  }
  fillPack(ctx, z, .6, 1);
}

function fillPack(ctx, z, k, s = 1){
  const { B, r, dens } = ctx, uw = Math.floor(z.w / s), uh = Math.floor(z.h / s);
  if (uw < 2 || uh < 2) return;
  const tries = Math.round(z.w * z.h / (22 * s * s) * k * (.35 + dens * .9) * (ctx.panel ? .77 : 1)), bx1 = z.x + z.w, by1 = z.y + z.h;
  for (let t = 0; t < tries; t++){
    const lim = r.chance(.15) ? 20 : 9, c = make(ctx, 'SMALL', Math.min(uw, lim), Math.min(uh, lim), 3); if (!c) continue;
    const rot = !c.norot && r.chance(.4) ? 1 : 0, cw = rot ? c.h : c.w, ch = rot ? c.w : c.h; if (cw > uw || ch > uh) continue;
    const x = z.x + r.int(0, uw - cw) * s, y = z.y + r.int(0, uh - ch) * s;
    if (!B.free(x - 1, y - 1, cw * s + 2, ch * s + 2, z.x, z.y, bx1, by1)) continue;
    drawComp(ctx, c, x, y, s, rot);
    if (ctx.panel){ silkFrame(ctx, c.type, x, y, cw * s, ch * s); if (c.type === 'to220' || c.type === 'sot') decouple(ctx, z, x, y, cw * s, ch * s) }
    if (r.chance(.3)){
      const dx = r.chance(.5) ? 1 : 0, dy = 1 - dx, n = r.int(1, 4); let px = x, py = y;
      for (let i = 1; i <= n; i++){
        px += dx * (cw + 1) * s; py += dy * (ch + 1) * s;
        if (px + cw * s > bx1 || py + ch * s > by1 || !B.free(px - 1, py - 1, cw * s + 2, ch * s + 2, z.x, z.y, bx1, by1)) break;
        drawComp(ctx, c, px, py, s, rot, i);
      }
    }
  }
}

function fillBus(ctx, z, s){
  const { r } = ctx, horiz = z.w >= z.h ? r.chance(.85) : r.chance(.15);
  const U = Math.floor((horiz ? z.w : z.h) / s), V = Math.floor((horiz ? z.h : z.w) / s);
  if (U < 6 || V < 3) return fillPack(ctx, z, 1, s);
  let J = r.chance(.6) ? r.int(2, Math.max(2, Math.floor(V * .45))) * (r.chance(.5) ? 1 : -1) : 0;
  if (Math.abs(J) > V - 3) J = 0;
  const K = Math.max(1, Math.floor((V - 1 - Math.abs(J)) / 2)), n = r.int(Math.max(1, Math.ceil(K * .3)), Math.min(K, 12));
  const v0 = 1 + (J < 0 ? -J : 0) + r.int(0, K - n) * 2, base = r.int(1, Math.max(1, U - Math.abs(J) - n - 2));
  const slot = r.chance(.6) ? TR : TR2, alt = r.chance(.15), group = ++ctx.B.groups;
  for (let k = 0; k < n; k++){
    const v = v0 + k * 2, jogAt = J > 0 ? base + (n - 1 - k) : base + k;
    const t0 = r.chance(.25) ? r.int(1, 4) : 0, t1 = r.chance(.3) ? r.int(1, 6) : 0, end = U - 1 - t1;
    if (end - t0 < 4) continue;
    const steps = [];
    for (let t = t0; t < end; t++){ const dv = J && t >= jogAt && t < jogAt + Math.abs(J) ? Math.sign(J) : 0; steps.push(horiz ? [1, dv] : [dv, 1]) }
    const sx = horiz ? z.x + t0 * s : z.x + v * s, sy = horiz ? z.y + v * s : z.y + t0 * s;
    const res = trace(ctx, sx, sy, s, steps, alt && k % 2 ? (slot === TR ? TR2 : TR) : slot, { bounds:z, group });
    if (res && t1 && r.chance(.7)) via(ctx, res.x, res.y, s, res.id, r.chance(.3));
  }
  fillPack(ctx, z, .35, 1);
}

// Exposed copper: a heat-spreading pad, solid with stitching or cross-hatched
function fillPour(ctx, z){
  // a copper fill is a patch, never a slab: past a small zone it is only parts that go there
  if (Math.max(z.w, z.h) > 34) return fillPack(ctx, z, 1, 1);
  const { B, r } = ctx, W = B.W, hatch = r.chance(.5), st = r.int(4, 6);
  for (let y = z.y + 1; y < z.y + z.h - 1; y++) for (let x = z.x + 1; x < z.x + z.w - 1; x++){
    const i = y * W + x; if (B.occ[i]) continue;
    const edge = y === z.y + 1 || y === z.y + z.h - 2 || x === z.x + 1 || x === z.x + z.w - 2;
    if (hatch && !edge && (x + y) % 3 && (x - y + 999) % 3) continue;
    B.buf[i] = PAD; B.occ[i] = 1;
  }
  if (!hatch) for (let y = z.y + 3; y < z.y + z.h - 3; y += st) for (let x = z.x + 3 + ((y / st) & 1) * (st >> 1); x < z.x + z.w - 3; x += st){ if (B.buf[y * W + x] !== PAD) continue; B.buf[y * W + x] = HOLE; for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) if (B.buf[(y + dy) * W + x + dx] === PAD) B.buf[(y + dy) * W + x + dx] = PADD }
}

function fillEmpty(ctx, z){
  const { B, r } = ctx, W = B.W;
  if (r.chance(.28)) for (let y = z.y + 1; y < z.y + z.h; y += 4) for (let x = z.x + 1; x < z.x + z.w; x += 4){ const i = y * W + x; if (!B.occ[i] && B.buf[i] === BG) B.buf[i] = BG2 }
}

// The parts a footprint's outline is printed around on a panel's boards: corner marks, and a dot at pin one on a chip
const FRAMED = { soic:1, sot:1, qfp:1, bga:1, xtal:1, to220:1, to92:1, ind:1, capTop:1, header:1, conn:1, usb:1, btn:1, diode:1, fp:1 };
const CHIPS = { soic:1, sot:1, qfp:1, bga:1 };
function silkFrame(ctx, type, x, y, w, h){
  const B = ctx.B;
  if (!FRAMED[type] || Math.min(w, h) < 3 || w * h < 12) return;
  // only where the ring around it is bare, so a frame never runs into its neighbour's
  for (let yy = y - 2; yy < y + h + 2; yy++) for (let xx = x - 2; xx < x + w + 2; xx++){
    if (xx >= x && xx < x + w && yy >= y && yy < y + h) continue;
    if (xx < 0 || yy < 0 || xx >= B.W || yy >= B.H || B.occ[yy * B.W + xx] || B.reg[yy * B.W + xx] < 2) return;
  }
  const ax = Math.min(3, Math.max(1, w >> 2)), ay = Math.min(3, Math.max(1, h >> 2)), x0 = x - 1, y0 = y - 1, x1 = x + w, y1 = y + h;
  for (const [cx, sx] of [[x0, 1], [x1, -1]]) for (const [cy, sy] of [[y0, 1], [y1, -1]]){
    for (let k = 0; k <= ax; k++) B.dot(cx + sx * k, cy, SILK, 5);
    for (let k = 1; k <= ay; k++) B.dot(cx, cy + sy * k, SILK, 5);
  }
  if (CHIPS[type] && B.free(x0 - 3, y0 - 1, 3, 3)) B.dot(x0 - 2, y0, SILK, 5);
}

// A regulator is never alone: its input and output capacitors sit beside it
function decouple(ctx, z, x, y, w, h){
  const { B, r } = ctx, bx1 = z.x + z.w, by1 = z.y + z.h, n = r.int(2, 3);
  const right = r.chance(.5);
  let px = right ? x + w + 2 : x, py = right ? y : y + h + 2;
  for (let k = 0; k < n; k++){
    const c = r.chance(.6) ? LIB.smd(r, 3, 2) : LIB.capTop(r, 5, 5); if (!c) continue;
    if (px + c.w > bx1 || py + c.h > by1 || !B.free(px - 1, py - 1, c.w + 2, c.h + 2, z.x, z.y, bx1, by1)) break;
    drawComp(ctx, c, px, py, 1, 0);
    if (right) py += c.h + 2; else px += c.w + 2;
  }
}

// Each seat's test pad is wired to a part near it: the wire its signal leaves the pad on. Tries a few short routes, a
// diagonal run and a straight one in either order, to the nearest parts first; with no route, a stub out to a via.
function wirePads(ctx){
  const { B } = ctx, W = B.W, H = B.H, occ = B.occ, reg = B.reg;
  if (!B.probes) return;
  const r = new Rng(ctx.key + ':wire'), R = 34;
  for (const p of B.probes.values()){
    const px = p.x - 1, py = p.y - 1, v = 2 + p.k;
    // inside the pad's own keep-out, the cells around the pad (not the pad, not its number) are the wire's to use
    const mine = (x, y) => x >= px - 1 && x <= px + 4 && y >= py - 1 && y <= py + 5 && !(x >= px && x <= px + 3 && y >= py && y <= py + 3);
    const open = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1 && reg[y * W + x] === v && (!occ[y * W + x] || (mine(x, y) && B.buf[y * W + x] === BG));
    const roomy = (x, y) => { for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (occ[yy * W + xx] && !mine(xx, yy)) return false; return true };
    const targets = [];
    for (let y = Math.max(1, py - R); y < Math.min(H - 1, py + R); y++) for (let x = Math.max(1, px - R); x < Math.min(W - 1, px + R); x++){
      const i = y * W + x; if (occ[i] !== 1 || reg[i] !== v || mine(x, y) || (x >= px - 1 && x <= px + 12 && y >= py - 1 && y <= py + 5)) continue;
      if (B.buf[i] === BG || B.buf[i] === BG2) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!occ[(y + dy) * W + x + dx]) targets.push([x + dx, y + dy, Math.hypot(x - px, y - py)]);
    }
    // a wire long enough to see: parts a few cells off first, the ones touching the pad's box only if nothing else is in reach
    targets.sort((a, b) => (a[2] < 9) - (b[2] < 9) || a[2] - b[2]);
    const exits = r.shuffle([[px - 1, py + 1 + r.int(0, 1), -1, 0], [px + 1 + r.int(0, 1), py - 1, 0, -1], [px + 1 + r.int(0, 1), py + 4, 0, 1]]);
    let best = null;
    for (let ti = 0; ti < targets.length && ti < 240 && !best; ti += 3){
      const [ex, ey] = targets[ti];
      for (const [sx, sy, ox, oy] of exits){
        if (!open(sx, sy)) continue;
        // one step out of the pad first, then the route
        const fx = sx + ox, fy = sy + oy;
        for (const diagFirst of [true, false]){
          const cells = [[sx, sy], [fx, fy]];
          let x = fx, y = fy, dx = ex - x, dy = ey - y;
          const go = (n, mx, my) => { for (let k = 0; k < n; k++){ x += mx; y += my; cells.push([x, y]) } };
          const d = Math.min(Math.abs(dx), Math.abs(dy)), sx2 = Math.sign(dx), sy2 = Math.sign(dy);
          if (diagFirst){ go(d, sx2, sy2); go(Math.abs(ex - x) + Math.abs(ey - y), Math.sign(ex - x), Math.sign(ey - y)) }
          else { const st = Math.abs(dx) > Math.abs(dy) ? [Math.abs(dx) - d, sx2, 0] : [Math.abs(dy) - d, 0, sy2]; go(st[0], st[1], st[2]); go(d, sx2, sy2) }
          if (x !== ex || y !== ey || cells.length > 60) continue;
          const L = cells.length, seen = new Set();
          let ok = true;
          for (let k = 0; k < L && ok; k++){
            const [cx, cy] = cells[k], key = cy * W + cx;
            if (seen.has(key) || !open(cx, cy) || (k >= 2 && k < L - 2 && !roomy(cx, cy))) ok = false;
            seen.add(key);
          }
          if (ok){ best = cells; break }
        }
        if (best) break;
      }
    }
    if (!best){
      // a stub out of the pad to a via
      for (const [sx, sy, ox, oy] of exits){
        const cells = [[sx, sy]]; let x = sx, y = sy;
        for (let k = 0; k < 7; k++){ x += ox; y += oy; if (!open(x, y) || (k >= 1 && !roomy(x, y))) break; cells.push([x, y]) }
        if (cells.length >= 5){ best = cells; break }
      }
      if (!best) continue;
    }
    const id = ++B.lanes, path = [];
    for (const [x, y] of best){ const i = y * W + x; B.buf[i] = TR; occ[i] = 2; B.own[i] = id; path.push(i) }
    B.paths.push({ path, s:1, id, group:0 });
    const [lx, ly] = best[best.length - 1];
    if (best.length <= 8) via(ctx, lx, ly, 1, id, false);
  }
}

// The boards of a panel are wired to each other: a ribbon cable across the slot between two that sit side by side, its
// connector on each, enough of them that every board is reached. Planned before the boards are filled, so their parts
// keep clear; painted once the edges are, as the cable lies over everything.
function ribbons(ctx){
  const { B, r } = ctx, bs = B.boards, W = B.W, H = B.H, out = [];
  if (bs.length < 2) return out;
  const m = Math.max(2, Math.round(Math.min(W, H) / 150)), inset = m + 3, depth = 5, gapMax = B.panel.slot + 4;
  const up = bs.map((_, i) => i), find = (i) => up[i] === i ? i : (up[i] = find(up[i]));
  const pairs = [];
  for (const a of bs) for (const b of bs){
    if (a === b) continue;
    // a before b across the slot: side by side (across is x) or one above the other (across is y)
    for (const horiz of [true, false]){
      const ea = horiz ? a.x + a.w : a.y + a.h, sb = horiz ? b.x : b.y;
      if (sb < ea || sb - ea > gapMax) continue;
      const lo = Math.max(horiz ? a.y : a.x, horiz ? b.y : b.x) + inset + 4, hi = Math.min(horiz ? a.y + a.h : a.x + a.w, horiz ? b.y + b.h : b.x + b.w) - inset - 4;
      if (hi - lo >= 24) pairs.push({ a, b, horiz, ea, sb, lo, hi });
    }
  }
  for (const P of r.shuffle(pairs)){
    if (find(P.a.k) === find(P.b.k)) continue;
    const n = r.pick([4, 5, 6]), span = n + 4, { horiz, ea, sb } = P;
    const c0 = ea - inset - depth, c1 = sb + inset + depth;   // across: from the back of a's connector to the back of b's
    const at = (al, ac) => horiz ? ac >= 0 && al >= 0 && ac < W && al < H ? al * W + ac : -1 : al >= 0 && ac >= 0 && al < W && ac < H ? ac * W + al : -1;
    for (let tries = 0; tries < 12; tries++){
      const u = r.int(P.lo, Math.max(P.lo, P.hi - span));
      // never two cables in the same band across the panel
      let ok = !out.some((o) => o.horiz === horiz && Math.abs(o.u - u) < 36);
      // clear of the parts already down, and of the breakaway tabs across the slot
      for (let al = u - 1; al <= u + span && ok; al++) for (let ac = c0 - 1; ac <= c1; ac++){
        const i = at(al, ac); if (i < 0){ ok = false; break }
        if (ac >= ea && ac < sb){ if (B.reg[i]){ ok = false; break } continue }
        if (ac >= ea - m && ac < ea || ac >= sb && ac < sb + m) continue;
        if (B.occ[i]){ ok = false; break }
      }
      if (!ok) continue;
      for (let al = u - 1; al <= u + span; al++) for (let ac = c0 - 1; ac <= c1; ac++){ const i = at(al, ac); if (i >= 0 && B.reg[i] >= 2) B.occ[i] = ac >= c0 && ac < c0 + depth || ac > c1 - depth && ac <= c1 - 0 ? 1 : 4 }
      out.push({ horiz, u, n, span, c0, c1, at, depth });
      up[find(P.a.k)] = find(P.b.k);
      break;
    }
  }
  return out;
}
function paintRibbons(ctx, cables){
  const { B } = ctx;
  for (const C of cables){
    const { u, n, span, c0, c1, at, depth } = C, group = ++B.groups;
    // the connectors: a dark housing on each board, the pins showing at its back
    for (const [a0, a1] of [[c0, c0 + depth], [c1 - depth + 1, c1 + 1]]){
      for (let al = u; al < u + span; al++) for (let ac = a0; ac < a1; ac++){
        const i = at(al, ac); if (i < 0) continue;
        B.buf[i] = al === u || al === u + span - 1 || ac === a0 || ac === a1 - 1 ? BODYH : BODY;
      }
      const back = a0 === c0 ? c0 + 1 : c1 - 1;
      for (let al = u + 2; al < u + 2 + n; al += 2){ const i = at(al, back); if (i >= 0) B.buf[i] = PIN }
    }
    // the cable: grey wires side by side, the first one red, from one connector to the other over the slot
    for (let k = 0; k < n; k++){
      const al = u + 2 + k, path = [];
      for (let ac = c0 + 2; ac <= c1 - 2; ac++){ const i = at(al, ac); if (i < 0) continue; B.buf[i] = k === 0 ? A(6) : k & 1 ? METD : METH; path.push(i) }
      B.paths.push({ path, s:1, id:++B.lanes, group, cable:true });
    }
  }
}

const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];

function walkers(ctx){
  const { B, r } = ctx, W = B.W, H = B.H, tries = Math.round(B.N / 105);
  const clear = (nx, ny, id, px, py) => {
    if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) return false;
    for (let yy = ny - 1; yy <= ny + 1; yy++) for (let xx = nx - 1; xx <= nx + 1; xx++){
      const i = yy * W + xx; if (B.occ[i]) return false;
      if (B.own[i] === id && !(xx === px && yy === py) && !(xx === nx && yy === ny) && Math.abs(xx - px) + Math.abs(yy - py) > 2) return false;
    }
    return true;
  };
  const part = (x, y) => x >= 0 && y >= 0 && x < W && y < H && B.occ[y * W + x] === 1 && B.reg[y * W + x] >= 2;
  for (let t = 0; t < (ctx.panel ? tries * 4 : tries); t++){
    const x = r.int(2, W - 3), y = r.int(2, H - 3);
    if (!B.free(x - 1, y - 1, 3, 3)) continue;
    // on a panel a wire starts at a part's pin, two cells off, and leaves straight away from it
    let from = -1;
    if (ctx.panel){ for (const dd of [0, 2, 4, 6]) if (part(x - 2 * DX[dd], y - 2 * DY[dd])){ from = dd; break } if (from < 0) continue }
    const bundle = r.chance(.3), id = ++B.lanes;
    let d = from >= 0 ? from : r.pick([0, 2, 4, 6]), cx = x, cy = y, run = 0, diag = 0, turned = 0;
    const pts = from >= 0 ? [[x - DX[from], y - DY[from]], [cx, cy]] : [[cx, cy]], dirs = from >= 0 ? [from] : [];
    for (const [px, py] of pts) B.own[py * W + px] = id;
    const maxN = r.int(10, bundle ? 70 : 110);
    while (pts.length < maxN){
      if (d & 1){ if (--diag <= 0){ d = (d - turned * (bundle || r.chance(.7) ? 1 : -1) + 8) % 8; run = 0 } }
      else if (run >= 3 && r.chance(bundle ? .08 : .1)){ turned = r.chance(.5) ? 1 : -1; d = (d + turned + 8) % 8; diag = r.int(2, 9) }
      const cand = bundle ? [d] : [d, ...r.shuffle([(d + 1) % 8, (d + 7) % 8]), ...r.shuffle([(d + 2) % 8, (d + 6) % 8])];
      let moved = false;
      for (const dd of cand){
        const nx = cx + DX[dd], ny = cy + DY[dd];
        if (clear(nx, ny, id, cx, cy)){ if (dd !== d){ d = dd; run = 0; diag = (d & 1) ? r.int(2, 6) : 0; turned = 0 } cx = nx; cy = ny; pts.push([cx, cy]); dirs.push(d); B.own[cy * W + cx] = id; moved = true; break }
      }
      if (!moved) break;
      run++;
    }
    if (pts.length < 7) continue;
    // and ends where it meets something: a part or another wire, one cell ahead, or else a via
    let met = false;
    if (ctx.panel){
      const ax = cx + DX[d], ay = cy + DY[d], bx = ax + DX[d], by = ay + DY[d];
      if (ax > 0 && ay > 0 && ax < W - 1 && ay < H - 1 && !B.occ[ay * W + ax] && bx >= 0 && by >= 0 && bx < W && by < H){
        const o = B.occ[by * W + bx];
        if ((o === 1 || o === 2) && B.reg[by * W + bx] >= 2){ pts.push([ax, ay]); met = true }
      }
    }
    const slot = r.chance(.75) ? TR : TR2, group = bundle ? ++B.groups : 0;
    commitWalk(ctx, pts, slot, id, group, ctx.panel ? (met ? 0 : 1) : null, ctx.panel ? 0 : null);
    if (bundle) bundleCopies(ctx, pts, dirs, slot, group);
  }
}

function commitWalk(ctx, pts, slot, id, group, endVia = null, startVia = null){
  const B = ctx.B, W = B.W, path = [];
  for (const [x, y] of pts){ const i = y * W + x; B.buf[i] = slot; B.occ[i] = 2; B.own[i] = id; path.push(i) }
  B.paths.push({ path, s:1, id, group });
  const [ex, ey] = pts[pts.length - 1], [sx, sy] = pts[0];
  if (ctx.r.chance(endVia ?? .65)) via(ctx, ex, ey, 1, id, ctx.r.chance(.35));
  if (ctx.r.chance(startVia ?? .3)) via(ctx, sx, sy, 1, id, ctx.r.chance(.35));
}

// Parallel copies of a jog-only walk: the lane on the outside of each 45° jog turns first.
function bundleCopies(ctx, pts, dirs, slot, group){
  const { B, r } = ctx, W = B.W, H = B.H, h = dirs[0];
  if (h === undefined || (h & 1)) return;
  const n = r.int(1, 4), side = r.chance(.5) ? 1 : -1, vx = -DY[h], vy = DX[h];
  for (let k = 1; k <= n; k++){
    const sig = side * k, ox = pts[0][0] + vx * 2 * sig, oy = pts[0][1] + vy * 2 * sig;
    const local = dirs.map(dd => dd === h ? 0 : ((dd - h + 8) % 8 === 1 ? 1 : -1));
    const runs = []; for (let i = 0; i < local.length; i++){ if (local[i] && (i === 0 || local[i - 1] !== local[i])){ let j = i; while (j < local.length && local[j] === local[i]) j++; runs.push([i, j - i, local[i]]) } }
    const seq = new Array(local.length).fill(0);
    let okSeq = true;
    for (const [st, len, js] of runs){
      const toward = vx * DX[(h + js + 8) % 8] + vy * DY[(h + js + 8) % 8] > 0 ? 1 : -1;
      const ns = st - toward * sig; if (ns < 0 || ns + len > seq.length){ okSeq = false; break }
      for (let i = ns; i < ns + len; i++) seq[i] = js;
    }
    if (!okSeq) continue;
    const id = ++B.lanes; let cx = ox, cy = oy; const cells = [];
    const free1 = (x, y) => { if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false; for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++){ const i = yy * W + xx; if (B.occ[i] && B.own[i] !== id) return false } return true };
    if (!free1(cx, cy)) continue;
    cells.push([cx, cy]); B.own[cy * W + cx] = id;
    for (const js of seq){ const dd = (h + js + 8) % 8, nx = cx + DX[dd], ny = cy + DY[dd]; if (!free1(nx, ny)) break; cx = nx; cy = ny; cells.push([cx, cy]); B.own[cy * W + cx] = id }
    if (cells.length < 7) continue;
    commitWalk(ctx, cells, slot, id, group);
  }
}

function speckle(ctx){
  // a panel's boards leave room between their parts: under two fifths of the loose specks a lone board carries
  const { B, r, dens } = ctx, tries = Math.round(B.N / 9 * (.3 + dens * .7) * (ctx.panel ? .385 : 1)), W = B.W;
  for (let t = 0; t < tries; t++){
    const x = r.int(1, W - 4), y = r.int(1, B.H - 4), k = r.weighted([['via',1.2],['dot',1.6],['smd',4],['pair',1.4],['silk',.6]]);
    if (k === 'via'){ if (B.free(x - 1, y - 1, 5, 5)) via(ctx, x + 1, y + 1, 1, -1, r.chance(.3)) }
    else if (k === 'dot'){ if (B.free(x - 1, y - 1, 3, 3)) B.dot(x, y, r.pick([PAD, PADH, MARK, A(r.pick([0, 2, 3, 6])), PIN])) }
    else if (k === 'smd'){
      const v = r.chance(.4), body = r.pick([BODY, MET, A(4), BODY, PADD]), end = r.chance(.7) ? PIN : PAD;
      if (!v && B.free(x - 1, y - 1, 5, 3)){ B.dot(x, y, end); B.dot(x + 1, y, body); B.dot(x + 2, y, end) }
      else if (v && B.free(x - 1, y - 1, 3, 5)){ B.dot(x, y, end); B.dot(x, y + 1, body); B.dot(x, y + 2, end) }
    }
    else if (k === 'pair'){ if (B.free(x - 1, y - 1, 5, 3)){ B.dot(x, y, PAD); B.dot(x + 2, y, PAD) } }
    else if (B.free(x - 1, y - 1, 3, 3)) B.dot(x, y, SILK);
  }
}

function labels(ctx){
  const { B, r } = ctx, tries = Math.round(B.N / 1600);
  for (let t = 0; t < tries; t++){
    const str = r.chance(.7) ? r.pick(LABELS) + r.int(1, 99) : r.pick(WORDS), w = str.length * 4 - 1;
    const x = r.int(1, B.W - w - 2), y = r.int(1, B.H - 7);
    // every word on a board is real: the made-up part labels (R12, +5V) are no longer printed. The draws stay, so the
    // rest of every board is laid out as it was
    if (!B.free(x - 1, y - 1, w + 2, 7)) continue;
    r.chance(.9);
  }
}

// Copper pour under the mask on every open area, pulled back one pixel from everything else.
function pourPass(ctx){
  const { B } = ctx, W = B.W, H = B.H, occ = B.occ, reg = B.reg, buf = B.buf;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++){
    const i = y * W + x, v = reg[i]; if (occ[i] || v < 2 || !B.boards[v - 2].pour) continue;
    if (occ[i - W - 1] || occ[i - W] || occ[i - W + 1] || occ[i - 1] || occ[i + 1] || occ[i + W - 1] || occ[i + W] || occ[i + W + 1]) continue;
    buf[i] = POUR;
  }
  for (let y = 4; y < H - 4; y += 7) for (let x = 4 + ((y / 7) & 1) * 3; x < W - 4; x += 7){
    const i = y * W + x; if (buf[i] === POUR && buf[i - 1] === POUR && buf[i + 1] === POUR && buf[i - W] === POUR && buf[i + W] === POUR) buf[i] = TRD;
  }
}

function finalize(ctx){
  const { B, r } = ctx, W = B.W, H = B.H;
  for (const gb of B.glows){
    const m = gb.m;
    for (let y = gb.y - m; y < gb.y + gb.h + m; y++){
      if (y < 0 || y >= H) continue;
      for (let x = gb.x - m; x < gb.x + gb.w + m; x++){
        if (x < 0 || x >= W) continue; const i = y * W + x; if (B.occ[i] !== 3) continue;
        const dx = x < gb.x ? gb.x - x : x >= gb.x + gb.w ? x - gb.x - gb.w + 1 : 0, dy = y < gb.y ? gb.y - y : y >= gb.y + gb.h ? y - gb.y - gb.h + 1 : 0;
        B.buf[i] = Math.max(dx, dy) <= Math.ceil(m / 2) ? GLOW : GLOW2;
      }
    }
  }
  for (const L of B.leds){
    const [x0, y0, x1, y1] = L.box, hr = L.hr, halo = [];
    for (let y = y0 - hr; y <= y1 + hr; y++) for (let x = x0 - hr; x <= x1 + hr; x++){ if (x < 0 || y < 0 || x >= W || y >= H) continue; const i = y * W + x; if (!B.occ[i] && B.reg[i] >= 2) halo.push(i) }
    L.halo = halo.length ? Int32Array.from(halo) : null; L.cells = Int32Array.from(L.cells); L.hi = Int32Array.from(L.hi);
  }
  for (const F of B.fans){
    const idx = [], a = [];
    for (let y = Math.floor(F.cy - F.R); y <= Math.ceil(F.cy + F.R); y++) for (let x = Math.floor(F.cx - F.R); x <= Math.ceil(F.cx + F.R); x++){
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const dx = x + .5 - F.cx, dy = y + .5 - F.cy, d = Math.hypot(dx, dy); if (d > F.R) continue;
      const i = y * W + x; if (d < F.hub){ B.buf[i] = d < F.hub * .4 ? METH : BODYH; continue }
      idx.push(i); a.push(Math.atan2(dy, dx) / TAU * F.blades + F.twist * d / F.R);
    }
    F.idx = Int32Array.from(idx); F.a = Float32Array.from(a);
  }
  for (const S of B.screens){
    const q = new Rng(S.seed), dw = Math.floor(S.w / S.s), rowsN = q.pick([10, 12, 15, 20]);
    Object.assign(S, { wm:q.int(1, 3), wk:q.pick([1, 2, 3]), bars:Array.from({ length:32 }, () => [q.int(1, 4), q.range(0, TAU), q.int(2, 5), q.range(0, TAU)]),
      rowsN, lines:Array.from({ length:rowsN }, () => { const runs = []; let x = 0; const end = q.int(Math.floor(dw * .3), Math.max(2, dw - 2)); while (x < end){ const l = q.int(1, 4); runs.push([x, Math.min(l, end - x)]); x += l + q.int(1, 2) } return runs }) });
  }
  // where each board's power comes from, and how far every wire is from it
  const boardOf = (x, y) => { const v = B.reg[clamp(Math.round(y), 0, H - 1) * W + clamp(Math.round(x), 0, W - 1)]; return v >= 2 ? v - 2 : -1 };
  for (const b of B.boards){ if (!b.src) b.src = [b.x + b.w / 2, b.y + b.h / 2]; b.Rmax = 8 }
  const dist = (bk, x, y) => { const s = B.boards[bk].src; return Math.hypot(x - s[0], y - s[1]) };
  for (const p of B.paths){
    const i0 = p.path[0], i1 = p.path[p.path.length - 1], bk = boardOf(i0 % W, (i0 / W) | 0); p.bk = bk; if (bk < 0) continue;
    const d0 = dist(bk, i0 % W, (i0 / W) | 0), d1 = dist(bk, i1 % W, (i1 / W) | 0);
    p.fwd = d0 <= d1; p.base = Math.min(d0, d1); p.path = Int32Array.from(p.path);
    B.boards[bk].Rmax = Math.max(B.boards[bk].Rmax, p.base + p.path.length);
  }
  const place = (o, x, y) => { const bk = boardOf(x, y); o.bk = bk; o.d = bk >= 0 ? dist(bk, x, y) : 0; if (bk >= 0) B.boards[bk].Rmax = Math.max(B.boards[bk].Rmax, o.d) };
  for (const L of B.leds) place(L, (L.box[0] + L.box[2]) / 2, (L.box[1] + L.box[3]) / 2);
  for (const F of B.fans) place(F, F.cx, F.cy);
  for (const S of B.screens) place(S, S.x + S.w / 2, S.y + S.h / 2);
  for (const S of B.segs) place(S, S.x, S.y);
  for (const Bg of B.bars){ const i = Bg.cols[0][0]; place(Bg, i % W, (i / W) | 0) }
  if (B.letters){
    const bk = B.letters.bk, ds = B.letters.cells.map(i => dist(bk, i % W, (i / W) | 0)), ord = ds.map((_, i) => i).sort((a, b) => ds[a] - ds[b]);
    B.letters.cells = Int32Array.from(ord.map(i => B.letters.cells[i])); B.letters.ds = Float32Array.from(ord.map(i => ds[i]));
  }
  const tail = Math.round(clamp(Math.min(W, H) * .1, 14, 80));
  for (const b of B.boards) b.wave = { k:r.weighted([[2, 3], [3, 1.4]]), ph:r.next(), tail };
  // a few data packets on top of the wave
  const groups = new Map();
  for (const p of B.paths){
    if (p.bk < 0 || p.path.length < 10) continue;
    let on, off, v;
    // how much runs is how busy the holder's seats are: ctx.traffic, 1 for a board that does not know
    const T = ctx.traffic ?? 1;
    if (p.group){ let gr = groups.get(p.group); if (!gr){ gr = { on:r.next() < Math.min(.85, .16 * T), off:r.int(0, 9999), v:r.int(2, 4), k:0, lag:r.int(0, 2) }; groups.set(p.group, gr) } on = gr.on; off = gr.off + (gr.k++) * gr.lag; v = gr.v }
    else { on = r.next() < Math.min(.6, .07 * T); off = r.int(0, 9999); v = r.int(2, 5) }
    if (!on) continue;
    const s = p.s, tl = r.int(3, 6) * s, P = p.path.length;
    v = Math.max(v * s, Math.ceil((P + tl) / LOOP));
    const Lt = v * LOOP, m = Math.max(1, Math.min(3, Math.floor(Lt / (P + tl + 12))));
    B.pulses.push({ path:p.path, s, tail:tl, v, Lt, m, C:Lt / m, off:off % Lt });
  }
}

// A board fills its whole box. Its job (logic, dense, chunky, lights, power) decides what it is made of.
function generate(seed, W, H, dens, keep = null, mounts = null, letters = null){
  const r = new Rng(seed), B = new Board(W, H), g = new G(B), b = { k:0, x:0, y:0, w:W, h:H };
  B.boards = [b]; B.reg.fill(2);
  const style = r.weighted([['logic',3],['dense',2.4],['chunky',1.5],['lights',1.4],['power',1.2]]), S = STYLES[style];
  const lists = {}; for (const [name, list] of Object.entries(LISTS)) lists[name] = list.map(([t, w]) => [t, w * (S.bias[t] ?? 1)]);
  const d = clamp(dens + (S.dens || 0), .05, 1);
  const ctx = { B, r, g, dens:d, Z:96 - 50 * d, gapP:.3 + (1 - d) * .5, lists, zw:S.zw, s2:S.s2 ?? .3, s3:S.s3 ?? .14, board:b, best:0 };
  b.style = style; b.pour = r.chance(.62);
  B.buf.fill(BG);
  // what the board keeps clear before anything is placed: its mounting holes, and the title block, which the parts
  // and the traces then grow around as they would on a board laid out by hand
  const holds = [];
  if (W >= 60 && H >= 60) for (const [cx, cy] of [[5, 5], [W - 6, 5], [5, H - 6], [W - 6, H - 6]]) holds.push({ x:cx - 4, y:cy - 4, w:9, h:9, hole:[cx, cy] });
  if (keep) for (const r of keep.rects ?? [keep]) holds.push({ x:r.x, y:r.y, w:r.w, h:r.h });
  // behind every pane of glass on the front, mirrored as the back is, the chip that drives it
  // the holder's letters, etched first so everything else is laid out around them
  const etched = letters ? etch(B, letters) : null;
  const clear = etched ? [...holds, etched] : holds;
  const drives = (mounts ?? []).filter((m) => m.w >= 6 && m.h >= 4 && !clear.some((k) => m.x < k.x + k.w + 2 && m.x + m.w > k.x - 2 && m.y < k.y + k.h + 2 && m.y + m.h > k.y - 2));
  for (const k of holds) B.reserve(k.x - 2, k.y - 2, k.w + 4, k.h + 4, 1);
  let zones = []; subdivide(ctx, 0, 0, W, H, 0, zones);
  for (const k of [...clear, ...drives]) zones = zones.flatMap((z) => around(z, k.x - 2, k.y - 2, k.w + 4, k.h + 4));
  for (const m of drives) driver(ctx, m);
  for (const z of zones) fillZone(ctx, z);
  for (const k of holds){
    if (k.hole) mountHole(B, k.hole[0], k.hole[1]);
  }
  if (keep) B.plateLamps = keep.draw(B);
  walkers(ctx); labels(ctx); speckle(ctx); pourPass(ctx); finalize(ctx);
  return B;
}

// the face the letters are etched in: 5×7, big enough that M is not H and D is not O
const ETCH = {'A':'01110100011000111111100011000110001','B':'11110100011000111110100011000111110','C':'01110100011000010000100001000101110','D':'11100100101000110001100011001011100','E':'11111100001000011110100001000011111','F':'11111100001000011110100001000010000','G':'01110100011000010111100011000101111','H':'10001100011000111111100011000110001','I':'01110001000010000100001000010001110','J':'00111000100001000010000101001001100','K':'10001100101010011000101001001010001','L':'10000100001000010000100001000011111','M':'10001110111010110101100011000110001','N':'10001100011100110101100111000110001','O':'01110100011000110001100011000101110','P':'11110100011000111110100001000010000','Q':'01110100011000110001101011001001101','R':'11110100011000111110101001001010001','S':'01111100001000001110000010000111110','T':'11111001000010000100001000010000100','U':'10001100011000110001100011000101110','V':'10001100011000110001100010101000100','W':'10001100011000110101101011010101010','X':'10001100010101000100010101000110001','Y':'10001100011000101010001000010000100','Z':'11111000010001000100010001000011111','0':'01110100011001110101110011000101110','1':'00100011000010000100001000010001110','2':'01110100010000100010001000100011111','3':'11111000100010000010000011000101110','4':'00010001100101010010111110001000010','5':'11111100001111000001000011000101110','6':'00110010001000011110100011000101110','7':'11111000010001000100010000100001000','8':'01110100011000101110100011000101110','9':'01110100011000101111000010001001100'};

// the two faces letters are etched in: the 5×7 for any board with room for it, the 3×5 the silkscreen uses for the least
const ETCH_FACE = { glyphs:ETCH, w:5, h:7, adv:6 }, SMALL_FACE = { glyphs:FONT, w:3, h:5, adv:4 };

/** A holder's letters as dots of a face at k board pixels a dot, thickened a little when the dots are big, so strokes read bold. */
function letterMask(text, face, k){
  const n = text.length, w = (n * face.adv - 1) * k, h = face.h * k, dots = new Uint8Array(w * h), mask = new Uint8Array(w * h);
  [...text].forEach((ch, i) => { const gl = face.glyphs[ch]; if (!gl) return; for (let j = 0; j < face.w * face.h; j++) if (gl[j] === '1') for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) dots[(((j / face.w) | 0) * k + dy) * w + (i * face.adv + (j % face.w)) * k + dx] = 1 });
  const bold = Math.floor(k * 0.22);
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++){
    if (dots[v * w + u]){ mask[v * w + u] = 1; continue }
    for (let dv = -bold; dv <= bold && !mask[v * w + u]; dv++) for (let du = -bold; du <= bold; du++){ const uu = u + du, vv = v + dv; if (du * du + dv * dv <= bold * bold && uu >= 0 && vv >= 0 && uu < w && vv < h && dots[vv * w + uu]){ mask[v * w + u] = 1; break } }
  }
  return { w, h, k, mask };
}

/**
 * A holder's hallmark, as a silversmith strikes their initials into a small plate: the letters cut through a gold plate
 * with clipped corners, so the board's mask shows through them. Its size around the letters, at k board pixels a dot.
 */
function hallmark(text, face, k){
  const m = letterMask(text, face, k), small = face === SMALL_FACE;
  const px = small ? 1 : k + 1, py = small ? 1 : Math.max(2, k);
  return { w:m.w + 2 * px, h:m.h + 2 * py, px, py, m, cut:small ? 1 : Math.max(1, Math.ceil(k / 2) + 1) };
}

/** The hallmark struck at x, y: lit along its top and left, shaded along its bottom and right, the letters open to the mask. */
function strike(B, x, y, hm, cells){
  const { w, h, px, py, m, cut } = hm;
  const plate = (u, v) => u >= 0 && v >= 0 && u < w && v < h && Math.min(u, w - 1 - u) + Math.min(v, h - 1 - v) >= cut;
  const letter = (u, v) => { const lu = u - px, lv = v - py; return lu >= 0 && lv >= 0 && lu < m.w && lv < m.h && m.mask[lv * m.w + lu] };
  const shade = h >= 9;
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++){
    if (!plate(u, v)) continue;
    if (letter(u, v)){ B.dot(x + u, y + v, BG, 5); continue }
    let c = PAD;
    if (shade){ if (!plate(u, v - 1) || !plate(u - 1, v)) c = PADH; else if (!plate(u, v + 1) || !plate(u + 1, v)) c = PADD }
    B.dot(x + u, y + v, c, 5); cells.push((y + v) * B.W + x + u);
  }
}

/**
 * Where a board's hallmark goes when no title block carries it (the whole wall turned over, or a board too small for
 * one): centred, never more than two board pixels a dot, so it reads as a mark struck on the board rather than a sign
 * across it. A board too small for one pixel a dot of the 5×7 face takes the 3×5 one; one too small for that carries none.
 */
function placeLetters(W, H, text){
  if (!text) return null;
  for (const k of [2, 1]){
    const hm = hallmark(text, ETCH_FACE, k);
    if (hm.w <= W * 0.62 && hm.h <= H * 0.5) return { x:Math.round((W - hm.w) / 2), y:Math.round((H - hm.h) / 2), w:hm.w, h:hm.h, hm };
  }
  const hm = hallmark(text, SMALL_FACE, 1);
  if (hm.w > W - 2 || hm.h > H - 2) return null;
  return { x:Math.round((W - hm.w) / 2), y:Math.round((H - hm.h) / 2), w:hm.w, h:hm.h, hm };
}

/** The hallmark alone, struck in a moat of bare mask the traces route around. */
function etch(B, L){
  const { x, y, w, h, hm } = L, W = B.W, cells = [], moat = Math.max(1, Math.round(hm.m.k / 2));
  for (let v = -moat; v < h + moat; v++) for (let u = -moat; u < w + moat; u++){
    const gx = x + u, gy = y + v; if (gx < 0 || gy < 0 || gx >= W || gy >= B.H || B.occ[gy * W + gx]) continue;
    B.occ[gy * W + gx] = 4;
  }
  strike(B, x, y, hm, cells);
  B.letters = { cells, bk:0 };
  return { x, y, w, h };
}

// a readout's segments on a 4×7 grid, a gap at every corner as a real one has: a b c d e f g
const SEG8 = [[[1,0],[2,0]], [[3,1],[3,2]], [[3,4],[3,5]], [[1,6],[2,6]], [[0,4],[0,5]], [[0,1],[0,2]], [[1,3],[2,3]]];

/** The title block on a board too short for the full one: holder, part number and the seat lamps on one line. */
function stripBlock(W, H, name, code, seats, text = ''){
  const pad = 3, tw = (str) => str.length * 4 - 1;
  const lm = text ? hallmark(text, H - 8 >= 11 ? ETCH_FACE : SMALL_FACE, 1) : null;
  let per = Math.min(seats.length, 12), parts = { name:true, code:true };
  const width = () => 2 * pad + [lm ? lm.w : -1, parts.name ? tw(name) : -1, parts.code ? tw(code) : -1, per ? per * 4 - 1 : -1].filter((v) => v >= 0).reduce((a, v, i) => a + v + (i ? 6 : 0), 0);
  // the least needed goes first: the lamps, then the part number, then the holder; the letters stay
  if (width() > W - 20) per = 0;
  if (width() > W - 20) parts.code = false;
  if (width() > W - 20) parts.name = false;
  const w = width(), h = Math.max(2 * pad + 5, lm ? lm.h : 0);
  if ((!lm && !parts.name) || w > W - 20 || h > H - 8) return null;
  const x = Math.round((W - w) / 2), y = Math.round((H - h) / 2);
  return { x, y, w, h, draw(B){
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) B.dot(xx, yy, BG);
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w - 1, y, -1, 1], [x, y + h - 1, 1, -1], [x + w - 1, y + h - 1, -1, -1]]) for (let k = 0; k < 3; k++){ B.dot(cx + sx * k, cy, SILK); B.dot(cx, cy + sy * k, SILK) }
    const text5 = (tx, ty, str, c) => [...str].forEach((ch, k) => { const gl = FONT[ch]; if (gl) for (let j = 0; j < 15; j++) if (gl[j] === '1') B.dot(tx + k * 4 + (j % 3), ty + ((j / 3) | 0), c) });
    let cx = x + pad;
    const mid = y + Math.round((h - 5) / 2);
    if (lm){ const cells = []; strike(B, cx, y + Math.round((h - lm.h) / 2), lm, cells); B.letters = { cells, bk:0 }; cx += lm.w + 6 }
    if (parts.name){ text5(cx, mid, name, SILK); cx += tw(name) + 6 }
    if (parts.code){ text5(cx, mid, code, PAD); cx += tw(code) + 6 }
    const lamps = [];
    seats.slice(0, per).forEach((v, k) => {
      const lx = cx + k * 4, ly = mid + 1, cells = [];
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++){ const edge = dx !== 1 || dy !== 1; B.dot(lx + dx, ly + dy, v ? (edge ? A(3) : AH(3)) : (edge ? BODYD : MARK)); if (v) cells.push((ly + dy) * B.W + lx + dx) }
      if (v === 2) lamps.push(Int32Array.from(cells));
    });
    return lamps;
  }};
}

/** A zone with a kept rectangle cut out of it: the strips of it either side, above and below. */
function around(z, x, y, w, h){
  if (x >= z.x + z.w || x + w <= z.x || y >= z.y + z.h || y + h <= z.y) return [z];
  const out = [], x1 = x + w, y1 = y + h, zx1 = z.x + z.w, zy1 = z.y + z.h;
  if (y > z.y) out.push({ x:z.x, y:z.y, w:z.w, h:y - z.y });
  if (y1 < zy1) out.push({ x:z.x, y:y1, w:z.w, h:zy1 - y1 });
  const my = Math.max(y, z.y), mh = Math.min(y1, zy1) - my;
  if (x > z.x) out.push({ x:z.x, y:my, w:x - z.x, h:mh });
  if (x1 < zx1) out.push({ x:x1, y:my, w:zx1 - x1, h:mh });
  return out.filter((q) => q.w >= 3 && q.h >= 3);
}

/** The chip that drives a pane of glass on the front: a square one behind a square screen, a long one behind a strip. */
function driver(ctx, m){
  const { B, r } = ctx, long = m.w >= m.h * 1.8 || m.h >= m.w * 1.8;
  const c = long ? LIB.soic(r, m.w, Math.min(m.h, 10)) : LIB.qfp(r, Math.min(m.w, m.h), Math.min(m.w, m.h));
  if (!c) return;
  const rot = long && m.h > m.w ? 1 : 0, cw = rot ? c.h : c.w, ch = rot ? c.w : c.h;
  if (cw > m.w || ch > m.h) return;
  const x = m.x + Math.floor((m.w - cw) / 2), y = m.y + Math.floor((m.h - ch) / 2);
  B.reserve(x, y, cw, ch, 1);
  if (c.pins && !long) escapes(ctx, x, y, c.w, 1, { x:m.x - 6, y:m.y - 6, w:m.w + 12, h:m.h + 12 });
  drawComp(ctx, c, x, y, 1, rot);
}

/**
 * The panes of glass in a picture of a panel's front, as rectangles on its board of W×H, mirrored left to right as
 * the back of a thing is. Glass is the near-black of a screen; the picture is read in blocks, and a run of blocks
 * that are nearly all glass is a pane.
 */
export function glassOf(data, iw, ih, sx, sy, sw, sh, W, H){
  const bs = Math.max(2, Math.round(Math.min(sw, sh) / 40)), cols = Math.floor(sw / bs), rows = Math.floor(sh / bs);
  if (cols < 3 || rows < 3) return [];
  const g = new Uint8Array(cols * rows);
  for (let by = 0; by < rows; by++) for (let bx = 0; bx < cols; bx++){
    let dark = 0, n = 0;
    for (let y = sy + by * bs; y < sy + (by + 1) * bs; y += 1) for (let x = sx + bx * bs; x < sx + (bx + 1) * bs; x += 1){
      const i = (y * iw + x) * 4; n++;
      if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] < 15) dark++;
    }
    g[by * cols + bx] = dark > n * 0.6 ? 1 : 0;
  }
  const out = [], seen = new Uint8Array(cols * rows);
  for (let i = 0; i < g.length; i++){
    if (!g[i] || seen[i]) continue;
    let x0 = cols, y0 = rows, x1 = 0, y1 = 0, n = 0; const st = [i]; seen[i] = 1;
    while (st.length){
      const j = st.pop(), x = j % cols, y = (j / cols) | 0; n++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ const nx = x + dx, ny = y + dy, k = ny * cols + nx; if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && g[k] && !seen[k]){ seen[k] = 1; st.push(k) } }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw < 3 || bh < 3 || n < bw * bh * 0.7) continue;
    const kx = W / cols, ky = H / rows;
    out.push({ x:Math.round(W - (x1 + 1) * kx), y:Math.round(y0 * ky), w:Math.round(bw * kx), h:Math.round(bh * ky) });
  }
  return out;
}

/** A plated mounting hole: a copper ring, the drill through it, a ring of vias. */
function mountHole(B, cx, cy){
  for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++){
    const d = Math.hypot(x - cx, y - cy);
    if (d <= 1.9) B.dot(x, y, HOLE); else if (d <= 3.2) B.dot(x, y, d <= 2.5 ? PADH : PAD); else if (d <= 4.3 && (x + y) % 3 === 0) B.dot(x, y, PADD);
  }
}

/**
 * The title block a holder's board carries, laid out in board pixels: who holds it in white, its part number in
 * copper, a lamp for each seat (lit when its agent is active, blinking while it works), the count of them, and a
 * seven-segment readout of the jobs passed with the failed beside it. Returns the size and a drawer, or null when the
 * board is too small to carry it.
 */
function titleBlock(W, H, info, text = ''){
  // every field at a fixed width, so the block, and so the whole board laid out around it, is the same whatever it says:
  // a holder's ENS or address, today's count or next year's; only the seats, which shape the panel too, size it
  const fix = (v, n) => String(v).toUpperCase().slice(0, n).padEnd(n, ' ');
  const name = fix(info.name, 14), code = fix(info.code, 14), seats = info.seats.slice(0, 50);
  const count = `${seats.length} ${seats.length === 1 ? 'SEAT' : 'SEATS'}  ${String(seats.filter((v) => v).length).padStart(String(seats.length).length, ' ')} ACTIVE`;
  const passed = Math.min(999999, info.passed | 0), digits = String(passed).padStart(6, ' ');
  const failed = `${String(Math.min(99999, info.failed | 0)).padStart(5, ' ')} FAILED`;
  const tw = (str) => str.length * 4 - 1, pad = 4, per = 25;
  const ledRows = Math.ceil(seats.length / per), ledW = Math.min(seats.length, per) * 4 - 1;
  const roW = digits.length * 10 + 2, sideW = Math.max(tw('PASSED'), tw(failed));
  const sw = 2 * pad + Math.max(tw(name), tw(code), ledW, tw(count), roW + 4 + sideW);
  const sh = 2 * pad + 5 + 3 + 5 + 5 + ledRows * 4 + 2 + 5 + 5 + 18;
  // the hallmark and the stats as one lockup, top-aligned: beside them where the board is wide, above them where it is
  // tall; at two board pixels a dot the plate is the readout's height, at one where that is all there is room for; a
  // short board takes a strip
  let hm = null, beside = true;
  for (const k of text ? [2, 1] : []){
    const c = hallmark(text, ETCH_FACE, k);
    if (c.w + 6 + sw <= W - 20 && sh <= H - 16 && c.h <= sh){ hm = c; beside = true; break }
    if (Math.max(c.w, sw) <= W - 20 && c.h + 5 + sh <= H - 16){ hm = c; beside = false; break }
  }
  if ((text && !hm) || sw > W - 20 || sh > H - 16) return stripBlock(W, H, name, code, seats, text);
  const w = hm ? (beside ? hm.w + 6 + sw : Math.max(hm.w, sw)) : sw, h = hm ? (beside ? sh : hm.h + 5 + sh) : sh;
  const x = Math.round((W - w) / 2), y = Math.round((H - h) / 2);
  const x0 = hm && beside ? x + hm.w + 6 : x, y0 = hm && !beside ? y + hm.h + 5 : y;
  const rects = [{ x:x0, y:y0, w:sw, h:sh }, ...(hm ? [{ x, y, w:hm.w, h:hm.h }] : [])];
  return { x, y, w, h, rects, draw(B){
    // the stats on bare mask with a courtyard's corner marks, as silkscreen frames a part, rather than a drawn box
    const x = x0, y = y0, w = sw, h = sh;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) B.dot(xx, yy, BG);
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w - 1, y, -1, 1], [x, y + h - 1, 1, -1], [x + w - 1, y + h - 1, -1, -1]]) for (let k = 0; k < 5; k++){ B.dot(cx + sx * k, cy, SILK); B.dot(cx, cy + sy * k, SILK) }
    if (hm){ const cells = []; strike(B, rects[1].x, rects[1].y, hm, cells); B.letters = { cells, bk:0 } }
    const text = (tx, ty, str, c) => [...str].forEach((ch, k) => { const gl = FONT[ch]; if (gl) for (let j = 0; j < 15; j++) if (gl[j] === '1') B.dot(tx + k * 4 + (j % 3), ty + ((j / 3) | 0), c) });
    let cy = y + pad;
    text(x + pad, cy, name, SILK); cy += 8;
    text(x + pad, cy, code, PAD); cy += 10;
    const lamps = [];
    seats.forEach((v, k) => {
      const lx = x + pad + (k % per) * 4, ly = cy + Math.floor(k / per) * 4, cells = [];
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++){ const edge = dx !== 1 || dy !== 1; B.dot(lx + dx, ly + dy, v ? (edge ? A(3) : AH(3)) : (edge ? BODYD : MARK)); if (v) cells.push((ly + dy) * B.W + lx + dx) }
      if (v === 2) lamps.push(Int32Array.from(cells));
    });
    cy += ledRows * 4 + 2;
    text(x + pad, cy, count, SILK); cy += 10;
    // the readout: black glass, unlit segments a ghost, the lit ones the lamp's colour
    const rx = x + pad, ry = cy;
    for (let yy = ry; yy < ry + 18; yy++) for (let xx = rx; xx < rx + roW; xx++) B.dot(xx, yy, yy === ry ? BODYH : yy === ry + 17 ? BODYD : BODY);
    [...digits].forEach((ch, i) => {
      const bits = ch === ' ' ? 0 : SEG7[+ch];
      for (let sgi = 0; sgi < 7; sgi++){
        const lit = (bits >> (6 - sgi)) & 1;
        for (const [px, py] of SEG8[sgi]) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) B.dot(rx + 2 + i * 10 + px * 2 + dx, ry + 2 + py * 2 + dy, lit ? A(0) : BODYD);
      }
    });
    text(rx + roW + 4, ry + 3, 'PASSED', SILK);
    text(rx + roW + 4, ry + 10, failed, (info.failed | 0) ? A(6) : MARK);
    return lamps;
  }};
}

function blk(fb, W, i, s, c){ if (s === 1){ fb[i] = c; return } for (let y = 0; y < s; y++){ const j = i + y * W; for (let x = 0; x < s; x++) fb[j + x] = c } }

const SEG7 = [0x7E, 0x30, 0x6D, 0x79, 0x33, 0x5B, 0x5F, 0x70, 0x7F, 0x7B];

const SEGPTS = [[[0,0],[1,0],[2,0]], [[2,0],[2,1],[2,2]], [[2,2],[2,3],[2,4]], [[0,4],[1,4],[2,4]], [[0,2],[0,3],[0,4]], [[0,0],[0,1],[0,2]], [[0,2],[1,2],[2,2]]];

// boot: null while running; 0..1 while the board powers up from its source
function compose(B, f, fb, boot){
  fb.set(B.buf);
  const W = B.W, t = f / LOOP, nb = B.boards.length, Rs = new Float32Array(nb);
  for (let k = 0; k < nb; k++){ const b = B.boards[k], wv = b.wave; Rs[k] = boot == null ? ((t * wv.k + wv.ph) % 1) * (b.Rmax + wv.tail * 1.6) - wv.tail * .3 : boot * (b.Rmax + 6) }
  // powered copper keeps a faint glow; the wave of light out from each board's main chip runs once, as the board powers
  // up. After that the light is signals: packets running chip to chip along the wires, as many as the seats are busy
  for (const p of B.paths){
    if (p.bk < 0) continue;
    const R = Rs[p.bk], tail = B.boards[p.bk].wave.tail, P = p.path.length, rel = R - p.base;
    const lit = boot == null ? P : Math.min(P, Math.floor(rel) + 1);
    // a ribbon cable's wires are insulated: light runs along them, but they keep their own colours
    if (!p.cable) for (let j = 0; j < lit; j++) blk(fb, W, p.path[p.fwd ? j : P - 1 - j], p.s, POW);
    if (boot != null && !p.cable) for (let j = Math.max(0, lit); j < P; j++) blk(fb, W, p.path[p.fwd ? j : P - 1 - j], p.s, TRD);
    if (boot == null) continue;
    const j0 = Math.max(0, Math.ceil(rel - tail)), j1 = Math.min(P - 1, Math.floor(rel));
    for (let j = j0; j <= j1; j++){
      const d = rel - j, cell = p.path[p.fwd ? j : P - 1 - j], c = d < 1.5 ? SPK : d < tail * .22 ? SPK2 : d < tail * .6 ? SPK3 : SPK4;
      blk(fb, W, cell, p.s, c);
      if (p.s === 1 && d < tail * .22){ for (const n of [cell - 1, cell + 1, cell - W, cell + W]) if (MASKISH[fb[n]]) fb[n] = SGLOW }
    }
  }
  if (boot == null) for (const p of B.pulses){
    const P = p.path.length;
    for (let j = 0; j < p.m; j++){
      const head = (p.v * f + p.off + j * p.C) % p.Lt; if (head >= P + p.tail) continue;
      const h = Math.floor(head);
      for (let k = 0; k <= p.tail; k++){
        const idx = h - k; if (idx < 0 || idx >= P) continue;
        const cell = p.path[idx], c = k === 0 ? SPK : k <= p.tail * .3 ? SPK2 : k <= p.tail * .65 ? SPK3 : SPK4;
        blk(fb, W, cell, p.s, c);
        // the head lights the mask either side of it, so a packet reads as light and not a moving pixel
        if (k < 2 && p.s === 1) for (const n of [cell - 1, cell + 1, cell - W, cell + W]) if (MASKISH[fb[n]]) fb[n] = SGLOW;
      }
    }
  }
  if (B.letters){
    const L = B.letters, R = Rs[L.bk], ds = L.ds; let lo = 0, hi = ds.length;
    while (lo < hi){ const m = (lo + hi) >> 1; if (ds[m] < R - 7) lo = m + 1; else hi = m }
    for (let i = lo; i < ds.length && ds[i] <= R; i++){ const c = L.cells[i]; if (fb[c] !== HOLE) fb[c] = PADH }
  }
  const reached = o => o.bk < 0 || boot == null || o.d <= Rs[o.bk];
  for (const L of B.leds){
    const n = L.states.length; let st = L.states[Math.floor(((f + L.phase) % (L.k * n)) / L.k)];
    if (L.bk >= 0){ const gap = Rs[L.bk] - L.d; if (boot != null && gap < 0) st = L.off; else if (gap >= 0 && gap < 5) st = L.flash }
    for (let i = 0; i < L.cells.length; i++) fb[L.cells[i]] = st.c;
    for (let i = 0; i < L.hi.length; i++) fb[L.hi[i]] = st.h;
    if (st.g >= 0 && L.halo) for (let i = 0; i < L.halo.length; i++) fb[L.halo[i]] = st.g;
  }
  for (const F of B.fans){
    const sh = reached(F) ? F.m * t : 0;
    for (let j = 0; j < F.idx.length; j++){ let ph = F.a[j] - sh; ph -= Math.floor(ph); fb[F.idx[j]] = ph < .1 ? METH : ph < .42 ? MET : BODYD }
  }
  for (const S of B.screens){ if (reached(S)) drawScreen(fb, W, S, t, f); else { const dw = Math.floor(S.w / S.s), dh = Math.floor(S.h / S.s); for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) blk(fb, W, (S.y + y * S.s) * W + S.x + x * S.s, S.s, BODYD) } }
  for (const S of B.segs){
    const on = reached(S), st = Math.floor(f / S.k), digits = S.seq[(st + S.idx * 7) % S.seq.length];
    for (let i = 0; i < S.n; i++){
      const bx = S.x + i * 4 * S.s, bits = on ? SEG7[(digits[i] + S.idx * 3 + i * 7) % 10] : 0;
      for (const pass of [0, 1]) for (let sgi = 0; sgi < 7; sgi++){
        const lit = (bits >> (6 - sgi)) & 1; if (lit !== pass) continue;
        for (const [px, py] of SEGPTS[sgi]) blk(fb, W, (S.y + py * S.s) * W + bx + px * S.s, S.s, lit ? S.lit : S.unlit);
      }
    }
  }
  for (const Bg of B.bars){
    const lvl = reached(Bg) ? Bg.n * (.5 + .32 * Math.sin(TAU * Bg.a * t + Bg.p1) + .18 * Math.sin(TAU * Bg.b * t + Bg.p2)) : -1;
    for (let i = 0; i < Bg.n; i++){ const c = i < lvl ? Bg.on[i] : Bg.off[i], col = Bg.cols[i]; for (let j = 0; j < col.length; j++) fb[col[j]] = c }
  }
}

function drawScreen(fb, W, S, t, f){
  const s = S.s, dw = Math.floor(S.w / s), dh = Math.floor(S.h / s);
  const put = (ux, uy, c) => blk(fb, W, (S.y + uy * s) * W + S.x + ux * s, s, c);
  for (let ux = 0; ux < dw; ux++) for (let uy = 0; uy < dh; uy++) put(ux, uy, BODYD);
  if (S.scene === 'scope'){
    let prev = null;
    for (let ux = 0; ux < dw; ux++){
      for (let uy = 0; uy < dh; uy++) if ((ux % 4 === 0 && uy % 4 === 0) || (uy === (dh >> 1) && ux % 2 === 0)) put(ux, uy, BODYH);
      const env = .65 + .35 * Math.sin(TAU * (ux / dw + t));
      const yv = Math.round(dh / 2 + (dh * .36) * env * Math.sin(TAU * (S.wm * ux / dw - t * S.wk)));
      const a = prev === null ? yv : prev, lo = Math.max(0, Math.min(a, yv)), hi = Math.min(dh - 1, Math.max(a, yv));
      for (let uy = lo; uy <= hi; uy++) put(ux, uy, A(S.ph));
      prev = yv;
    }
  } else if (S.scene === 'term'){
    // a boot log scrolling up; one full cycle of lines per loop
    const rows = Math.floor(dh / 2), o = Math.floor(t * S.rowsN);
    for (let row = 0; row < rows; row++){
      const line = S.lines[(o + row) % S.rowsN], y = row * 2;
      for (const [x, l] of line) for (let k = 0; k < l && x + k < dw; k++) put(x + k, y, row === rows - 1 ? AH(S.ph) : A(S.ph));
    }
    if (Math.floor(f / 5) % 2) put(Math.min(dw - 1, 1), Math.max(0, (rows - 1) * 2), AH(S.ph));
  } else {
    const nb = Math.floor((dw - 1) / 3);
    for (let i = 0; i < nb; i++){
      const [a, p, b, q] = S.bars[i % S.bars.length];
      const v = (.5 + .5 * Math.sin(TAU * a * t + p)) * (.6 + .4 * Math.sin(TAU * b * t + q));
      const hgt = Math.max(1, Math.round((dh - 2) * (.12 + .88 * v)));
      for (let k = 0; k < hgt; k++){ const fr = k / (dh - 2), c = fr < .6 ? A(3) : fr < .85 ? A(2) : A(6); put(1 + i * 3, dh - 1 - k, c); put(2 + i * 3, dh - 1 - k, c) }
    }
  }
}

// A palette spread across every slot the parts use: the mask, the copper under it and the copper bared, the chips'
// glass, the lamp the power wave and the lit parts take, and the parts' own colours.
const slotCache = new Map();
function slotsOf(P){
  if (slotCache.has(P.id)) return slotCache.get(P.id);
  const h = hex, bg = h(P.bg), sig = h(P.lit), tail = h(P.tail), pad = h(P.pad), c = new Array(NS);
  c[BG] = bg; c[BG2] = h(P.bg2); c[TR] = h(P.tr); c[TR2] = h(P.tr2); c[TRD] = mix(bg, BLACK, .45); c[POUR] = P.pour ? h(P.pour) : mix(bg, h(P.tr), .28);
  c[PAD] = pad; c[PADH] = mix(pad, WHITE, .42); c[PADD] = mix(pad, BLACK, .3);
  c[BODY] = h(P.body); c[BODYH] = mix(c[BODY], WHITE, .24); c[BODYD] = mix(c[BODY], BLACK, .62);
  c[MARK] = h(P.mark); c[PIN] = h(P.pin); c[PIND] = mix(c[PIN], BLACK, .32);
  // silkscreen is a thin matte ink, so the mask shows through it a little
  c[SILK] = mix(h(P.silk), bg, .15);
  c[MET] = h(P.met); c[METH] = mix(c[MET], WHITE, .45); c[METD] = mix(c[MET], BLACK, .45);
  c[HOLE] = mix(bg, BLACK, .7); c[VOID] = c[HOLE]; c[SHADOW] = c[HOLE]; c[EDGEH] = mix(bg, WHITE, .2); c[EDGEL] = mix(bg, BLACK, .5); c[SUB] = h('#d2bd86');
  c[GLOW] = mix(bg, sig, .3); c[GLOW2] = mix(bg, sig, .13);
  c[SPK] = h(P.spark); c[SPK2] = sig; c[SPK3] = mix(tail, bg, .15); c[SPK4] = mix(tail, bg, .55); c[SGLOW] = mix(bg, sig, .34); c[POW] = mix(c[TR], sig, .3);
  P.acc.forEach((x, i) => { const a = h(x); c[A0 + i] = a; c[AD0 + i] = mix(a, c[BODY], .58); c[AH0 + i] = mix(a, WHITE, .55); c[AG0 + i] = mix(a, bg, .6) });
  slotCache.set(P.id, c);
  return c;
}
// for a caller that names no theme: a plain green board
const FALLBACK = { id:'fallback', bg:'#0b3b23', bg2:'#0e4529', tr:'#187040', tr2:'#2c8a57', pad:'#e8b24c', body:'#17171b', mark:'#7d8088', pin:'#d6d8dc', silk:'#f2f1e6', met:'#8d9198', spark:'#ffffff', tail:'#22d38a', lit:'#8bffcf',
  acc:['#3ef0ff','#ff4fd8','#ffc928','#4dff88','#eadbb7','#9b6bff','#ff3b3b','#2f7bff'] };

function toLut(rgb){ const lut = new Uint32Array(rgb.length); rgb.forEach((c, i) => lut[i] = pack(c)); return lut }

function colorize(fb, out, lut){ for (let i = 0, N = fb.length; i < N; i++) out[i] = lut[fb[i]] }

// the board in the wall's colours, so the back of a panel is the same product as its front: the solder mask is the
// theme's (green steel, brown phenolic ivory, blue slate, black onyx), the chips are the wall's black glass, the
// silkscreen its face, the traces and the lit parts its lamp; the warning yellow and the wrong red keep their meaning
// each theme's board is one of Board Fab's soldermasks as tuned there, not a colour worked out from the wall's: the
// green board on the steel wall, the red on ivory, the black on night and onyx, the blue on slate, green on olive.
// The finish follows: gold on green and black, copper on the warm walls, silver on slate.
const hx = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const FAB_MASKS = {
  black: { bg:'#0d0d0f', bg2:'#121214', pour:'#1a1b1f', tr:'#2a2d34', silk:'#f1f0ea', edgeh:'#3b3d43', sig:'#ffc247', tail:'#ff6a1f' },
  green: { bg:'#0b3b23', bg2:'#0e4529', pour:'#125632', tr:'#187040', silk:'#f2f1e6', edgeh:'#2c8a57', sig:'#8bffcf', tail:'#22d38a' },
  blue:  { bg:'#0b1f55', bg2:'#0e2663', pour:'#132f77', tr:'#1a3c8e', silk:'#f1f4ff', edgeh:'#3a62c4', sig:'#7cf8ff', tail:'#3e8bff' },
  red:   { bg:'#530d12', bg2:'#5f1016', pour:'#72151b', tr:'#871b22', silk:'#fbf3ea', edgeh:'#b2343b', sig:'#ffe066', tail:'#ff9a1f' },
};
const MASK_OF = { steel:'green', ivory:'red', night:'black', olive:'green', slate:'blue', onyx:'black' };
const FINISH = { steel:'#e8b24c', ivory:'#e08a5c', night:'#e8b24c', olive:'#e08a5c', slate:'#c9cdd3', onyx:'#e8b24c' };
const boardCache = new Map();
export function themeBoard(name, _T?) {
  if (boardCache.has(name)) return boardCache.get(name);
  const mk = FAB_MASKS[MASK_OF[name] ?? 'green'];
  const P = {
    id:'imd-' + name, bg:mk.bg, bg2:mk.bg2, pour:mk.pour, tr:mk.tr, tr2:hx(mix(hex(mk.tr), hex(mk.edgeh), .35)),
    pad:FINISH[name] ?? FINISH.steel, body:'#17171b', mark:'#7d8088', pin:'#d6d8dc', silk:mk.silk, met:'#8d9198',
    spark:'#ffffff', tail:mk.tail, lit:mk.sig,
    // the lamps a real board carries: green, amber, red and warm white, and the mask's own glow taken down a third, so a
    // lit lamp is a colour with a white glint in it and never a white blot; no rainbow of indicators
    acc:[hx(mix(hex(mk.sig), hex(mk.bg), .3)),'#ffb43a','#ffc928','#3ecf7a','#eadbb7','#eadbb7','#e5484d','#3ecf7a'],
  };
  boardCache.set(name, P);
  return P;
}

/* ================================================================
   The panel: a holder's seats as boards in a manufacturing panel
   ================================================================ */


function eachDisc(B, cx, cy, rad, fn){
  const r2 = rad * rad;
  for (let y = Math.max(0, Math.floor(cy - rad)); y <= Math.min(B.H - 1, Math.ceil(cy + rad)); y++)
    for (let x = Math.max(0, Math.floor(cx - rad)); x <= Math.min(B.W - 1, Math.ceil(cx + rad)); x++){
      const dx = x + .5 - cx, dy = y + .5 - cy, d2 = dx * dx + dy * dy; if (d2 <= r2) fn(y * B.W + x, x, y, Math.sqrt(d2));
    }
}

/** How many boards a panel of so many seats is cut into: one for a seat or two, up to five for the biggest holders. */
function boardsFor(seats, r){
  if (seats <= 2) return 1;
  if (seats <= 5) return r.weighted([[1, 1], [2, 3]]);
  if (seats <= 12) return r.weighted([[2, 2], [3, 3]]);
  if (seats <= 25) return r.weighted([[3, 2], [4, 3]]);
  return r.weighted([[4, 2], [5, 2]]);
}

function buildPanel(ctx, n){
  const { B, r } = ctx, W = B.W, H = B.H, M = Math.min(W, H), reg = B.reg;
  const portrait = H > W * 1.15, rail = Math.max(11, Math.round(M * r.range(.06, .07)));
  const slot = Math.max(3, Math.round(M * .017)), s2 = Math.ceil(slot / 2);
  const rails = [];
  let ix = s2, iy = s2, iw = W - 2 * s2, ih = H - 2 * s2;
  // the rails always run top and bottom, whatever the panel's shape, because they carry the holder's name and record
  rails.push({ x:0, y:0, w:W, h:rail }, { x:0, y:H - rail, w:W, h:rail }); iy = rail + s2; ih = H - 2 * rail - 2 * s2;
  const cells = [{ x:ix, y:iy, w:iw, h:ih }];
  while (cells.length < n){
    cells.sort((a, b) => b.w * b.h - a.w * a.h);
    const c = cells.shift(), vert = c.w > c.h * 1.05 || (c.w > c.h * .95 && r.chance(.5)), t = Math.round((vert ? c.w : c.h) * r.range(.36, .64));
    if (vert) cells.push({ x:c.x, y:c.y, w:t, h:c.h }, { x:c.x + t, y:c.y, w:c.w - t, h:c.h });
    else cells.push({ x:c.x, y:c.y, w:c.w, h:t }, { x:c.x, y:c.y + t, w:c.w, h:c.h - t });
  }
  cells.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const rl of rails) for (let y = rl.y; y < rl.y + rl.h; y++) reg.fill(1, y * W + rl.x, y * W + rl.x + rl.w);
  const boards = cells.map((c, k) => {
    const b = { k, x:c.x + s2, y:c.y + s2, w:c.w - 2 * s2, h:c.h - 2 * s2 };
    const ar = b.w / b.h, mn = Math.min(b.w, b.h);
    // no round boards: a panel's back is the shape of the panel, filled edge to edge, and a circle in it is empty corners
    r.chance(.45); b.round = false;
    if (b.round){ b.R = Math.floor(mn / 2); b.cx = b.x + b.w / 2; b.cy = b.y + b.h / 2; b.x = Math.round(b.cx - b.R); b.y = Math.round(b.cy - b.R); b.w = b.h = 2 * b.R; b.cx = b.x + b.R; b.cy = b.y + b.R }
    b.rc = b.round ? b.R : Math.max(2, Math.round(mn * r.range(.025, .07)));
    const v = 2 + k;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++){
      let inside;
      if (b.round){ const dx = x + .5 - b.cx, dy = y + .5 - b.cy; inside = dx * dx + dy * dy <= b.R * b.R }
      else { const dx = Math.max(b.x + b.rc - x - .5, 0, x + .5 - (b.x + b.w - b.rc)), dy = Math.max(b.y + b.rc - y - .5, 0, y + .5 - (b.y + b.h - b.rc)); inside = dx * dx + dy * dy <= b.rc * b.rc }
      if (inside) reg[y * W + x] = v;
    }
    return b;
  });
  // breakaway tabs with mouse-bite perforations across the routed slots
  const tabW = Math.max(5, Math.round(slot * 2.6)), bites = [];
  const material = (x, y) => x >= 0 && y >= 0 && x < W && y < H && reg[y * W + x] !== 0;
  for (const b of boards){
    const spots = [];
    if (b.round) spots.push(['t', b.cx], ['b', b.cx], ['l', b.cy], ['r', b.cy]);
    else for (const sd of ['t', 'b', 'l', 'r']){
      const horiz = sd === 't' || sd === 'b', len = horiz ? b.w : b.h, base = horiz ? b.x : b.y;
      for (const f of len > 150 ? [.25, .75] : [.5]) spots.push([sd, base + len * f]);
    }
    for (const [sd, u] of spots){
      const c = Math.round(u), half = tabW >> 1;
      let x0, y0, w, h, px, py, bx, by, along;
      if (sd === 't'){ x0 = c - half; w = tabW; y0 = b.y - slot; h = slot + 1; px = c; py = b.y - slot - 1; by = b.y - 1; along = 'x' }
      else if (sd === 'b'){ x0 = c - half; w = tabW; y0 = b.y + b.h - 1; h = slot + 1; px = c; py = b.y + b.h + slot; by = b.y + b.h; along = 'x' }
      else if (sd === 'l'){ y0 = c - half; h = tabW; x0 = b.x - slot; w = slot + 1; px = b.x - slot - 1; py = c; bx = b.x - 1; along = 'y' }
      else { y0 = c - half; h = tabW; x0 = b.x + b.w - 1; w = slot + 1; px = b.x + b.w + slot; py = c; bx = b.x + b.w; along = 'y' }
      if (!material(px, py)) continue;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < W && y < H && !reg[y * W + x]) reg[y * W + x] = 1;
      if (along === 'x') for (let x = x0 + 1; x < x0 + w - 1; x += 2) bites.push([x, by]);
      else for (let y = y0 + 1; y < y0 + h - 1; y += 2) bites.push([bx, y]);
    }
  }
  return { rails, boards, slot, rail, bites, portrait };
}

function paintBase(ctx){
  const { B } = ctx, W = B.W, H = B.H, reg = B.reg, buf = B.buf, occ = B.occ;
  for (let i = 0; i < B.N; i++){ if (!reg[i]){ buf[i] = VOID; occ[i] = 4 } else { buf[i] = BG; if (reg[i] === 1) occ[i] = 4 } }
  for (const [x, y] of B.panel.bites){ if (x < 0 || y < 0 || x >= W || y >= H) continue; const i = y * W + x; buf[i] = VOID; occ[i] = 4 }
  // keep parts and copper back from every routed edge
  const m = Math.max(2, Math.round(Math.min(W, H) / 150));
  let front = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const i = y * W + x, v = reg[i]; if (v < 2) continue;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || reg[i - 1] !== v || reg[i + 1] !== v || reg[i - W] !== v || reg[i + W] !== v){ occ[i] = 4; front.push(i) }
  }
  for (let pass = 1; pass < m; pass++){
    const next = [];
    for (const i of front) for (const j of [i - 1, i + 1, i - W, i + W]){ if (j < 0 || j >= B.N || reg[j] < 2 || occ[j]) continue; occ[j] = 4; next.push(j) }
    front = next;
  }
}

function voidDisc(B, cx, cy, rad){
  // a drilled tooling hole: its plated wall catches the light all round, so it reads as a hole on any mask
  eachDisc(B, cx, cy, rad + 1, (i, x, y, d) => { if (d <= rad){ B.buf[i] = VOID; B.occ[i] = 4 } else if (B.reg[i]){ B.buf[i] = EDGEH; B.occ[i] = 4 } });
}
function fiducial(B, cx, cy, rf){
  eachDisc(B, cx, cy, rf * 2.4, (i, x, y, d) => { B.buf[i] = d <= rf ? PAD : SUB; B.occ[i] = Math.max(B.occ[i], 1) });
}
function panelHole(B, cx, cy, rm){
  eachDisc(B, cx, cy, rm + 2.5, (i, x, y, d) => {
    if (!B.reg[i]) return;
    if (d > rm){ if (B.buf[i] !== VOID){ B.buf[i] = BG; B.occ[i] = 4 } return }
    B.occ[i] = 4;
    B.buf[i] = d <= rm * .52 ? VOID : d > rm - 1 ? PADD : (x + y) % 7 === 0 ? PADH : PAD;
  });
}

/**
 * The rails, as a fab's panel has them: a tooling hole at each end, three alignment marks (two along the top, one along
 * the bottom, so a machine can tell which way up the panel is), and silkscreen. The top rail carries the holder: who,
 * the part number, the seats with a lamp each (lit where its agent is active, blinking while it works) and the record.
 * The bottom rail carries what can be done with the panel, printed as its own legend, where the page asks for that
 * (`info.actions`); in a picture of it, the lot's date code and copper weight and a test coupon, as a real rail has.
 * Nothing on the rails moves the boards, so what they say can change and the boards stay as they are.
 */
// the way to the holder at the left; what can be saved, right-aligned at the other end
const SAVES = [['png', 'PNG'], ['gif', 'GIF'], ['video', 'MP4']];
function railFurniture(ctx){
  const { B } = ctx, P = B.panel, info = ctx.info, lamps = [];
  const up = (s) => String(s).toUpperCase(), tw = (s) => s.length * 4 - 1;
  B.actions = [];
  P.rails.forEach((rl, ri) => {
    const t = rl.h, L = rl.w, cy = rl.y + t / 2;
    for (const u of [t * .95, L - t * .95]) voidDisc(B, rl.x + u, cy, Math.max(2, t * .2));
    for (const u of ri === 0 ? [t * 2.2, L - t * 2.2] : [t * 2.2]) fiducial(B, rl.x + u, cy, Math.max(1.2, t * .1));
    const x0 = Math.round(t * 3.2), y0 = Math.round(rl.y + (t - 5) / 2), x1 = Math.round(L - t * 3.2);
    if (ri === 0){
      // the holder always; then whole fields as room allows: the record, the part number, the seats. The seats themselves
      // are on the boards, a test point each
      const n = info.seats.length;
      // the record only where it is known: the chain's copy has no jobs to count, and says nothing rather than zero
      const record = info.passed == null ? [] : [Math.min(999999, info.passed | 0) + ' PASSED', Math.min(99999, info.failed | 0) + ' FAILED'];
      const parts = [up(info.name), ...record, up(info.code), n + (n === 1 ? ' SEAT' : ' SEATS')];
      let str = parts[0];
      for (const p of parts.slice(1)){ const next = str + '  ' + p; if (tw(next) > x1 - x0) break; str = next }
      silkText(B, x0, y0, str, 1, SILK, 4);
      return;
    }
    if (info.actions){
      const put = (id, label, x) => { silkText(B, x, y0, label, 1, SILK, 4); B.actions.push({ id, x:x - 4, y:rl.y, w:tw(label) + 8, h:t }) };
      put('explorer', 'EXPLORER', x0);
      // the holder looking at their own panel can change it
      let left = x0 + tw('EXPLORER') + 14;
      if (info.edit){ put('edit', 'CUSTOMIZE', left); left += tw('CUSTOMIZE') + 14 }
      // the bottom rail has no mark at its right end, so the saves sit as far from the hole there as the words at the left sit from theirs
      let x = Math.round(L - t * 1.9);
      // all three where they fit; where they do not, one word that opens them
      const need = SAVES.reduce((n, [, l]) => n + tw(l) + 14, -14);
      if (x - need >= left) for (const [id, label] of SAVES.slice().reverse()){ x -= tw(label); put(id, label, x); x -= 14 }
      else if (x - tw('SAVE') >= left) put('save', 'SAVE', x - tw('SAVE'));
      return;
    }
    // the lot: the week the holder's first agent came online, from the design; 2600 for a board that never said
    const str = 'LOT ' + String(info.lot || 2600).padStart(4, '0') + '  ETHEREUM  IMD';
    if (tw(str) <= x1 - x0) silkText(B, x0, y0, str, 1, SILK, 4);
    // an impedance test coupon: a serpentine trace between two pads, at the far end
    const cw = Math.min(Math.round(L * .16), 60), ch = Math.max(4, Math.round(t * .45)), cx0 = x1 - cw, cy0 = Math.round(rl.y + (t - ch) / 2);
    if (cx0 > x0 + tw(str) + 8){
      for (let x = cx0 + 2; x < cx0 + cw - 2; x += 2){ for (let y = cy0; y < cy0 + ch; y++) B.dot(x, y, TR2, 4); B.dot(x + 1, ((x - cx0) / 2) % 2 ? cy0 : cy0 + ch - 1, TR2, 4) }
      for (const px of [cx0, cx0 + cw - 2]) for (let y = cy0; y < cy0 + ch; y++){ B.dot(px, y, PAD, 4); B.dot(px + 1, y, PAD, 4) }
    }
  });
  return lamps;
}

function boardFurniture(ctx, b){
  const { B, r } = ctx, M = Math.min(b.w, b.h), rm = clamp(M * .034, 2.5, 9);
  b.rm = rm;
  const holes = [];
  if (b.round){ const a0 = r.range(0, TAU); for (let i = 0; i < 3; i++){ const a = a0 + i * TAU / 3; holes.push([b.cx + Math.cos(a) * (b.R - rm - 5), b.cy + Math.sin(a) * (b.R - rm - 5)]) } }
  else { const ins = Math.max(rm + 5, b.rc * .7 + rm + 2); holes.push([b.x + ins, b.y + ins], [b.x + b.w - ins, b.y + ins], [b.x + ins, b.y + b.h - ins], [b.x + b.w - ins, b.y + b.h - ins]) }
  if (M >= 40) holes.forEach(([x, y]) => panelHole(B, x, y, rm));
  const rf = Math.max(1.2, rm * .32);
  if (!b.round && M >= 50){ const fi = Math.max(rm * 2 + 9, b.rc * .7 + rm * 2 + 8); fiducial(B, b.x + b.w - fi, b.y + fi * .55 + 2, rf); fiducial(B, b.x + fi * .55 + 2, b.y + b.h - fi, rf) }
  else if (b.round && M >= 50) fiducial(B, b.cx, b.cy - b.R * .55, rf);
  // gold fingers on one edge, with a keying notch
  if (!b.round && b.w >= 90 && b.h >= 60 && r.chance(.5)){
    const span = Math.round(b.w * r.range(.35, .58)), x0 = Math.round(b.x + (b.w - span) / 2), fh = clamp(Math.round(b.h * .075), 5, 18);
    const pitch = M > 220 ? 4 : 3, fw = pitch - 1, y1 = b.y + b.h, notchX = Math.round(x0 + span * r.range(.25, .4)), nw = pitch * 2, nh = Math.max(2, Math.round(fh * .55));
    B.reserve(x0 - 2, y1 - fh - 4, span + 4, fh + 4, 4);
    for (let x = x0; x + fw <= x0 + span; x += pitch){
      if (x + fw > notchX - 1 && x < notchX + nw + 1) continue;
      for (let y = y1 - fh; y < y1; y++) for (let xx = x; xx < x + fw; xx++){ const i = y * B.W + xx; if (B.reg[i] < 2) continue; B.buf[i] = y === y1 - fh ? PADH : PAD; B.occ[i] = 4 }
    }
    for (let y = y1 - nh; y < y1; y++) for (let x = notchX; x < notchX + nw; x++){ const i = y * B.W + x; B.reg[i] = 0; B.buf[i] = VOID; B.occ[i] = 4 }
  }
}


/**
 * Test points, one for each of the holder's seats: a pad a probe touches, labelled with the seat's token number, the
 * seats shared across the boards by their size. A seat whose agent is active has its pad ringed in green, and while it
 * works the ring blinks; an idle seat's pad is bare. Only a few pads to a board carry their number, so the print stays a detail.
 * Returns the cells of the working seats' rings, for the blink.
 */
function testPoints(ctx){
  // their own draw, so the rest of the board's layout keeps its sequence
  const { B, info } = ctx, r = new Rng(ctx.key + ':tp'), lamps = [];
  const ids = info.ids ?? [], states = info.seats ?? [];
  if (!ids.length) return lamps;
  const area = B.boards.reduce((n, b) => n + b.w * b.h, 0);
  let next = 0;
  const placed = [];
  B.boards.forEach((b, bi) => {
    const share = bi === B.boards.length - 1 ? ids.length - next : Math.round((ids.length * b.w * b.h) / area);
    const mine = ids.slice(next, next + share), st = states.slice(next, next + share); next += mine.length;
    // a few numbers to a board, as many as its size carries without the print taking over; the other pads unlabelled
    const most = Math.max(2, Math.round((b.w * b.h) / 6500)), every = Math.max(1, Math.ceil(mine.length / most));
    mine.forEach((id, k) => {
      // the bare number: a # is three dots wide in this face and reads as an H
      const label = k % every ? '' : String(id), lw = label ? label.length * 4 + 2 : 0;
      // a dozen places it could go, and the one farthest from the pads already down, so they spread over the board
      let x = -1, y = -1, far = -1;
      for (let tries = 0, got = 0; tries < 160 && got < 12; tries++){
        const cx = r.int(b.x + 8, b.x + b.w - 14 - lw), cy = r.int(b.y + 8, b.y + b.h - 12);
        if (!B.free(cx - 1, cy - 1, 6 + lw, 7) || B.reg[cy * B.W + cx] !== 2 + b.k) continue;
        got++;
        let d = 1e9; for (const [qx, qy] of placed) d = Math.min(d, Math.hypot(qx - cx - lw / 2, qy - cy));
        if (d > far){ far = d; x = cx; y = cy }
      }
      {
        if (x < 0) return;
        placed.push([x + lw / 2, y]);
        B.reserve(x - 1, y - 1, 6 + lw, 7, 1);
        const v = st[k] ?? 0, cells = [];
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++){
          const edge = dx === 0 || dy === 0 || dx === 3 || dy === 3, corner = (dx === 0 || dx === 3) && (dy === 0 || dy === 3);
          if (corner) continue;
          // the pad's ring a soft green where the seat's agent is active, so the pad's own bright centre and a signal's
          // white head still read against it; full green only while it is working, in the blink below
          const c = !edge ? (dx === 1 && dy === 1 ? METH : MET) : v === 2 ? A(3) : v ? AG(3) : PADD;
          B.dot(x + dx, y + dy, c);
          if (edge && v === 2) cells.push((y + dy) * B.W + x + dx);
        }
        if (cells.length) lamps.push(Int32Array.from(cells));
        if (label) silkText(B, x + 6, y, label, 1, SILK);
        // where a signal for this seat starts: its pad's middle, and the pad's ring to flash
        (B.probes ??= new Map()).set(id, { x:x + 1, y:y + 1, k:b.k, ring:Int32Array.from([1, 2, 4, 7, 8, 11, 13, 14].map((q) => (y + (q >> 2)) * B.W + x + (q & 3))) });
      }
    });
  });
  return lamps;
}

function fillBoard(ctx, b){
  const r = new Rng(ctx.key + ':board:' + b.k);
  const style = r.weighted([['logic',3],['dense',2.4],['chunky',1.5],['lights',1.4],['power',1.2]]), S = STYLES[style];
  const lists = {}; for (const [name, list] of Object.entries(LISTS)) lists[name] = list.map(([t, w]) => [t, w * (S.bias[t] ?? 1)]);
  const dens = clamp(ctx.dens + (S.dens || 0) - (ctx.panel ? .1 : 0), .05, 1);
  const bctx = { B:ctx.B, g:ctx.g, r, dens, panel:ctx.panel, Z:96 - 50 * dens, gapP:.3 + (1 - dens) * .5, lists, zw:S.zw, s2:S.s2 ?? .3, s3:S.s3 ?? .14, board:b, best:b.hero ?? 0 };
  b.style = style; b.pour = r.chance(.62);
  const zones = []; subdivide(bctx, b.x, b.y, b.w, b.h, 0, zones);
  for (const z of zones) fillZone(bctx, z);
}

// routed edges catch light on the top-left and cast a short shadow onto the table
function edges(ctx){
  const { B } = ctx, W = B.W, H = B.H, reg = B.reg, buf = B.buf;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const i = y * W + x;
    if (reg[i]){
      const up = y > 0 ? reg[i - W] : 1, lf = x > 0 ? reg[i - 1] : 1, dn = y < H - 1 ? reg[i + W] : 1, rt = x < W - 1 ? reg[i + 1] : 1;
      if (!up || !lf) buf[i] = EDGEH; else if (!dn || !rt) buf[i] = EDGEL;
    } else if (buf[i] === VOID){
      if ((y > 0 && reg[i - W]) || (x > 0 && reg[i - 1]) || (x > 0 && y > 0 && reg[i - W - 1]) || (y > 1 && reg[i - 2 * W]) || (x > 1 && reg[i - 2])) buf[i] = SHADOW;
    }
  }
}

/**
 * A holder's panel, laid out as Board Fab lays one out and dressed as theirs: their seats cut into boards, their letters
 * etched on the biggest, a driver chip behind each pane of glass on the front, and the holder on the rails. Its layout depends only on the seed, the size, the seat count, the front and the letters.
 */
function generatePanel(seed, W, H, dens, info, mounts, text){
  const r = new Rng(seed), B = new Board(W, H), g = new G(B);
  // traffic: a few packets on a quiet panel, a lot where every seat's agent is active, more again while one is working
  const n = info.seats.length || 1, act = info.seats.filter((v) => v).length / n, busy = info.seats.some((v) => v === 2);
  const ctx = { B, r, g, dens, key:seed, info, panel:true, traffic:.5 + 2.2 * act + (busy ? 1.6 : 0) };
  B.panel = buildPanel(ctx, boardsFor(info.seats.length, r)); B.boards = B.panel.boards;
  paintBase(ctx);
  const lamps = railFurniture(ctx);
  for (const b of B.boards) boardFurniture(ctx, b);
  const cables = ribbons(ctx);
  const big = B.boards.slice().sort((p, q) => q.w * q.h - p.w * p.h)[0];
  if (text && big){
    const L = placeLetters(Math.round(big.w * .8), Math.round(big.h * .7), text);
    if (L){ L.x += Math.round(big.x + big.w * .1); L.y += Math.round(big.y + big.h * .15); etch(B, L); B.letters.bk = big.k }
  }
  // the Morse lamp goes by the letters before the main chips take their room, or by the biggest board's main chip
  if (B.letters) morseLed(ctx, text, big);
  // one line to a panel, in Morse in the marking of its biggest main chip: the panel's pick, or the shortest that fits
  // when the chip is too small for it. The main chip is sized to its board's short side, so it is that board's
  const pick = LINES[new Rng(seed + ':line').int(0, LINES.length - 1)];
  const host = B.boards.slice().sort((p, q) => Math.min(q.w, q.h) - Math.min(p.w, p.h))[0];
  const say = { lines:[pick, ...LINES.filter((l) => l !== pick).sort((p, q) => p.join('').length - q.join('').length)], used:new Set() };
  // the other main chips are bare, but for one at most on a panel: the outline of its die, the mould's two round marks or
  // a small 2D code; a third of panels have none
  const br = new Rng(seed + ':blank'), others = B.boards.filter((b) => b !== host);
  for (const b of others) b.blank = 'plain';
  if (others.length && br.chance(.67)) br.pick(others).blank = br.pick(['die', 'molds', 'dm']);
  for (const b of B.boards) heroChip({ ...ctx, blank:b.blank }, b, b === host ? say : null);
  if (!B.letters) morseLed(ctx, 'IMD', big);
  for (const m of mounts ?? []){
    const v = B.reg[clamp(Math.round(m.y + m.h / 2), 0, H - 1) * W + clamp(Math.round(m.x + m.w / 2), 0, W - 1)];
    if (v >= 2 && m.w >= 6 && m.h >= 4 && B.free(m.x - 1, m.y - 1, m.w + 2, m.h + 2)) driver({ ...ctx, board:B.boards[v - 2] }, m);
  }
  const probes = testPoints(ctx);
  for (const b of B.boards) fillBoard(ctx, b);
  wirePads(ctx);
  walkers(ctx); labels(ctx); speckle(ctx); pourPass(ctx); edges(ctx); paintRibbons(ctx, cables); finalize(ctx);
  B.plateLamps = [...lamps, ...probes];
  return B;
}

/**
 * A board for a seed at W×H board pixels, and a painter of its frame at any time on the loop clock. With `info`
 * ({ name, code, seats: 0 off · 1 active · 2 working per seat, passed, failed }), the board carries its holder's title
 * block at its middle, laid out with it rather than printed over it. With `letters`, up to three of A-Z and 0-9 are
 * struck as its hallmark, beside or above the title block, or alone; the caller passes them through initialsOf.
 */
export function makeBoard(seed, W, H, palette, dens = 0.72, info: any = null, mounts: any = null, letters = '', clear: any = null) {
  const text = String(letters ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  // a holder's board, big enough to look at, is a panel of boards; a glance at one on the wall is a single board
  const panel = info && W >= 96 && H >= 96;
  const block = info && !panel ? titleBlock(W, H, info, text) : null;
  // `clear`: rects kept bare for what is mounted over the board, as the monitor's tube is on its chassis
  const keep = block ?? (clear?.length ? { rects:clear, draw:() => [] } : null);
  const B = panel ? generatePanel(String(seed), W, H, dens, info, mounts, text) : generate(String(seed), W, H, dens, keep, mounts, block ? null : placeLetters(W, H, text));
  const lut = toLut(slotsOf(palette && typeof palette === 'object' ? palette : FALLBACK));
  const fb = new Uint8Array(W * H), lamps = B.plateLamps ?? [];
  // signals sent in from outside, as they run: the path, which way, when they set off and how long they take
  const live = [];
  let wires = null, bootAt = -1e9;
  // seats set from outside, held until set again: 0 idle, 1 active, 2 working
  const held = new Map();
  const all = B.pulses.slice();
  let sent = 0;
  return {
    W, H,
    /** Where the bottom rail's legend says what can be done, in board pixels, when the page asked for it. */
    actions: B.actions ?? [],
    /** How many signals run on it, for a check that a busy holder's board is busier. */
    signals: B.pulses.length,
    /** Whether the letters asked for are on the board: always, on any board with room for the 3×5 face (13×7 for three). */
    etched: Boolean(text && B.letters),

    /**
     * A signal from outside, at t ms: light flows out along every wire from that seat's pad (or, with no seat, from a
     * point on a wire), entering each at its nearer end, the far wires later, the pad flashing as it sets off. Ignored if
     * the board does not carry the seat. `alert` is red; `strength` from 0 to 1 sets the length of its tail.
     */
    pulse(t: number, seat: number | null = null, strength = 1, alert = false) {
      if (!B.paths.length) return;
      const at = seat != null ? B.probes?.get(seat) : null;
      if (seat != null && !at) return;
      wires ??= (() => { const c = []; for (const p of B.paths) for (const i of p.path) c.push(i); return Int32Array.from(c) })();
      let x, y;
      if (at){ x = at.x + 1; y = at.y + 1 }
      else { const i = wires[(sent++ * 7919) % wires.length]; x = i % W; y = (i / W) | 0 }
      const st = clamp(strength, 0, 1);
      // as the power-up runs, light enters every wire at its nearer end and runs along it, the far wires later, until it
      // has reached the whole board. Each wire cell's distance from where it starts, along the wire, in the order of `wires`
      const dist = new Float32Array(wires.length);
      let n = 0, far = 0;
      for (const p of B.paths){
        const P = p.path.length, a = p.path[0], z = p.path[P - 1];
        const da = Math.hypot((a % W) - x, ((a / W) | 0) - y), dz = Math.hypot((z % W) - x, ((z / W) | 0) - y);
        const fwd = da <= dz, base = Math.min(da, dz);
        for (let j = 0; j < P; j++){ const d = base + (fwd ? j : P - 1 - j); dist[n++] = d; if (d > far) far = d }
      }
      live.push({ x, y, t0:t, dur:(far + 40) * 6, dist, tail:14 + st * 30, alert, ring:at ? at.ring : null });
      while (live.length > 24) live.shift();
    },
    /** The power-up, at t ms: light races out from each board's main chip along every wire, as when the panel first turns over. */
    boot(t: number) { bootAt = t },
    /** A seat's state from outside, held until set again: 0 idle, 1 active, 2 working. Its pad shows it. */
    seat(seat: number, state: 0 | 1 | 2) { if (B.probes?.has(seat)) held.set(seat, state) },
    /** How busy the board runs, 0 to 1: the share of its own signals that run. 1 is as it was made. */
    level(l: number) {
      const n = Math.round(clamp(l, 0, 1) * all.length);
      B.pulses = all.slice(0, n);
    },
    /** Paints the frame at t ms into a 32-bit view of an ImageData's pixels. `boot` from 0 to 1 powers the board up. */
    paint(t: number, out: Uint32Array, boot: number | null = null) {
      const f = Math.floor((((t % 3000) + 3000) % 3000) / 3000 * LOOP);
      // a power-up asked for from outside runs as the first one does
      if (boot == null && t - bootAt < 1400){ const p = (t - bootAt) / 1400; boot = p < 0.5 ? 2 * p * p : 1 - (2 - 2 * p) ** 2 / 2 }
      compose(B, f, fb, boot);
      // the status LED spelling the holder's letters, in real time at 110 ms a unit; dark until the board has powered up
      const M = B.morse;
      if (M && boot == null && M.pat[Math.floor(t / 110) % M.pat.length]){
        for (const c of M.halo) if (MASKISH[fb[c]]) fb[c] = AG(1);
        for (const c of M.cells) fb[c] = A(1);
        fb[M.glint] = SPK;
      }
      // a seat whose agent is working blinks, each a beat after the last
      lamps.forEach((cells, k) => { if ((f + k * 3) % 20 >= 13) for (const c of cells) fb[c] = AG(3) });
      // a seat set from outside: its pad's ring grey, a soft green, or blinking while it works
      let k = 0;
      for (const [seat, st] of held){ const ring = B.probes.get(seat).ring, c = st === 0 ? PADD : st === 1 || (f + k++ * 3) % 20 < 13 ? AG(3) : A(3); for (const i of ring) fb[i] = c }
      // the signals sent in: light flowing out along the wires, bright at its head, fading behind; the seat's pad flashing
      for (let k = live.length - 1; k >= 0; k--){
        const L = live[k], q = (t - L.t0) / L.dur;
        if (q < 0) continue;
        if (q > 1){ live.splice(k, 1); continue }
        const edge = L.alert ? A(6) : SPK, near = L.alert ? A(6) : SPK2, far = L.alert ? AD(6) : SPK3;
        // the front moves at one speed along every wire; a bright head, a tail fading behind it
        const R = (t - L.t0) / 6;
        for (let n = 0; n < wires.length; n++){
          const gap = R - L.dist[n];
          if (gap < 0 || gap > L.tail) continue;
          const c = wires[n];
          fb[c] = gap < 1.5 ? edge : gap < L.tail * 0.3 ? near : far;
          if (gap < 1.5) for (const m of [c - 1, c + 1, c - W, c + W]) if (m >= 0 && m < fb.length && MASKISH[fb[m]]) fb[m] = L.alert ? AG(6) : SGLOW;
        }
        // the pad answers the signal it sent: a short flash, white or red, then back to its own colour
        if (L.ring && q < 0.12) for (const c of L.ring) fb[c] = edge;
      }
      colorize(fb, out, lut);
    },
  };
}


/**
 * A panel's board: as big as fits a box of BOARD_LONG × BOARD_TALL board pixels, the shape of the box a lifted panel
 * fills, so every panel shows at the same grain when it is looked at, a one-seat square and a fifty-seat strip alike.
 * A panel has one board, the same lifted off the wall, on the page where its holder designs it, and on its card; every
 * view scales it. The wall turned over shows each at a glance instead, a board pixel to a CSS pixel, no title block.
 */
export const BOARD_LONG = 384, BOARD_TALL = 216;
export const boardSize = (cw: number, ch: number): [number, number] => {
  const k = Math.min(BOARD_LONG / cw, BOARD_TALL / ch);
  return [Math.round(cw * k), Math.round(ch * k)];
};

/** The seed of a panel's back: its first seat, so every panel has its own board and keeps it. */
export const boardSeed = (first: number) => `seat-${first}`;

/** What a board's title block says: its holder, its part number, a lamp a seat (0 off, 1 active, 2 working), its record. */
export type BoardInfo = { name: string; code: string; seats: Array<0 | 1 | 2>; ids?: number[]; passed?: number; failed?: number; actions?: boolean; edit?: boolean; lot?: number | null };
