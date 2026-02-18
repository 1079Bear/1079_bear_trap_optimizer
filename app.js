/* ============================================================
   #1079 LoL App – Kingshot Bear Optimizer
   PART 2 — New app.js (no Plotly, new score engine + UI wiring)
   ============================================================ */

/* ------------------- Constants / Game Assumptions ------------------- */
// Bear window count (Y)
const WINDOWS = 5;
// Bear unit & modifiers (fixed per your spec)
const BEAR_TROOPS = 5000;       // Bear has 5,000 infantry_bear
const BEAR_DEF   = 10;          // Bear defense
const BEAR_HP    = 83.3333;     // Bear health
const BEAR_DEF_PER_TROOP = (BEAR_HP * BEAR_DEF) / 100; // 8.33333...
const BEAR_ATK_BONUS = 0.25;    // Bear Level 5 = +25% attack
const BASE_LETHALITY = 10;      // Base lethality in your formula
// Archer vs infantry skillmod (+10%)
const SKILLMOD_INF = 1.00;
const SKILLMOD_CAV = 1.00;
const SKILLMOD_ARC = 1.10;

// Recommended fill threshold like the legacy app (92.3%)
const FILL_THRESHOLD = 0.923;

/* ------------------- Tier data (loaded from tiers.json) ------------------- */
let TIERS = null; // will be loaded on init

/* ------------------- Utilities ------------------- */
const $ = (id) => document.getElementById(id);
const nval = (id) => {
  const el = $(id);
  if (!el) return 0;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : 0;
};

function parseTriplet(str) {
  if (!str || typeof str !== "string") return null;
  const arr = str.replace(/%/g, "").trim().split(/[/,\s]+/).map(s => s.trim()).filter(Boolean);
  if (arr.length === 0) return null;
  const nums = arr.map(Number);
  if (nums.some(x => !Number.isFinite(x) || x < 0)) return null;
  let i = nums[0] ?? 0;
  let c = nums[1] ?? 0;
  let a = nums.length >= 3 ? nums[2] : Math.max(0, 100 - (i + c));
  const sum = i + c + a;
  if (sum <= 0) return null;
  return { i: i / sum, c: c / sum, a: a / sum };
}

function toPctTriplet({ i, c, a }) {
  const sum = (i + c + a) || 1;
  const pi = Math.round((i / sum) * 100);
  const pc = Math.round((c / sum) * 100);
  const pa = 100 - pi - pc;
  return `${pi}/${pc}/${pa}`;
}

function cloneStock(s) {
  return { inf: Math.max(0, Math.floor(s.inf || 0)),
           cav: Math.max(0, Math.floor(s.cav || 0)),
           arc: Math.max(0, Math.floor(s.arc || 0)) };
}

function sumTroops(o) { return (o.inf|0) + (o.cav|0) + (o.arc|0); }

/* ------------------- Per‑troop attack from tier ------------------- */
/**
 * Using: attack_per_troop = base_attack × (1 + BEAR_ATK_BONUS) × BASE_LETHALITY / 100
 * i.e., base_attack * 1.25 * 10 / 100 = base_attack * 0.125
 */
function perTroopAttack(baseAttack) {
  return baseAttack * (1 + BEAR_ATK_BONUS) * (BASE_LETHALITY / 100);
}

/* ------------------- Damage model (per your math) ------------------- */
/**
 * Base damage (round 0):
 *   army = sqrt(remaining_ut × army_min), where army_min = min(attacker_total, BEAR_TROOPS)
 *   base_damage = army × (perTroopAttack) / BEAR_DEF_PER_TROOP / 100 × skillmod
 * Then total 10‑round damage = sum(base_dmg_types) * 10
 * Final Score = ceil(total_10_round_damage)
 */
