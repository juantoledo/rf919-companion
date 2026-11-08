// WCAG AA contrast for every text/background pairing of the design tokens, in both themes.
// The tokens are light-dark(light, dark) pairs in docs/css/tokens.css; translucent ones are laid over what they sit on.
import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../docs/css/tokens.css", import.meta.url), "utf8");

// --name: light-dark(a, b);  (a and b may hold commas inside rgba(...))
function tokens(theme) {
  const out = {};
  for (const m of css.matchAll(/--([\w-]+):\s*light-dark\((.*?)\);/g)) {
    let depth = 0, cut = -1;
    for (let i = 0; i < m[2].length; i++) {
      const c = m[2][i];
      if (c === "(") depth++; else if (c === ")") depth--;
      else if (c === "," && !depth) { cut = i; break; }
    }
    out[m[1]] = (theme === "light" ? m[2].slice(0, cut) : m[2].slice(cut + 1)).trim();
  }
  return out;
}
function parse(c) {
  let m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  m = c.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(",").map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
  throw new Error(`can't read colour ${c}`);
}
const over = ([r, g, b, a], [R, G, B]) => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a), 1];
const lum = (rgb) => {
  const [r, g, b] = rgb.slice(0, 3).map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };

// [text, background, what the background sits on]
const SURFACES = ["bg", "surface", "surface-2", "surface-3"];
const PAIRS = [
  ...["text", "dim"].flatMap((t) => SURFACES.map((s) => [t, s, "bg"])),
  ...["accent", "cool", "warn", "prop-fair"].flatMap((t) => ["bg", "surface", "surface-2"].map((s) => [t, s, "bg"])),
  ["dim", "glass", "bg"], ["text", "glass", "bg"],          // the floating bars, over the page
  ["text", "glass-strong", "bg"], ["dim", "glass-strong", "bg"], ["accent", "glass", "bg"],  // the snackbar, the selected tab
  ["accent", "accent-soft", "surface"],                       // chips, tonal buttons, the tab pill
  ["cool", "cool-soft", "surface"],
  ["warn", "warn-soft", "surface"], ["on-warn-soft", "warn-soft", "surface"],
  ["on-accent", "accent", "surface"],                         // filled buttons
  ["on-inverse", "inverse", "bg"],                          // the snackbar
  ["freq-ink", "surface", "bg"],
];

for (const theme of ["light", "dark"]) {
  test(`${theme} theme: text tokens reach 4.5:1 on what they sit on`, () => {
    const t = tokens(theme), col = (n) => parse(t[n] ?? assert.fail(`no --${n}`));
    const fails = [];
    for (const [fg, bg, base] of PAIRS) {
      const back = over(col(bg), over(col(base), [255, 255, 255]));
      const r = ratio(over(col(fg), back), back);
      if (r < 4.5) fails.push(`--${fg} on --${bg}: ${r.toFixed(2)}`);
    }
    assert.deepEqual(fails, []);
  });
}
