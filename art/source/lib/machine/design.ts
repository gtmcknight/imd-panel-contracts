/**
 * A wallet's own panel, as it set it onchain.
 *
 * A design is one 32-byte word per wallet, stored by PanelDesigns on Ethereum mainnet and read by
 * the wall for every holder in a few calls. It never names a shape or a colour: the layout decides
 * how big a wallet's module is from the seats it holds, the reader's theme decides its plate and
 * its lamps, and the design only steers what the module's own draw would have been. A device kind
 * is preferred where the module has room for it, up to three parts are mounted first where they
 * fit, and a seed re-rolls whatever the parts leave open. The label is the panel's letters: up to three, struck as a
 * gold hallmark on the back of the panel when it turns over. Zero is no design, and a wallet with none draws exactly
 * as it always has. When a module shrinks, the parts are placed in the order picked, so the last
 * picked are the ones left off; the word itself never changes.
 *
 * The word, byte 0 most significant (the contract's NatSpec carries the same table):
 *
 *   0      version, 2
 *   1      device kind, 0 auto, then DESIGN_KINDS from 1
 *   2-4    parts, in the order picked: an instrument's index in INSTRUMENT_NAMES plus one, 0 none
 *   5-8    seed, uint32, 0 keeps the module's own draw
 *   9-17   label, twelve 6-bit characters of LABEL_CHARS, 0 ends it; the site sets and draws up to three of A-Z and 0-9,
 *          the hallmark on the panel's back (see initialsOf)
 *   18-19  lot, uint16: the year and week the wallet's first agent came online, as YYWW (2618 is 2026 week 18),
 *          printed on the board's rail; 0 for none, which the board prints as 2600. Written by the site when it saves
 *   20-31  reserved, zero. A panel wears the viewer's theme; a design carries no colours
 *
 * Only version 2 is read. Version 1 carried a lamp and a plate and was never deployed, so a version
 * 1 word draws as no design, the same as any version this site does not know.
 *
 * No imports but types, so a script can load this file on its own: a part's index is checked
 * against the instruments where it is drawn, not here.
 */
import type { DeviceKind } from "./devices";

export const DESIGN_VERSION = 2;

/** The device kinds a design can ask for, in their byte order from 1. */
export const DESIGN_KINDS = ["mixer", "console", "rack", "station", "synth", "patch", "grid"] as const satisfies readonly DeviceKind[];


/** How many parts a design can mount. */
export const PARTS_MAX = 3;

/**
 * A single-cell tile as a part: its index from here. A one-seat panel is a single cell, and the tiles are the pictures drawn
 * for exactly that, so a holder of one seat can pick one as their part; anywhere bigger a tile part is left off.
 */
export const TILE_PART = 200;
/** The tile a part stands for, or -1 for an instrument. */
export const tileOf = (T: number): number => (T >= TILE_PART ? T - TILE_PART : -1);

/** The label's alphabet, from code 1; code 0 ends the label. Every character has a glyph in the pixel face. */
export const LABEL_CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.!?/+#&'*:";
export const LABEL_MAX = 12;

export type Design = {
  /** A preferred device kind, or null to let the shape choose. */
  kind: (typeof DESIGN_KINDS)[number] | null;
  /** Up to PARTS_MAX instrument kinds, in the order picked, no repeats; mounted before the draw fills the rest. */
  parts: number[];
  /** 0 keeps the module's own draw; anything else re-rolls what the parts leave open. */
  seed: number;
  /** The panel's letters: the word holds up to LABEL_MAX of LABEL_CHARS; the site sets up to INITIALS_MAX of A-Z and 0-9. */
  label: string;
  /** The lot code printed on the board's back: YYWW of the week the wallet's first agent came online, or null for none. */
  lot?: number | null;
};

export const BLANK: Design = { kind: null, parts: [], seed: 0, label: "" };

/** A label as it will be stored: upper case, only the alphabet, no longer than the limit, no trailing space. */
export function cleanLabel(text: string): string {
  return [...text.toUpperCase()].filter((c) => LABEL_CHARS.includes(c)).join("").replace(/^ +/, "").slice(0, LABEL_MAX).replace(/ +$/, "");
}