function computeFormationDamage(formation, tierKey) {
  if (!TIERS || !TIERS.tiers || !TIERS.tiers[tierKey]) {
    return {
      byType: { inf: 0, cav: 0, arc: 0 },
      round10Total: 0,
      finalScore: 0
    };
  }

  const tier = TIERS.tiers[tierKey];

  // Base attacks (from tiers.json)
  const baseAtkInf = (tier.inf && tier.inf[0]) || 0;
  const baseAtkCav = (tier.cav && tier.cav[0]) || 0;
  const baseAtkArc = (tier.arc && tier.arc[0]) || 0;

  // Per‑troop attack with bear bonus & base lethality
  const atkInf = perTroopAttack(baseAtkInf);
  const atkCav = perTroopAttack(baseAtkCav);
  const atkArc = perTroopAttack(baseAtkArc);

  const total = Math.max(0, sumTroops(formation));
  const armyMin = Math.min(total, BEAR_TROOPS) || 0;

  const dInf = (() => {
    const army = Math.sqrt((formation.inf || 0) * armyMin);
    return army * (atkInf / BEAR_DEF_PER_TROOP) / 100 * SKILLMOD_INF;
  })();
  const dCav = (() => {
    const army = Math.sqrt((formation.cav || 0) * armyMin);
    return army * (atkCav / BEAR_DEF_PER_TROOP) / 100 * SKILLMOD_CAV;
  })();
  const dArc = (() => {
    const army = Math.sqrt((formation.arc || 0) * armyMin);
    return army * (atkArc / BEAR_DEF_PER_TROOP) / 100 * SKILLMOD_ARC;
  })();

  const baseSum = dInf + dCav + dArc;
  const total10 = baseSum * 10;
  const finalScore = Math.ceil(total10);

  return {
    byType: { inf: dInf, cav: dCav, arc: dArc },
    round10Total: total10,
    finalScore
  };
}

/* ------------------- Heuristic weights for ratio modes ------------------- */
function damageWeightsByTier(tierKey) {
  // Pure coefficient for "value per unit" (ignoring sqrt concavity), used only as a priority tiebreaker
  const tier = TIERS?.tiers?.[tierKey];
  if (!tier) return { inf: 1, cav: 1, arc: 2 };

  const atkInf = perTroopAttack(tier.inf[0]) / BEAR_DEF_PER_TROOP / 100 * SKILLMOD_INF;
  const atkCav = perTroopAttack(tier.cav[0]) / BEAR_DEF_PER_TROOP / 100 * SKILLMOD_CAV;
  const atkArc = perTroopAttack(tier.arc[0]) / BEAR_DEF_PER_TROOP / 100 * SKILLMOD_ARC;

  return { inf: atkInf, cav: atkCav, arc: atkArc };
}

function baseWeightsForMode(mode) {
  // 1:1 Ratio -> [1,1,1], Magic 1:2 -> Archers weighted x2 by default
  if (mode === "magic12") return { inf: 1, cav: 1, arc: 2 };
  return { inf: 1, cav: 1, arc: 1 };
}

/* ------------------- Allocation helpers ------------------- */
function allocateByWeights(targetSize, stock, weights, priorityWeights) {
  // target initial proportional allocation
  const W = Math.max(0.000001, weights.inf + weights.cav + weights.arc);
  let wantInf = Math.round((weights.inf / W) * targetSize);
  let wantCav = Math.round((weights.cav / W) * targetSize);
  let wantArc = targetSize - wantInf - wantCav;

  // Cap by stock
  let inf = Math.min(stock.inf, wantInf);
  let cav = Math.min(stock.cav, wantCav);
  let arc = Math.min(stock.arc, wantArc);

  // Fill remaining capacity using priority by "priorityWeights" (usually damage value)
  let placed = inf + cav + arc;
  let deficit = targetSize - placed;

  // Build priority list high->low
  const pr = [
    ["arc", priorityWeights.arc],
    ["cav", priorityWeights.cav],
    ["inf", priorityWeights.inf],
  ].sort((a,b) => b[1] - a[1]);

  while (deficit > 0) {
    let progressed = false;
    for (const [k] of pr) {
      if (deficit <= 0) break;
      const canGive = Math.min(deficit, Math.max(0, stock[k] - (k==="inf"?inf:(k==="cav"?cav:arc))));
      if (canGive > 0) {
        if (k === "inf") inf += canGive;
        else if (k === "cav") cav += canGive;
        else arc += canGive;
        deficit -= canGive;
        progressed = true;
      }
    }
    if (!progressed) break; // no more stock
  }

  // Deduct from stock (mutates)
  stock.inf -= inf; stock.cav -= cav; stock.arc -= arc;

  return { inf, cav, arc };
}

