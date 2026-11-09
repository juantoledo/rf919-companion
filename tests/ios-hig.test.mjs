// Apple's Human Interface Guidelines, as far as they publish numbers: the Dynamic Type table, the system colours, the 44 pt
// control and the 11 pt minimum, held against docs/css. What Apple doesn't publish (corner radii, bar heights, margins) can only
// be measured on a device; concentric corners are a rule without numbers, so the rule is what's checked.
// https://developer.apple.com/design/human-interface-guidelines/typography, /color, /accessibility, /sheets
import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = read("../docs/css/tokens.css"), app = read("../docs/css/app.css");
const token = (name) => tokens.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim() ?? assert.fail(`no --${name}`);

// style: [size, leading] in pt, iOS at the default size ("Large")
const TYPE = {large: [34, 41], title1: [28, 34], title2: [22, 28], title3: [20, 25], headline: [17, 22], body: [17, 22], callout: [16, 21],
  sub: [15, 20], small: [13, 18], caption: [12, 16], caption2: [11, 13]};
// the bars keep their size whatever the text setting: the same styles, in px
const BARS = {"bar-title": "headline", "bar-label": "sub", "bar-small": "caption", "bar-tab": "caption2"};
const rem = (v) => { const m = v.match(/^calc\(([\d.]+)rem \* var\(--type-scale\)\)$/); assert.ok(m, `not scaled rem: ${v}`); return +m[1] * 16; };

test("type tokens are Apple's Dynamic Type table", () => {
  for (const [n, [size, lead]] of Object.entries(TYPE)) assert.deepEqual([rem(token(`fs-${n}`)), rem(token(`lh-${n}`))], [size, lead], n);
  for (const [n, style] of Object.entries(BARS)) assert.deepEqual([parseFloat(token(`fs-${n}`)), parseFloat(token(`lh-${n}`))], TYPE[style], n);
  assert.ok(Math.min(...Object.values(TYPE).map(([s]) => s)) >= 11, "Apple's minimum is 11 pt");
  assert.match(tokens, /@supports \(font: -apple-system-body\)/, "Larger Text");
});

const rules = [...app.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].replace(/\s+/g, " ").trim(), m[2]]);
const STYLES = [...Object.keys(TYPE), ...Object.keys(BARS)].join("|");
// What may leave the table: the frequency's digits (the brand), the diagnostics in monospace, and the invisible select over the
// band chip (16 px stops iOS zooming the page when it's focused)
const exempt = (sel, value) => /--font-(freq|mono)|^inherit$/.test(value) || /\.rb-freq|\.band-pick select/.test(sel) || /^0$/.test(value) || /clamp\(/.test(value);

test("every font uses a style's size and leading, and only Apple's weights", () => {
  const bad = [];
  for (const [sel, body] of rules) {
    for (const [, v] of body.matchAll(/(?<![-\w])font:\s*([^;}]+)/g)) {
      const value = v.trim();
      if (exempt(sel, value)) continue;
      const m = value.match(new RegExp(`^(400|600|700) var\\(--fs-(${STYLES})\\)/var\\(--lh-(${STYLES})\\) var\\(--font-ui\\)$`));
      if (!m || m[2] !== m[3]) bad.push(`${sel}: font: ${value}`);
    }
    for (const [, v] of body.matchAll(/(?<![-\w])font-size:\s*([^;}]+)/g)) if (!exempt(sel, v.trim()) && !new RegExp(`^var\\(--fs-(${STYLES})\\)$`).test(v.trim())) bad.push(`${sel}: font-size: ${v.trim()}`);
    for (const [, v] of body.matchAll(/(?<![-\w])line-height:\s*([^;}]+)/g)) if (!/\.freq/.test(sel) && !new RegExp(`^var\\(--lh-(${STYLES})\\)$`).test(v.trim())) bad.push(`${sel}: line-height: ${v.trim()}`);
    for (const [, v] of body.matchAll(/font-weight:\s*([^;}]+)/g)) if (!["400", "600", "700"].includes(v.trim())) bad.push(`${sel}: font-weight: ${v.trim()}`);
  }
  assert.deepEqual(bad, []);
});

