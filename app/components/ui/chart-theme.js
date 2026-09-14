import { fmtINR, fmtINRcompact } from "../overview/aggregations";

// Chart.js draws to canvas, so it cannot read CSS variables; these mirror the
// tokens in globals.css for each theme.
const PALETTES = {
  light: { accent: "#0E6B5E", accentFill: "rgba(14,107,94,0.12)", ink: "#3C4850", muted: "#66727A", grid: "#E7ECEE", prior: "#A5B0B6", surface: "#FFFFFF" },
  dark: { accent: "#3FB8A4", accentFill: "rgba(63,184,164,0.16)", ink: "#B3C0C5", muted: "#85949A", grid: "#212C31", prior: "#5B6A70", surface: "#141B1E" },
};

export function chartPalette(theme) {
  return PALETTES[theme === "dark" ? "dark" : "light"];
}

const FONT = "'IBM Plex Mono', ui-monospace, monospace";

export function tooltip(p, label = (ctx) => fmtINR(ctx.parsed.y ?? ctx.parsed)) {
  return {
    backgroundColor: p === PALETTES.dark ? "#E8EEF0" : "#121A1F",
    titleColor: p === PALETTES.dark ? "#121A1F" : "#FFFFFF",
    bodyColor: p === PALETTES.dark ? "#121A1F" : "#FFFFFF",
    padding: 10,
    cornerRadius: 8,
    displayColors: false,
    titleFont: { family: FONT, size: 11 },
    bodyFont: { family: FONT, size: 12 },
    callbacks: { label },
  };
}

export function axes(p, { yCompact = true, xTicks = {} } = {}) {
  return {
    x: {
      grid: { display: false },
      border: { display: false },
      ticks: { color: p.muted, font: { family: FONT, size: 10 }, maxRotation: 0, autoSkipPadding: 20, ...xTicks },
    },
    y: {
      grid: { color: p.grid, drawTicks: false },
      border: { display: false },
      ticks: { color: p.muted, font: { family: FONT, size: 10 }, padding: 8, maxTicksLimit: 4, callback: (v) => (yCompact ? fmtINRcompact(v) : v) },
    },
  };
}
