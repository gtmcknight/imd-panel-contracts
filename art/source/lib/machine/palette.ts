/**
 * The wall's colours.
 *
 * The wall is a photograph's palette, not the page's: a grey wall, pale instrument faces, black
 * ink, black glass. It does not follow the reader's light/dark choice because it is a picture of a
 * room, and a room does not invert. Two colours carry state and nothing else: green for what is
 * alive, a seat working now, a service that is up; the brand's red for what went wrong, a node
 * that failed. The terminal's phosphor is its own green.
 */
export type Palette = {
  /** The wall behind the modules, seen in the gaps. */
  wall: string;
  /** An instrument's face plate. */
  face: string;
  /** Ink: strokes, knobs, needles, type on a face. */
  stroke: string;
  /** Black glass: scopes, readouts, the terminal. */
  screen: string;
  /** What is drawn on the glass: a trace, digits, a sweep. Light on either panel tone. */
  glass: string;
  /** The line around each module. Ink on a light wall; on a dark wall a darker line, so the boxes are edges, not outlines. */
  frame?: string;
  /** The accent: what went wrong. */
  accent: string;
  /** Lit glass on a module that is on, and the brighter lit glass while it is working. */
  lit: string;
  hot: string;
  /** What is alive: working now, or a service that is up. */
  ok: string;
};

export const LIGHT: Palette = {
  wall: "#7d7d79",
  face: "#d6d6d2",
  stroke: "#141414",
  screen: "#0a0a0a",
  glass: "#f2f2ee",
  accent: "#b3261e",
  ok: "#1f9d55",
  lit: "#3ecf7a",
  hot: "#9df5bd",
};

/**
 * A panel of another batch: about one module in six, a shade darker than the rest with the same
 * ink, the way a rack fills up over years. Tone without a black plate in a grey wall.
 */
export const INVERTED: Palette = { ...LIGHT, face: "#b8b8b3", screen: "#050505" };

/**
 * The wall's themes, chosen from the cog. Each is a piece of gear that existed: a palette for the
 * faces, one for the panel in six from another batch, and the colour its lamps and lit glass take. Steel is the
 * wall as photographed with P1 terminal green. Ivory is the same room in warmer light with the amber
 * of a monochrome monitor. Night is the lights off and the same terminal green, on black.
 * Olive is a field radio with red lamps. Slate is a cool grey instrument with the orange of a gas
 * plasma screen. Onyx is a black hi-fi with the same amber, on black. Every lamp is a screen that existed,
 * and none sits on a plate of its own hue. State keeps its colours in every theme: red is wrong,
 * and the terminal's phosphor is the phosphor.
 */
export type ThemeName = "steel" | "ivory" | "night" | "olive" | "slate" | "onyx";
export type Theme = { light: Palette; dark: Palette; lamp: string; note: string; term: Phosphor };

/** The terminal's phosphor in a theme: bright for the written line, dim for the quiet one, and the rule between. */
export type Phosphor = { ink: string; dim: string; rule: string };
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
const mix = (a: string, b: string, t: number) => "#" + hex(a).map((v, i) => Math.round(v + (hex(b)[i]! - v) * t).toString(16).padStart(2, "0")).join("");
/** A lamp's phosphor: the written line lifted most of the way to white, the quiet line pulled toward grey. */
export const phosphorOf = (lamp: string): Phosphor => ({ ink: mix(lamp, "#ffffff", 0.6), dim: mix(lamp, "#7a7a7a", 0.4), rule: mix(lamp, "#7a7a7a", 0.4) + "59" });
const theme = (light: Palette, dark: Palette, lamp: string, note: string): Theme => ({ light, dark, lamp, note, term: phosphorOf(lamp) });

const IVORY: Palette = { ...LIGHT, wall: "#8a8577", face: "#ebe5d4", stroke: "#1b1915", screen: "#0b0a08", glass: "#fbf7ea" };
// night is the room with the lights off: cool charcoal plates, a little blue in the dark. Onyx is a black hi-fi: true black, warm ink
const NIGHT: Palette = { ...LIGHT, wall: "#0d0f12", face: "#22262b", stroke: "#b8bec6", screen: "#000000", glass: "#e4e8ee", frame: "#000000" };
const OLIVE: Palette = { ...LIGHT, wall: "#3b3f2e", face: "#6b6f52", stroke: "#12140c", screen: "#090a06", glass: "#ece6c6" };
const SLATE: Palette = { ...LIGHT, wall: "#4f5a65", face: "#c8cfd5", stroke: "#12191f", screen: "#070c11", glass: "#f0f4f7" };
const ONYX: Palette = { ...LIGHT, wall: "#000000", face: "#1e1e1e", stroke: "#d9d3c7", screen: "#000000", glass: "#f3eee2", frame: "#000000" };

export const THEMES: Record<ThemeName, Theme> = {
  steel: theme(LIGHT, INVERTED, "#39d353", "the wall as photographed, P1 terminal green"),
  ivory: theme(IVORY, { ...IVORY, face: "#cfc8b4", screen: "#050403" }, "#ffb000", "cream faces, monitor amber"),
  // on the dark themes the other batch is a shade lighter instead, the same ink throughout
  night: theme(NIGHT, { ...NIGHT, face: "#30353b", screen: "#000000" }, "#3dff6b", "the lights off, phosphor green"),
  olive: theme(OLIVE, { ...OLIVE, face: "#4f533c", screen: "#040503" }, "#ff4b3e", "a field radio, red lamps"),
  slate: theme(SLATE, { ...SLATE, face: "#a9b2ba", screen: "#03070a" }, "#ff8c1a", "a cool grey instrument, gas plasma orange"),
  onyx: theme(ONYX, { ...ONYX, face: "#2b2b2b", screen: "#000000" }, "#ffb000", "a black hi-fi, amber lamps"),
};

/** The cog's order: the light plates on the first row, the dark on the second. */
export const THEME_NAMES: readonly ThemeName[] = ["steel", "ivory", "slate", "night", "onyx", "olive"];

/** Which modules are lit: the active ones, any with an agent behind a seat, as the card counts them; only the ones working now; or all, the room as a show. */
export type LitMode = "active" | "working" | "all";
/** The default leads, as it does in every row of the cog's panel. */
export const LIT_NAMES: readonly LitMode[] = ["active", "working", "all"];

/** The terminal's phosphor as the steel wall has it, for the cards drawn outside a theme. */
export const PHOSPHOR = "#c9ecbf";
export const PHOSPHOR_DIM = "#7fb37a";
