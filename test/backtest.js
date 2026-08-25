/**
 * Shared backtest harness: the engine drafts against a competent ADP-based
 * bot from every draft slot, and each side's projected starter total is
 * compared. Used by test/assertions.js (correctness gate) and
 * scripts/tune.mjs (grades candidate scoring constants against the same
 * measure). Kept out of src/template.html deliberately — this is test-only
 * opponent-simulation code, not part of the shipped page.
 */

const BT_CAP = {QB:2, TE:2, K:1, DST:1, RB:6, WR:7};

// A competent ADP drafter: best available by ADP, but it respects roster caps
// and makes sure it walks away with a legal starting lineup. The honest baseline.
function btAdpBot(M, team, W, S) {
  const roster = M.teamRosters[team] || [];
  const cnt = {}; roster.forEach(p => cnt[p.p] = (cnt[p.p] || 0) + 1);
  const left = W.rounds() - roster.length;
  const missing = [];
  for (const pos of ["QB","RB","WR","TE","DST","K"]) {
    const need = Math.max(0, S.starters[pos] - (cnt[pos] || 0));
    for (let i = 0; i < need; i++) missing.push(pos);
  }
  if (left <= missing.length && missing.length) {
    const urgent = missing.includes("K") || missing.includes("DST")
      ? missing.filter(p => p === "K" || p === "DST")
      : missing;
    const pool = M.avail.filter(p => urgent.includes(p.p)).sort((a,b) => a.adp - b.adp);
    if (pool.length) return pool[0];
  }
  const pool = M.avail.slice().sort((a,b) => a.adp - b.adp)
    .filter(p => (cnt[p.p] || 0) < BT_CAP[p.p])
    .filter(p => !((p.p === "K" || p.p === "DST") && left > missing.length + 1));
  return pool[0] || M.avail.slice().sort((a,b) => a.adp - b.adp)[0];
}

function btSimulate(meStrategy, W, S) {
  S.picks = [];
  const total = W.totalPicks();
  for (let i = 1; i <= total; i++) {
    const M2 = W.model();
    const team = W.teamOnPick(M2.cur);
    const mine = team === S.slot;
    const pick = (mine && meStrategy === "engine")
      ? M2.avail.slice().sort((a,b) => b.score - a.score)[0]
      : btAdpBot(M2, team, W, S);
    S.picks.push(pick.id);
  }
  return W.model();
}

function btStarterPoints(roster, S) {
  const pool = roster.slice().sort((a,b) => b.proj - a.proj);
  const used = new Set();
  const take = pos => { const p = pool.find(x => x.p === pos && !used.has(x.id)); if (p) used.add(p.id); return p; };
  let tot = 0;
  const st = S.starters;
  for (const pos of ["QB","RB","WR","TE"]) for (let i=0;i<st[pos];i++){ const p=take(pos); if(p) tot+=p.proj; }
  for (let i=0;i<st.FLEX;i++){
    const p = pool.filter(x => ["RB","WR","TE"].includes(x.p) && !used.has(x.id))[0];
    if (p){ used.add(p.id); tot += p.proj; }
  }
  for (const pos of ["DST","K"]) for (let i=0;i<st[pos];i++){ const p=take(pos); if(p) tot+=p.proj; }
  return tot;
}

// Runs engine vs. ADP-bot from every slot in a `teams`-team league and
// returns the summary the engine is graded on: average starter-point edge,
// how many slots it wins, and the per-slot rosters (for legality checks).
function btRunAll(W, S, teams, verbose) {
  teams = teams || 12;
  S.teams = teams;
  const deltas = [], rosters = [];
  let wins = 0;
  for (let slot = 1; slot <= teams; slot++) {
    S.slot = slot;
    const eng = btSimulate("engine", W, S).mine;
    const adp = btSimulate("adp", W, S).mine;
    const engPts = btStarterPoints(eng, S);
    const adpPts = btStarterPoints(adp, S);
    deltas.push(engPts - adpPts);
    rosters.push({slot, eng, adp});
    if (engPts > adpPts) wins++;
    if (verbose) console.log(`  slot ${String(slot).padStart(2)}: engine ${engPts.toFixed(0)}  vs  ADP ${adpPts.toFixed(0)}   ${(engPts-adpPts>=0?"+":"")}${(engPts-adpPts).toFixed(0)}`);
  }
  const avg = deltas.reduce((a,b)=>a+b,0) / deltas.length;
  if (verbose) console.log(`  average edge: ${avg >= 0 ? "+" : ""}${avg.toFixed(1)} projected starter points`);
  return { avg, wins, deltas, rosters };
}