/** How many letters a panel's back carries. */
export const INITIALS_MAX = 3;
// three-letter strings that read as a slur: the back never etches them, whatever a word holds, nor them spelt with digits
// for letters (F4G, N1G)
const INITIALS_BLOCKED = new Set(["FAG", "FGT", "NIG", "NGR", "NGA", "KKK"]);
const AS_LETTER: Record<string, string> = { 0: "O", 1: "I", 3: "E", 4: "A", 5: "S", 6: "G", 7: "T", 8: "B", 9: "G" };

/** Letters as they will be stored and etched: upper case, A-Z and 0-9 only, at most three, and none of the few blocked. */
export function cleanInitials(text: string): string {
  const s = [...text.toUpperCase()].filter((c) => /[A-Z0-9]/.test(c)).join("").slice(0, INITIALS_MAX);
  return INITIALS_BLOCKED.has([...s].map((c) => AS_LETTER[c] ?? c).join("")) ? "" : s;
}

/**
 * The letters on a panel's back, read from its label by the same rules the site saves with, so a word written straight
 * to the contract etches nothing else. Takes a design or its label.
 */
export const initialsOf = (d: Design | string | null | undefined): string => cleanInitials(typeof d === "string" ? d : d?.label ?? "");

/** Parts as they will be stored: whole kinds a byte can hold, each once, no more than three. */
export const cleanParts = (parts: readonly number[]): number[] =>
  [...new Set(parts.filter((T) => Number.isInteger(T) && T >= 0 && T < 255))].slice(0, PARTS_MAX);

/** Whether a design is the module's own with nothing changed: saving it is the same as clearing. */
export const isBlank = (d: Design) => !d.kind && !d.parts.length && !d.seed && !d.label;

/** The word for a design, as 0x and 64 hex digits. A blank design is zero. */
export function encodeDesign(d: Design): `0x${string}` {
  if (isBlank(d)) return `0x${"0".repeat(64)}`;
  let w = BigInt(DESIGN_VERSION) << 248n;
  w |= BigInt(d.kind ? DESIGN_KINDS.indexOf(d.kind) + 1 : 0) << 240n;
  cleanParts(d.parts).forEach((T, i) => { w |= BigInt(T + 1) << BigInt(232 - 8 * i); });
  w |= BigInt(d.seed >>> 0) << 184n;
  const label = cleanLabel(d.label);
  for (let i = 0; i < label.length; i++) w |= BigInt(LABEL_CHARS.indexOf(label[i]!) + 1) << BigInt(184 - 6 * (i + 1));
  if (d.lot) w |= BigInt(d.lot & 0xffff) << 96n;
  return `0x${w.toString(16).padStart(64, "0")}`;
}

/**
 * The design in a word, or null for zero, for a version this site does not know, or for anything
 * that is not a word. A kind past the list is auto, so a later list never draws as garbage here.
 */
export function decodeDesign(word: string | null | undefined): Design | null {
  if (!word || !/^0x[0-9a-fA-F]{64}$/.test(word)) return null;
  const w = BigInt(word);
  if (w === 0n || Number(w >> 248n) !== DESIGN_VERSION) return null;
  const byte = (i: number) => Number((w >> BigInt(248 - 8 * i)) & 0xffn);
  const k = byte(1);
  let label = "";
  for (let i = 0; i < LABEL_MAX; i++) {
    const c = Number((w >> BigInt(184 - 6 * (i + 1))) & 63n);
    if (!c || c > LABEL_CHARS.length) break;
    label += LABEL_CHARS[c - 1];
  }
  return {
    kind: k >= 1 && k <= DESIGN_KINDS.length ? DESIGN_KINDS[k - 1]! : null,
    parts: cleanParts([byte(2), byte(3), byte(4)].filter(Boolean).map((b) => b - 1)),
    seed: Number((w >> 184n) & 0xffffffffn),
    label: label.trimEnd(),
    lot: Number((w >> 96n) & 0xffffn) || null,
  };
}

/** A date as the board's lot code, YYWW: the two-digit year and the ISO week. */
export function lotOf(at: string | number | Date): number {
  const d = new Date(at), t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // the ISO week: the Thursday of this week decides the year
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const week = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  return (t.getUTCFullYear() % 100) * 100 + week;
}

/** The draw a design re-rolls to, standing in for the module's first seat in every seeded choice: clear of every real seat's. */
export const seedOf = (d: Design | null, first: number): number => (d?.seed ? 4096 + (d.seed % 1_048_573) : first);

/** A fresh seed for "Fill": any non-zero uint32. */
export const freshSeed = (): number => 1 + Math.floor(Math.random() * 0xfffffffe);
