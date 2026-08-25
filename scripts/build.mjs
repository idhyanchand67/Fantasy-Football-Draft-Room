/**
 * Injects the player dataset into the template and emits two builds:
 *
 *   index.html         a standalone document — open it locally or serve it from
 *                      GitHub Pages. Carries its own doctype/head/body.
 *   dist/artifact.html the bare fragment for Claude Artifacts, which supplies
 *                      the page skeleton itself at publish time.
 *
 * Both are single files with no runtime dependencies.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");

const template = read("src/template.html");
const players = read("data/players.json");
const schedule = read("data/schedule.json");
const defense = read("data/defense.json");

if (!template.includes("/*PLAYERS_JSON*/"))
  throw new Error("src/template.html is missing the /*PLAYERS_JSON*/ placeholder");
if (!template.includes("/*SCHEDULE_JSON*/"))
  throw new Error("src/template.html is missing the /*SCHEDULE_JSON*/ placeholder");
if (!template.includes("/*DEFENSE_JSON*/"))
  throw new Error("src/template.html is missing the /*DEFENSE_JSON*/ placeholder");

const count = JSON.parse(players).length;
const fragment = template
  .replace("/*PLAYERS_JSON*/", players)
  .replace("/*SCHEDULE_JSON*/", schedule)
  .replace("/*DEFENSE_JSON*/", defense);

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="A live snake-draft board for full-PPR fantasy football.">
<meta name="color-scheme" content="light dark">
${fragment}
</html>
`;

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "index.html"), standalone);
fs.writeFileSync(path.join(root, "dist/artifact.html"), fragment);

const kb = n => (n / 1024).toFixed(0) + " KB";
console.log(`built ${count} players`);
console.log(`  index.html          ${kb(standalone.length)}  (standalone / GitHub Pages)`);
console.log(`  dist/artifact.html  ${kb(fragment.length)}  (Claude Artifacts fragment)`);
