/**
 * Type in the drawing's own language.
 *
 * A system font inside a drawn instrument breaks the illusion, so every number and word on the
 * wall is either seven-segment digits or this 3×5 pixel face. Each glyph is fifteen bits, three per
 * row, top to bottom. Uppercase only, and only the letters the labels use. A holder's label on their
 * own instrument takes the rest of the alphabet and a few marks besides, from a second table that
 * the wall's own words never reach, so what the wall has always printed prints the same.
 */
const FONT: Record<string, string> = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110",
  E: "111100110100111", H: "101101111101101", I: "111010010010111", K: "101101110101101",
  L: "100100100100111", M: "101111111101101", N: "110101101101101", O: "010101101101010",
  R: "110101110101101", S: "011100010001110", T: "111010010010010", U: "101101101101111",
  V: "101101101101010", W: "101101111111101", Y: "101101010010010", Z: "111001010100111",
  0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 3: "111001111001111",
  4: "101101111001001", 5: "111100111001111", 6: "111100111101111", 7: "111001001001001",
  8: "111101111101111", 9: "111101111001111", "%": "101001010100101", "°": "010101010000000",
  " ": "000000000000000",
};

/** The rest of the alphabet and the marks, for the labels holders stick on their instruments. */
const LABEL_FONT: Record<string, string> = {
  ...FONT,
  F: "111100110100100", G: "011100101101011", J: "001001001101010", P: "110101110100100",
  Q: "010101101110011", X: "101101010101101", "-": "000000111000000", ".": "000000000000010",
  "!": "010010010000010", "?": "110001010000010", "/": "001001010100100", "+": "000010111010000",
  "#": "101111101111101", "&": "010101010101011", "'": "010010000000000", "*": "101010101000000",
  ":": "000010000010000",
};

/** The glyph's fifteen bits, for anything that wants to set the face in something other than pixels. */
export const glyphBits = (ch: string, full = false): string => (full ? LABEL_FONT : FONT)[ch] ?? FONT[" "]!;

/** The width of a string set in the pixel face at scale `s` (one pixel = s×s). */
export function pixelWidth(text: string, s: number): number {
  return text.length * 4 * s - s;
}

/** Draw a string in the pixel face. Unknown characters become a space; `full` sets a holder's label, with every letter. */
export function pixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, s: number, colour: string, full = false): void {
  ctx.fillStyle = colour;
  const face = full ? LABEL_FONT : FONT;
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = face[ch] ?? FONT[" "]!;
    for (let i = 0; i < 15; i++) {
      if (glyph[i] === "1") ctx.fillRect(cx + (i % 3) * s, y + Math.floor(i / 3) * s, s, s);
    }
    cx += 4 * s;
  }
}

/** Segments a–g of each digit, in the order top, top-right, bottom-right, bottom, bottom-left, top-left, middle. */
const SEGMENTS = ["1111110", "0110000", "1101101", "1111001", "0110011", "1011011", "1011111", "1110000", "1111111", "1111011"];

/**
 * Seven-segment digits. Unlit segments are drawn faintly, as on a real display, so a "7" still
 * shows the shape of the cell it sits in.
 */
export function sevenSegment(
  ctx: CanvasRenderingContext2D,
  digits: string,
  x0: number,
  y0: number,
  digitWidth: number,
  digitHeight: number,
  colour: string,
): void {
  const sw = Math.max(1, digitWidth * 0.14);
  for (let i = 0; i < digits.length; i++) {
    const on = SEGMENTS[Number(digits[i])] ?? "0000000";
    const xx = x0 + digitWidth * i;
    const ww = digitWidth * 0.66;
    const hh = digitHeight;
    const segs: Array<[number, number, number, number]> = [
      [xx, y0, ww, sw],
      [xx + ww - sw, y0, sw, hh / 2],
      [xx + ww - sw, y0 + hh / 2, sw, hh / 2],
      [xx, y0 + hh - sw, ww, sw],
      [xx, y0 + hh / 2, sw, hh / 2],
      [xx, y0, sw, hh / 2],
      [xx, y0 + hh / 2 - sw / 2, ww, sw],
    ];
    segs.forEach((r, j) => {
      ctx.fillStyle = colour;
      ctx.globalAlpha = on[j] === "1" ? 1 : 0.12;
      ctx.fillRect(r[0], r[1], r[2], r[3]);
    });
  }
  ctx.globalAlpha = 1;
}
