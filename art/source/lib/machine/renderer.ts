/**
 * The wall on a canvas.
 *
 * One renderer owns one canvas: it solves the layout for the width it is given, paints every
 * module once, then runs a frame loop that repaints only what moves — a rolling set of a few
 * dozen modules drifting for a few seconds each, the nodes that are working, the module under
 * the pointer and the ones it recently left, and the operator's monitor. Two thousand modules
 * repainted every frame would not be a page; forty are nothing.
 *
 * Browser-only. The React component in `components/machine/wall.tsx` creates one on mount and
 * feeds it fresh snapshots; nothing here touches the DOM beyond its canvas.
 */
import { ago } from "@/lib/time";
import { initialsOf, type Design } from "./design";
import { drawModule } from "./module";
import type { BoardInfo } from "./board";
import type { MonitorBack } from "./tube";

/**
 * The board engine and the monitor's back, fetched only when a panel's back is wanted: the first time the pointer is on
 * the wall, so it is there by the time anything is clicked, and never for a reader who only looks.
 */
let LIB: (typeof import("./board") & Pick<typeof import("./tube"), "makeMonitorBack">) | null = null;
let loading: Promise<void> | null = null;
export function loadBoards(): Promise<void> {
  if (LIB) return Promise.resolve();
  return (loading ??= Promise.all([import("./board"), import("./tube")]).then(([b, t]) => { LIB = { ...b, makeMonitorBack: t.makeMonitorBack }; }));
}
import { activityOf, HOLE, solveLayout } from "./layout";
import { THEMES, type LitMode, type Theme, type ThemeName } from "./palette";
import { createPainter, LOOP_MS, TAU, type Painter } from "./painter";
import { rng } from "./rng";
import { FACE_KEY, remember, remembered } from "./settings";
import { glyphBits } from "./pixel-font";
import type { RoomSound } from "./sound";

/** The film sound's level: its mp3 sits near -8 LUFS, far above the room, so it plays at about a third. */
const FILM_VOLUME = 0.35;
/** How a film left the glass: it ran to its last frame, or a key or a change of channel cut it. */
export type FilmEnd = "ended" | "stopped";
/** The test pattern's bars, as densities of the phosphor, brightest at the left; the ramp the reels were drawn with, dark to bright. */
const BARS = [1, 0.86, 0.72, 0.58, 0.44, 0.3, 0.16];
const RAMP = " .:-=+*#%@";
import { HAS_WORKED, IDLE, RECENT, SEATS, WORKING, type Activity, type Block, type Layout, type MachineEvent, type MachineSnapshot, type SeatRecord, type Unit } from "./types";

/** How many characters the monitor's status line is sized for: "900 agents online · 3 working | 24h: 86 jobs · …". */
const STATUS_CHARS = 108;

/** The column count a width settled at, kept in the browser so the next visit's first paint is already right. */
function readCols(key: string): number | undefined {
  try { const v = Number(localStorage.getItem(key)); return v >= 20 && v <= 200 ? v : undefined; } catch { return undefined; }
}
function writeCols(key: string, cols: number) {
  try { localStorage.setItem(key, String(cols)); } catch { /* private mode */ }
}

/** What the card over a module says: who it is, how it is doing, and where the card points. */
export type Tip = {
  /** The module's first seat, which seeds its back, and its design's lot code if it saved one. */
  first: number;
  lot?: number | null;
  x: number;
  /** The module's left edge, where the card lines up. */
  left: number;
  y: number;
  bottom: number;
  /** The seat the module speaks for. */
  tokenId: number;
  /** Its holder and the seats they hold, when the wall is grouped by wallet. */
  owner: string | null;
  seats: number[];
  /** Its record, when it has one. */
  record: SeatRecord | null;
  /** The records of every seat the module holds that has one, for the card's rows. */
  held: SeatRecord[];
  /** What it holds this minute, when the feed knows. */
  current: { step: string; objective: string } | null;
  /** How busy it is. */
  activity: Activity;
  /** The label its holder stuck on it, when its design has one. */
  label: string | null;
};

/** Amber, for the reader's own modules: the one colour the wall keeps for them. */
/**
 * Steps worth naming in the feed: the ones a job has several of, so "passed" alone would not say
 * which. A one-step job's step (oracle_assess) is left off; the title says what the job was.
 */
const MULTI_STEP = new Set(["implement", "test", "review", "contract_review", "integrate", "manifest", "deploy", "publish", "build_contract_project", "build_dapp"]);
/** How dark the rest of the wall goes while the spotlight is on the reader's modules. */
const SPOT_DIM = 0.62;
/** The spotlight eases in over this long, and out in a little more than half of it, ms. */
const SPOT_IN_MS = 380;
const SPOT_OUT_MS = 220;
/** A web address in a line of the terminal, without the punctuation a sentence hangs on its end. */
const URL_RE = /https?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?…]/g;

export type MotionMode = "auto" | "off" | "all";

export type RendererOptions = {
  /** The page's monospace family, for the screens' type. */
  fontFamily: string;
  /** A round hundred of jobs was completed while the wall was up: the page may play a sound or ring the room. */
  onCelebrate?: (n: number) => void;
  /** The monitor was clicked off its tabs: the prompt wants the keyboard. */
  onFocus?: () => void;
  /** The monitor's back was clicked, the wall turned over: the page turns the wall to its front. */
  onFront?: () => void;
  /** A key in the reel's legend was tapped: "esc", "space", "w", "m", "n", "p", "x" or "← →". */
  onFilmKey?: (key: string) => void;
  /** The cog at the top right was clicked. */
  onSettings?: () => void;
  /** Where a tooltip should show, in CSS pixels from the canvas's top left, or null to hide. */
  onTip: (tip: Tip | null) => void;
  /** A module or the monitor was clicked: the page it leads to. */
  onOpen: (href: string) => void;
  /** A URL printed on the monitor was clicked. */
  onLink?: (href: string) => void;
  /** A wallet's device was clicked: its card should stay up, with its seats to read. */
  onPin?: (tip: Tip) => void;
  sound?: RoomSound | null;
  /** Skip the frame loop: the reader asked for reduced motion. */
  still?: boolean;
  /** The most of the wall's height the monitor may take; half unless a page asks for more, as the small frame at /buy does. */
  glass?: number;
  /** The sound switch beside the cog was pressed. */
  onListen?: () => void;
  /** A wall with no monitor, all panels: the page where a holder sees their panel in place. */
  bare?: boolean;
  /** Drawn somewhere else's page (the onchain art): the monitor is dark glass, and nothing is kept in the browser. */
  forget?: boolean;
};

type Mark = "up" | "down" | "unknown" | "ink" | "accent" | "ring" | "dim";

/** A line of a screen: text, or a run of marked segments across one line. */
type Row = { t: string; wt?: 400 | 600; col?: string | null; al?: number; mark?: Mark; segments?: Array<{ mark: Mark; t: string }>; lead?: { t: string; col: string; al?: number }; spans?: Array<{ t: string; wt?: 400 | 600; face?: number }> };
/**
 * A tab. A `feed` tab fills the glass from the bottom with its newest rows and types the last one
 * in. A tab with `columns` draws them side by side first, then its rows beneath.
 */
type Tab = { title: string; lamp?: string | null; prompt?: boolean; feed?: boolean; columns?: Row[][]; rows: Row[] };

/** A screen's inner geometry: the glass and the text column inside the bezel. */
type Screen = { x: number; y: number; w: number; h: number; sx: number; sy: number; sw: number; sh: number; tx: number; ty: number; tw: number; term: boolean };

/**
 * One face of the status line: a name, the figure beside it, what closes the bar, and how the
 * bar itself is drawn between the brackets. `draw` returns the x it left off at.
 */
type Face = {
  /** What the figure is, when it needs saying before the figure. A face whose words read better
   *  after the number leaves this out and says it all in the note. */
  name?: string;
  figure: string;
  /** The widest shape the figure can take, for a figure that changes often enough that the bar
   *  after it would visibly shuffle. The figure is drawn into that room. A face whose figure is
   *  all but settled leaves this out and is set tight, so nothing stands off it in a gap. */
  slot?: string;
  /** A quiet word after the figure saying what it counts, when the figure does not say it itself. */
  note?: string;
  /** What closes the bar. Empty when the face has nothing to say there, and nothing moves for it. */
  tail: string;
  /** The most cells this face's bar wants; the glass gives it fewer when there is not the room. */
  cells: number;
  draw: (bx: number, cells: number, chW: number, ink: string, fade: number) => number;
};

/** How long one panel takes to turn over, and how long the wave takes to cross the wall, ms. */
const FLIP_MS = 520;
const FLIP_WAVE_MS = 1300;
/** How long the monitor's tube shows before it turns back to its terminal, ms. */
const MONITOR_HOLD_MS = 1600;

/** How long a module keeps moving after the pointer leaves it, ms. */
const LINGER = 2200;
/** How long a module found from the prompt keeps its ring. */
const RING_MS = 4000;
/** Green on the terminal's glass, for what is up and what is working. */
const UP = "#3ecf7a";
/** The one warm accent on the glass, for the newest line, the cursor and the spinner: the orange Claude Code marks its own lines with. */
const CLAUDE = "#d97757";
/** A braille spinner, one frame every eighty milliseconds, while anything is working. */
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/** How long the banner stays on the glass after the room opens, ms. */
const BANNER_MS = 9_000;
/** A new line types itself in over this long, ms. */
const TYPE_MS = 700;
/** When the log first lands, its lines print one to a step, this far apart, ms. */
const PRINT_MS = 45;
/** A line just printed is at full brightness, and settles to its resting fade over this long, ms. */
const FLASH_MS = 260;
/** The time between paints, ms: thirty a second, or twenty on a machine the wall has found slow. */
const PAINT_MS = 1000 / 30;
const SLOW_PAINT_MS = 1000 / 20;
/** Where the desk image sits relative to the wall's width: its intrinsic aspect ratio. */
export const DESK_ASPECT = 152 / 1921;
/** On a phone the desk is drawn wider than the page and cropped, so the floor and the chair keep a size that reads. */
export const DESK_PHONE_SCALE = 3;
export const PHONE_MAX = 639;

