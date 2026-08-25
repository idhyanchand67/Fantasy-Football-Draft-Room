/**
 * Boots the built page in real Chromium and runs the assertion suite inside it,
 * so what gets tested is exactly what ships. Also writes screenshots to docs/.
 *
 *   npm test
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const built = path.join(root, "index.html");

if (!fs.existsSync(built)) {
  console.error("index.html not found — run `npm run build` first.");
  process.exit(1);
}

const assertions = fs.readFileSync(path.join(root, "test/assertions.js"), "utf8");
const shots = process.argv.includes("--screenshots");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", m => console.log(m.text()));
page.on("pageerror", e => console.log("PAGE ERROR:", e.message));

await page.goto("file://" + built, { waitUntil: "domcontentloaded" });

if (!(await page.evaluate(() => typeof window.WarRoom !== "undefined"))) {
  console.error("the draft engine never booted");
  await browser.close();
  process.exit(1);
}

const result = await page.evaluate(`(function(){ ${assertions} })()`);
console.log(`\n${result.passes} passed, ${result.fails} failed`);

if (shots) {
  const dir = path.join(root, "docs");
  fs.mkdirSync(dir, { recursive: true });
  const mid = () => page.evaluate(() => {
    const W = window.WarRoom;
    W.state.picks = []; W.state.slot = 5;
    for (let i = 0; i < 31; i++) {
      const M = W.model();
      W.state.picks.push(M.avail.slice().sort((a, b) => a.adp - b.adp)[0].id);
    }
    W.render();
  });
  await mid();
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({ path: path.join(dir, "screenshot-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: path.join(dir, "screenshot-dark.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(dir, "screenshot-mobile.png") });
  console.log("screenshots written to docs/");
}

await browser.close();
process.exit(result.fails ? 1 : 0);