const hex = (s) => "#" + s.split(",").map((n) => (+n).toString(16).padStart(2, "0")).join("");
const pair = (name) => {
  const m = token(name).match(/^light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/i);
  assert.ok(m, `--${name} isn't a pair of hex colours`);
  return [m[1].toLowerCase(), m[2].toLowerCase()];
};
// [light, dark]: Apple's values; null where a custom colour stands in, for the reason given
const COLOURS = {
  bg: ["242,242,247", null],             // dark: systemBackground, black (Apple gives semantic colours no values)
  surface: [null, "28,28,30"],           // light: white, likewise
  faint: ["174,174,178", "99,99,102"],   // systemGray2
  "lamp-off": ["199,199,204", "72,72,74"],     // systemGray3
  "switch-off": ["229,229,234", "44,44,46"],   // systemGray5
  "switch-on": ["52,199,89", "48,209,88"],     // green
  dim: [null, "174,174,178"],            // light: systemGray fails 4.5:1 on the fills
  accent: [null, "0,145,255"],           // light: system blue fails 4.5:1 as text
  cool: [null, "0,210,224"],             // light: teal, likewise
  warn: [null, "255,66,69"],             // light: red, likewise
  "prop-fair": [null, "255,214,0"],      // light: yellow, likewise
  "danger-fill": ["233,21,45", "233,21,45"],   // red, Increased Contrast: white on it reaches 4.5:1
};
test("colours are Apple's published values, or on the list with a reason", () => {
  for (const [name, [light, dark]] of Object.entries(COLOURS)) {
    const [l, d] = pair(name);
    if (light) assert.equal(l, hex(light), `--${name} light`);
    if (dark) assert.equal(d, hex(dark), `--${name} dark`);
  }
});
test("band colours come from the system palette", () => {
  const SYSTEM = ["255,66,69", "255,146,48", "255,214,0", "48,209,88", "0,218,195", "0,210,224", "60,211,254", "0,145,255", "109,124,255", "219,52,242", "255,55,95", "183,138,102"].map(hex);
  const src = fs.readFileSync(new URL("../docs/js/ui/shell.js", import.meta.url), "utf8");
  const block = src.match(/BAND_COLORS = \{([\s\S]*?)\}/)[1];
  const used = [...block.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0].toLowerCase());
  assert.ok(used.length >= 10);
  for (const c of used) assert.ok(SYSTEM.includes(c), `${c} isn't a system colour`);
});

test("controls are 44 pt, with about 12 pt between them", () => {
  assert.equal(token("hit"), "44px");
  assert.deepEqual([...tokens.matchAll(/--hit:\s*([^;]+);/g)].map((m) => m[1]), ["44px"], "one value, no override for touch");
  assert.equal(token("control-gap"), "var(--s3)");
  assert.match(tokens, /--s3:\s*12px/);
});
test("the medium detent is half of the large one", () => {
  assert.equal(parseFloat(token("detent-medium")) * 2, parseFloat(token("detent-large")));
  const g = fs.readFileSync(new URL("../docs/js/ui/gestures.js", import.meta.url), "utf8");
  assert.match(g, new RegExp(`LARGE = \\.${String(parseFloat(token("detent-large")))}, MEDIUM = \\.${String(parseFloat(token("detent-medium")))}`));
});

test("corners are concentric: an inner radius is the outer one less the gap", () => {
  assert.equal(token("r-in-card"), "calc(var(--r3) - var(--panel-pad))");
  assert.equal(token("r-in-sheet"), "calc(var(--r4) - var(--s4))");
  const radius = (sel) => rules.find(([s, b]) => s.split(/, (?![^(]*\))/).includes(sel) && /border-radius/.test(b))?.[1].match(/border-radius:\s*([^;}]+)/)[1].trim();
  assert.equal(radius(".menu-list"), "var(--r-in-sheet)");
  assert.equal(radius(".radiobar"), "var(--round)");
  assert.equal(radius(".radiobar .rb-open"), "var(--round)");
  assert.equal(radius(".panel :is(select, input[type=text], textarea)"), "var(--r-in-card)");
});