export class WallRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly opts: RendererOptions;
  private snapshot: MachineSnapshot | null = null;
  private layout: Layout | null = null;
  private painter: Painter | null = null;
  private width = 0;
  private height = 0;
  private raf = 0;
  /**
   * The wall's pace: it paints thirty times a second, since nothing on it moves faster than a
   * needle, timed by the clock rather than counted in refreshes, so a 120 Hz screen does not
   * paint twice as often. On a machine that finds even that heavy, the paint is timed and the
   * wall settles: fewer modules drifting, twenty paints a second.
   */
  private every = PAINT_MS;
  /** When the last paint began, on the frame clock. */
  private painted = 0;
  /** A rolling mean of what a paint costs, in milliseconds. */
  private cost = 0;
  /** Off screen: the loop stops, and starts again when the wall scrolls back in. */
  private shown = true;
  /** The colours the wall is drawn in, chosen from the cog. */
  private theme: Theme = THEMES.steel;
  /** The wall turned over: every panel shows its circuit board. A prototype, not yet on the onchain renderer. */
  private backs = false;
  /** When the turn began, and which panels have finished turning; 0 when the wall is still. */
  private flipAt = 0;
  private flipDone: Uint8Array | null = null;
  private flipFrom: HTMLCanvasElement | null = null;
  private flipTo: HTMLCanvasElement | null = null;
  private flipIndex: Map<Unit, number> | null = null;
  /** The grid cells of the blank plates, painted again when the wall turns over. */
  private margins: number[] = [];
  /** Each panel's board, kept by its first seat, made again when its size or colours change. */
  private boards = new Map<number, { key: string; at: number; paint: (t: number, out: Uint32Array) => void; cv: HTMLCanvasElement; bx: CanvasRenderingContext2D; img: ImageData; out: Uint32Array }>();
  /** The monitor's back, made for its size and colours and kept; and whether the wave has still to turn it. */
  private monitorBack: { key: string; at: number; back: MonitorBack; cv: HTMLCanvasElement; bx: CanvasRenderingContext2D; img: ImageData; out: Uint32Array } | null = null;
  private monitorTurning = false;
  /**
   * The monitor shows its back only for a beat: the wave turns it with everything else, its tube shows, then it turns
   * itself back because the terminal is live. True once it faces the room again (and always, for a wall loaded turned over).
   */
  private monitorHomed = true;
  /** When the monitor starts turning back to the room, and the two pictures it turns between; 0 when it is not. */
  private homeAt = 0;
  private homePics: [HTMLCanvasElement, HTMLCanvasElement] | null = null;
  /** The LEDs' colour, and which modules are lit: working now, moved in the last day, or all. */

  private lit: LitMode = "active";
  private get ledColour() { return this.theme.lamp; }
  /** Whether a module's glass is lit under the current setting: 2 working, 1 on, 0 dark. */
  private litLevel(u: Unit): 0 | 1 | 2 {
    if (u.activity === WORKING) return 2;
    if (this.lit === "all") return 1;
    // active is what the card calls active: an agent behind any of its seats, ready or with a record
    if (this.lit === "active" && u.activity >= HAS_WORKED) return 1;
    return 0;
  }
  private get pal() { return this.theme.light; }
  /** The terminal's phosphor: the theme's lamp, written. */
  private get PHOSPHOR() { return this.theme.term.ink; }
  private get PHOSPHOR_DIM() { return this.theme.term.dim; }
  /** The line around a module: ink, or the darker line a dark theme names. */
  private get edge() { return this.pal.frame ?? this.pal.stroke; }
  /**
   * How the wall moves. Auto: a handful of modules drift at a time, picked at random. Off:
   * nothing drifts; the log still scrolls. All: every module drifts, in turns, a share of them
   * each paint, since two thousand at once is more than a frame holds.
   */
  private motion: MotionMode = "auto";
  /** The turns the modules that are on take, and in all-motion every module: each paints once every this many paints. */
  private turns = 4;
  private paints = 0;
  /** The last target height, so a theme change can lay the wall out again as it was. */
  private target = 0;
  private hot: number | null = null;
  /** The reader's own wallet, lower-cased, so their modules can be told from the rest. */
  private mine: string | null = null;
  /** The holders' designs, by lower-case wallet, as read from the chain; a wallet missing here draws its own module. */
  private designs = new Map<string, Design>();
  private readonly warm = new Map<number, number>();
  private readonly live = new Map<number, number>();
  private liveN = 24;
  /** The modules that are on, by index: active this week or working now, running all the time in turns. */
  private working: number[] = [];
  /** The feed's lines as last built, and what they were built from; rebuilt only when one of those changes. */
  private feedRows: { snapshot: MachineSnapshot; answers: Map<string, string>; names: Map<string, string>; second: number; rows: Row[] } | null = null;
  /** How many seats each holder has, by lowercase address, counted once per snapshot for the join lines. */
  private held: { snapshot: MachineSnapshot; by: Map<string, number> } | null = null;
  /** What the oracle answered, by job, for the feed's passed and scored lines. */
  private answers = new Map<string, string>();
  /** Holders' ENS names, by lowercase address, as the page resolves them; a join line names the wallet by it. */
  private names = new Map<string, string>();
  /** The spotlight: the pointer rests on the wallet's name, and everything but the reader's modules is dimmed. */
  private spot = false;
  /** How far the spotlight is in, 0 to 1; it eases in over a third of a second and out faster. */
  private spotLevel = 0;
  private spotFrom = 0;
  private spotAt = 0;
  /** The lit wall as it was when the spotlight came on, blended against while the level moves. */
  private spotBase: HTMLCanvasElement | null = null;
  /** The newest event's time, and when it arrived here, so the feed can type it in. */
  private newest: { at: string; since: number } | null = null;
  /** When the room opened, for the banner. */
  private readonly born = performance.now();
  /** When the first log landed, ms on the performance clock, or 0 while the plane is still being read. */
  private arrived = 0;
  /** What the wall was laid out from, so a refresh that moves nothing keeps every module where it is. */
  private laidFrom: { width: number; target: number; owners: Array<string | null> | undefined; nodes: string } | null = null;
  /** The prompt: what is typed, whether it has the keyboard, and what commands have printed. */
  private input = "";
  private focused = false;
  private echoes: Row[] = [];
  /**
   * A film on the glass: frames of text, played at their own rate over the feed, with a sound.
   * Typed in as a command; any key, or the end of the reel, takes it off.
   */
  private film: { cols: number; rows: number; fps: number; frames: string[]; began: number; audio: HTMLAudioElement | null; onEnd?: (why: FilmEnd) => void; wide: boolean; pausedAt: number | null; link: string | null; channel: { at: number; of: number } | null; ended: boolean; shown: number; loop: boolean; scale: number } | null = null;
  /** Modules the prompt pointed at, ringed until their warmth runs out. */
  private ringed = new Set<number>();
  /** Where each URL sits on the glass as of the last paint, in draw space, so a click can land on it. */
  private links: Array<{ x: number; y: number; w: number; h: number; href: string }> = [];
  // type metrics, set from the cell size
  private FS = 11; private LH = 17; private HEAD = 19; private PAD = 6; private BEZ = 4;

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions) {
    this.canvas = canvas;
    this.opts = opts;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
  }

  /** The wall's height for the last layout, in CSS pixels. */
  get wallHeight() { return this.height; }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    // a film's sound outlives nothing: the wall leaving the page, or being rebuilt under it, takes the reel with it
    if (this.film) { this.film.audio?.pause(); this.film = null; }
  }

  /** The wall's theme: its colours and its lamps. The wall is laid out again as it was and painted whole in them. */
  setTheme(name: ThemeName) {
    const next = THEMES[name];
    if (next === this.theme) return;
    this.theme = next;
    this.painter?.setLamp(this.ledColour);
    // a new palette paints every module, whatever the snapshot did or did not change
    if (this.snapshot && this.layout) this.layOut(this.snapshot, this.width, this.target);
  }

  /** Which modules are lit. Every module is painted again. */
  setLit(lit: LitMode) {
    if (lit === this.lit) return;
    this.lit = lit;
    const L = this.layout;
    if (L) for (const u of L.units) this.redraw(u, 0, false, false);
  }

  /** How the wall moves; see MotionMode. Every module is painted still, and the drift starts over. */
  setMotion(mode: MotionMode) {
    if (mode === this.motion) return;
    this.motion = mode;
    const L = this.layout;
    if (!L) return;
    this.live.clear();
    this.liveN = mode === "off" ? 0 : mode === "all" ? L.units.length : Math.min(48, Math.max(12, Math.round(L.units.length / 14)));
    for (const u of L.units) this.redraw(u, 0, false, false);
  }

  /** Whether the wall is on screen. Off it, the loop rests; back on, it runs again. */
  setShown(shown: boolean) {
    if (shown === this.shown) return;
    this.shown = shown;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (shown && this.layout && !this.opts.still) this.raf = requestAnimationFrame(this.frame);
  }

  /**
   * Take a fresh read of the swarm. When the picture has the same shape as the last one, the same
   * width, holders and nodes, the wall stays put: only the modules whose seats changed are
   * repainted, with the monitor, and whatever was moving keeps moving. Otherwise the wall is laid
   * out again and painted whole.
   */
  update(snapshot: MachineSnapshot, width: number, targetHeight: number) {
    this.target = targetHeight;
    const w = Math.max(280, width);
    const nodes = Object.keys(snapshot.seats).map(Number).sort((a, b) => a - b).join(",");
    const from = this.laidFrom;
    const same = snapshot.at !== 0 && this.layout != null && from != null && from.width === w && from.target === targetHeight && from.nodes === nodes && WallRenderer.sameOwners(from.owners, snapshot.owners);
    this.note(snapshot);
    if (same) { this.refresh(); return; }
    this.laidFrom = { width: w, target: targetHeight, owners: snapshot.owners, nodes };
    this.layOut(snapshot, w, targetHeight);
  }

  private static sameOwners(a: Array<string | null> | undefined, b: Array<string | null> | undefined): boolean {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** The indices of the modules that are on. */
  private static onIndices(units: Unit[]): number[] {
    const out: number[] = [];
    units.forEach((u, i) => { if (u.activity >= RECENT) out.push(i); });
    return out;
  }

  /** A refresh that moved nothing: the modules whose seats changed are repainted, and the monitor. */
  private refresh() {
    const L = this.layout!, m = this.snapshot!, now = Date.now();
    L.units.forEach((u, i) => {
      let activity: Activity = IDLE, last = 0;
      for (const x of u.ids) {
        const r = m.seats[x], a = activityOf(r, now);
        if (a > activity) activity = a;
        const t = r?.last ? new Date(r.last).getTime() : 0;
        if (t > last) last = t;
      }
      if (activity === u.activity && last === u.last) return;
      u.activity = activity; u.last = last;
      // a module that is drifting or warm is painted by the frame loop anyway, with its new state
      if (!this.warm.has(i) && !this.live.has(i)) this.redraw(u, 0, false, false);
    });
    this.working = WallRenderer.onIndices(L.units);
    this.drawBlocks(performance.now());
  }

  /** Which event is newest, for the line that types in, and when the first log landed. */
  private note(snapshot: MachineSnapshot) {
    // a round hundred of agents online at once is an occasion: fireworks on the glass, for a reader who has connected a
    // wallet, the first time this browser sees the count at or past that hundred, whether it crossed while they watched
    // or was already there when they arrived. Each hundred is celebrated once on this browser, ever, so a count hovering
    // at the line does not throw the party every few minutes; and never twice within an hour whatever the number
    const online = snapshot.health.agentsOnline;
    if (this.mine && online >= 100 && !this.party) {
      const mark = Math.floor(online / 100) * 100;
      if (WallRenderer.firstTime(mark)) this.celebrate(online, performance.now());
    }
    const top = snapshot.events[0]?.at;
    // the first log prints line by line, and its newest line types in once the rest are up
    // with reduced motion there is no frame loop to print by, so the log is simply there
    if (top && !this.arrived) { this.arrived = performance.now(); this.newest = { at: top, since: this.opts.still ? 0 : this.arrived }; }
    else if (top && top !== this.newest?.at) this.newest = { at: top, since: performance.now() };
    // one sample of the inference counter per read, for the bar's pulse; a plane that has not
    // answered yet says nothing, and a counter that has not moved is still a sample, since a
    // quiet minute is part of the trace
    if (snapshot.at && snapshot.counts.inferenceTokens > 0) {
      const last = this.pulse[this.pulse.length - 1];
      if (!last || snapshot.at > last.at) {
        this.pulse.push({ at: snapshot.at, tokens: snapshot.counts.inferenceTokens });
        // a cell to the read, and enough reads behind the oldest cell to fill its window
        while (this.pulse.length > WallRenderer.PULSE_CELLS + 8) this.pulse.shift();
      }
    }
    this.snapshot = snapshot;
  }

  /** Lay the wall out for a width and a target height, and paint it whole. */
  private layOut(snapshot: MachineSnapshot, width: number, targetHeight: number) {
    this.width = width;
    const previousBlocks = this.layout?.blocks;
    // Before the plane answers there are no modules to place. Laying out 2,000 unknown seats as
    // one-cell modules would make the cells tiny and then grow when the data lands, so the waiting
    // wall is bare plates at the column count this width settled at last time, or a guess near it.
    const waiting = snapshot.at === 0;
    const memory = `imd.wall.cols:${Math.round(this.width / 40)}`;
    // a desktop wall settles near 17px cells, a phone's a little larger, with its one-cell modules left out
    const resting = waiting ? (readCols(memory) ?? Math.round(this.width / (this.width < 640 ? 21 : 17))) : undefined;
    this.layout = solveLayout({
      resting,
      width: this.width,
      targetHeight,
      total: SEATS,
      seats: snapshot.seats,
      owners: snapshot.owners,
      previousBlocks,
      // a phone draws none of the one-cell modules, which are too small to read at that width
      keep: this.width < 640 ? 0 : 1,
      monitorPad: 0,
      monitorSize: (cell, cols) => this.monitorSize(cell, cols),
      // the sound switch is in the site's bar now; the cog keeps a square of two cells at the top right. A bare wall keeps
      // no room for it: it is panels only
      cogSize: this.opts.bare ? 0 : 2,
      playSize: this.opts.bare ? 0 : 2,
    });
    const L = this.layout;
    if (!waiting && !this.opts.forget) writeCols(memory, L.cols);
    this.setMetrics(L.cell);
    this.height = L.rows * L.cell;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // a trace's sharp corners would otherwise grow mitres past the glass: a mitre on a tight angle runs to ten times the line's half width
    this.ctx.lineJoin = "round";
    this.painter = createPainter(this.ctx, L.cell, this.theme.light, this.theme.dark);
    this.painter.setLamp(this.ledColour);

    const ctx = this.ctx;
    ctx.fillStyle = this.pal.wall;
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawBlocks(0);
    // the cells nothing claimed, and the column of wall either side of the monitor: blank plates,
    // so the wall reads as wall and not as a hole
    const margin = (i: number) => {
      const v = L.grid[i];
      if (v == null || v <= HOLE) return true;
      if (v >= 0) return false;
      const bk = L.blocks[-1 - v]!, col = i % L.cols, pad = bk.pad ?? 0;
      return bk.kind === "monitor" && (col < bk.c + pad || col >= bk.c + bk.w - pad);
    };
    this.margins = [];
    for (let i = 0; i < L.rows * L.cols; i++) if (margin(i)) this.margins.push(i);
    this.paintMargins();
    for (const u of L.units) this.draw(u, 0, false, false);

    this.working = WallRenderer.onIndices(L.units);
    this.liveN = this.motion === "off" ? 0 : this.motion === "all" ? L.units.length : Math.min(48, Math.max(12, Math.round(L.units.length / 14)));
    this.live.clear(); this.warm.clear(); this.hot = null;
    cancelAnimationFrame(this.raf);
    if (!this.opts.still && this.shown) this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ metrics and text

  private setMetrics(cell: number) {
    this.FS = Math.max(9, Math.min(13, cell * 0.5));
    this.LH = this.FS * 1.55;
    // the status line, air, its rule, air again, then the feed
    this.HEAD = this.FS * 2.5;
    this.PAD = Math.max(8, cell * 0.5);
    this.BEZ = Math.max(4, cell * 0.26);
  }
  private mono(wt: 400 | 600) { return `${wt} ${this.FS}px ${this.opts.fontFamily}`; }
  private measure(t: string, wt: 400 | 600 = 400) { this.ctx.font = this.mono(wt); return this.ctx.measureText(t).width; }

  // ------------------------------------------------------------------ what the monitor says

  private static hhmm(iso: string) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "--:--" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  /**
   * One terminal line for an event: time, a five-letter kind, who, what.
   *
   * The kind is the vocabulary of the feed — NEW, WORK, PASS, FAIL, QUEUE, CHECK, CHAIN, SITE,
   * LIVE, JOIN — and the who column is the agent when there is one, so a reader can watch a
   * single seat's day go by.
   */
  /**
   * An objective on one line. The monitor cuts a line to its own width when it is drawn, so this
   * only collapses whitespace and bounds the very longest texts, so a wide monitor shows all it can.
   */
  private static short(text: string, max = 240): string {
    const t = text.replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    // back to a word break, and never leave a separator or a comma hanging before the ellipsis
    return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 12)).replace(/[\s·,;:]+$/, "")}…`;
  }
  /**
   * One terminal line for an event: time, a five-letter kind, who, what.
   *
   * The kind is the vocabulary of the feed — NEW, WORK, PASS, FAIL, QUEUE, CHECK, CHAIN, SITE,
   * LIVE, JOIN — and the who column is the agent when there is one, so a reader can watch a
   * single seat's day go by. The work is named once: a line on the same job as the line before
   * it shows only its step, so a burst of activity on one job reads as a burst.
   */
  /** A chain by its name, the way a reader says it. */
  private static chainName(id: number | string) { const n = Number(id); return n === 1 ? "Ethereum" : n === 8453 ? "Base" : n === 11155111 ? "Sepolia" : `chain ${n}`; }
  /**
   * What kind of job it is, from its objective and step: an oracle question, a contract, a site,
   * research, or a job. The plane does not say, so the words in the objective have to.
   */
  static kindOf(objective: string, step?: string | null): string {
    const o = objective.toLowerCase(), st = (step ?? "").toLowerCase();
    if (/^answer this question about chain \d+ over blocks/.test(o.trim()) || st === "oracle_assess") return "oracle";
    const contract = /\b(contract|hook|token|foundry|solidity)\b/.test(o) || /contract|manifest/.test(st);
    const site = /\b(dapp|website|web app|frontend|landing page|site)\b/.test(o) || /site|dapp/.test(st);
    // a contract with a site in front of it, deployed and seeded, is what the plane counts as a launch
    if (contract && site) return "launch";
    if (site) return "site";
    if (contract) return "contract";
    if (/\b(research|report|analy[sz]e|survey|write up|investigate)\b/.test(o)) return "research";
    return "job";
  }
  /**
   * A job's title: what it asks, not the prompt it was asked with. An oracle job's objective is a
   * template around one question; the template goes and the question stays, with its chain named
   * at the end. Any other objective is its first sentence.
   */
  static title(objective: string): string {
    let t = objective.replace(/\s+/g, " ").trim();
    const oracle = /^Answer this question about chain \d+ over blocks \d+ to \d+, exactly as \S+ pins it:\s*/i.exec(t);
    if (oracle) t = t.slice(oracle[0].length);
    t = t.replace(/\s*Write only artifacts\/answer\.json.*$/i, "");
    // the first sentence; a question keeps its mark off, since the line is the question
    const end = t.search(/[.?!](\s|$)/);
    if (end > 0) t = t.slice(0, end);
    t = t.replace(/,? as of the pinned window/i, "");
    // "What is the floor price of X" is "Floor price of X"; other question words carry their grammar and stay
    t = t.replace(/^what (is|was|are|were) (the )?/i, "").trim();
    t = t.charAt(0).toUpperCase() + t.slice(1);
    return t || objective.slice(0, 60);
  }

  /**
   * One terminal line for an event, as a sentence: who acted, what they did, what they did it
   * to, then the result. The actors are the agents, the three systems the header lights, and the
   * swarm itself for what the plane does on its own. The verb is set bold, the way Claude Code
   * sets a tool's name, so no legend is needed. `kind` survives for the colours.
   */
  /** The explorer's word for a step, by its role: done, doing, and to do. */
  private static readonly STEP_WORD: Record<string, [string, string, string]> = {
    implement: ["built", "building", "build"], build_contract_project: ["built", "building", "build"], build_dapp: ["built", "building", "build"],
    test: ["tested", "testing", "test"], tests: ["tested", "testing", "test"],
    review: ["reviewed", "reviewing", "review"], contract_review: ["reviewed", "reviewing", "review"],
    integrate: ["integrated", "integrating", "integrate"], manifest: ["attested", "attesting", "attest"],
    deploy: ["deployed", "deploying", "deploy"], publish: ["published", "publishing", "publish"],
  };
  private static stepWord(role: string, step: string, form: 0 | 1 | 2): string | null {
    return (WallRenderer.STEP_WORD[role] ?? WallRenderer.STEP_WORD[step])?.[form] ?? null;
  }

  private static feedLine(e: MachineEvent, sameJob: boolean, answer?: string | null, again = false, seat?: SeatRecord | null, holder?: { name: string; seats: number } | null): { t: string; kind: string; spans: Array<{ t: string; wt?: 400 | 600; face?: number }> } {
    const time = WallRenderer.hhmm(e.at);
    const join = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(" · ");
    // the title, unless the line above is the same job and the ⎿ already says so; the kind is not repeated in it, the
    // job line and the explorer both say it once
    const title = (text: string, _step?: string | null) => (sameJob ? null : WallRenderer.title(text));
    let kind: string, actor: string, verb: string, object: string;
    // the line's first word after the time says what kind of thing moved: a job, an oracle question, or an agent joining
    // the kind column says what moved: a job, an oracle question, or a seat; the actor column always names the agent the same way
    const what = e.kind === "agent" ? "joined" : WallRenderer.kindOf("objective" in e ? e.objective : "", "step" in e ? e.step : null) === "oracle" ? "oracle" : "job";
    const oracle = what === "oracle";
    switch (e.kind) {
      // posting and queueing have no actor the plane names, so the job's kind stands in the actor's place: an oracle is asked, the rest are posted
      case "job": { kind = "NEW"; actor = "swarm"; verb = oracle ? "asked" : "posted"; object = WallRenderer.title(e.objective); break; }
      // the job's last line: completed, and how many steps it took; or stopped, with the reason in plain words
      case "done": {
        const name = WallRenderer.title(e.objective);
        if (e.state === "completed") { kind = "PASS"; actor = "swarm"; verb = oracle ? "signed" : "completed"; object = join(name, oracle ? null : `${e.steps} step${e.steps === 1 ? "" : "s"}`); }
        else if (e.state === "cancelled") { kind = "QUEUE"; actor = "swarm"; verb = "cancelled"; object = name; }
        else { kind = "FAIL"; actor = "swarm"; verb = "stopped"; object = join(name, e.failure ? WallRenderer.short(e.failure) : null); }
        break;
      }
      case "node": {
        const agent = e.tokenId == null ? "swarm" : `agent #${e.tokenId}`;
        const cancelled = e.state === "failed" && /cancel/i.test(e.reason ?? "");
        // the step is named only where it tells the reader something: a multi-step job, or the step an agent is on now
        const step = MULTI_STEP.has(e.step) || e.state === "leased" || e.state === "working" ? e.step : null;
        // what the oracle answered leads the verdict, ahead of the title, so it is never cut off by a long question
        // an oracle's steps are answers, whatever the template calls them; a job's take the explorer's words
        const done = oracle ? "answered" : WallRenderer.stepWord(e.role, e.step, 0), doing = oracle ? "working" : WallRenderer.stepWord(e.role, e.step, 1);
        // a step line uses the explorer's word for the step: built, reviewed, integrated; the oracle's answer leads its verdict
        if (e.state === "accepted") { kind = "PASS"; actor = agent; verb = done ?? "passed"; object = join(answer, title(e.objective, e.step), done ? null : step); }
        // a cancellation has no actor either: the job's kind stands in, and the title follows without repeating it
        else if (cancelled) { kind = "QUEUE"; actor = "swarm"; verb = "cancelled"; object = join(sameJob ? null : WallRenderer.title(e.objective), step); }
        // the title leads and the result trails, so the titles line up down the glass
        else if (e.state === "failed") { kind = "FAIL"; actor = agent; verb = "failed"; object = join(title(e.objective, e.step), step, e.reason ? WallRenderer.short(e.reason) : null); }
        // a step with a seat named on it while still ready has been offered to that seat: the plane called it, and waits
        else if (e.state === "ready" || e.state === "waiting") { kind = "QUEUE"; actor = agent; verb = e.tokenId == null ? "queued" : "called"; object = join(WallRenderer.title(e.objective), step); }
        else if (e.state === "leased" || e.state === "working") { kind = "WORK"; actor = agent; verb = doing ?? "working"; object = join(title(e.objective, e.step), doing ? null : step); }
        else { kind = "CHECK"; actor = agent; verb = "verifying"; object = join(title(e.objective, e.step), step); }
        break;
      }
      // the one line a job writes to the chain: the verdicts, as a record. With the split, how many were accepted
      case "review": {
        kind = "CHAIN"; actor = "verifier"; verb = "onchain";
        const n = e.scores, a = e.accepted;
        const what = a == null ? `${n} score${n === 1 ? "" : "s"}` : a === n ? `${n} score${n === 1 ? "" : "s"}, all accepted` : a === 0 ? `${n} score${n === 1 ? "" : "s"}, all rejected` : `${n} scores, ${a} accepted`;
        object = join(title(e.objective), what);
        break;
      }
      // the site is hosted once it has its name: that is the line people share
      case "site": kind = "SITE"; actor = "publisher"; verb = e.ensName ? "hosted" : "published"; object = join(title(e.objective), e.ensName ?? (e.cid ? `${e.cid.slice(0, 16)}…` : null)); break;
      case "launch": kind = "LIVE"; actor = "deployer"; verb = "deployed"; object = join(e.token ?? `launch ${e.launchNumber}`, WallRenderer.chainName(e.chainId)); break;
      // the plane's join is the worker's connection time; an agent already seen at work before it only reconnected.
      // The join line says who arrived: whose seat it is, how many the holder has, and how long the seat was away
      case "agent": {
        kind = "JOIN"; actor = `agent #${e.tokenId}`;
        const a = seat?.accepted ?? 0, f = seat?.failed ?? 0;
        // the plane's record is the seat's whole history, and `last` is a moment it worked, never a heartbeat.
        // A seat whose submissions are all still being judged has worked too, so the moment counts on its own
        const last = seat?.last ?? null, away = last ? Date.now() - new Date(last).getTime() : null;
        const worked = a + f > 0 || last != null;
        // the verb is the arrival: a seat with no record is ready, one that has worked before is awake
        verb = worked || again ? "awake" : "ready";
        // what an arrival is worth saying is time, not a tally: a seat with nothing behind it is new to the
        // wall, and one with a record says how long it has been gone. An hour or a week reads as an arrival
        const record = !worked ? "first shift" : away == null ? null : away < 3_600_000 ? `last worked ${ago(last)}` : `back after ${ago(last).replace(/ ago$/, "")}`;
        // whose it is, by name or address, and how many the holder has when more than one
        const who = holder ? (holder.seats > 1 ? `${holder.name}, ${holder.seats} seats` : holder.name) : "";
        // the seat's sigil before the holder, so the marks line up down the glass; the record trails the holder,
        // where it is the first thing a narrow line gives up
        const spans = [{ t: `${time.padEnd(7)}${what.padEnd(8)}${actor.padEnd(13)}` }, { t: verb.padEnd(13), wt: 600 as const }, { t: who, face: e.tokenId }, ...(record ? [{ t: who ? ` · ${record}` : record }] : [])];
        return { t: spans.map((x) => x.t).join(""), kind, spans };
      }
    }
    // columns of fixed words, the verb bold, then the object; the actor column takes a four-digit seat with a space to spare
    const spans = [{ t: `${time.padEnd(7)}${what.padEnd(8)}${actor.padEnd(13)}` }, { t: verb.padEnd(13), wt: 600 as const }, { t: object }];
    return { t: spans.map((x) => x.t).join(""), kind, spans };
  }
  /** The job an event belongs to, for telling consecutive lines on one job apart from a change of job. */
  private static jobOf(e: MachineEvent): string | null {
    return e.kind === "launch" || e.kind === "agent" ? null : e.jobId;
  }
  private static fmt(n: number | null | undefined) { return n == null ? "·" : n.toLocaleString("en-US"); }
  /** A figure the way a reader says it: 3.1B, 412M, 58K. Exact under a thousand. */
  private static compact(n: number) {
    return n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
  }
  private static up(v: boolean | null): Mark { return v == null ? "unknown" : v ? "up" : "down"; }
  /** The next 1, 2 or 5 of a decade at or above n: a scale that holds still between the steps. */
  private static step(n: number) {
    const decade = 10 ** Math.floor(Math.log10(n));
    return (([1, 2, 5, 10].find((f) => n <= f * decade) ?? 10) * decade);
  }

  private tabs(now: number): Tab[] {
    const m = this.snapshot!, hh = m.health, cc = m.counts, ev = m.events, A = this.pal.accent, f = WallRenderer.fmt;
    const lamp = hh.workingNow > 0 ? UP : null;
    // the feed, oldest first, so it reads down the glass to the newest line above the prompt
    // a review that scored nothing says nothing about the agents: it is left out of the feed
    const oldestFirst = [...ev].reverse().filter((e) => !(e.kind === "review" && !e.scores));
    const folded = oldestFirst;
    // the plane clips a posted job's objective; the fullest text on the same job stands in for it
    const fullest = new Map<string, string>();
    for (const e of ev) if ("objective" in e && e.objective && (fullest.get(e.jobId)?.length ?? 0) < e.objective.length) fullest.set(e.jobId, e.objective);
    const filled = (e: MachineEvent): MachineEvent => (e.kind === "job" && fullest.has(e.jobId) ? { ...e, objective: fullest.get(e.jobId)! } : e);
    // the lines are the same from one paint to the next until the picture, the answers or the names change; a join
    // line says how long ago in seconds, so they are also built again each second, and no more often than that
    const second = Math.floor(Date.now() / 1000), was = this.feedRows;
    if (ev.length && was && was.snapshot === m && was.answers === this.answers && was.names === this.names && was.second === second) {
      return [{ title: "LIVE", lamp, prompt: true, feed: true, rows: was.rows.concat(this.echoes) }];
    }
    // the seats agents have been seen working on, as the feed reads down to each line
    const worked = new Set<number>();
    const feed: Row[] = ev.length
      ? folded.map((e, i): Row => {
          const prev = folded[i - 1];
          const sameJob = prev != null && WallRenderer.jobOf(prev) != null && WallRenderer.jobOf(prev) === WallRenderer.jobOf(e);
          const again = e.kind === "agent" && worked.has(e.tokenId);
          if (e.kind === "node" && e.tokenId != null) worked.add(e.tokenId);
          const seat = e.kind === "agent" ? m.seats[e.tokenId] ?? null : null;
          const owner = e.kind === "agent" ? m.owners?.[e.tokenId]?.toLowerCase() ?? null : null;
          const holder = owner ? { name: this.names.get(owner) ?? `${owner.slice(0, 6)}…${owner.slice(-4)}`, seats: this.seatsHeld(m).get(owner) ?? 0 } : null;
          const { t, kind, spans } = WallRenderer.feedLine(filled(e), sameJob, "jobId" in e ? this.answers.get(e.jobId) : null, again, seat, holder);
          // the lead is plain ascii, the way a log marks its lines: a star for a line of its own, a bracket for one that
          // continues the job above; the colour says pass or fail
          const lead = { t: sameJob ? "⎿" : ">", col: kind === "FAIL" ? A : kind === "PASS" ? UP : this.PHOSPHOR_DIM };
          const quiet = kind === "QUEUE" || kind === "CHECK";
          return { t, spans, col: kind === "FAIL" ? A : null, al: quiet ? 0.55 : 1, lead };
        })
      : !hh.reachable ? [{ t: "control plane unreachable", col: A }]
      // still reading: a spinner and the seconds it has taken, the way Claude Code waits on a tool
      : m.at === 0 ? [{ t: `Reading the control plane… (${Math.floor((now - this.born) / 1000)}s)`, al: 0.7, lead: { t: SPINNER[Math.floor(now / 80) % SPINNER.length]!, col: CLAUDE } }]
      : [{ t: "no events yet" }];
    if (ev.length) this.feedRows = { snapshot: m, answers: this.answers, names: this.names, second, rows: feed };
    return [{ title: "LIVE", lamp, prompt: true, feed: true, rows: feed.concat(this.echoes) }];
  }

  /** Seats per holder, lowercase address to count, counted once for each snapshot. */
  private seatsHeld(m: MachineSnapshot): Map<string, number> {
    if (this.held?.snapshot === m) return this.held.by;
    const by = new Map<string, number>();
    for (const o of m.owners ?? []) if (o) { const k = o.toLowerCase(); by.set(k, (by.get(k) ?? 0) + 1); }
    this.held = { snapshot: m, by };
    return by;
  }

  /**
   * The status line across the monitor's top: the figures a reader wants at a glance, in the
   * order they matter, and at the right the three systems as lamps. What the glass is too narrow
   * for is dropped from the end, never wrapped.
   */
  private status(): { groups: Array<Array<{ n: string; word: string }>>; systems: Array<{ name: string; up: boolean | null }> } {
    const m = this.snapshot!, hh = m.health, cc = m.counts, f = WallRenderer.fmt;
    return {
      // what moves while a reader watches: who is online, who is working when anyone is, what passed today;
      // then the one lifetime figure that only grows. Launches and sites live in the status command and on the explorer
      groups: hh.reachable
        ? [
            [{ n: f(hh.agentsOnline), word: hh.agentsOnline === 1 ? "agent online" : "agents online" }, { n: f(hh.workingNow), word: "working" }],
            // the day's output, led by its label: jobs, oracle questions, and the steps that made them
            [{ n: "", word: "24h:" }, { n: f(hh.jobsDoneLastDay ?? 0), word: hh.jobsDoneLastDay === 1 ? "job" : "jobs" }, { n: f(hh.oraclesDoneLastDay ?? 0), word: hh.oraclesDoneLastDay === 1 ? "oracle" : "oracles" }, { n: f(hh.acceptedLastDay), word: hh.acceptedLastDay === 1 ? "step" : "steps" }],
          ]
        : [[{ n: "", word: "control plane unreachable" }]],
      systems: [{ name: "verifier", up: hh.verifierUp }, { name: "publisher", up: hh.publisherUp }, { name: "deployer", up: hh.deployerUp }],
    };
  }

  /** The width of a status group as drawn: bright figures, dim words, dots between. */
  private groupWidth(items: Array<{ n: string; word: string }>): number {
    const { ctx, FS } = this;
    return items.reduce((w, it, i) => {
      ctx.font = this.mono(600); const nw = it.n ? ctx.measureText(it.n).width + FS * 0.55 : 0;
      ctx.font = this.mono(400); const ww = ctx.measureText(it.word).width;
      return w + nw + ww + (i < items.length - 1 ? ctx.measureText(it.n ? " · " : " ").width : 0);
    }, 0);
  }

  /** Draws a status group at x, bright figures and dim words, held back by a factor when asked; returns where it ended. */
  private group(S: Screen, x: number, y: number, items: Array<{ n: string; word: string }>, ink: string, fade = 1): number {
    const { ctx, FS } = this;
    ctx.textBaseline = "top";
    items.forEach((it, i) => {
      if (it.n) { ctx.font = this.mono(600); ctx.fillStyle = ink; ctx.globalAlpha = 0.95 * fade; ctx.fillText(it.n, x, y); x += ctx.measureText(it.n).width + FS * 0.55; }
      ctx.font = this.mono(400); ctx.fillStyle = ink; ctx.globalAlpha = 0.6 * fade; ctx.fillText(it.word, x, y); x += ctx.measureText(it.word).width;
      // a label with no figure leads its group with a space, not a dot
      if (i < items.length - 1) { const sep = it.n ? " · " : " "; ctx.globalAlpha = 0.35 * fade; ctx.fillText(sep, x, y); x += ctx.measureText(sep).width; }
    });
    ctx.globalAlpha = 1;
    return x;
  }

  /** How many times each module has been pressed, by its first seat: a press lands it somewhere new. */
  /** Modules mid-flash from a press, by first seat, until when. */
  private flash = new Map<number, number>();
  /** $IMD's market cap against the goal, read by the page from Dexscreener; null until it answers. */
  private market: { cap: number | null; goal: number } = { cap: null, goal: 1_000_000_000 };

  setMarket(market: { cap: number | null; goal: number }) {
    this.market = market;
    if (this.layout) this.drawBlocks(performance.now());
  }

  /**
   * The bar's two faces: the market's opinion of the machine, and the machine's own pulse. A
   * click on the left of the status line turns it over.
   */
  private face: 0 | 1 = remembered(FACE_KEY, ["0", "1"] as const, "0") === "1" ? 1 : 0;
  /** The pointer is on the part of the bar that turns.*/
  private footHot = false;
  /** Where that part sits on the glass as of the last paint, in draw space. */
  private foot: { x: number; y: number; w: number; h: number } | null = null;
  /**
   * The inference the swarm has spent, sampled once per read of the plane. The counter only
   * rises, so the gap between two samples is what was spent between them.
   */
  private pulse: Array<{ at: number; tokens: number }> = [];
  /** The goal bar is a short read: a figure against a number it is heading for. */
  private static GOAL_CELLS = 24;
  /** The trace is a long one: it is the reading, not a decoration beside it. */
  private static PULSE_CELLS = 50;
  /**
   * A cell to the read, so the trace steps on every read of the plane rather than making a
   * reader wait out a minute for it to move. What each cell carries is the rate over the minute
   * behind it, not the gap since the read before: the counter lands in lumps a minute or so
   * apart, so a bare gap would be three empty cells in four and a trace of spikes standing in
   * nothing. The minute behind each read is the same minute the figure is quoted in.
   */
  private static WINDOW_MS = 60_000;
  /** The y the status line is drawn at, so a face draws its bar on the same line as its name. */
  private footY = 0;

  /**
   * The trace: tokens a minute, a cell to the minute, oldest first, the newest cell last. The
   * minutes are counted back from the newest sample, so the trace does not shuffle along under
   * a reader between reads. A minute the plane said nothing in is a real nothing and stays in.
   */
  private rates(): number[] {
    const { WINDOW_MS, PULSE_CELLS } = WallRenderer;
    const p = this.pulse;
    const out: number[] = [];
    for (let i = 1; i < p.length; i++) {
      const b = p[i]!;
      // back to the last read at or before the window opens, so the cell covers a whole minute
      // and the lump that landed on the boundary is inside it; or to the oldest read there is,
      // so a page up less than a minute still gets a rate over as much of one as it has watched
      let j = i - 1;
      while (j > 0 && p[j]!.at > b.at - WINDOW_MS) j--;
      const a = p[j]!;
      const mins = (b.at - a.at) / 60_000;
      if (mins > 0) out.push(Math.max(0, (b.tokens - a.tokens) / mins));
    }
    return out.slice(-PULSE_CELLS);
  }

  /** Whether the room is playing, for the switch's lamp; the pointer on the switch. */
  private listening = false;
  private playHot = false;
  setListening(on: boolean) {
    if (on === this.listening) return;
    this.listening = on;
    if (this.layout) this.drawBlocks(performance.now());
  }
  private hotPlay(on: boolean) {
    if (on === this.playHot) return;
    this.playHot = on;
    this.drawBlocks(performance.now());
  }

  /** The sound switch: a plate the cog's size beside it, play or pause on it and a lamp lit while the room sounds. */
  private drawPlay(bk: Block) {
    const L = this.layout!, { ctx } = this, cell = L.cell;
    const x = bk.c * cell + 1, y = bk.r * cell + 1, w = bk.w * cell - 2, h = bk.h * cell - 2, s = Math.min(w, h);
    ctx.fillStyle = this.pal.face; ctx.fillRect(x, y, w, h);
    if (this.playHot) { ctx.fillStyle = "#fff"; ctx.globalAlpha = 0.22; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; }
    ctx.strokeStyle = this.edge; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = this.pal.stroke;
    for (const [sx, sy] of [[x + s * 0.12, y + s * 0.12], [x + w - s * 0.12, y + s * 0.12], [x + s * 0.12, y + h - s * 0.12], [x + w - s * 0.12, y + h - s * 0.12]]) { ctx.beginPath(); ctx.arc(sx!, sy!, Math.max(1, s * 0.03), 0, TAU); ctx.fill(); }
    const cx = x + w / 2, cy = y + h / 2, r = s * 0.17;
    if (this.listening) { const bw = r * 0.55; ctx.fillRect(cx - r * 0.8, cy - r, bw, r * 2); ctx.fillRect(cx + r * 0.8 - bw, cy - r, bw, r * 2); }
    else { ctx.beginPath(); ctx.moveTo(cx - r * 0.7, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx - r * 0.7, cy + r); ctx.closePath(); ctx.fill(); }
    // the lamp, lit while the room plays
    ctx.fillStyle = this.listening ? this.pal.ok : this.pal.stroke; ctx.globalAlpha = this.listening ? 1 : 0.28;
    ctx.beginPath(); ctx.arc(x + w - s * 0.24, y + s * 0.24, Math.max(1.5, s * 0.055), 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    if (this.playHot) this.ring(x, y, w, h);
  }

  private cogHot = false;
  private hotCog(on: boolean) {
    if (on === this.cogHot) return;
    this.cogHot = on;
    this.drawBlocks(performance.now());
  }

  /** The cog: a two-cell plate at the top right with a gear on it, the room's settings. */
  private drawCog(bk: Block) {
    const L = this.layout!, { ctx } = this, cell = L.cell;
    const x = bk.c * cell + 1, y = bk.r * cell + 1, w = bk.w * cell - 2, h = bk.h * cell - 2;
    ctx.fillStyle = this.pal.face; ctx.fillRect(x, y, w, h);
    if (this.cogHot) { ctx.fillStyle = "#fff"; ctx.globalAlpha = 0.22; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; }
    ctx.strokeStyle = this.edge; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    // a module of its own, two cells square: its screws at the corners, a cog in the middle drawn in the wall's line
    const s = Math.min(w, h), cx = x + w / 2, cy = y + h / 2, r = s * 0.13;
    ctx.fillStyle = this.pal.stroke;
    for (const [sx, sy] of [[x + s * 0.12, y + s * 0.12], [x + w - s * 0.12, y + s * 0.12], [x + s * 0.12, y + h - s * 0.12], [x + w - s * 0.12, y + h - s * 0.12]]) { ctx.beginPath(); ctx.arc(sx!, sy!, Math.max(1, s * 0.03), 0, TAU); ctx.fill(); }
    ctx.strokeStyle = this.pal.stroke; ctx.lineWidth = Math.max(1.5, s * 0.06);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    // eight teeth
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU, r1 = r + ctx.lineWidth * 0.3, r2 = s * 0.25;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
    }
    ctx.lineWidth = 1;
    if (this.cogHot) this.ring(x, y, w, h);
  }

  private monitorSize(cell: number, cols: number) {
    if (this.opts.bare) return { w: 0, h: 0 };
    this.setMetrics(cell);
    const { FS, PAD, BEZ, HEAD, LH } = this;
    // about half the wall, so a question reads whole; never narrower than the status line
    const minW = Math.min(this.width * 0.54, 780) - PAD * 2 - BEZ * 2;
    // room for the status line at its usual length, counted in a monospaced face's advance (0.6 of its size) rather than
    // measured: the wall's layout must be the same whatever the numbers say and whatever face the machine has, because the
    // onchain renderer lays out this same wall to find a holder's panel
    const lineW = STATUS_CHARS * FS * 0.6;
    const textW = Math.max(minW, lineW);
    // a phone's wall is one column of modules, so its glass runs taller: more of the log, the way the room reads there
    const rowsN = (this.width < 640 ? 18 : 12) + 4.2;
    const rowsGuess = Math.ceil(2600 / cols);
    return {
      w: Math.min(cols, Math.ceil((textW + PAD * 2 + BEZ * 2 + FS * 1.2) / cell)),
      h: Math.min(Math.ceil(rowsGuess * (this.opts.glass ?? 0.5)), Math.ceil((HEAD + rowsN * LH + PAD * 1.6 + BEZ * 2) / cell)),
    };
  }

  // ------------------------------------------------------------------ screens

  /** Bezel, glass, inner bevel; a terminal adds phosphor and scanlines. */
  private chrome(x: number, y: number, w: number, h: number, hot: boolean, term: boolean): Screen {
    const { ctx, BEZ, PAD } = this;
    ctx.fillStyle = this.pal.face; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = this.edge; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (hot) this.ring(x, y, w, h);
    const sx = x + BEZ, sy = y + BEZ, sw = w - BEZ * 2, sh = h - BEZ * 2;
    ctx.fillStyle = term ? "#040604" : this.pal.screen; ctx.fillRect(sx, sy, sw, sh);
    if (term) { ctx.fillStyle = "#000"; ctx.globalAlpha = 0.28; for (let ly = sy + 1; ly < sy + sh; ly += 3) ctx.fillRect(sx, ly, sw, 1); ctx.globalAlpha = 1; }
    ctx.strokeStyle = term ? this.PHOSPHOR : this.pal.face; ctx.globalAlpha = 0.18; ctx.strokeRect(sx + 1.5, sy + 1.5, sw - 3, sh - 3); ctx.globalAlpha = 1;
    return { x, y, w, h, sx, sy, sw, sh, tx: sx + PAD, ty: sy + PAD * 0.8, tw: sw - PAD * 2, term };
  }

  /** Tabs across the top, a lamp at the right, a rule beneath. Returns the y the rows start at. */
  private header(S: Screen, bk: Block, now: number): number {
    const { ctx, FS, PAD, HEAD } = this;
    const ink = S.term ? this.PHOSPHOR : this.pal.face;
    bk.tabRects = [];
    const { groups, systems } = this.status();
    // while anything is working, a spinner turns at the left, in the accent, the way Claude Code waits
    const busy = this.snapshot!.health.workingNow > 0;
    let lineX = S.tx;
    if (busy) {
      ctx.font = this.mono(600); ctx.textBaseline = "top";
      ctx.fillStyle = CLAUDE; ctx.fillText(SPINNER[Math.floor(now / 80) % SPINNER.length]!, S.tx, S.ty);
      lineX += FS * 1.5;
    }
    // the systems at the right, named when there is room, lamps alone when there is not
    ctx.font = this.mono(400);
    const lampW = this.measure("*"), gap = FS * 1.2;
    const named = systems.reduce((w, sy) => w + lampW + FS * 0.5 + ctx.measureText(sy.name).width + gap, 0) - gap;
    const bare = systems.length * (lampW + FS * 0.6) - FS * 0.6;
    const divider = FS * 2.4;
    const full = groups.reduce((w, g) => w + this.groupWidth(g), 0) + divider * (groups.length - 1);
    const sysW = lineX - S.tx + full + FS * 2 + named <= S.tw ? named : bare;
    const room = S.tw - sysW - FS * 1.5 - (lineX - S.tx);
    // the swarm's own figures always show; the output group shortens from its end until it fits
    const shown = groups.map((g) => [...g]);
    while (shown.length > 1 && shown[1]!.length > 0 && shown.reduce((w, g) => w + this.groupWidth(g), 0) + divider > room) shown[1]!.pop();
    if (shown[1]?.length === 0) shown.pop();
    let gx = lineX;
    shown.forEach((g, i) => {
      gx = this.group(S, gx, S.ty, g, ink);
      if (i < shown.length - 1) {
        // a thin divider between the two reads
        ctx.strokeStyle = ink; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(gx + divider / 2, S.ty - FS * 0.1); ctx.lineTo(gx + divider / 2, S.ty + FS * 1.15); ctx.stroke(); ctx.globalAlpha = 1;
        gx += divider;
      }
    });
    let x = S.sx + S.sw - PAD;
    ctx.font = this.mono(400);
    for (let i = systems.length - 1; i >= 0; i--) {
      const sy = systems[i]!;
      const withName = sysW === named;
      if (withName) { const w = ctx.measureText(sy.name).width; x -= w; ctx.fillStyle = ink; ctx.globalAlpha = 0.6; ctx.fillText(sy.name, x, S.ty); ctx.globalAlpha = 1; x -= FS * 0.5; }
      // the system's state as one quiet mark: a bullet in the up colour, an x in the accent when it is down, a dim ? when unknown
      const tag = sy.up === true ? "*" : sy.up === false ? "x" : "?";
      const tw = ctx.measureText(tag).width; x -= tw;
      ctx.fillStyle = sy.up === true ? UP : sy.up === false ? this.pal.accent : ink; ctx.globalAlpha = sy.up == null ? 0.4 : 0.85;
      ctx.fillText(tag, x, S.ty); ctx.globalAlpha = 1;
      x -= withName ? gap : FS * 0.6;
    }
    const ry = S.ty + FS * 1.75;
    ctx.strokeStyle = ink; ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.moveTo(S.tx, ry); ctx.lineTo(S.sx + S.sw - PAD, ry); ctx.stroke(); ctx.globalAlpha = 1;
    return S.ty + HEAD;
  }

  /**
   * The bar under the prompt, the way tmux keeps its status at the bottom: a name, a figure, a
   * short bar, and how old the picture is. The bar has two faces and a click turns it over: the
   * market's read of the machine, $IMD's cap against the billion the company is aiming for, and
   * the machine's own, what the swarm is spending on inference as it spends it. What the glass
   * is too narrow for is dropped from the right.
   */
  private footer(S: Screen, y: number, now: number) {
    const { ctx, FS, PAD } = this, m = this.snapshot!;
    const ink = S.term ? this.PHOSPHOR : this.pal.face;
    // the whole bar sits back a little from the feed above it
    const fade = 0.7;
    const ry = y - FS * 0.75;
    ctx.strokeStyle = ink; ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.moveTo(S.tx, ry); ctx.lineTo(S.sx + S.sw - PAD, ry); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.font = this.mono(400); ctx.textBaseline = "top";
    this.footY = y;
    // the right side first, so the bar can take whatever is left
    // the age counts in seconds from the first tick, the number right-aligned to two places, so
    // the words never move and only the digits change: "updated  3s ago", "updated 15s ago"
    const secs = Math.max(0, Math.round((performance.timeOrigin + now - m.at) / 1000));
    const age = secs < 60 ? `${String(secs).padStart(2)}s` : ago(new Date(m.at).toISOString()).replace(/ ago$/, "");
    const right: Array<{ n: string; word: string }> = [{ n: age.trimStart(), word: "ago last updated" }];
    // the all-time figure belongs to the market's face; the pulse's own face carries it at its tail
    if (this.face === 0) right.push({ n: WallRenderer.compact(m.counts.inferenceTokens), word: "tokens used" });
    let x = S.sx + S.sw - PAD;
    for (const it of right) {
      const w = this.groupWidth([it]);
      if (x - w - FS * 2 <= S.tx + FS * 22) continue;
      x -= w;
      this.group(S, x, y, [it], ink, fade);
      x -= FS * 2.2;
    }
    const face = this.face === 0 ? this.capFace() : this.pulseFace();
    // the name, then the figure bright after it; the placeholder is the shape of the figure, so nothing jumps when it lands
    ctx.font = this.mono(400); ctx.fillStyle = ink; ctx.globalAlpha = (this.footHot ? 0.95 : 0.6) * fade;
    let bx = S.tx;
    if (face.name) { ctx.fillText(`${face.name} `, bx, y); bx += ctx.measureText(`${face.name} `).width; }
    ctx.font = this.mono(600); ctx.globalAlpha = 0.95 * fade; ctx.fillText(face.figure, bx, y);
    bx += Math.max(face.slot ? ctx.measureText(face.slot).width : 0, ctx.measureText(face.figure).width);
    if (face.note) {
      // the words carry the pointer's light on a face that leads with its figure instead of a name
      ctx.font = this.mono(400); ctx.globalAlpha = (this.footHot ? 0.95 : 0.6) * fade; ctx.fillText(` ${face.note}`, bx, y);
      bx += ctx.measureText(` ${face.note}`).width;
    }
    bx += FS * 0.6;
    ctx.font = this.mono(400); ctx.globalAlpha = 1;
    const chW = ctx.measureText("·").width, tail = face.tail ? ctx.measureText(` ${face.tail}`).width : 0;
    // the bar is short: a couple of dozen cells at most, never the whole width
    const cells = Math.min(face.cells, Math.floor((x - bx - tail - chW * 2) / chW));
    if (cells >= 8) {
      ctx.fillStyle = ink; ctx.globalAlpha = 0.6 * fade; ctx.fillText("[", bx, y); bx += chW;
      bx = face.draw(bx, cells, chW, ink, fade);
      ctx.font = this.mono(400); ctx.fillStyle = ink;
      ctx.globalAlpha = 0.6 * fade; ctx.fillText("]", bx, y); bx += chW;
      if (face.tail) { ctx.globalAlpha = 0.85 * fade; ctx.fillText(` ${face.tail}`, bx, y); bx += ctx.measureText(` ${face.tail}`).width; }
      ctx.globalAlpha = 1;
    }
    // what the click turns over: the name, the figure and the bar, not the read-outs at the right
    this.foot = { x: S.tx, y: y - FS * 0.3, w: Math.max(bx, S.tx) - S.tx, h: FS * 1.6 };
  }

  /** The market's face: $IMD's cap on a bar that ends at the billion the company is aiming for. */
  private capFace(): Face {
    const { ctx } = this, { cap, goal } = this.market;
    const compact = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`).replace(/\.0+([BMK])$/, "$1");
    const ratio = cap == null ? 0 : Math.min(1, cap / goal);
    return {
      name: "$IMD",
      figure: cap == null ? "$--.--M" : compact(cap),
      slot: "$--.--M",
      tail: `${compact(goal)} goal`,
      cells: WallRenderer.GOAL_CELLS,
      draw: (bx, cells, chW, ink, fade) => {
        const filled = Math.min(cells, Math.max(ratio > 0 ? 1 : 0, Math.round(ratio * cells)));
        ctx.fillStyle = ink;
        ctx.globalAlpha = 1; ctx.font = this.mono(600); ctx.fillText("=".repeat(filled), bx, this.footY); bx += chW * filled;
        ctx.font = this.mono(400); ctx.globalAlpha = 0.4 * fade; ctx.fillText("·".repeat(cells - filled), bx, this.footY);
        return bx + chW * (cells - filled);
      },
    };
  }

  /**
   * The machine's own face: what the swarm is spending on inference, a cell per read of the
   * plane, newest at the right. Until enough reads are in, the cells to the left are the goal
   * bar's dim dots, so the trace grows leftwards into a shape that was always there.
   */
  private pulseFace(): Face {
    const { ctx, FS } = this;
    const rates = this.rates();
    // the tail is the newest bar, so the reader is told the number the trace ends on
    const now = rates[rates.length - 1];
    // by the second, the pace a reader can feel. The rate is measured over the minute behind the
    // newest read, so a lump landing every minute or so reads as a steady figure rather than a
    // number flashing on and off with the counter
    const persec = now == null ? null : now / 60;
    const rate = persec == null || persec < 1 ? "" : persec >= 1e6 ? `${(persec / 1e6).toFixed(1)}M/sec` : persec >= 1e3 ? `${(persec / 1e3).toFixed(1)}K/sec` : `${Math.round(persec)}/sec`;
    return {
      // the number leads and the words follow it, the way the figure would be read aloud
      // the steady figure leads: the all-time count only ever rises and never changes width, so
      // the trace after it is anchored. The live pace goes to the tail, where a minute nothing
      // landed in simply says nothing and leaves no hole in the middle of the line
      figure: WallRenderer.compact(this.snapshot!.counts.inferenceTokens),
      // set tight: the count is in the billions and only rises, so it changes width about as
      // often as a decade turns, and reserving room for that would stand the words off in a gap
      note: "inference tokens used",
      tail: rate,
      cells: WallRenderer.PULSE_CELLS,
      draw: (bx, cells, chW, ink, fade) => {
        const y = this.footY;
        const shown = rates.slice(-cells);
        const blanks = cells - shown.length;
        // the scale steps 1, 2, 5 of a decade rather than following the tallest bar, so a busy
        // minute does not resize every bar beside it; it only moves when the trace outgrows a step
        const peak = WallRenderer.step(Math.max(...shown, 1));
        ctx.fillStyle = ink;
        ctx.globalAlpha = 0.4 * fade; ctx.font = this.mono(400);
        if (blanks > 0) ctx.fillText("·".repeat(blanks), bx, y);
        const base = y + FS * 1.15, tall = FS * 1.15, w = Math.max(1, Math.floor(chW * 0.7));
        shown.forEach((r, i) => {
          const h = Math.max(1, Math.round((r / peak) * tall));
          // the newest sample is the bright one, the way the feed's newest line is
          ctx.globalAlpha = (i === shown.length - 1 ? 1 : 0.75) * fade;
          ctx.fillRect(Math.round(bx + (blanks + i) * chW), Math.round(base - h), w, h);
        });
        ctx.globalAlpha = 1;
        return bx + chW * cells;
      },
    };
  }

  private mark(S: Screen, x: number, y: number, mark: Mark) {
    const { ctx, FS } = this;
    const cy = y + FS * 0.55, rr = FS * 0.27, ink = S.term ? this.PHOSPHOR : this.pal.face;
    if (mark === "ring") { ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x + rr, cy, rr - 0.5, 0, TAU); ctx.stroke(); ctx.fillStyle = UP; ctx.beginPath(); ctx.arc(x + rr, cy, rr * 0.5, 0, TAU); ctx.fill(); }
    else {
      ctx.fillStyle = mark === "up" ? UP : mark === "down" || mark === "accent" ? this.pal.accent : mark === "dim" || mark === "unknown" ? "#5a5a56" : ink;
      ctx.beginPath(); ctx.arc(x + rr, cy, rr, 0, TAU); ctx.fill();
    }
  }

  /** One line. `chars` limits how much of the text is shown, for a line still typing in. */
  private row(S: Screen, y: number, r: Row, chars = Infinity) {
    const { ctx, FS } = this;
    let tx = S.tx;
    ctx.textBaseline = "top";
    ctx.font = this.mono(r.wt ?? 400); ctx.globalAlpha = r.al ?? 1;
    const ink = r.col ?? (S.term ? this.PHOSPHOR : this.pal.face);
    if (r.segments) {
      for (const sg of r.segments) {
        this.mark(S, tx, y, sg.mark); tx += FS * 1.3;
        ctx.fillStyle = ink; ctx.fillText(sg.t, tx, y); tx += ctx.measureText(sg.t).width + FS * 1.2;
      }
      ctx.globalAlpha = 1;
      return;
    }
    if (r.mark) { this.mark(S, tx, y, r.mark); tx += FS * 1.3; }
    // the glyph before a line: ⏺ for an event, ⎿ for another step of the same job, the way Claude Code marks its lines
    if (r.lead) { ctx.fillStyle = r.lead.col; ctx.globalAlpha = r.lead.al ?? 1; ctx.fillText(r.lead.t, tx, y); ctx.globalAlpha = r.al ?? 1; tx += FS * 1.5; }
    ctx.fillStyle = ink;
    const lim = S.tx + S.tw - tx;
    // a line in runs: the verb set bold among the rest, each run drawn in its own weight; the last run takes the cut
    if (r.spans) {
      let left = lim, budget = chars, x = tx;
      for (let i = 0; i < r.spans.length; i++) {
        const sp = r.spans[i]!;
        if (sp.face != null) {
          // the seat's sigil: a five by five mark mirrored down its middle, drawn from the seat's number and the same
          // every time, so a reader learns a seat by its mark the way a badge is read before a name
          const d = Math.round(FS * 1.1), fy = y - (d - FS) / 2, cellW = d / 5, g = rng(sp.face * 7919 + 17);
          ctx.fillStyle = ink;
          for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) {
            if (g() < 0.5) continue;
            const px = x + i * cellW, py = fy + j * cellW;
            ctx.fillRect(Math.round(px), Math.round(py), Math.ceil(cellW), Math.ceil(cellW));
            if (i < 2) ctx.fillRect(Math.round(x + (4 - i) * cellW), Math.round(py), Math.ceil(cellW), Math.ceil(cellW));
          }
          x += d + FS * 0.6; left -= d + FS * 0.6;
        }
        ctx.font = this.mono(sp.wt ?? r.wt ?? 400);
        let str = sp.t;
        const w = ctx.measureText(str).width;
        if (w > left) {
          str = str.slice(0, Math.max(0, Math.floor((str.length * left) / w) - 1)) + "…";
          while (str.length > 1 && ctx.measureText(str).width > left) str = str.slice(0, -2) + "…";
          str = str.replace(/[\s·,;:]+…$/, "…");
        }
        if (budget < str.length) str = str.slice(0, Math.max(0, budget));
        budget -= str.length;
        ctx.fillText(str, x, y);
        const used = ctx.measureText(str).width; x += used; left -= used;
        if (str.endsWith("…") || left <= 0 || budget <= 0) break;
      }
      ctx.globalAlpha = 1;
      return;
    }
    let str = r.t;
    // fit the line to the glass: a first cut from the measured width, then a step or two back for the ellipsis
    const full = ctx.measureText(str).width;
    if (full > lim && str.length > 3) {
      str = str.slice(0, Math.max(3, Math.floor((str.length * lim) / full))) + "…";
      while (str.length > 3 && ctx.measureText(str).width > lim) str = str.slice(0, -2) + "…";
    }
    if (chars < str.length) str = str.slice(0, Math.max(0, chars));
    ctx.fillText(str, tx, y);
    // a URL in the line is underlined and remembered, so it can be clicked; a cut URL still leads to the whole address
    const shown = str.endsWith("…") ? str.length - 1 : str.length;
    for (const m of r.t.matchAll(URL_RE)) {
      const start = m.index!, end = Math.min(start + m[0].length, shown);
      if (start >= shown) break;
      const lx = tx + ctx.measureText(str.slice(0, start)).width, lw = ctx.measureText(str.slice(start, end)).width;
      ctx.fillRect(lx, y + FS * 1.15, lw, 1);
      this.links.push({ x: lx, y, w: lw, h: FS * 1.3, href: m[0] });
    }
    ctx.globalAlpha = 1;
  }

  private drawBlocks(tms: number) {
    const L = this.layout!, { ctx, FS, PAD, LH } = this;
    const now = tms || performance.now();
    this.links = [];
    for (const bk of L.blocks) {
      // a bare wall's blocks take no room and draw nothing
      if (!bk.w || !bk.h) continue;
      if (bk.kind === "settings") { this.drawCog(bk); continue; }
      if (bk.kind === "listen") { this.drawPlay(bk); continue; }
      // the wall turned over: the monitor shows its back too, once the wave has turned it
      if (this.monitorTurning) continue;
      // away from the site the monitor has nothing to say: dark glass in its frame
      if (this.opts.forget) { const pad = bk.pad ?? 0; this.chrome((bk.c + pad) * L.cell + 1, bk.r * L.cell + 1, (bk.w - 2 * pad) * L.cell - 2, bk.h * L.cell - 2, false, true); continue; }
      if (this.backs && !this.monitorHomed) { this.drawMonitorBack(bk, now); continue; }
      // the block may reserve a column of wall on either side; the monitor itself is drawn between them
      const pad = bk.pad ?? 0;
      const S = this.chrome((bk.c + pad) * L.cell + 1, bk.r * L.cell + 1, (bk.w - 2 * pad) * L.cell - 2, bk.h * L.cell - 2, false, true);
      const tabs = this.tabs(now);
      const T = tabs[bk.tab] ?? tabs[0]!;
      // a film takes the whole glass, the header included
      if (this.film) { this.drawFilm(S, now); continue; }
      let y = this.header(S, bk, now);
      // from the bottom up: the bar, its rule with the same air as the status line's, then the prompt in its box
      const footY = S.sy + S.sh - PAD * 0.6 - FS;
      const boxH = FS * 2.1, boxTop = footY - FS * 1.5 - boxH;
      const promptY = boxTop + (boxH - FS) / 2;
      // the show: the log slides off the top of the glass, the fireworks play in the room it leaves, and the log slides
      // back once they are done, the header, the prompt and the bar holding still the whole time
      const shift = this.partyShift(now);
      const roomTop = y, roomH = boxTop - LH * 0.4 - y;
      if (this.party && shift >= 1) this.drawParty({ ...S, sy: roomTop, sh: roomH }, now);
      // the show ends once the log has slid back; drawParty is not reached then, so the end is checked here
      else if (this.party && this.party.leaving != null && now - this.party.leaving >= 700) { const own = this.party.words; this.party = null; if (!own) this.echo(["type imd for a surprise"], this.pal.accent); }
      if (T.feed && shift < 1) {
        ctx.save(); ctx.beginPath(); ctx.rect(S.sx, roomTop - LH * 0.2, S.sw, roomH + LH * 0.4); ctx.clip();
        y -= shift * (roomH + LH);
        // as many of the newest lines as fit, the oldest at the top, fading with age; the newest types in
        const fit = Math.max(1, Math.floor(roomH / LH));
        // the banner on arrival: the name in the accent, a line of context, then it scrolls off
        const banner: Row[] = now - this.born < BANNER_MS ? [
          { t: "IMD swarm", col: CLAUDE, wt: 600 },
          { t: `${SEATS.toLocaleString("en-US")} seats · reading the control plane`, al: 0.6 }, { t: "" },
        ] : [];
        const rows = [...banner, ...T.rows.slice(-(fit - banner.length))];
        // the first log prints a line to a step, from the top; before it lands, and once it is up, every line is there
        const printed = this.arrived && !this.opts.still ? (now - this.arrived) / PRINT_MS : Infinity;
        // the newest line types in from when it lands; on the first log that is once the lines above it have printed
        const since = this.newest?.since === this.arrived ? this.arrived + Math.max(0, rows.length - 1 - banner.length) * PRINT_MS : this.newest?.since ?? 0;
        const typing = since ? Math.max(0, Math.min(1, (now - since) / TYPE_MS)) : 1;
        rows.forEach((r, i) => {
          const j = i - banner.length;
          if (j >= 0 && j >= printed) return;
          // the newest event is set in weight, marked in the accent, and types itself in; a command's printout is none of those
          const last = i === rows.length - 1 && this.echoes.length === 0;
          const age = (rows.length - 1 - i) / Math.max(1, rows.length - 1);
          // a line just printed is bright, then settles into the fade of its age
          const flash = j >= 0 && Number.isFinite(printed) ? Math.max(0, 1 - (printed - j) * PRINT_MS / FLASH_MS) : 0;
          const rest = last ? 1 : 0.95 - age * 0.5;
          const al = (r.al ?? 1) * (rest + (1 - rest) * flash);
          const lead = last && r.lead ? { ...r.lead, col: CLAUDE } : r.lead;
          this.row(S, y, { ...r, al, wt: last ? 600 : r.wt, lead }, last ? Math.ceil(r.t.length * typing) : Infinity);
          y += LH;
        });
        ctx.restore();
      } else if (!T.feed) {
        if (T.columns) {
          const colGap = FS * 3;
          const widths = T.columns.map((c) => Math.max(...c.map((r) => this.measure(r.t, r.wt ?? 400) + (r.mark ? FS * 1.3 : 0))));
          let x = S.tx, tallest = 0;
          T.columns.forEach((rows, i) => {
            const col: Screen = { ...S, tx: x, tw: widths[i]! };
            let cy = y;
            for (const r of rows) { if (cy + LH > S.sy + S.sh - PAD * 0.5) break; this.row(col, cy, r); cy += LH; }
            tallest = Math.max(tallest, cy - y);
            x += widths[i]! + colGap;
          });
          y += tallest + LH * 0.6;
        }
        for (const r of T.rows) { if (y + LH > S.sy + S.sh - PAD * 0.5) break; this.row(S, y, r); y += LH; }
      }
      if (T.prompt && boxTop - y > -LH * 0.2) {
        // the prompt sits in its own rounded box, a chevron at the left, as Claude Code's does
        // the box starts on the text column, like every line above it, with the chevron inset
        const bx = S.tx, bw = S.sx + S.sw - PAD - bx, rr = FS * 0.5;
        ctx.strokeStyle = this.PHOSPHOR_DIM; ctx.globalAlpha = this.focused ? 0.9 : 0.5; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx + rr, boxTop); ctx.lineTo(bx + bw - rr, boxTop); ctx.arcTo(bx + bw, boxTop, bx + bw, boxTop + rr, rr);
        ctx.lineTo(bx + bw, boxTop + boxH - rr); ctx.arcTo(bx + bw, boxTop + boxH, bx + bw - rr, boxTop + boxH, rr);
        ctx.lineTo(bx + rr, boxTop + boxH); ctx.arcTo(bx, boxTop + boxH, bx, boxTop + boxH - rr, rr);
        ctx.lineTo(bx, boxTop + rr); ctx.arcTo(bx, boxTop, bx + rr, boxTop, rr);
        ctx.stroke(); ctx.globalAlpha = 1;
        ctx.font = this.mono(400); ctx.textBaseline = "top";
        ctx.fillStyle = this.PHOSPHOR_DIM; ctx.fillText(">", S.tx + FS * 0.8, promptY);
        const at = S.tx + FS * 2.2;
        // the typed line sits at the feed's weight; only the cursor is bright
        ctx.fillStyle = this.PHOSPHOR; ctx.globalAlpha = 0.85; ctx.fillText(this.input, at, promptY); ctx.globalAlpha = 1;
        const blink = this.focused ? Math.floor(now / 530) % 2 === 0 : true;
        ctx.fillStyle = CLAUDE;
        if (blink) { ctx.globalAlpha = this.focused ? 1 : 0.45; ctx.fillRect(at + ctx.measureText(this.input).width, promptY, FS * 0.6, FS * 1.1); ctx.globalAlpha = 1; }
        if (!this.focused && !this.input) { ctx.fillStyle = this.PHOSPHOR_DIM; ctx.globalAlpha = 0.5; ctx.fillText("? for commands", at + FS * 1.2, promptY); ctx.globalAlpha = 1; }
        this.footer(S, footY, now);
      }
    }
    // the monitor stays lit under the spotlight; the switch and the cog go dark with the wall
    if (this.spotLevel > 0) for (const bk of L.blocks) if (bk.kind !== "monitor") this.dim(bk.c * L.cell, bk.r * L.cell, bk.w * L.cell, bk.h * L.cell);
  }

  /** One module: an instrument, a tile, or a wallet's device, with its hardware and its lamp. */
  private draw(u: Unit, tms: number, hot: boolean, live: boolean, back = this.backs) {
    const L = this.layout!, { ctx } = this, p = this.painter!, cell = L.cell;
    // each module keeps its own clock: a seeded head start, so two alike never move in step. The pace is the loop's for
    // every module, so the whole wall repeats exactly every LOOP_MS and a module drawn anywhere is the same frame
    const clock = rng(u.first * 13 + 5);
    clock();
    tms = tms + clock() * LOOP_MS;
    // an active module is on: it runs all the time, its lamp lit, the way a machine at work looks from across the room
    const k = u.activity;
    const x = u.c * cell + 1, y = u.r * cell + 1, w = u.w * cell - 2, h = u.h * cell - 2, mv = hot || live || k >= RECENT, n = u.ids.length;
    if (back) { this.drawBack(u, tms, x, y, w, h); if (hot) this.ring(x, y, w, h); return; }
    // a press wakes the module for a few seconds and flashes its face; it never changes what the device is set to
    // the plate, what is mounted on it and its hardware are the module's own drawing, shared with the page where a holder designs theirs
    const mine = this.isMine(u);
    // on: the glass lights, brighter while working; that is how the wall shows it from across the room
    const lit = this.litLevel(u);
    // a module that is on lights its own face: its glass, its lamps, its marks. It is never traded for a screen, so the
    // wall lit is the same wall, and the lit setting only changes what is on
    const on = lit > 0;
    const look = drawModule(p, x, y, w, h, { first: u.first, n, cw: u.w, ch: u.h, activity: k, lit, moving: mv, tms, mine, edge: this.edge, theme: this.theme, design: this.designOf(u) });
    const inv = look.inverted;
    const U = cell / 20, lx = x + w - U * 3, ly = y + U * 2.6, lr = Math.max(1.4, U * 1.5);
    // two signals and no more: on, the glass is lit; working now, a lamp-coloured frame around the edge as well.
    // A module that is on but not lit under the current setting keeps its corner lamp
    if (k && !on && !(u.w === 1 && u.h === 1)) this.lamp(lx, ly, lr, k);
    if (k === WORKING) { ctx.strokeStyle = this.ledColour; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); ctx.lineWidth = 1; }
    // under the pointer the face lifts a shade, the way a key does before it is pressed
    if (hot) { ctx.fillStyle = "#fff"; ctx.globalAlpha = inv ? 0.1 : 0.22; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; this.ring(x, y, w, h); }
    this.flashOver(u, x, y, w, h);
  }

  /** The blank plates: a face with three rules, or with the wall turned over, bare board with a drill hole. */
  private paintMargins() {
    const L = this.layout!, { ctx } = this;
    const mask = this.backs && LIB ? LIB.themeBoard(this.themeName(), this.theme) : null;
    for (const i of this.margins) {
      const x = (i % L.cols) * L.cell + 1, y = Math.floor(i / L.cols) * L.cell + 1, s = L.cell - 2;
      ctx.fillStyle = this.pal.wall; ctx.fillRect(x - 1, y - 1, L.cell, L.cell);
      if (mask) {
        ctx.fillStyle = mask.bg; ctx.fillRect(x, y, s, s);
        ctx.fillStyle = mask.pad; ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.16, 0, TAU); ctx.fill();
        ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.08, 0, TAU); ctx.fill();
        ctx.strokeStyle = this.edge; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
        continue;
      }
      ctx.fillStyle = this.pal.face; ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = this.edge; ctx.lineWidth = 1; ctx.globalAlpha = 0.85; ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
      ctx.globalAlpha = 0.35;
      for (let k = 1; k <= 3; k++) { const ly = y + (s * k) / 4; ctx.beginPath(); ctx.moveTo(x + L.cell * 0.2, ly); ctx.lineTo(x + L.cell * 0.8, ly); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
  }

  /** A panel's back: its board at one CSS pixel a board pixel, in its design's colours or the wall's, framed as the front is. */
  private drawBack(u: Unit, tms: number, x: number, y: number, w: number, h: number) {
    const { ctx } = this, b = this.boardOf(u);
    // a board painted at this moment of its loop already is not painted again: a still wall turned over costs a copy a panel
    const f = Math.floor((((tms % 3000) + 3000) % 3000) / 150);
    if (b.at !== f) { b.paint(tms, b.out); b.bx.putImageData(b.img, 0, 0); b.at = f; }
    const was = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false; ctx.drawImage(b.cv, x, y, w, h); ctx.imageSmoothingEnabled = was;
    ctx.strokeStyle = this.edge; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  /**
   * What a panel's board is made from, the same wherever it is shown: its size (boardSize), a
   * picture of its front at that size for the glass, and its holder's letters. The wall's boards and the one lifted off
   * the wall are both made from this, so they are one board.
   */
  backOf(first: number): { size: [number, number]; front: ImageData; letters: string; info: BoardInfo } | null {
    if (!LIB) return null;
    const L = this.layout, u = L?.units.find((x) => x.first === first);
    if (!L || !u) return null;
    const size = LIB.boardSize(u.w, u.h), f = this.frontOf(first, size[0] / (u.w * L.cell));
    if (!f) return null;
    return { size, front: f.getContext("2d")!.getImageData(0, 0, f.width, f.height), letters: initialsOf(this.designOf(u)), info: this.infoOf(u) };
  }

  /** A board's title block as the wall knows it: the holder's address (the page fills in a name), its seats' lamps, its record. */
  private infoOf(u: Unit): BoardInfo {
    const recs = u.ids.map((id) => this.snapshot?.seats[id]);
    const o = u.owner;
    return {
      name: o ? `${o.slice(0, 6)}_${o.slice(-4)}` : `seat #${u.seat}`, code: `no. ${u.first}`, lot: this.designOf(u)?.lot ?? null,
      seats: recs.map((r) => (r?.working ? 2 : r ? 1 : 0)), ids: u.ids,
      passed: recs.reduce((n, r) => n + (r?.accepted ?? 0), 0), failed: recs.reduce((n, r) => n + (r?.failed ?? 0), 0),
    };
  }

  /** A panel's board as the wall turned over shows it: one board pixel to a CSS pixel, crisp like the fronts' lines, its glass and its letters, no title block. */
  private boardOf(u: Unit) {
    const name = this.themeName(), L = this.layout!;
    const W = Math.max(8, Math.round(u.w * L.cell - 2)), H = Math.max(8, Math.round(u.h * L.cell - 2)), letters = initialsOf(this.designOf(u));
    const key = `${name}:${W}x${H}:${letters}:${JSON.stringify(this.designOf(u))}:${L.cell}`;
    let b = this.boards.get(u.first);
    if (!b || b.key !== key) {
      const f = this.frontOf(u.first, 1)!, fd = f.getContext("2d")!.getImageData(0, 0, f.width, f.height);
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const bx = cv.getContext("2d")!, img = bx.createImageData(W, H);
      const B = LIB!, mounts = B.glassOf(fd.data, fd.width, fd.height, 0, 0, fd.width, fd.height, W, H);
      b = { key, at: -1, paint: B.makeBoard(B.boardSeed(u.first), W, H, B.themeBoard(name, THEMES[name]), 0.72, null, mounts, letters).paint, cv, bx, img, out: new Uint32Array(img.data.buffer) };
      this.boards.set(u.first, b);
    }
    return b;
  }

  private themeName(): ThemeName { return (Object.keys(THEMES) as ThemeName[]).find((n) => THEMES[n] === this.theme) ?? "steel"; }

  /**
   * Turn the wall over, or back: a wave from the top left, each panel turning on its upright axis. Both sides are
   * pictures before it starts, the wall as it is and the wall as it will be, so the wave itself only copies.
   */
  setBacks(on: boolean) {
    if (on === this.backs) return;
    if (!LIB){ void loadBoards().then(() => this.setBacks(on)); return; }
    this.backs = on;
    const L = this.layout;
    if (!L || !this.snapshot) return;
    if (this.opts.still || !this.shown) { this.layOut(this.snapshot, this.width, this.target); return; }
    const copy = () => { const c = document.createElement("canvas"); c.width = this.canvas.width; c.height = this.canvas.height; c.getContext("2d")!.drawImage(this.canvas, 0, 0); return c; };
    const from = copy();
    for (const u of L.units) { this.ctx.fillStyle = this.pal.wall; this.ctx.fillRect(u.c * L.cell, u.r * L.cell, u.w * L.cell, u.h * L.cell); this.draw(u, 0, false, false); }
    // the monitor turns with the panels: its other side goes into the picture too. Turning back, it is already facing the room
    const turnMonitor = on || !this.monitorHomed;
    this.monitorTurning = false; this.monitorHomed = !on; this.homeAt = 0; this.homePics = null;
    this.drawBlocks(0);
    const to = copy();
    this.ctx.save(); this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.drawImage(from, 0, 0); this.ctx.restore();
    this.flipFrom = from; this.flipTo = to;
    this.flipAt = performance.now(); this.flipDone = new Uint8Array(L.units.length);
    this.flipIndex = new Map(L.units.map((u, i) => [u, i]));
    this.monitorTurning = turnMonitor;
    this.opts.sound?.press();
  }

  /** One step of the turn: every panel the wave has reached, squeezed to its edge and opened again on the other side. */
  private flipStep(now: number) {
    const L = this.layout!, { ctx } = this, done = this.flipDone!, cell = L.cell, span = L.cols + L.rows * 0.6, k = this.canvas.width / this.width;
    let still = true;
    L.units.forEach((u, i) => {
      if (done[i]) return;
      const p = (now - this.flipAt - (FLIP_WAVE_MS * (u.c + u.r * 0.6)) / span - rng(u.first * 7 + 1)() * 140) / FLIP_MS;
      if (p <= 0) { still = false; return; }
      const x = u.c * cell, y = u.r * cell, w = u.w * cell, h = u.h * cell;
      ctx.fillStyle = this.pal.wall; ctx.fillRect(x, y, w, h);
      if (p >= 1) { done[i] = 1; this.draw(u, now, i === this.hot, false); return; }
      still = false;
      const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2, s = Math.max(0.02, Math.abs(Math.cos(e * Math.PI))), src = e < 0.5 ? this.flipFrom! : this.flipTo!;
      const sw = w * s;
      ctx.drawImage(src, x * k, y * k, w * k, h * k, x + (w - sw) / 2, y, sw, h);
      // the face turning away from the room's light goes dark
      ctx.fillStyle = "#000"; ctx.globalAlpha = (1 - s) * 0.45; ctx.fillRect(x + (w - sw) / 2, y, sw, h); ctx.globalAlpha = 1;
    });
    // the monitor turns as one heavy piece: once the wave reaches its middle, and slower than a panel
    const bk = this.monitorTurning ? L.blocks.find((b) => b.kind === "monitor") : null;
    if (bk) {
      const pad = bk.pad ?? 0, x = (bk.c + pad) * cell, y = bk.r * cell, w = (bk.w - 2 * pad) * cell, h = bk.h * cell;
      const p = (now - this.flipAt - (FLIP_WAVE_MS * (bk.c + bk.w / 2 + (bk.r + bk.h / 2) * 0.6)) / span) / (FLIP_MS * 1.5);
      if (p >= 1) {
        this.monitorTurning = false; ctx.fillStyle = this.pal.wall; ctx.fillRect(x, y, w, h); this.drawBlocks(now);
        // the tube shows for a beat, then the monitor turns back to the room
        if (this.backs) this.homeAt = now + MONITOR_HOLD_MS;
      }
      else {
        still = false;
        if (p > 0) {
          const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2, s = Math.max(0.02, Math.abs(Math.cos(e * Math.PI))), sw = w * s;
          ctx.fillStyle = this.pal.wall; ctx.fillRect(x, y, w, h);
          ctx.drawImage(e < 0.5 ? this.flipFrom! : this.flipTo!, x * k, y * k, w * k, h * k, x + (w - sw) / 2, y, sw, h);
          ctx.fillStyle = "#000"; ctx.globalAlpha = (1 - s) * 0.45; ctx.fillRect(x + (w - sw) / 2, y, sw, h); ctx.globalAlpha = 1;
        }
      }
    } else this.monitorTurning = false;
    if (still) { this.paintMargins(); this.flipAt = 0; this.flipDone = null; this.flipFrom = this.flipTo = null; this.flipIndex = null; }
  }

  /** The monitor turning back to face the room, its tube to its terminal, the same squeeze as the wave's, slower. */
  private homeStep(now: number) {
    const L = this.layout!, { ctx } = this, bk = L.blocks.find((b) => b.kind === "monitor");
    if (!bk || !this.backs) { this.homeAt = 0; this.homePics = null; return; }
    const pad = bk.pad ?? 0, cell = L.cell, x = (bk.c + pad) * cell, y = bk.r * cell, w = (bk.w - 2 * pad) * cell, h = bk.h * cell, k = this.canvas.width / this.width;
    if (!this.homePics) {
      // both faces as pictures: the back as it is now, and the terminal drawn once and copied, then the back put back
      const grab = () => { const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext("2d")!.drawImage(this.canvas, x * k, y * k, w * k, h * k, 0, 0, c.width, c.height); return c; };
      const back = grab();
      this.monitorHomed = true; this.drawBlocks(now);
      const front = grab();
      this.homePics = [back, front]; this.monitorTurning = true;
    }
    const p = (now - this.homeAt) / (FLIP_MS * 1.5);
    ctx.fillStyle = this.pal.wall; ctx.fillRect(x, y, w, h);
    if (p >= 1) { this.monitorTurning = false; this.homeAt = 0; this.homePics = null; this.drawBlocks(now); return; }
    const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2, s = Math.max(0.02, Math.abs(Math.cos(e * Math.PI))), sw = w * s;
    ctx.drawImage(e < 0.5 ? this.homePics[0] : this.homePics[1], x + (w - sw) / 2, y, sw, h);
    ctx.fillStyle = "#000"; ctx.globalAlpha = (1 - s) * 0.45; ctx.fillRect(x + (w - sw) / 2, y, sw, h); ctx.globalAlpha = 1;
  }

  /** The panel lifted off the wall while it is being looked at: its place stays empty until it is put back. */
  private lifted: number | null = null;
  setLifted(first: number | null) {
    const L = this.layout, was = this.lifted;
    this.lifted = first;
    if (!L) return;
    for (const u of L.units) if (u.first === was || u.first === first) this.redraw(u, 0, false, false);
  }

  /** An empty place on the wall: the bare rack behind it, a shade darker, its four mounting holes. */
  private drawGap(u: Unit) {
    const L = this.layout!, { ctx } = this, cell = L.cell, x = u.c * cell + 1, y = u.r * cell + 1, w = u.w * cell - 2, h = u.h * cell - 2;
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)"; ctx.fillRect(x, y, w, Math.max(2, cell * 0.12));
    const r = Math.max(1.2, cell * 0.07), m = cell * 0.22;
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    for (const [cx, cy] of [[x + m, y + m], [x + w - m, y + m], [x + m, y + h - m], [x + w - m, y + h - m]]){ ctx.beginPath(); ctx.arc(cx!, cy!, r, 0, TAU); ctx.fill() }
  }

  /** Whether the wall is turned over. */
  get turnedOver() { return this.backs; }

  /** The monitor's back at its block's size and the wall's colours, made once and kept. */
  private monitorBackOf(bk: Block) {
    const L = this.layout!, pad = bk.pad ?? 0, name = this.themeName();
    const W = Math.max(8, Math.round((bk.w - 2 * pad) * L.cell - 2)), H = Math.max(8, Math.round(bk.h * L.cell - 2)), key = `${name}:${W}x${H}`;
    let m = this.monitorBack;
    if (!m || m.key !== key) {
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const bx = cv.getContext("2d")!, img = bx.createImageData(W, H);
      m = this.monitorBack = { key, at: -1, back: LIB!.makeMonitorBack(W, H, LIB!.themeBoard(name, this.theme)), cv, bx, img, out: new Uint32Array(img.data.buffer) };
    }
    return m;
  }

  /** The monitor's back: its tube from behind on the chassis, the heater flaring as each new line lands on the glass it turned away. */
  private drawMonitorBack(bk: Block, now: number) {
    const L = this.layout!, { ctx } = this, pad = bk.pad ?? 0, m = this.monitorBackOf(bk), g = m.back.glowBox;
    const x = (bk.c + pad) * L.cell + 1, y = bk.r * L.cell + 1, w = (bk.w - 2 * pad) * L.cell - 2, h = bk.h * L.cell - 2;
    const flare = this.newest ? Math.max(0, 1 - (now - this.newest.since) / 1200) : 0;
    // the board moves on its own frames, as a panel's does; between them only the glow is painted again
    const f = Math.floor((((now % 3000) + 3000) % 3000) / 150);
    if (m.at !== f) { m.back.paint(now, m.out, flare); m.bx.putImageData(m.img, 0, 0); m.at = f; }
    else if (g) { m.back.glow(now, m.out, flare); m.bx.putImageData(m.img, 0, 0, g.x, g.y, g.w, g.h); }
    const was = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false; ctx.drawImage(m.cv, x, y, w, h); ctx.imageSmoothingEnabled = was;
    ctx.strokeStyle = this.edge; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  /** The instant after a press: the face goes dark for a few frames. */
  private flashOver(u: Unit, x: number, y: number, w: number, h: number) {
    const until = this.flash.get(u.first);
    if (!until) return;
    if (performance.now() > until) { this.flash.delete(u.first); return; }
    const { ctx } = this;
    ctx.fillStyle = this.pal.stroke; ctx.globalAlpha = 0.55; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
  }

  /**
   * A press: the face flashes, the room clicks, and the module runs for a few seconds, then
   * settles back exactly where it was.
   */
  private press(i: number) {
    const u = this.layout!.units[i]!, now = performance.now();
    this.flash.set(u.first, now + 90);
    this.warm.set(i, Math.max(this.warm.get(i) ?? 0, now + 4_000));
    this.opts.sound?.press();
    this.redraw(u, now, i === this.hot, true);
  }

  /**
   * The lamp, as the key reads it: green and a little larger when working now, an ink ring with
   * a green centre when active this week, ink when it has taken a job, dim when waiting.
   */
  private lamp(cx: number, cy: number, r: number, k: Activity, colour = this.ledColour) {
    const { ctx } = this;
    ctx.beginPath();
    if (k === WORKING) { ctx.fillStyle = colour; ctx.arc(cx, cy, r * 1.3, 0, TAU); ctx.fill(); }
    else if (k === RECENT) {
      ctx.strokeStyle = this.pal.stroke; ctx.lineWidth = 1.2; ctx.arc(cx, cy, r, 0, TAU); ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, TAU); ctx.fill();
    }
    else { ctx.fillStyle = this.pal.stroke; ctx.globalAlpha = k ? 1 : 0.35; ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
  }

  /** The border under the pointer: ink with a white inner line, so it reads on a light face and a dark one. */
  private ring(x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    ctx.strokeStyle = this.pal.stroke; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
  }

  private redraw(u: Unit, t: number, hot: boolean, live: boolean) {
    const L = this.layout!;
    // a panel still turning is the turn's to paint
    if (this.flipAt && this.flipDone && !this.flipDone[this.flipIndex?.get(u) ?? -1]) return;
    this.ctx.fillStyle = this.pal.wall;
    this.ctx.fillRect(u.c * L.cell, u.r * L.cell, u.w * L.cell, u.h * L.cell);
    if (u.first === this.lifted){ this.drawGap(u); return; }
    this.draw(u, t, hot, live);
    // under the spotlight everything but the reader's own stays dark, however often it is repainted
    if (this.spotLevel > 0 && !this.isMine(u)) this.dim(u.c * L.cell, u.r * L.cell, u.w * L.cell, u.h * L.cell);
  }

  /** Whether a module is one of the reader's, read off the holder every time so nothing cached can go stale. */
  private isMine(u: Unit) { return Boolean(this.mine && u.owner?.toLowerCase() === this.mine); }

  /**
   * A module's design: its wallet's. A wallet's seats are one module and the design is kept by the
   * wallet, so selling seats reshapes the module and keeps its look, and a seat bought in joins it.
   * A module with no holder known, as before the owners are read, has none.
   */
  private designOf(u: Unit): Design | null {
    if (!this.designs.size || !u.owner) return null;
    return this.designs.get(u.owner.toLowerCase()) ?? null;
  }

  /**
   * The holders' designs, by lower-case wallet. Only the modules whose design changed are painted
   * again, so a read that lands after the first paint, or a save from the page next door, is a few redraws.
   */
  setDesigns(next: Map<string, Design>) {
    const was = this.designs;
    this.designs = next;
    const L = this.layout;
    if (!L) return;
    L.units.forEach((u, i) => {
      const k = u.owner?.toLowerCase();
      if (k && was.get(k) !== next.get(k)) this.redraw(u, 0, i === this.hot, false);
    });
  }

  /** A seat's module as the layout placed it: its seats, its box in cells, how busy it is and how lit, for a picture of it elsewhere. */
  moduleOf(seat: number): { first: number; ids: number[]; c: number; r: number; w: number; h: number; activity: Activity; lit: 0 | 1 | 2; cell: number } | null {
    const L = this.layout, u = L?.units.find((x) => x.ids.includes(seat));
    if (!L || !u) return null;
    return { first: u.first, ids: u.ids, c: u.c, r: u.r, w: u.w, h: u.h, activity: u.activity, lit: this.litLevel(u), cell: L.cell };
  }

  /**
   * A module's face drawn again on its own at `k` device pixels a wall pixel, still, the way the wall has it now: the
   * picture a panel lifted off the wall shows, sharp at whatever size it is lifted to.
   */
  frontOf(first: number, k: number): HTMLCanvasElement | null {
    const L = this.layout, u = L?.units.find((x) => x.first === first);
    if (!L || !u) return null;
    const cell = L.cell, w = u.w * cell, h = u.h * cell, c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const g = c.getContext("2d")!;
    g.scale(k, k); g.lineJoin = "round";
    g.fillStyle = this.pal.wall; g.fillRect(0, 0, w, h);
    const clock = rng(u.first * 13 + 5); clock();
    drawModule(createPainter(g, cell, this.theme.light, this.theme.dark), 1, 1, w - 2, h - 2, {
      first: u.first, n: u.ids.length, cw: u.w, ch: u.h, activity: u.activity, lit: this.litLevel(u), moving: false,
      tms: clock() * LOOP_MS, mine: this.isMine(u), edge: this.edge, theme: this.theme, design: this.designOf(u),
    });
    return c;
  }

  /** The theme the wall is drawn in. */
  get palette(): Theme { return this.theme; }

  /** How far down the wall its panels fill it, CSS pixels: below that a wall laid out to a set height is mostly blank plates. */
  get filled(): number {
    const L = this.layout;
    if (!L) return 0;
    // the last row that is mostly panels: a ragged last row of a few panels and many blank plates reads as a gap
    for (let r = L.rows - 1; r > 0; r--){
      let n = 0;
      for (let c = 0; c < L.cols; c++){ const v = L.grid[r * L.cols + c]; if (v != null && v >= 0) n++ }
      if (n >= L.cols * 0.8) return (r + 1) * L.cell;
    }
    return L.rows * L.cell;
  }

  private dim(x: number, y: number, w: number, h: number) { this.ctx.fillStyle = `rgba(0, 0, 0, ${SPOT_DIM * this.spotLevel})`; this.ctx.fillRect(x, y, w, h); }

  /** The spotlight on the reader's modules: on, the rest of the wall goes dark; off, the wall is painted whole again. */
  setSpotlight(on: boolean) {
    if (on === this.spot) return;
    this.spot = on;
    const L = this.layout;
    if (!L || !this.snapshot) return;
    // without a frame loop to ease by, the light snaps
    if (this.opts.still || !this.raf) {
      this.spotLevel = on ? 1 : 0;
      if (on) { this.dim(0, 0, this.width, this.height); for (const u of L.units) if (this.isMine(u)) this.redraw(u, 0, false, false); this.drawBlocks(performance.now()); }
      else this.layOut(this.snapshot, this.width, this.target);
      return;
    }
    // coming on, keep the lit wall as it stands; the level then eases from wherever it is
    if (on && !this.spotBase) {
      const c = document.createElement("canvas"); c.width = this.canvas.width; c.height = this.canvas.height;
      c.getContext("2d")?.drawImage(this.canvas, 0, 0); this.spotBase = c;
    }
    this.spotFrom = this.spotLevel; this.spotAt = performance.now();
  }

  /** One step of the spotlight's ease: the lit wall, the dim at this level, and the reader's modules and the monitor lit through it. */
  private spotStep(now: number) {
    const L = this.layout!, base = this.spotBase, { ctx } = this;
    const target = this.spot ? 1 : 0, dur = this.spot ? SPOT_IN_MS : SPOT_OUT_MS;
    const t = Math.min(1, (now - this.spotAt) / dur), e = 1 - (1 - t) ** 3;
    this.spotLevel = this.spotFrom + (target - this.spotFrom) * e;
    if (base) {
      const k = this.canvas.width / this.width;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(base, 0, 0); ctx.restore();
      this.dim(0, 0, this.width, this.height);
      const lit = (x: number, y: number, w: number, h: number) => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(base, x * k, y * k, w * k, h * k, x * k, y * k, w * k, h * k); ctx.restore(); };
      for (const u of L.units) if (this.isMine(u)) lit(u.c * L.cell, u.r * L.cell, u.w * L.cell, u.h * L.cell);
      for (const bk of L.blocks) if (bk.kind === "monitor") { const pad = bk.pad ?? 0; lit((bk.c + pad) * L.cell, bk.r * L.cell, (bk.w - 2 * pad) * L.cell, bk.h * L.cell); }
    }
    if (t >= 1) { this.spotAt = 0; if (!this.spot) this.spotBase = null; }
  }

  // ------------------------------------------------------------------ motion

  private pickLive(now: number) {
    const L = this.layout!;
    // a waiting wall has no modules to light, and a still one lights none
    if (L.units.length === 0 || this.motion === "off") return;
    if (this.motion === "all") {
      if (this.live.size < L.units.length) L.units.forEach((u, i) => { if (u.activity < RECENT) this.live.set(i, Infinity); });
      return;
    }
    for (let tries = 0; tries < 8 && this.live.size < this.liveN; tries++) {
      const i = Math.floor(Math.random() * L.units.length);
      const u = L.units[i]!;
      if (u.activity < RECENT && !this.live.has(i) && !this.warm.has(i)) { this.live.set(i, now + 2000 + Math.random() * 3000); this.opts.sound?.tick(); }
    }
  }

  private readonly frame = (now: number) => {
    const L = this.layout;
    if (!L) return;
    // paint thirty times a second, or twenty once the machine has shown it is slow, whatever the screen's refresh;
    // a few milliseconds of slack, so a 60 Hz frame that lands a hair early is not skipped for the next
    if (now - this.painted < this.every - 4) { this.raf = requestAnimationFrame(this.frame); return; }
    this.painted = now;
    const began = performance.now();
    if (this.spotAt) this.spotStep(now);
    if (this.flipAt) this.flipStep(now);
    if (this.homeAt && now >= this.homeAt) this.homeStep(now);
    this.paints++;
    for (const [i, until] of this.live) {
      if (now > until || this.warm.has(i)) { this.live.delete(i); if (!this.warm.has(i)) this.redraw(L.units[i]!, 0, false, false); }
      // with everything drifting, each module takes its turn, a share of them each paint
      else if (this.motion !== "all" || (i + this.paints) % this.turns === 0) this.redraw(L.units[i]!, now, false, true);
    }
    this.pickLive(now);
    // the modules that are on run all the time, in turns like everything in all-motion: a share of them each paint
    if (this.motion !== "off") for (const i of this.working) if (!this.warm.has(i) && (i + this.paints) % this.turns === 0) this.redraw(L.units[i]!, now, false, false);
    // the terminal ticks at a third of the wall's pace, which is all a scrolling log needs; while it is printing, typing or waiting it ticks every paint
    const printing = !this.arrived || now < this.arrived + 32 * PRINT_MS + TYPE_MS || (this.newest != null && now < this.newest.since + TYPE_MS);
    // a film on the glass wants every paint; the log only every third
    if (printing || this.party || (this.film && this.filmDue(now)) || this.paints % 3 === 0) this.drawBlocks(now);
    for (const [i, until] of this.warm) {
      if (i !== this.hot && now > until) { this.warm.delete(i); this.ringed.delete(i); this.redraw(L.units[i]!, 0, false, false); }
      else this.redraw(L.units[i]!, now, i === this.hot || this.ringed.has(i), true); // the ring under the pointer or where the prompt pointed; the motion lingers
    }
    this.settle(performance.now() - began);
    this.raf = requestAnimationFrame(this.frame);
  };

  /**
   * How the wall settles on a slow machine. A paint that keeps costing more than six
   * milliseconds, a good third of a refresh, means the machine is struggling: half the drifting
   * modules and paint every third refresh instead. Once it is cheap again the modules come back;
   * the pace stays, so the wall does not flap between the two.
   */
  private settle(ms: number) {
    this.cost = this.cost * 0.9 + ms * 0.1;
    // with everything drifting, a slow machine gives each module a longer turn instead
    if (this.motion === "all") { if (this.cost > 6 && this.turns < 8) { this.turns = 8; this.cost = 0; } return; }
    if (this.cost > 6 && this.every < SLOW_PAINT_MS) { this.every = SLOW_PAINT_MS; this.liveN = Math.max(6, Math.round(this.liveN / 2)); this.cost = 0; }
    else if (this.cost < 2 && this.every === SLOW_PAINT_MS && this.layout) { this.liveN = Math.min(48, Math.max(12, Math.round(this.layout.units.length / 14))); this.cost = 3; }
  }

  private setHot(i: number | null) {
    if (i != null && i !== this.hot) this.opts.sound?.hover();
    if (this.hot != null && this.hot !== i) this.warm.set(this.hot, performance.now() + LINGER);
    this.hot = i;
    if (i != null) this.warm.set(i, Infinity);
  }

  // ------------------------------------------------------------------ the prompt

  /** The reader's wallet, or null when none is connected; the modules it holds are repainted either way. */
  /** The reader's wallet, lower-cased, or null. */
  get wallet(): string | null { return this.mine; }
  setMine(address: string | null) {
    const next = address ? address.toLowerCase() : null;
    if (next === this.mine) return;
    const was = this.mine;
    this.mine = next;
    const L = this.layout;
    if (!L) return;
    L.units.forEach((u, i) => {
      const o = u.owner?.toLowerCase();
      if (o && (o === was || o === next)) this.redraw(u, 0, i === this.hot, false);
    });
  }

  /** The oracle's answers by job; the feed is painted again with them. */
  setAnswers(answers: Map<string, string>) { this.answers = answers; if (this.layout) this.drawBlocks(performance.now()); }

  setNames(names: Map<string, string>) { this.names = names; if (this.layout) this.drawBlocks(performance.now()); }
  /** The wallets the feed's join lines belong to, for the page to name. */
  joinWallets(): string[] {
    const m = this.snapshot; if (!m?.owners) return [];
    return [...new Set(m.events.flatMap((e) => (e.kind === "agent" && m.owners![e.tokenId] ? [m.owners![e.tokenId]!.toLowerCase()] : [])))];
  }
  /** Whether the prompt has the keyboard. The cursor blinks only then. */
  setFocused(on: boolean) { this.focused = on; this.drawBlocks(performance.now()); }
  setInput(text: string) { this.input = text; this.drawBlocks(performance.now()); }
  /**
   * The film's frame for this moment, drawn as text in the phosphor: a fixed cell for every
   * character, sized so the whole frame fits the glass under the header, centred. The reel
   * ends where the frames do, and the glass goes back to the feed.
   */
  private drawFilm(S: Screen, now: number) {
    const f = this.film!;
    // a frame's timestamp can precede the moment the reel began, since it names the frame's start, not the call: never before the first frame
    // a looping reel goes round; the others run out
    const raw = Math.max(0, Math.floor((((f.pausedAt ?? now) - f.began) / 1000) * f.fps));
    const i = f.loop ? raw % f.frames.length : raw;
    // a reel that runs out on a channel holds the glass on a test pattern until the viewer turns the dial; one with no dial leaves
    if (i >= f.frames.length && !f.ended) {
      if (!f.channel) { this.stopFilm("ended"); return; }
      f.ended = true; f.audio?.pause();
    }
    const { ctx, FS, PAD, HEAD } = this;
    // the keys along the top, the way the feed's header sits, then a rule
    ctx.font = this.mono(400); ctx.textBaseline = "top"; ctx.fillStyle = this.PHOSPHOR;
    // the channel at the left, the reel's own keys centred, the way out at the far right
    const keys: [string, string][] = f.ended ? [["n", "next channel"], ["p", "previous"], ...(f.link ? [["x", "view original"] as [string, string]] : [])] : [
      ["w", f.wide ? "centered" : "widescreen"], ["space", f.pausedAt == null ? "pause" : "play"], ...(f.audio ? [["m", f.audio.muted ? "unmute" : "mute"] as [string, string]] : []),
      ...(f.link ? [["x", "view original"] as [string, string]] : []),
    ];
    // each pair is a key on the glass too: its rect is kept, so a tap on it does what the key does, which is how a phone drives the reel
    this.filmKeys = [];
    const pair = (key: string, what: string, x: number) => {
      const x0 = x;
      ctx.globalAlpha = 1; ctx.font = this.mono(600); ctx.fillText(key, x, S.ty); x += ctx.measureText(key).width + FS * 0.45;
      ctx.globalAlpha = 0.6; ctx.font = this.mono(400); ctx.fillText(what, x, S.ty); x += ctx.measureText(what).width;
      this.filmKeys.push({ x: x0 - FS * 0.4, y: S.ty - FS * 0.5, w: x - x0 + FS * 0.8, h: FS * 2, key });
      return x;
    };
    const widthOf = (key: string, what: string) => { ctx.font = this.mono(600); const k = ctx.measureText(key).width; ctx.font = this.mono(400); return k + FS * 0.45 + ctx.measureText(what).width; };
    if (f.channel && f.channel.of > 1) pair("← →", `channel ${f.channel.at + 1}`, S.tx);
    const gap = FS * 1.6;
    const total = keys.reduce((w, [k, v]) => w + widthOf(k, v), 0) + gap * (keys.length - 1);
    let kx = S.sx + (S.sw - total) / 2;
    for (const [key, what] of keys) kx = pair(key, what, kx) + gap;
    ctx.font = this.mono(600); const escW = ctx.measureText("esc").width; ctx.font = this.mono(400);
    pair("esc", "exit", S.sx + S.sw - PAD - escW - FS * 0.45 - ctx.measureText("exit").width);
    ctx.globalAlpha = 1;
    const ry = S.ty + FS * 1.75;
    ctx.strokeStyle = this.PHOSPHOR; ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.moveTo(S.tx, ry); ctx.lineTo(S.sx + S.sw - PAD, ry); ctx.stroke(); ctx.globalAlpha = 1;
    const top = S.ty + HEAD;
    const availW = S.sw - PAD * 2, availH = S.sy + S.sh - PAD - top;
    // the frame fits the glass, or covers it: never stretched, what runs past the edge is cut
    const probe = 10; ctx.font = `400 ${probe}px ${this.opts.fontFamily}`;
    const adv = ctx.measureText("M").width / probe;
    const byW = availW / (f.cols * adv), byH = availH / f.rows;
    // a reel can ask to sit smaller than the glass, floating in it
    const fs = Math.max(4, (f.wide ? Math.max(byW, byH) : Math.min(byW, byH)) * f.scale);
    const cw = fs * adv, ch = fs;
    const x0 = S.sx + (S.sw - f.cols * cw) / 2, y0 = top + (availH - f.rows * ch) / 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(S.sx + PAD, top, availW, availH); ctx.clip();
    ctx.font = `400 ${fs}px ${this.opts.fontFamily}`; ctx.textBaseline = "top"; ctx.fillStyle = this.PHOSPHOR;
    if (f.ended) { f.shown = Math.floor(now / 90); this.drawBars(f.cols, f.rows, x0, y0, ch, now); ctx.restore(); return; }
    f.shown = i;
    const lines = f.frames[i]!.split("\n");
    const first = Math.max(0, Math.floor((top - y0) / ch)), last = Math.min(lines.length, Math.ceil((top + availH - y0) / ch));
    for (let r = first; r < last; r++) ctx.fillText(lines[r]!, x0, y0 + r * ch);
    ctx.restore();
  }

  /**
   * The pattern a set shows when the programme is over, drawn in the reel's own grid so it sits
   * exactly where the picture was: seven bars stepping down in density the way colour bars step
   * down in brightness, the small reversed row under them, static beneath, and a signal that is
   * not quite clean, the odd row torn sideways and the odd cell flickering. No words: the keys
   * along the top say what to press.
   */
  private drawBars(cols: number, rows: number, x0: number, y0: number, ch: number, now: number) {
    const { ctx } = this;
    const barsEnd = Math.round(rows * 0.6), smallEnd = barsEnd + Math.max(2, Math.round(rows * 0.09));
    const t = Math.floor(now / 90);
    let seed = (t * 2654435761) >>> 0;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    ctx.fillStyle = this.PHOSPHOR;
    for (let r = 0; r < rows; r++) {
      // every so often a row tears a few cells to one side
      const tear = rand() < 0.06 ? Math.round((rand() - 0.5) * 6) : 0;
      let line = "";
      for (let c = 0; c < cols; c++) {
        const cc = Math.min(cols - 1, Math.max(0, c - tear));
        const bar = Math.min(BARS.length - 1, Math.floor((cc / cols) * BARS.length));
        let level: number;
        if (r < barsEnd) level = BARS[bar]!;
        else if (r < smallEnd) level = BARS[BARS.length - 1 - bar]!;
        else level = 0.08 + rand() * 0.1;
        // the signal's noise: a cell now and then reads a step too bright or too dim
        if (rand() < 0.04) level += (rand() - 0.5) * 0.5;
        const k = Math.max(0, Math.min(RAMP.length - 1, Math.round(level * (RAMP.length - 1))));
        line += RAMP[k];
      }
      ctx.globalAlpha = r < smallEnd ? 1 : 0.45;
      ctx.fillText(line, x0, y0 + r * ch);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Whether the glass needs painting for the film this frame: a reel has twelve frames a second
   * and the pattern ticks at about eleven, so most of the sixty frames a second change nothing.
   */
  private filmDue(now: number): boolean {
    const f = this.film!;
    if (f.ended) return Math.floor(now / 90) !== f.shown;
    if (f.shown === -1) return true;
    if (f.pausedAt != null) return false;
    return Math.floor(((now - f.began) / 1000) * f.fps) !== f.shown;
  }

  /** Whether the reel on the glass has run out and is holding its pattern. */
  get filmEnded() { return this.film?.ended ?? false; }

  /** Put a film on the glass: the frames, their rate, a sound to run with them, and where the original lives. */
  playFilm(cols: number, rows: number, fps: number, frames: string[], audio: HTMLAudioElement | null, link: string | null, onEnd?: (why: FilmEnd) => void, channel: { at: number; of: number } | null = null, loop = false, wideFirst = false, scale = 1) {
    // a change of channel keeps the framing and the mute; a fresh start is centred and heard, unless the reel asks to fill the glass
    const wide = this.film?.wide ?? wideFirst, muted = this.film?.audio?.muted ?? false;
    if (audio) audio.muted = muted;
    this.stopFilm();
    this.film = { cols, rows, fps, frames, began: performance.now(), audio, onEnd, wide, pausedAt: null, link, channel, ended: false, shown: -1, loop, scale };
    // the reel is mastered hot; brought down to where the room's own sound sits
    if (audio) { audio.volume = FILM_VOLUME; audio.currentTime = 0; void audio.play().catch(() => undefined); }
  }

  /** Between the frame that fills the glass and the whole frame, centred. */
  /** The reel's keys as drawn, with the rect each covers; a tap on one is that key. */
  private filmKeys: Array<{ x: number; y: number; w: number; h: number; key: string }> = [];
  /** The key under a point on the reel's legend, or null. */
  filmKeyAt(clientX: number, clientY: number): string | null {
    if (!this.film) return null;
    const b = this.canvas.getBoundingClientRect(), k = this.width / b.width;
    const x = (clientX - b.left) * k, y = (clientY - b.top) * k;
    return this.filmKeys.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)?.key ?? null;
  }
  toggleFilmWide() { if (this.film && !this.film.ended) { this.film.wide = !this.film.wide; this.film.shown = -1; } }

  /** Hold the film on its frame, or let it run on from there, the sound with it. */
  toggleFilmPause() {
    const f = this.film; if (!f || f.ended) return;
    const now = performance.now();
    if (f.pausedAt == null) { f.pausedAt = now; f.audio?.pause(); }
    else { f.began += now - f.pausedAt; f.pausedAt = null; void f.audio?.play().catch(() => undefined); }
    f.shown = -1;
  }

  /** The film's sound off, or back on. */
  toggleFilmMute() { if (this.film?.audio) { this.film.audio.muted = !this.film.audio.muted; this.film.shown = -1; } }

  /** Which reel is on, of how many, for the keys that change it. */
  get filmChannel() { return this.film?.channel ?? null; }

  /** Where the film came from, to open beside it. */
  get filmLink() { return this.film?.link ?? null; }

  /** Take the film off the glass, if one is on, and quiet its sound; says whether it ran out or was cut. */
  stopFilm(why: FilmEnd = "stopped") {
    if (!this.film) return;
    const f = this.film;
    f.audio?.pause();
    this.film = null;
    this.drawBlocks(performance.now());
    f.onEnd?.(why);
  }

  /** Whether a film is on the glass. */
  get filming() { return this.film !== null; }

  /**
   * Fireworks over the whole glass. Rockets go up from the foot of the screen as a rising dot with a
   * thin trail, and burst into a ring of sparks that fly out, slow, and fall under gravity, each spark
   * a glyph that cools as it ages, * to + to . as a real one fades. A dozen go off over the show,
   * staggered, then the occasion types in under them and a hint to type imd. Drawn into a grid of
   * characters the size of the glass, so it is a terminal's fireworks, not a picture of some.
   */
  private party: { n: number; since: number; shells: Array<{ x: number; y: number; at: number; hue: number; k: number }>; leaving: number | null; words?: [string, string]; fin?: number } | null = null;
  private static readonly SHOW_MS = 9000;
  /** Whether the show is on the glass, holding for a key. */
  get partying() { return this.party !== null; }
  /** The reader dismissed the show: the log slides back, and the terminal prints its hint once it is in. */
  endParty() { if (this.party && this.party.leaving == null) this.party.leaving = performance.now(); }
  /** Whether a hundred has been celebrated on this browser before, and that none was in the last hour; marks it. */
  private static firstTime(mark: number): boolean {
    try {
      const seen = JSON.parse(localStorage.getItem("imd.wall.celebrated") ?? "{}") as Record<string, number>;
      const now = Date.now(), recent = Object.values(seen).some((at) => now - at < 3600e3);
      if (seen[mark] || recent) return false;
      seen[mark] = now; localStorage.setItem("imd.wall.celebrated", JSON.stringify(seen));
      return true;
    } catch { return true; }
  }
  /** The fireworks on demand, for seeing them without waiting on the hundredth agent. */
  rehearse(n = 100) { this.celebrate(n, performance.now()); }
  /** A reader's own buy, as /buy throws it: the amount in the big digits, sooner, with their words under it. */
  cheer(n: number, words: [string, string]) { this.celebrate(n, performance.now(), words, 2400); }
  private celebrate(n: number, now: number, words?: [string, string], fin?: number) {
    const g = rng(n * 7 + 3);
    // a dozen shells: where each bursts, when, its colour, and how big
    const shells = Array.from({ length: 12 }, (_, i) => ({ x: 0.1 + g() * 0.8, y: 0.15 + g() * 0.4, at: now + 200 + i * 520 + g() * 300, hue: g(), k: 0.6 + g() * 0.7 }));
    this.party = { n, since: now, shells, leaving: null, words, fin };
    this.opts.onCelebrate?.(n);
  }
  /** How far the log has slid off the glass for the show: 0 in place, 1 gone; eases out and back. */
  private partyShift(now: number): number {
    if (!this.party) return 0;
    const t = now - this.party.since, SLIDE = 700;
    const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
    if (t < SLIDE) return ease(t / SLIDE);
    // the show holds until the reader dismisses it; then the log slides back over the same slide
    const left = this.party.leaving == null ? 0 : now - this.party.leaving;
    if (left >= SLIDE) return 0;
    return 1 - ease(left / SLIDE);
  }
  private drawParty(S: Screen, now: number): boolean {
    const P = this.party;
    if (!P) return false;
    const t = now - P.since;
    const { ctx, FS, LH } = this;
    ctx.font = this.mono(600); ctx.textBaseline = "top";
    const chW = ctx.measureText("M").width, cols = Math.max(20, Math.floor(S.tw / chW)), rows = Math.max(6, Math.floor(S.sh / LH));
    // a reader's own buy in the small frame at /buy has a glass a few rows tall: no room for the number, so the words
    // take the middle of it on one line, and nothing is drawn past the prompt
    const tiny = P.words != null && Math.floor(S.sh / LH) < 8;
    const grid: Array<Array<{ ch: string; col: string; al: number } | null>> = Array.from({ length: rows }, () => Array(cols).fill(null));
    const put = (cx: number, cy: number, ch: string, col: string, al: number) => {
      const c = Math.round(cx), r = Math.round(cy);
      if (r < 0 || r >= rows || c < 0 || c >= cols) return;
      const cur = grid[r]![c];
      if (!cur || cur.al < al) grid[r]![c] = { ch, col, al };
    };
    const A = this.pal.accent, UPc = UP, INK = this.PHOSPHOR, colours = [A, UPc, INK, "#ffd166", "#8fdcff", "#ff9ecb"];
    for (const sh of P.shells) {
      const age = now - sh.at;
      const bx = sh.x * cols, by = sh.y * rows, col = colours[Math.floor(sh.hue * colours.length)]!;
      // the rise: from the foot to the burst point over six hundred ms, a dot and a fading trail behind it
      const RISE = 600;
      if (age < 0 && age > -RISE) {
        const p = 1 + age / RISE, ry = rows - 1 - (rows - 1 - by) * p;
        put(bx, ry, "^", col, 0.95);
        for (let k = 1; k <= 4; k++) put(bx, ry + k, k < 2 ? "|" : k < 4 ? ":" : ".", col, Math.max(0.1, 0.5 - k * 0.1));
      } else if (age >= 0 && age < 2600) {
        // the burst: forty sparks on a ring, flying out, slowing, and falling; the glyph cools with age
        const T = age / 1000, n = 44, g = rng(Math.floor(sh.at) + 11);
        const slow = 1 - Math.exp(-T * 2.2);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + g() * 0.15, v = (0.8 + g() * 0.5) * sh.k;
          const x = bx + Math.cos(a) * v * 14 * slow, y = by + Math.sin(a) * v * 5.5 * slow + T * T * 2.4;
          const life = 1 - T / 2.6, ch = T < 0.35 ? "*" : T < 0.9 ? "+" : T < 1.6 ? "'" : ".";
          if (life > 0) put(x, y, ch, col, Math.max(0, life) * (i % 5 === 0 && T > 1 ? 0.5 : 1));
        }
        if (age < 140) { put(bx, by, "@", "#ffffff", 1); put(bx - 1, by, "*", "#ffffff", 0.9); put(bx + 1, by, "*", "#ffffff", 0.9); }
      }
    }
    // the finale: from the last shell on, the number assembles out of falling sparks in the pixel face, each dot of it a
    // glyph that settles from a spark into a solid block, and holds there until the reader presses a key
    const digits = String(P.n), FIN = P.fin ?? 6800;
    // the number: as big as fits with a row clear above and four rows kept under it for the words and the way out
    // the block is the number and the words under it, sized to fit the room and centred as one. The number is never
    // smaller than two cells a pixel; on a short glass the words close up instead: no blank row, then the way out on
    // the second line
    const scale = Math.max(2, Math.min(Math.floor(cols / (digits.length * 4)), Math.floor((rows - 4) / 5)));
    // the words' room is measured in pixels, since a row count floors away the half row that decides it
    const spare = S.sh / LH - 5 * scale, gap = spare >= 3.6 ? 1 : 0, lines = 2;
    const top = Math.max(0, Math.floor((rows - gap - lines - 5 * scale) / 2));
    if (t > FIN && !tiny) {
      const gw = digits.length * 4 * scale - scale, left = Math.floor((cols - gw) / 2);
      const settle = Math.min(1, (t - FIN) / 1600);
      digits.split("").forEach((d, di) => {
        const bits = glyphBits(d);
        for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
          if (bits[r * 3 + c] !== "1") continue;
          for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < scale; xx++) {
            const gx = left + (di * 4 + c) * scale + xx, gy = top + r * scale + yy;
            // each block lands in its own moment, falling in from above; once landed it is solid
            const own = ((gx * 7 + gy * 13) % 17) / 17, p = Math.min(1, Math.max(0, (settle - own * 0.5) / 0.5));
            if (p <= 0) continue;
            const ch = p < 0.5 ? "*" : p < 0.85 ? "+" : "#";
            put(gx, gy - (1 - p) * 6, ch, p < 0.85 ? A : "#ffd166", 0.4 + 0.6 * p);
          }
        }
      });
    }
    // the grid to the glass
    const x0 = S.tx, y0 = S.sy;
    if (tiny) { ctx.save(); ctx.beginPath(); ctx.rect(S.sx, S.sy, S.sw, S.sh); ctx.clip(); }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const cell = grid[r]![c]; if (!cell) continue;
      ctx.fillStyle = cell.col; ctx.globalAlpha = cell.al; ctx.fillText(cell.ch, x0 + c * chW, y0 + r * LH);
    }
    ctx.globalAlpha = 1;
    if (tiny) ctx.restore();
    // once the number has landed, the occasion types in under it, then a line later the way out
    const wordsAt = tiny ? 1200 : FIN + 1600, landed = Math.min(1, Math.max(0, (t - wordsAt) / 900));
    if (landed > 0) {
      // a phone has no escape key: a tap on the glass is the way out there, and the line says so
      const touch = typeof matchMedia === "function" && matchMedia("(hover: none)").matches;
      const [msg, more] = P.words ?? [`${P.n.toLocaleString("en-US")}+ agents online at once. Thanks for being early.`, "Let's build something great together."], bye = touch ? "tap to continue" : "press esc";
      const shown = msg.slice(0, Math.ceil(msg.length * landed));
      const my = tiny ? S.sy + Math.max(0, (S.sh - 2 * LH) / 2) : S.sy + (top + 5 * scale + gap) * LH, out = t > wordsAt + 2600 && P.leaving == null;
      ctx.font = this.mono(600); ctx.fillStyle = "#ffd166"; ctx.globalAlpha = 1;
      ctx.fillText(shown, S.tx + (S.tw - ctx.measureText(msg).width) / 2, my);
      if (landed >= 1) {
        ctx.font = this.mono(400); ctx.fillStyle = INK; ctx.globalAlpha = 0.85;
        // the way out follows the words on the same line, breathing, once it is time to go
        const gapW = ctx.measureText("  ").width, moreW = ctx.measureText(more).width, byeW = out ? ctx.measureText(bye).width : 0;
        const lx = S.tx + (S.tw - (moreW + (out ? gapW + byeW : 0))) / 2;
        ctx.fillText(more, lx, my + LH);
        if (out) { ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t / 400); ctx.fillText(bye, lx + moreW + gapW, my + LH); }
        ctx.globalAlpha = 1;
      }
    }
    return true;
  }

  /** Print lines under the feed, the way a shell prints a command's output. */
  echo(lines: string[], col?: string) {
    for (const t of lines) this.echoes.push({ t, col: col ?? null, al: 0.9 });
    this.echoes = this.echoes.slice(-24);
    this.drawBlocks(performance.now());
  }
  clearEchoes() { this.echoes = []; this.drawBlocks(performance.now()); }

  // ------------------------------------------------------------------ the prompt's answers
  //
  // Each command answers on the glass from what the wall already holds. Nothing here says what
  // the header and the footer already say; it is the figures behind them.

  /** A holder on one line: the name when known, else the short address. */
  private static holder(address: string | null, ens: string | null) {
    return address ? ens ?? `${address.slice(0, 6)}…${address.slice(-4)}` : "no holder on record";
  }
  private static plural(n: number, word: string) { return `${WallRenderer.fmt(n)} ${word}${n === 1 ? "" : "s"}`; }

  /** What the header does not show: how long the swarm has been quiet, what is waiting, who holds the seats. */
  report(): string[] {
    const m = this.snapshot;
    if (!m || m.at === 0) return ["the control plane has not answered yet"];
    const hh = m.health, f = WallRenderer.fmt, out: string[] = [];
    const top = m.events[0];
    if (top) { const { t } = WallRenderer.feedLine(top, false); out.push(`last move ${ago(top.at)} · ${t.slice(7).replace(/\s+/g, " ").trim()}`); }
    const down = [["verifier", hh.verifierUp], ["publisher", hh.publisherUp], ["deployer", hh.deployerUp]].filter(([, up]) => up === false).map(([n]) => n);
    if (down.length) out.push(`down: ${down.join(" · ")}`);
    const waiting = hh.pendingVerification + hh.pendingDeployment + hh.pendingSites;
    out.push(waiting ? `waiting: ${f(hh.pendingVerification)} to verify · ${f(hh.pendingDeployment)} to deploy · ${f(hh.pendingSites)} site${hh.pendingSites === 1 ? "" : "s"} to publish` : "nothing waiting on the verifier, the deployer or the publisher");
    const owners = m.owners ?? [];
    const held = new Map<string, number>();
    for (const o of owners) if (o) held.set(o.toLowerCase(), (held.get(o.toLowerCase()) ?? 0) + 1);
    const largest = Math.max(0, ...held.values());
    out.push(`seats: ${f(hh.seatsEnrolled)} enrolled of ${f(SEATS)} · ${WallRenderer.plural(held.size, "holder")}${largest ? ` · the largest holds ${f(largest)}` : ""}`);
    if (m.chain) out.push(`collection ${m.chain.collection.slice(0, 6)}…${m.chain.collection.slice(-4)} on ${m.chain.chainId === 1 ? "mainnet" : m.chain.chainId === 11155111 ? "sepolia" : `chain ${m.chain.chainId}`}`);
    return out;
  }

  /** The jobs by state, how the recent moves went, the last failure and why, and the busiest agent. */
  jobs(): string[] {
    const m = this.snapshot;
    if (!m || m.at === 0) return ["the control plane has not answered yet"];
    const cc = m.counts, f = WallRenderer.fmt, out: string[] = [];
    const order = ["executing", "completed", "blocked", "cancelled"];
    const states = Object.entries(cc.jobStates).sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    out.push(`${WallRenderer.plural(cc.jobs, "job")} · ${states.map(([k, n]) => `${f(n)} ${k}`).join(" · ")}`);
    const nodes = m.events.filter((e): e is Extract<MachineEvent, { kind: "node" }> => e.kind === "node");
    const passed = nodes.filter((e) => e.state === "accepted").length;
    const failed = nodes.filter((e) => e.state === "failed" && !/cancel/.test(e.reason ?? ""));
    const cancelled = nodes.filter((e) => e.state === "failed" && /cancel/.test(e.reason ?? "")).length;
    if (nodes.length) out.push(`last ${WallRenderer.plural(nodes.length, "step")}: ${f(passed)} passed · ${f(failed.length)} failed · ${f(cancelled)} cancelled`);
    const last = failed[0];
    if (last) out.push(`last failure ${ago(last.at)} · ${last.tokenId == null ? "no agent" : `agent #${last.tokenId}`} on ${last.step}${last.reason ? ` · ${WallRenderer.short(last.reason)}` : ""}`);
    const busiest = Object.values(m.seats).sort((a, b) => b.accepted + b.failed - (a.accepted + a.failed))[0];
    if (busiest) out.push(`busiest agent #${busiest.tokenId} · ${WallRenderer.plural(busiest.accepted, "step")} done · ${f(busiest.failed)} failed · last ${ago(busiest.last)}`);
    return out;
  }

  /** The holder of a seat, for the wall to name before it asks about the seat. */
  ownerOf(id: number): string | null { return this.snapshot?.owners?.[id] ?? null; }

  /**
   * The seats with a record, best first: the most work accepted, and between two of those, the one
   * that had to be asked fewer times. It is a standing among agents, not among the two thousand
   * seats, so a seat that has never worked is not ranked last, it is simply not in the running.
   */
  private ranking(): number[] {
    const m = this.snapshot;
    if (!m) return [];
    return Object.values(m.seats)
      .filter((r) => WallRenderer.tried(r) > 0)
      .sort((a, b) => b.accepted - a.accepted || WallRenderer.rate(b) - WallRenderer.rate(a) || a.tokenId - b.tokenId)
      .map((r) => r.tokenId);
  }
  /** What a seat has been judged on. A plane without the tally only knows the verdicts it has seen. */
  private static tried(r: SeatRecord) { return r.attempts ?? r.accepted + r.failed; }
  private static rate(r: SeatRecord) { const n = WallRenderer.tried(r); return n ? r.accepted / n : 0; }
  private static ordinal(n: number) {
    const teen = n % 100 >= 11 && n % 100 <= 13;
    return `${n}${teen ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
  }
  /**
   * What a seat has done, in one line: how much of what it attempted was taken, and what became of
   * the rest. The share is the point. "195 steps done" reads the same for a seat that is asked
   * twice for every step it lands, and a holder cannot tell those apart from a total.
   */
  private static record(r: SeatRecord, brief = false): string {
    const f = WallRenderer.fmt, n = r.attempts;
    // a seat of a holder's several is a row in a list, and the glass cuts a line that runs past it:
    // the share and when it last worked survive the cut, the breakdown of the rest does not
    const when = brief ? `worked ${ago(r.last)}` : `last worked ${ago(r.last)}`;
    if (n == null) return `${WallRenderer.plural(r.accepted, "step")} done · ${f(r.failed)} failed · ${when}`;
    const rest = brief ? [] : [
      r.rejected ? `${f(r.rejected)} turned down` : null,
      r.failed ? `${f(r.failed)} failed` : null,
      r.pending ? `${f(r.pending)} waiting on a verdict` : null,
    ].filter((x): x is string => x !== null);
    return [`${f(r.accepted)} of ${f(n)} accepted`, `${(WallRenderer.rate(r) * 100).toFixed(1)}%`, ...rest, when].join(" · ");
  }

  /** One seat: its holder, where it stands, its record, and its module ringed on the wall. */
  seat(id: number, ens: string | null): string[] {
    const m = this.snapshot;
    if (!m || m.at === 0) return ["the control plane has not answered yet"];
    if (!Number.isInteger(id) || id < 0 || id >= SEATS) return [`seat #${id}: the collection runs #0 to #${SEATS - 1}`];
    const r = m.seats[id], who = WallRenderer.holder(this.ownerOf(id), ens);
    this.point([id]);
    if (!r) return [`seat #${id} · held by ${who} · no work on record`];
    const state = r.working ? "working now" : r.queued ? `queued for ${WallRenderer.plural(r.queued, "step")}` : "idle";
    const rank = this.ranking(), place = rank.indexOf(id);
    const standing = place < 0 ? "" : ` · ${WallRenderer.ordinal(place + 1)} of ${WallRenderer.plural(rank.length, "agent")}`;
    return [`agent #${id} · held by ${who}${standing} · ${state}`, `  ${WallRenderer.record(r)}`];
  }

  /** A holder's seats, ringed on the wall, and which of them are agents. */
  holder(address: string, ens: string | null): string[] {
    const m = this.snapshot;
    if (!m || m.at === 0) return ["the control plane has not answered yet"];
    const key = address.toLowerCase(), ids: number[] = [];
    (m.owners ?? []).forEach((o, i) => { if (o && o.toLowerCase() === key) ids.push(i); });
    const who = WallRenderer.holder(address, ens);
    if (!ids.length) return [`${who} holds no seats`];
    this.point(ids);
    const agents = ids.filter((id) => m.seats[id]);
    const head = `${who} holds ${WallRenderer.plural(ids.length, "seat")}${agents.length ? ` · ${agents.length} of them ${agents.length === 1 ? "is an agent" : "are agents"}` : ""} · ringed on the wall`;
    // an agent gets a line of its own, worked first, since a holder reads their own seats one by one;
    // the seats with nothing behind them are a list, because there is nothing to say about them yet
    const rank = this.ranking();
    const working = agents
      .slice()
      .sort((a, b) => rank.indexOf(a) - rank.indexOf(b))
      .slice(0, 8)
      .map((id) => {
        const r = m.seats[id]!, place = rank.indexOf(id);
        const standing = place < 0 ? "" : `${WallRenderer.ordinal(place + 1)} of ${WallRenderer.fmt(rank.length)} · `;
        return `  ${`#${id}`.padEnd(6)} ${standing}${WallRenderer.record(r, true)}`;
      });
    const over = agents.length > 8 ? [`  … and ${agents.length - 8} more agents`] : [];
    const idle = ids.filter((id) => !m.seats[id]);
    const rest = idle.length
      ? [`  ${idle.slice(0, 12).map((id) => `#${id}`).join(" ")}${idle.length > 12 ? ` … and ${idle.length - 12} more` : ""} · no work on record`]
      : [];
    return [head, ...working, ...over, ...rest];
  }

  /** The feed's lines that carry a word, each naming its job, newest last. */
  grep(word: string): string[] {
    const m = this.snapshot;
    if (!m || m.at === 0) return ["the control plane has not answered yet"];
    const q = word.toLowerCase();
    const hits = m.events.map((e) => WallRenderer.feedLine(e, false).t).filter((t) => t.toLowerCase().includes(q));
    if (!hits.length) return [`no line carries "${word}"`];
    return [`${hits.length} of ${m.events.length} lines carry "${word}"${hits.length > 12 ? ", the newest 12:" : ":"}`, ...hits.slice(0, 12).reverse().map((t) => `  ${t}`)];
  }

  /** The wall as it stands, freshly painted with the reader's own modules ringed, for a picture of the room. */
  snap(): HTMLCanvasElement {
    if (this.mine) {
      const ids: number[] = [];
      (this.snapshot?.owners ?? []).forEach((o, i) => { if (o && o.toLowerCase() === this.mine) ids.push(i); });
      if (ids.length) this.point(ids);
    }
    this.drawBlocks(performance.now());
    return this.canvas;
  }

  /** Ring the modules holding these seats for a moment, so the wall answers the prompt too. */
  private point(ids: number[]) {
    const L = this.layout;
    if (!L) return;
    const now = performance.now(), want = new Set(ids);
    L.units.forEach((u, i) => {
      if (!u.ids.some((id) => want.has(id))) return;
      this.warm.set(i, now + RING_MS); this.ringed.add(i);
      this.redraw(u, now, true, true);
    });
    // with the frame loop off, the rings would stay: take them off by hand
    if (this.opts.still) window.setTimeout(() => { for (const i of this.ringed) { this.ringed.delete(i); this.warm.delete(i); if (L.units[i]) this.redraw(L.units[i]!, 0, false, false); } }, RING_MS);
  }
  /** Switch the monitor to a tab by name, as a command would. */

  // ------------------------------------------------------------------ pointer

  /** The grid cell under a client point, and the canvas's on-screen box. */
  private at(clientX: number, clientY: number) {
    const L = this.layout!, b = this.canvas.getBoundingClientRect();
    const col = Math.floor((clientX - b.left) / (b.width / L.cols)), row = Math.floor((clientY - b.top) / (b.height / L.rows));
    const v = col >= 0 && col < L.cols && row >= 0 ? L.grid[row * L.cols + col] : undefined;
    // a bare plate is nothing to point at
    return { b, col, row, v: v != null && v <= HOLE ? undefined : v };
  }

  pointerMove(clientX: number, clientY: number): "pointer" | "" {
    const L = this.layout, m = this.snapshot;
    if (!L || !m) return "";
    const { b, v } = this.at(clientX, clientY);
    const cw = b.width / L.cols, ch = b.height / L.rows;
    this.hotCog(v != null && v < 0 && L.blocks[-1 - v]!.kind === "settings");
    this.hotPlay(v != null && v < 0 && L.blocks[-1 - v]!.kind === "listen");
    if (v != null && v < 0) {
      // the monitor explains itself: tabs look like tabs and the prompt says "click to type"
      this.opts.onTip(null);
      this.setHot(null);
      this.hotFoot(L.blocks[-1 - v]!.kind === "monitor" && !this.film && !this.backs && this.onFoot(clientX, clientY));
      return "pointer";
    }
    if (v == null) { this.opts.onTip(null); this.setHot(null); this.hotFoot(false); return ""; }
    this.setHot(v);
    this.opts.onTip(this.tipFor(v, cw, ch));
    return "pointer";
  }

  /** The card for the module a seat is in, as the pointer would raise it, or null before the wall is laid out. */
  tipOf(seat: number): Tip | null {
    const L = this.layout;
    if (!L || !this.snapshot) return null;
    const v = L.units.findIndex((u) => u.ids.includes(seat));
    if (v < 0) return null;
    const b = this.canvas.getBoundingClientRect();
    return this.tipFor(v, b.width / L.cols, b.height / L.rows);
  }

  /** The card's data for a module, placed in CSS pixels of the canvas. */
  private tipFor(v: number, cw: number, ch: number): Tip {
    const L = this.layout!, m = this.snapshot!, u = L.units[v]!, s = m.seats[u.seat] ?? null;
    const held = m.events.find((e): e is Extract<MachineEvent, { kind: "node" }> => e.kind === "node" && e.tokenId === u.seat && (e.state === "leased" || e.state === "working"));
    return {
      x: (u.c + u.w / 2) * cw, left: u.c * cw, y: u.r * ch, bottom: (u.r + u.h) * ch,
      tokenId: u.seat, owner: u.owner, seats: u.ids, record: s, held: u.ids.map((id) => m.seats[id]).filter((r): r is SeatRecord => Boolean(r)), current: held ? { step: held.step, objective: held.objective } : null, activity: u.activity,
      label: initialsOf(this.designOf(u)) || null,
      first: u.first, lot: this.designOf(u)?.lot ?? null,
    };
  }

  /** The pointer arriving at or leaving the part of the line that turns; only a change repaints. */
  private hotFoot(on: boolean) {
    if (this.footHot === on) return;
    this.footHot = on;
    if (this.layout) this.drawBlocks(performance.now());
  }

  pointerLeave() {
    this.hotCog(false);
    this.hotPlay(false);
    this.hotFoot(false);
    this.opts.onTip(null);
    if (this.hot != null) this.warm.set(this.hot, performance.now() + LINGER);
    this.hot = null;
  }

  /** Whether a client point is on the part of the status line that turns over. */
  private onFoot(clientX: number, clientY: number): boolean {
    const f = this.foot;
    if (!f) return false;
    const b = this.canvas.getBoundingClientRect(), k = this.width / b.width;
    const x = (clientX - b.left) * k, y = (clientY - b.top) * k;
    return x >= f.x - 2 && x <= f.x + f.w + 2 && y >= f.y && y <= f.y + f.h;
  }

  /** The URL under a client point, if the pointer is on one. */
  private linkAt(clientX: number, clientY: number): string | null {
    const b = this.canvas.getBoundingClientRect(), k = this.width / b.width;
    const x = (clientX - b.left) * k, y = (clientY - b.top) * k;
    const hit = this.links.find((l) => x >= l.x - 2 && x <= l.x + l.w + 2 && y >= l.y - 2 && y <= l.y + l.h);
    return hit ? hit.href : null;
  }

  click(clientX: number, clientY: number) {
    const L = this.layout;
    if (!L) return;
    const { b, v } = this.at(clientX, clientY);
    if (v == null) return;
    if (v < 0) {
      const bk = L.blocks[-1 - v]!;
      if (bk.kind === "settings") { this.opts.onSettings?.(); return; }
      if (bk.kind === "listen") { this.opts.onListen?.(); return; }
      if (this.backs) { this.opts.onFront?.(); return; }
      const href = this.linkAt(clientX, clientY);
      if (href) { this.opts.onLink?.(href); return; }
      // the status line turns over: the market's read of the machine, then the machine's own
      if (bk.kind === "monitor" && !this.film && this.onFoot(clientX, clientY)) {
        this.face = this.face === 0 ? 1 : 0;
        remember(FACE_KEY, String(this.face));
        this.opts.sound?.press();
        this.drawBlocks(performance.now());
        return;
      }
      // on the reel a tap on a key in the legend is that key: the page answers it as it would the keyboard
      if (this.film) { const key = this.filmKeyAt(clientX, clientY); if (key) this.opts.onFilmKey?.(key); return; }
      // a tap on the monitor while the show holds is the way out on a phone; otherwise it takes the keyboard for the prompt
      if (this.party && this.party.leaving == null && performance.now() - this.party.since > 2000) { this.endParty(); return; }
      this.opts.onFocus?.();
      return;
    }
    const u = L.units[v]!;
    // every module takes the press, and a click goes through to the holder's page
    this.press(v);
    this.opts.onPin?.(this.tipFor(v, b.width / L.cols, b.height / L.rows));
  }
}
