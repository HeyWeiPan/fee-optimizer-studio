/**
 * Design tokens for Fee Optimizer Studio.
 *
 * Locked palette + type scale. Components MUST import from this module instead
 * of writing color/font literals — this is the single anchor for the dark
 * terminal aesthetic (deep slate canvas, single amber accent, mono numerics).
 *
 * If you find yourself reaching for a hex code in a JSX/CSS file, add a token here first.
 */

export const palette = {
  // Surface — deep slate, near-black canvas
  bg: "#0E1116",
  surface: "#161B22",
  border: "#262C36",
  borderStrong: "#3A434F",

  // Text
  ink: "#E6EDF3",
  inkMuted: "#8B949E",
  inkSubtle: "#6E7681",

  // Brand — single amber accent
  accent: "#D9A441",
  accentHover: "#E5B055",
  accentSoft: "#332710",
  accentInk: "#0E1116",

  // Semantic — cool palette: cyan-teal / amber / magenta-pink
  success: "#2DBFB0",
  successSoft: "#0F2421",
  warning: "#D9A441",
  warningSoft: "#332710",
  danger: "#E5337E",
  dangerSoft: "#2A0F1B",

  // Chart series — cool gray scale anchored by amber + cyan + magenta
  chart: [
    "#D9A441",
    "#2DBFB0",
    "#E5337E",
    "#A8B0BB",
    "#8B949E",
    "#6E7681",
    "#5C6470",
    "#3A434F",
  ],
} as const;

export const radius = {
  none: "0",
  sm: "4px",
  md: "8px",
  lg: "14px",
  xl: "20px",
  pill: "9999px",
} as const;

export const space = {
  px: "1px",
  0.5: "2px",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  16: "64px",
} as const;

export const font = {
  // Display + body: humanist sans, weights doing the work
  display: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  body: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  // Mono: data tables, addresses, BPS counters, claim amounts
  mono: '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace',
} as const;

export const text = {
  display: { fontFamily: font.display, fontWeight: 600, letterSpacing: "-0.02em" },
  h1: { fontFamily: font.display, fontWeight: 700, fontSize: "32px", lineHeight: "1.1", letterSpacing: "-0.025em" },
  h2: { fontFamily: font.display, fontWeight: 600, fontSize: "22px", lineHeight: "1.2", letterSpacing: "-0.015em" },
  h3: { fontFamily: font.body, fontWeight: 600, fontSize: "15px", lineHeight: "1.4" },
  body: { fontFamily: font.body, fontWeight: 400, fontSize: "14px", lineHeight: "1.5" },
  small: { fontFamily: font.body, fontWeight: 400, fontSize: "12px", lineHeight: "1.4" },
  mono: { fontFamily: font.mono, fontVariantNumeric: "tabular-nums" },
} as const;

export const shadow = {
  sm: "0 1px 0 rgba(0, 0, 0, 0.3)",
  md: "0 4px 12px rgba(0, 0, 0, 0.4)",
  lg: "0 12px 32px rgba(0, 0, 0, 0.5)",
} as const;

export type Palette = typeof palette;
