/**
 * Rewrites the hard-coded colours in app/legacy.css to design tokens.
 *
 * The legacy stylesheet carried 437 literal hex values across 380 distinct
 * shades — which is why the screens read as washed out and why dark mode was
 * impossible. This maps each literal onto the nearest token from
 * app/design-tokens.css (CIE76 in Lab, separate thresholds for neutral and
 * chromatic colours) and leaves anything too far away untouched, so nothing is
 * silently recoloured.
 *
 *   node scripts/tokenize-legacy-colors.mjs           # report only
 *   node scripts/tokenize-legacy-colors.mjs --write   # apply
 */
import fs from "node:fs";

const TOKENS_FILE = "app/design-tokens.css";
const TARGET_FILE = "app/legacy.css";

/* Tokens a screen is allowed to reference. Ramp steps are resolved to their
   literal value; semantic aliases are what we actually write into the CSS. */
const SEMANTIC = {
  "--surface": "--ink-0",
  "--surface-2": "--ink-100",
  "--surface-3": "--ink-200",
  "--line": "--ink-200",
  "--line-strong": "--ink-300",
  "--text": "--ink-900",
  "--text-2": "--ink-700",
  "--text-3": "--ink-500",
  "--rail": "--ink-950",
  "--brand": "--brand-500",
  "--brand-soft": "--brand-50",
  "--brand-ink": "--brand-700",
};

const NEUTRAL_MAX_DELTA = 26;   /* greys drift more before anyone notices */
const CHROMA_MAX_DELTA = 18;

function hexToRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function rgbToLab([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [f(r), f(g), f(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const k = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [k(x), k(y), k(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const chroma = (lab) => Math.hypot(lab[1], lab[2]);
const isMuted = (lab) => chroma(lab) < 14;

/* ---- read the token values out of the stylesheet -------------------------- */
const tokensCss = fs.readFileSync(TOKENS_FILE, "utf8");
const rootBlock = tokensCss.slice(tokensCss.indexOf(":root{"), tokensCss.indexOf("@media"));
const literals = new Map();
const aliases = new Map();
for (const [, name, value] of rootBlock.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
  const raw = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3,8}$/.test(raw)) literals.set(name, raw);
  else {
    const ref = raw.match(/^var\(\s*(--[\w-]+)\s*\)$/);
    if (ref) aliases.set(name, ref[1]);
  }
}
/* follow alias chains to their literal value */
for (const [name, target] of aliases) {
  let cursor = target;
  for (let hop = 0; hop < 6 && !literals.has(cursor); hop++) cursor = aliases.get(cursor) ?? cursor;
  if (literals.has(cursor)) literals.set(name, literals.get(cursor));
}

/* candidate list: semantic name -> literal colour */
const candidates = [];
for (const [alias, ramp] of Object.entries(SEMANTIC)) {
  const value = literals.get(ramp);
  if (value) candidates.push({ name: alias, hex: value, lab: rgbToLab(hexToRgb(value)) });
}
for (const [name, value] of literals) {
  if (/^--(brand|ink|warn|danger|info|good)-\d+$/.test(name) || /^--(rail|text|line|surface|brand)/.test(name)) {
    candidates.push({ name, hex: value, lab: rgbToLab(hexToRgb(value)) });
  }
}

/* ---- rewrite -------------------------------------------------------------- */
const css = fs.readFileSync(TARGET_FILE, "utf8");
const report = new Map();
let replaced = 0;
let skipped = 0;

/* Which tokens a declaration is allowed to use. Nearest-colour alone is not
   enough: a pale border that maps to a *surface* token stays invisible, and an
   8-digit shadow colour must never become an opaque one. */
const GROUPS = {
  line: ["--line", "--line-strong", "--ink-200", "--ink-300", "--ink-400", "--ink-800", "--rail-line",
         "--brand-200", "--brand-300", "--brand-400", "--brand", "--brand-500", "--brand-600",
         "--warn-100", "--warn-500", "--danger-100", "--danger-500", "--info-100", "--info-500",
         "--good-100", "--good-500"],
  surface: ["--surface", "--surface-2", "--surface-3", "--ink-0", "--ink-50", "--ink-100", "--ink-200",
            "--brand-soft", "--brand-50", "--brand-100", "--warn-50", "--warn-100", "--danger-50",
            "--danger-100", "--info-50", "--info-100", "--good-50", "--good-100", "--rail", "--ink-950",
            "--rail-2", "--rail-active", "--brand", "--brand-500", "--brand-600", "--brand-700",
            "--warn-500", "--danger-500", "--info-500", "--good-500"],
  text: ["--text", "--text-2", "--text-3", "--brand", "--brand-ink", "--brand-500", "--brand-600",
         "--brand-700", "--ink-700", "--ink-800", "--ink-900", "--warn-500", "--warn-700",
         "--danger-500", "--danger-700", "--info-500", "--info-700", "--good-500", "--good-700",
         "--ink-400", "--ink-500", "--ink-600", "--rail-text", "--rail-text-2", "--rail-accent",
         "--brand-100", "--brand-200", "--brand-300"],
};

function declarationFor(source, index) {
  const before = source.slice(Math.max(0, index - 120), index);
  const match = before.match(/(?:^|[;{])\s*([-a-zA-Z]+)\s*:[^;{]*$/);
  return match ? match[1].toLowerCase() : "";
}

function groupFor(property) {
  if (/^(border|outline|column-rule)/.test(property)) return "line";
  if (/^(background|fill)/.test(property)) return "surface";
  if (/^(color|stroke|-webkit-text-fill-color|caret-color)/.test(property)) return "text";
  return "";               /* box-shadow, gradients, anything ambiguous */
}

const out = css.replace(/#[0-9a-fA-F]{3,8}\b/g, (hex, index) => {
  /* colours carrying alpha (#rgba / #rrggbbaa) stay literal: dropping the alpha
     would turn a soft shadow into a solid slab */
  const digits = hex.length - 1;
  if (digits === 4 || digits === 8) { skipped++; return hex; }

  const property = declarationFor(css, index);
  const group = groupFor(property);
  if (!group) { skipped++; return hex; }

  const lab = rgbToLab(hexToRgb(hex));
  if (lab[0] > 95 && group === "text") { skipped++; return hex; }  /* white on a coloured fill */

  const allowed = new Set(GROUPS[group]);
  const limit = isMuted(lab) ? NEUTRAL_MAX_DELTA : CHROMA_MAX_DELTA;
  let best = null;
  for (const candidate of candidates) {
    if (!allowed.has(candidate.name)) continue;
    /* keep near-greys with near-greys and saturated with saturated, but do not
       split two shades that differ by a couple of chroma points */
    if (isMuted(candidate.lab) !== isMuted(lab)) continue;
    const d = deltaE(lab, candidate.lab);
    if (!best || d < best.d) best = { ...candidate, d };
  }
  if (!best || best.d > limit) {
    skipped++;
    report.set(`${property}:${hex.toLowerCase()}`, (report.get(`${property}:${hex.toLowerCase()}`) || 0) + 1);
    return hex;
  }
  replaced++;
  return `var(${best.name})`;
});

/* Shadows were written as 1–3% alpha hexes, which read as no shadow at all on
   a tinted canvas. Map each one onto the elevation token its blur implies. */
let shadows = 0;
const withShadows = out.replace(/box-shadow:\s*([^;}]+)/g, (decl, value) => {
  if (/inset|var\(--elev/.test(value)) return decl;
  /* offsets may be written unitless ("0 2px 4px"), so match those too */
  const lengths = value.match(/-?[\d.]+(?:px)?(?=\s|$)/g) || [];
  const blur = Number((lengths[2] ?? "").replace("px", ""));
  if (!Number.isFinite(blur)) return decl;
  const token = blur <= 6 ? "--elev-1" : blur <= 20 ? "--elev-2" : blur <= 44 ? "--elev-3" : "--elev-4";
  shadows++;
  return `box-shadow:var(${token})`;
});
console.log(`rewrote ${shadows} shadows onto elevation tokens`);

console.log(`replaced ${replaced} literals, left ${skipped} untouched`);
if (report.size) {
  console.log("unmapped (no token within tolerance):");
  [...report.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
    .forEach(([hex, count]) => console.log(`  ${hex} ×${count}`));
}

if (process.argv.includes("--write")) {
  fs.writeFileSync(TARGET_FILE, withShadows);
  console.log(`wrote ${TARGET_FILE}`);
} else {
  console.log("dry run — pass --write to apply");
}
