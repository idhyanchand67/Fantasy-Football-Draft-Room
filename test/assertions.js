
let fails = 0, passes = 0;
const ok = (cond, msg, extra="") => {
  if (cond) { passes++; }
  else { fails++; console.log("  FAIL:", msg, extra); }
};

const w = window;
const W = w.WarRoom;
ok(!!W, "page booted and exposed the engine");
if (!W) process.exit(1);

// ---------------------------------------------------------------- snake math
console.log("\n== snake order ==");
const S = W.state;
S.teams = 12; S.slot = 5;
ok(W.teamOnPick(1) === 1, "pick 1 -> team 1");
ok(W.teamOnPick(12) === 12, "pick 12 -> team 12");
ok(W.teamOnPick(13) === 12, "pick 13 -> team 12 (turn)");
ok(W.teamOnPick(24) === 1, "pick 24 -> team 1");
ok(W.teamOnPick(25) === 1, "pick 25 -> team 1 (turn)");
ok(W.label(13) === "2.01", "pick 13 labels 2.01", W.label(13));
const myPicks = [];
for (let p = 1; p <= W.totalPicks(); p++) if (W.teamOnPick(p) === 5) myPicks.push(p);
ok(myPicks[0] === 5 && myPicks[1] === 20 && myPicks[2] === 29,
   "slot 5 picks 5, 20, 29...", myPicks.slice(0,4).join(","));
ok(myPicks.length === W.rounds(), "one pick per round", `${myPicks.length} vs ${W.rounds()}`);

// -------------------------------------------------------- replacement / VOR
console.log("\n== replacement level & VOR ==");
S.picks = [];
let M = W.model();
const qb1 = M.avail.filter(p => p.p === "QB").sort((a,b) => b.ap - a.ap)[0];
const rb1 = M.avail.filter(p => p.p === "RB").sort((a,b) => b.ap - a.ap)[0];
ok(qb1.proj > rb1.proj, "top QB outscores top RB in raw points", `${qb1.n} ${qb1.proj} vs ${rb1.n} ${rb1.proj}`);
ok(rb1.vor > qb1.vor, "but top RB has higher VOR (1QB scarcity handled)",
   `${rb1.n} +${rb1.vor.toFixed(0)} vs ${qb1.n} +${qb1.vor.toFixed(0)}`);
ok(M.kNeed.QB === 12, "12 QB starters demanded at an empty board", String(M.kNeed.QB));
ok(M.kNeed.RB > 24 && M.kNeed.RB < 35, "RB demand includes flex share", String(M.kNeed.RB));

const replRBbefore = M.repl.RB;
const rbsAll = M.avail.filter(p => p.p === "RB").sort((a,b) => b.ap - a.ap);

// 10 RBs off the board across 10 different teams: supply and demand fall together,
// so the replacement level should hold steady. That stability is the point of VBD.
S.picks = rbsAll.slice(0, 10).map(p => p.id);
M = W.model();
ok(Math.abs(M.repl.RB - replRBbefore) < 0.5,
   "replacement RB holds when a run consumes supply and demand together",
   `${replRBbefore.toFixed(1)} -> ${M.repl.RB.toFixed(1)}`);
ok(M.runs.RB >= 4, "RB run detected in last 8 picks", String(M.runs.RB));

// 34 RBs gone is past what the league needs to start: supply is now the binding
// constraint and the replacement level must fall.
S.picks = rbsAll.slice(0, 34).map(p => p.id);
M = W.model();
ok(M.repl.RB < replRBbefore - 5,
   "replacement RB drops once supply is exhausted past league demand",
   `${replRBbefore.toFixed(1)} -> ${M.repl.RB.toFixed(1)}`);
const bestRBnow = M.byPos.RB[0], bestWRnow = M.byPos.WR[0];
ok(bestWRnow.vor > bestRBnow.vor,
   "after an RB drought the engine pivots value toward WR",
   `WR +${bestWRnow.vor.toFixed(0)} vs RB +${bestRBnow.vor.toFixed(0)}`)

// ------------------------------------------------------------ survival curve
console.log("\n== survival probability ==");
S.picks = [];
S.slot = 1;              // slot 1: picks 1 and 24 -> long wait
M = W.model();
const early = M.avail.find(p => p.adp > 20 && p.adp < 26);
const late  = M.avail.find(p => p.adp > 90 && p.adp < 100);
ok(early.surv < late.surv, "a pick-22 ADP player is likelier to be gone than a pick-95 one",
   `${early.n} ${(early.surv*100).toFixed(0)}% vs ${late.n} ${(late.surv*100).toFixed(0)}%`);
ok(early.surv >= 0 && early.surv <= 1 && late.surv >= 0 && late.surv <= 1, "survival stays in [0,1]");
const top3 = M.avail.filter(p => p.adp <= 3);
ok(top3.every(p => p.surv < 0.25), "top-3 ADP players almost never last to pick 24");

// ------------------------------------------------------------ need weighting
console.log("\n== roster need weighting ==");
S.teams = 12; S.slot = 1; S.picks = [];
// give myself two QBs by drafting them at my picks; fill others with filler
function draftInto(targetSlot, wantPos) {
  // record picks until it's targetSlot's turn, then take the best of wantPos
  const M2 = W.model();
  const cur = M2.cur;
  if (W.teamOnPick(cur) !== targetSlot) return false;
  const pick = M2.avail.filter(p => p.p === wantPos).sort((a,b) => b.ap - a.ap)[0];
  W.draft(pick.id);
  return true;
}
function fillOthers() {
  const M2 = W.model();
  if (W.teamOnPick(M2.cur) === S.slot) return;
  const pick = M2.avail.slice().sort((a,b) => a.adp - b.adp)[0];
  W.draft(pick.id);
}
S.picks = [];
while (W.model().mine.length < 2) {
  if (!draftInto(1, "QB")) fillOthers();
}
M = W.model();
ok(M.mine.filter(p => p.p === "QB").length === 2, "test set up two QBs on my roster");
const bestQBleft = M.avail.filter(p => p.p === "QB").sort((a,b) => b.score - a.score)[0];
const bestOverall = M.avail.slice().sort((a,b) => b.score - a.score)[0];
ok(bestOverall.p !== "QB", "with 2 QBs rostered the engine stops recommending QB", bestOverall.p);
ok(bestQBleft.score < bestOverall.score * 0.4, "third QB is heavily discounted");