/* ------------------- Builders ------------------- */
function buildCallRally(mode, stock, rallySize, tierKey, manualTriplet) {
  const s = cloneStock(stock);
  if (rallySize <= 0) return { rally: { inf:0, cav:0, arc:0 }, stockAfter: s };

  let weights = baseWeightsForMode(mode);
  // If manual override exists, convert to weights
  if (manualTriplet) {
    weights = { inf: manualTriplet.i, cav: manualTriplet.c, arc: manualTriplet.a };
  }

  const prio = damageWeightsByTier(tierKey);
  const rally = allocateByWeights(Math.floor(rallySize), s, weights, prio);

  return { rally, stockAfter: s };
}

function buildJoinRallies(mode, stock, X, cap, tierKey, manualTripletFor11 = null) {
  const packs = [];
  const s = cloneStock(stock);
  const prio = damageWeightsByTier(tierKey);

  for (let i = 0; i < Math.max(0, Math.floor(X)); i++) {
    let weights = baseWeightsForMode(mode);
    // In 1:1 mode, if a manual triplet was used for call, we mirror that for joins
    if (mode === "ratio11" && manualTripletFor11) {
      weights = { inf: manualTripletFor11.i, cav: manualTripletFor11.c, arc: manualTripletFor11.a };
    }
    const march = allocateByWeights(Math.floor(cap), s, weights, prio);
    packs.push(march);
  }

  return { packs, leftover: s };
}

/* ------------------- Recommendation (how many marches to send) ------------------- */
function meetsTargetFill(fill) { return fill >= FILL_THRESHOLD; }

function evaluateMarchSet(packs, cap) {
  const totals = packs.map(p => (p.inf + p.cav + p.arc));
  const fills  = totals.map(t => cap > 0 ? (t / cap) : 0);
  const minFill   = fills.length ? Math.min(...fills) : 0;
  const avgFill   = fills.length ? (fills.reduce((a,b)=>a+b,0) / fills.length) : 0;
  const fullCount = fills.filter(f => meetsTargetFill(f)).length;
  return { totals, fills, minFill, avgFill, fullCount };
}

function recommendMarchCount(mode, tierKey, callRally, stockAfterCall, X, cap, manualTripletFor11) {
  let best = null;

  for (let n = 1; n <= Math.max(1, Math.floor(X)); n++) {
    const sim = buildJoinRallies(mode, stockAfterCall, n, cap, tierKey, manualTripletFor11);
    const stats = evaluateMarchSet(sim.packs, cap);
    const leftTotal = sumTroops(sim.leftover);

    // Score function (simple but monotonic with the legacy idea)
    const score =
      stats.fullCount * 1e9 +
      stats.minFill * 1e6 +
      stats.avgFill * 1e3 -
      leftTotal;

    const candidate = {
      marchCount: n,
      score,
      metrics: stats,
      packs: sim.packs,
      leftover: sim.leftover
    };
    if (!best || candidate.score > best.score) best = candidate;
  }

  return best;
}

/* ------------------- Rendering ------------------- */
function renderCallTable(rally) {
  const tot = sumTroops(rally);
  const html = `
    <table>
      <thead>
        <tr><th>Type</th><th>Infantry</th><th>Cavalry</th><th>Archers</th><th>Total</th></tr>
      </thead>
      <tbody>
        <tr style="background:#162031;">
          <td><strong>CALL RALLY</strong></td>
          <td>${rally.inf.toLocaleString()}</td>
          <td>${rally.cav.toLocaleString()}</td>
          <td>${rally.arc.toLocaleString()}</td>
          <td>${tot.toLocaleString()}</td>
        </tr>
      </tbody>
    </table>
  `;
  $("callRallyTable").innerHTML = html;
}

