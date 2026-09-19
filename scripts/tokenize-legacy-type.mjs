/**
 * Moves the legacy stylesheet off fixed px type onto the fluid scale.
 *
 * app/legacy.css declared 260 font sizes in px, which is why the screens never
 * really adapted between a phone and a desk. Each size is mapped to the nearest
 * --text-* token (the scale's desktop anchor), radii to --r-*, and line heights
 * to --leading-*. Anything outside tolerance is left alone and reported.
 *
 *   node scripts/tokenize-legacy-type.mjs           # report only
 *   node scripts/tokenize-legacy-type.mjs --write   # apply
 */
import fs from "node:fs";

const TARGET = "app/legacy.css";

/* token -> the size it settles on at desktop width */
const TYPE = [
  ["--text-2xs", 12],
  ["--text-xs", 13],
  ["--text-sm", 14],
  ["--text-base", 15.5],
  ["--text-md", 17],
  ["--text-lg", 20],
  ["--text-xl", 25],
  ["--text-2xl", 33],
  ["--text-3xl", 44],
  ["--text-4xl", 58],
];
const TYPE_TOLERANCE = 3;      /* px */

const RADIUS = [
  ["--r-xs", 6],
  ["--r-sm", 9],
  ["--r-md", 12],
  ["--r-lg", 16],
  ["--r-xl", 22],
];
const RADIUS_TOLERANCE = 3;

const LEADING = [
  ["--leading-tight", 1.32],
  ["--leading-snug", 1.5],
  ["--leading-normal", 1.75],
  ["--leading-loose", 1.95],
];
const LEADING_TOLERANCE = 0.13;

function nearest(table, value, tolerance) {
  let best = null;
  for (const [name, anchor] of table) {
    const d = Math.abs(anchor - value);
    if (!best || d < best.d) best = { name, d };
  }
  return best && best.d <= tolerance ? best.name : null;
}

let css = fs.readFileSync(TARGET, "utf8");
const skipped = { font: [], radius: [], leading: [] };
let fonts = 0, radii = 0, leadings = 0;

css = css.replace(/font-size:\s*(\d+(?:\.\d+)?)px/g, (decl, px) => {
  const token = nearest(TYPE, Number(px), TYPE_TOLERANCE);
  if (!token) { skipped.font.push(px); return decl; }
  fonts++;
  return `font-size:var(${token})`;
});

/* only the plain radius shorthands — anything with slashes or multiple values
   stays as written, since the token scale cannot express those */
css = css.replace(/border-radius:\s*(\d+(?:\.\d+)?)px(?=[;}])/g, (decl, px) => {
  const value = Number(px);
  if (value >= 100) { radii++; return "border-radius:var(--r-pill)"; }
  const token = nearest(RADIUS, value, RADIUS_TOLERANCE);
  if (!token) { skipped.radius.push(px); return decl; }
  radii++;
  return `border-radius:var(${token})`;
});

css = css.replace(/line-height:\s*(\d\.\d+)(?=[;}])/g, (decl, value) => {
  const token = nearest(LEADING, Number(value), LEADING_TOLERANCE);
  if (!token) { skipped.leading.push(value); return decl; }
  leadings++;
  return `line-height:var(${token})`;
});

console.log(`font sizes  -> tokens: ${fonts} (left ${skipped.font.length})`);
console.log(`radii       -> tokens: ${radii} (left ${skipped.radius.length})`);
console.log(`line heights-> tokens: ${leadings} (left ${skipped.leading.length})`);
for (const [kind, list] of Object.entries(skipped)) {
  if (list.length) console.log(`  unmapped ${kind}:`, [...new Set(list)].slice(0, 12).join(", "));
}

if (process.argv.includes("--write")) {
  fs.writeFileSync(TARGET, css);
  console.log(`wrote ${TARGET}`);
} else {
  console.log("dry run — pass --write to apply");
}