// ---------------------------------------------------------- endgame K / DST
console.log("\n== endgame K/DST forcing ==");
S.picks = []; S.teams = 12; S.slot = 1;
// simulate a whole draft by ADP for everyone, engine for me (test/backtest.js)
const engineRun = btSimulate("engine", W, S);
const myRoster = engineRun.mine;
ok(myRoster.filter(p => p.p === "K").length === 1, "engine ended with exactly 1 K",
   String(myRoster.filter(p => p.p === "K").length));
ok(myRoster.filter(p => p.p === "DST").length === 1, "engine ended with exactly 1 DST",
   String(myRoster.filter(p => p.p === "DST").length));
ok(myRoster.filter(p => p.p === "QB").length >= 1, "engine ended with at least 1 QB");
ok(myRoster.filter(p => p.p === "RB").length >= 2, "engine ended with at least 2 RB");
ok(myRoster.filter(p => p.p === "WR").length >= 3, "engine ended with at least 3 WR");
ok(myRoster.filter(p => p.p === "TE").length >= 1, "engine ended with at least 1 TE");
ok(myRoster.length === W.rounds(), "engine filled every roster spot");

// ------------------------------------------------- head to head vs pure ADP
console.log("\n== engine vs best-available-by-ADP, all 12 slots ==");
const bt = btRunAll(W, S, 12, true);
bt.rosters.forEach(({slot, adp}) => {
  ok(adp.filter(p=>p.p==="K").length===1 && adp.filter(p=>p.p==="DST").length===1,
     `baseline at slot ${slot} fielded a legal lineup`);
});
ok(bt.wins >= 9, "engine beats a competent ADP drafter from at least 9 of 12 slots", `won ${bt.wins}/12`);
ok(bt.avg > 15, "average edge is a meaningful number of points", bt.avg.toFixed(1));

// -------------------------------------------------------------- data sanity
console.log("\n== data sanity ==");
const P = W.PLAYERS;
ok(P.length > 250, "player pool is deep enough", String(P.length));
ok(P.every(p => p.n && p.p && p.t && p.proj > 0), "every player has name, pos, team, projection");
ok(P.every(p => p.p === "DST" || (p.bye >= 5 && p.bye <= 14)), "every player has a plausible bye week");
ok(new Set(P.map(p => p.id)).size === P.length, "player ids are unique");
const posCounts = {};
P.forEach(p => posCounts[p.p] = (posCounts[p.p]||0)+1);
console.log("  pool by position:", JSON.stringify(posCounts));
ok(posCounts.RB >= 60 && posCounts.WR >= 90 && posCounts.TE >= 30 && posCounts.QB >= 25,
   "enough depth at every position to survive a 16-round draft");
const tagged = P.filter(p => p.tag);
ok(tagged.length > 50, "news attached to a meaningful share of the pool", String(tagged.length));
ok(tagged.every(p => p.note && p.note.length > 8), "every tagged player carries a readable note");

const SCHED = W.SCHEDULE;
const schedTeams = Object.keys(SCHED);
ok(schedTeams.length === 32, "schedule covers all 32 teams", String(schedTeams.length));
ok(schedTeams.every(t => SCHED[t].length === 18), "every team's schedule has 18 weeks");
ok(schedTeams.every(t => SCHED[t].filter(w => w === "BYE").length === 1), "every team has exactly one bye week in its schedule");
ok(P.every(p => p.p === "DST" || SCHED[p.t]), "every player's team has a schedule entry");

// ------------------------------------------------------------------ render
console.log("\n== render integrity ==");
S.picks = []; S.slot = 5;
W.render();
const doc = w.document;
ok(doc.querySelectorAll("#rows .row").length > 20, "board renders player rows");
ok(doc.querySelector("#rec .nm").textContent.length > 2, "recommendation card names a player",
   doc.querySelector("#rec .nm").textContent);
ok(doc.querySelectorAll("#meters .meter").length === 4, "four supply meters render");
ok(doc.querySelectorAll("#league .tm").length === 12, "league board shows 12 teams");
ok(doc.querySelectorAll("#slots .slot").length === W.rounds(), "roster shows every slot");

// clicking a row now opens the info dialog instead of drafting directly —
// drafting happens from the Draft button inside it (see the session where
// this changed: fast one-click drafting from the search box's Enter key
// was deliberately kept working via a separate path, tested below)
const firstRow = doc.querySelector("#rows .row");
const firstId = firstRow.dataset.id;
firstRow.dispatchEvent(new w.Event("click", { bubbles: true }));
ok(doc.getElementById("info").open, "clicking a row opens the player info dialog");
ok(W.state.picks.length === 0, "clicking a row does not draft directly");
ok(doc.getElementById("infoHead").textContent.includes(W.byId.get(firstId).n),
   "the info dialog shows the clicked player's name");
doc.getElementById("infoDraft").click();
ok(W.state.picks.length === 1 && W.state.picks[0] === firstId,
   "the dialog's Draft button records the pick");
ok(!doc.getElementById("info").open, "the dialog closes after drafting");
W.undo();
ok(W.state.picks.length === 0, "undo removes it");

return { passes, fails };