function renderJoinTable(packs) {
  let html = `
    <table>
      <thead>
        <tr><th>Formation</th><th>Infantry</th><th>Cavalry</th><th>Archers</th><th>Total</th></tr>
      </thead>
      <tbody>
  `;
  packs.forEach((p, idx) => {
    const tot = p.inf + p.cav + p.arc;
    html += `<tr>
      <td>#${idx+1}</td>
      <td>${p.inf.toLocaleString()}</td>
      <td>${p.cav.toLocaleString()}</td>
      <td>${p.arc.toLocaleString()}</td>
      <td>${tot.toLocaleString()}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  $("joinTableWrap").innerHTML = html;
}

function renderScoreboard(rows) {
  // rows: [{ window:1, formation:"Call"|"Join #k", counts:{inf,cav,arc}, dmgBy:{inf,cav,arc}, total10, finalScore }, ...]
  let html = `
    <table>
      <thead>
        <tr>
          <th>Window</th>
          <th>Formation</th>
          <th>Inf</th>
          <th>Cav</th>
          <th>Arc</th>
          <th>Base dmg (Inf/Cav/Arc)</th>
          <th>Round‑10 total dmg</th>
          <th>Final Score</th>
        </tr>
      </thead>
      <tbody>
  `;
  rows.forEach(r => {
    html += `<tr>
      <td>${r.window}</td>
      <td>${r.formation}</td>
      <td>${r.counts.inf.toLocaleString()}</td>
      <td>${r.counts.cav.toLocaleString()}</td>
      <td>${r.counts.arc.toLocaleString()}</td>
      <td>${r.dmgBy.inf.toFixed(3)} / ${r.dmgBy.cav.toFixed(3)} / ${r.dmgBy.arc.toFixed(3)}</td>
      <td>${r.total10.toFixed(3)}</td>
      <td>${r.finalScore.toLocaleString()}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  $("scoreboardTableWrap").innerHTML = html;
}

/* ------------------- Main compute flow ------------------- */
function compute(mode) {
  const tierKey = $("troopTier").value;

  // show current tier basics
  const tier = TIERS?.tiers?.[tierKey];
  if (tier) {
    const note = `Using tier ${tierKey} — Base ATK (Inf/Cav/Arc): ${tier.inf[0]}/${tier.cav[0]}/${tier.arc[0]}. Bear def/troop ${BEAR_DEF_PER_TROOP.toFixed(5)}.`;
    $("selectedTierNote").textContent = note;
  } else {
    $("selectedTierNote").textContent = "";
  }

  // inputs
  const stock0 = {
    inf: nval("stockInf"),
    cav: nval("stockCav"),
    arc: nval("stockArc")
  };
  const rallySize = Math.max(0, Math.floor(nval("rallySize")));
  const joinCap   = Math.max(0, Math.floor(nval("marchSize")));
  const X         = Math.max(1, Math.floor(nval("numFormations")));

  // manual override triplet (for call)
  const parsed = parseTriplet($("compInput").value);
  const manualTriplet = parsed ? { i: parsed.i, c: parsed.c, a: parsed.a } : null;

  // Build Call rally
  const { rally, stockAfter } = buildCallRally(mode, stock0, rallySize, tierKey, manualTriplet);

  // Build joins (initially with all X marches)
  const joinsBuild = buildJoinRallies(mode, stockAfter, X, joinCap, tierKey, manualTriplet);
  const joins = joinsBuild.packs;

  // Recommended march count (1..X), then re‑use best
  const best = recommendMarchCount(mode, tierKey, rally, stockAfter, X, joinCap, manualTriplet);
  window.__recommendedMarches = best?.marchCount || X;
  $("recommendedDisplay").textContent =
    `Best: ${window.__recommendedMarches} marches (min fill ${(best.metrics.minFill*100).toFixed(1)}%, avg fill ${(best.metrics.avgFill*100).toFixed(1)}%)`;

  // Use the *current* X marches set for rendering (user can click "Use Recommended" to apply)
  renderCallTable(rally);
  renderJoinTable(joins);

  // Fractions readout for call rally
  const tripletDisplay = (() => {
    const total = sumTroops(rally) || 1;
    const fr = { i: rally.inf/total, c: rally.cav/total, a: rally.arc/total };
    return toPctTriplet(fr);
  })();
  $("fractionReadout").textContent = `Using: ${tripletDisplay} (Inf/Cav/Arc)`;

  // Inventory readout
  const formedTroops = joins.reduce((s,p)=>s+sumTroops(p), 0);
  const totalAvailBefore = sumTroops(stock0);
  const left = joinsBuild.leftover;
  const rallyTotal = sumTroops(rally);
  const totalUsed = totalAvailBefore - sumTroops(left);
  $("inventoryReadout").textContent =
`Rally ${rallyTotal.toLocaleString()} used → INF ${rally.inf.toLocaleString()}, CAV ${rally.cav.toLocaleString()}, ARC ${rally.arc.toLocaleString()}.

Formations built: ${joins.length} × cap ${joinCap.toLocaleString()} (troops placed: ${formedTroops.toLocaleString()}).

Leftover → INF ${left.inf.toLocaleString()}, CAV ${left.cav.toLocaleString()}, ARC ${left.arc.toLocaleString()}.

Stock used: ${totalUsed.toLocaleString()} of ${totalAvailBefore.toLocaleString()}.`;

  // --------- Scoreboard (Option‑A layout) across WINDOWS ---------
  const makeRowsForWindow = (wIdx) => {
    const rows = [];
    // Call rally row
    if (rallyTotal > 0) {
      const dmgR = computeFormationDamage(rally, tierKey);
      rows.push({
        window: wIdx,
        formation: "Call",
        counts: rally,
        dmgBy: dmgR.byType,
        total10: dmgR.round10Total,
        finalScore: dmgR.finalScore
      });
    }
    // Join rows
    joins.forEach((p, i) => {
      const dmgJ = computeFormationDamage(p, tierKey);
      rows.push({
        window: wIdx,
        formation: `Join #${i+1}`,
        counts: p,
        dmgBy: dmgJ.byType,
        total10: dmgJ.round10Total,
        finalScore: dmgJ.finalScore
      });
    });
    return rows;
  };

  let allRows = [];
  for (let w = 1; w <= WINDOWS; w++) {
    allRows = allRows.concat(makeRowsForWindow(w));
  }
  renderScoreboard(allRows);

  // Keep backend state for subsequent changes
  $("hiddenLastMode").value = mode;
  $("hiddenBestFractions").value = tripletDisplay;
}

/* ------------------- Event wiring ------------------- */
function wire() {
  // Buttons
  $("btnRatio11").addEventListener("click", () => compute("ratio11"));
  $("btnMagic12").addEventListener("click", () => compute("magic12"));
  $("btnRecompute").addEventListener("click", () => {
    const last = $("hiddenLastMode").value || "ratio11";
    compute(last);
  });

  $("btnUseRecommended").addEventListener("click", () => {
    if (window.__recommendedMarches) {
      $("numFormations").value = window.__recommendedMarches;
      const last = $("hiddenLastMode").value || "ratio11";
      compute(last);
      // pulse
      const btn = $("btnUseRecommended");
      btn.classList.remove("pulse-recommended");
      void btn.offsetWidth;
      btn.classList.add("pulse-recommended");
    }
  });

  // When tier changes, note updates and recompute with last mode
  $("troopTier").addEventListener("change", () => {
    const last = $("hiddenLastMode").value || "ratio11";
    compute(last);
  });

  // When manual comp changes, just update hint (recompute on Recalculate or pressing the mode button)
  $("compInput").addEventListener("input", () => {
    const parsed = parseTriplet($("compInput").value);
    $("compHint").textContent = parsed
      ? `Manual override detected. Using ${toPctTriplet(parsed)} for Call rally.`
      : `Invalid or empty → app will auto‑compose based on chosen ratio button.`;
  });
}

/* ------------------- Initialization ------------------- */
async function init() {
  try {
    const res = await fetch("tiers.json", { cache: "no-store" });
    TIERS = await res.json();
  } catch (e) {
    console.error("Failed to load tiers.json", e);
    TIERS = { tiers: {} };
  }

  wire();

  // Initial compute in 1:1 mode so the page shows structure
  compute("ratio11");
}

window.addEventListener("DOMContentLoaded", init);
