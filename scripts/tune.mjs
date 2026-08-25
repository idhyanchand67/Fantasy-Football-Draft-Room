/**
 * Coordinate-ascent search over the recommendation engine's hand-picked
 * scoring constants (src/template.html's TUNE object), graded against the
 * same engine-vs-ADP backtest the test suite runs (test/backtest.js) —
 * 12-team, default lineup, engine drafts against a competent ADP bot from
 * every slot.
 *
 *   npm run build && node scripts/tune.mjs [--apply] [--passes=2]
 *
 * Without --apply this only prints what it found. With --apply it rewrites
 * the defaults in src/template.html — re-run `npm run build && npm test`
 * afterward to confirm the full assertion suite (not just the backtest
 * average) still passes before trusting the result.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const built = path.join(root, "index.html");
const templatePath = path.join(root, "src/template.html");

if (!fs.existsSync(built)) {
  console.error("index.html not found — run `npm run build` first.");
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const passesArg = args.find(a => a.startsWith("--passes="));
const PASSES = passesArg ? parseInt(passesArg.split("=")[1], 10) : 2;

// key: [default, min, max, step]. Left out on purpose: blocked, kdstUrgent,
// kdstWait, byeStackThreshold — these encode logical gates (forcing a legal
// roster, near-total exclusion), not values worth curve-fitting. Touching
// them risks breaking the endgame K/DST assertions in test/assertions.js
// for no real gain in projected points.
const PARAM_SPEC = {
  flexFill:        [0.92, 0.5, 1.0, 0.04],
  qbBackup:        [0.30, 0.05, 0.6, 0.04],
  qbDeep:          [0.05, 0.0, 0.3, 0.03],
  teBackup:        [0.38, 0.05, 0.7, 0.04],
  teDeep:          [0.10, 0.0, 0.3, 0.03],
  depthBase:       [0.62, 0.3, 0.9, 0.04],
  depthDecay:      [0.06, 0.0, 0.2, 0.02],
  depthFloor:      [0.30, 0.1, 0.5, 0.03],
  byeStackPenalty: [0.96, 0.85, 1.0, 0.02],
  urgencyWeight:   [0.60, 0.1, 1.5, 0.1],
};

const backtestSrc = fs.readFileSync(path.join(root, "test/backtest.js"), "utf8");

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", e => console.log("PAGE ERROR:", e.message));
await page.goto("file://" + built, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: backtestSrc });

async function evaluate(params) {
  return page.evaluate((p) => {
    const W = window.WarRoom, S = W.state;
    Object.assign(W.TUNE, p);
    return btRunAll(W, S, 12, false);
  }, params);
}

// Roster legality is a hard constraint, not part of the score: a duplicate
// DST wastes a roster spot no matter how the point total nets out, and the
// backtest's average-edge/win-count proxy doesn't see that on its own — it
// missed exactly this failure mode on the first tuning run (caught by
// test/assertions.js's "endgame K/DST forcing" checks instead).
function legal(res) {
  return res.rosters.every(({ eng }) =>
    eng.filter(p => p.p === "DST").length === 1 &&
    eng.filter(p => p.p === "K").length === 1);
}

const round3 = v => Math.round(v * 1000) / 1000;
const defaults = Object.fromEntries(Object.entries(PARAM_SPEC).map(([k, v]) => [k, v[0]]));

console.log("Evaluating current defaults (12-team, 1QB, default lineup)...");
let t0 = Date.now();
const base = await evaluate(defaults);
console.log(`  baseline: avg +${base.avg.toFixed(1)} pts, wins ${base.wins}/12  (${Date.now() - t0}ms for 24 simulated drafts)`);
if (!legal(base)) throw new Error("defaults produce an illegal roster somewhere — fix PARAM_SPEC before tuning");

let best = { ...defaults };
let bestResult = base;

for (let pass = 1; pass <= PASSES; pass++) {
  console.log(`\nPass ${pass}/${PASSES}`);
  for (const key of Object.keys(PARAM_SPEC)) {
    const [, min, max, step] = PARAM_SPEC[key];
    const candidates = [best[key] - step, best[key] + step]
      .map(v => round3(Math.min(max, Math.max(min, v))))
      .filter(v => v !== best[key]);
    for (const v of candidates) {
      const trial = { ...best, [key]: v };
      const res = await evaluate(trial);
      // require the win count not to regress by more than one slot, so a
      // single lucky slot can't drag the average up while making the
      // recommendation worse almost everywhere else
      const better = res.avg > bestResult.avg && res.wins >= bestResult.wins - 1 && legal(res);
      if (better) {
        console.log(`  ${key}: ${best[key]} -> ${v}   avg +${res.avg.toFixed(1)} (was +${bestResult.avg.toFixed(1)}), wins ${res.wins}/12`);
        best = trial; bestResult = res;
      }
    }
  }
}

console.log(`\nFinal: avg +${bestResult.avg.toFixed(1)} pts (baseline +${base.avg.toFixed(1)}), wins ${bestResult.wins}/12`);
console.log("\nTuned constants:");
for (const key of Object.keys(PARAM_SPEC)) {
  const changed = best[key] !== defaults[key];
  console.log(`  ${key.padEnd(16)} ${defaults[key]}${changed ? ` -> ${best[key]}` : ""}`);
}

await browser.close();

if (apply) {
  let src = fs.readFileSync(templatePath, "utf8");
  for (const key of Object.keys(PARAM_SPEC)) {
    const re = new RegExp(`(${key}\\s*:\\s*)[0-9.]+`);
    if (!re.test(src)) throw new Error(`could not find TUNE.${key} in src/template.html to update`);
    src = src.replace(re, `$1${best[key]}`);
  }
  fs.writeFileSync(templatePath, src);
  console.log("\nApplied to src/template.html — run `npm run build && npm test` to verify.");
} else {
  console.log("\nRe-run with --apply to write these into src/template.html.");
}
