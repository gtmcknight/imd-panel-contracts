/**
 * The wall's remembered choices, from the cog on the front page: its colours, its LEDs, which
 * modules are lit and how it moves. Kept in localStorage under these keys, so the workbench on
 * the machine page opens on the same colours and LEDs the reader set on the wall, and a choice
 * made there follows them home.
 */
export const THEME_KEY = "imd.wall.theme", MOTION_KEY = "imd.wall.motion", LIT_KEY = "imd.wall.lit";
/** Which face of the status line was last turned up, so a refresh keeps the one being read. */
export const FACE_KEY = "imd.wall.face";
/** The keys the theme replaced: a colour scheme and an LED colour chosen apart. */
const SCHEME_KEY = "imd.wall.scheme", LED_KEY = "imd.wall.led";

/** The remembered value under a key when it is one of the allowed, else the fallback. */
export const remembered = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try { const v = localStorage.getItem(key); return allowed.includes(v as T) ? (v as T) : fallback; } catch { return fallback; }
};
export const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private window */ } };

/**
 * The remembered theme. A reader who chose a colour scheme before the themes keeps its look: the
 * scheme's name is a theme's name, so it carries over, and the two old keys are cleared.
 */
export const rememberedTheme = <T extends string>(allowed: readonly T[], fallback: T): T => {
  const theme = remembered(THEME_KEY, allowed, "" as T);
  if (theme) return theme;
  const scheme = remembered(SCHEME_KEY, allowed, "" as T);
  try { localStorage.removeItem(SCHEME_KEY); localStorage.removeItem(LED_KEY); } catch { /* private window */ }
  if (scheme) { remember(THEME_KEY, scheme); return scheme; }
  return fallback;
};
