/* ============================================================
   #1079 LoL App – Kingshot Bear Optimizer
   FINAL CLEAN app.js (PART 1/4)
   ============================================================ */

console.log("app.js loaded");

/* ------------------- Constants ------------------- */
const WINDOWS = 5;
const BEAR_TROOPS = 5000;
const BEAR_DEF = 10;
const BEAR_HP = 83.3333;
const BEAR_DEF_PER_TROOP = (BEAR_HP * BEAR_DEF) / 100;
const BEAR_ATK_BONUS = 0.25;
const BASE_LETHALITY = 10;

const SKILLMOD_INF = 1.0;
const SKILLMOD_CAV = 1.0;
const SKILLMOD_ARC = 1.10;

const INF_MIN_PCT = 0.075;
const INF_MAX_PCT = 0.10;
const CAV_MIN_PCT = 0.10;
const FILL_THRESHOLD = 0.923;

let TIERS = null;

/* ------------------- Utilities ------------------- */
function $(id){ return document.getElementById(id); }

function nval(id){
  const el = document.getElementById(id);
  if (!el) return 0;
  const v = (el.value ?? "").trim();
  if (v === "") return 0;
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : 0;
}

function sumTroops(o){
  return (o.inf|0)+(o.cav|0)+(o.arc|0);
}

function cloneStock(s){
  return {
    inf: Math.max(0, s.inf|0),
    cav: Math.max(0, s.cav|0),
    arc: Math.max(0, s.arc|0)
  };
}

/* ------------------- Triplet parser ------------------- */
function parseTriplet(str){
  if(!str) return null;
  const arr = str.replace(/%/g,"").trim().split(/[/,\s]+/)
                .map(Number).filter(x => Number.isFinite(x));
  if(!arr.length) return null;
  let i = arr[0] ?? 0;
  let c = arr[1] ?? 0;
  let a = arr[2] ?? (100 - (i+c));
  const S = i+c+a;
  if (S <= 0) return null;
  return { i:i/S, c:c/S, a:a/S };
}

function toPctTriplet(fr){
  const S = fr.i+fr.c+fr.a || 1;
  const pi = Math.round(fr.i/S*100);
  const pc = Math.round(fr.c/S*100);
  const pa = 100 - pi - pc;
  return `${pi}/${pc}/${pa}`;
}

/* ============================================================
   DAMAGE ENGINE
   ============================================================ */
function perTroopAttack(baseAtk){
  return baseAtk * (1 + BEAR_ATK_BONUS) * (BASE_LETHALITY/100);
}

function computeFormationDamage(pack, tierKey){
  const t = TIERS?.tiers?.[tierKey];
  if(!t){
    return {finalScore:0, byType:{inf:0,cav:0,arc:0}, round10Total:0};
  }

  const nInf = pack.inf|0;
  const nCav = pack.cav|0;
  const nArc = pack.arc|0;
  const total = nInf+nCav+nArc;
  if(total <= 0){
    return {finalScore:0, byType:{inf:0,cav:0,arc:0}, round10Total:0};
  }

  const armyMin = Math.min(total, BEAR_TROOPS);

  const atkInf = perTroopAttack(t.inf[0]);
  const atkCav = perTroopAttack(t.cav[0]);
  const atkArc = perTroopAttack(t.arc[0]);

  const dInf = Math.sqrt(nInf*armyMin)*(atkInf/BEAR_DEF_PER_TROOP)/100*SKILLMOD_INF;
  const dCav = Math.sqrt(nCav*armyMin)*(atkCav/BEAR_DEF_PER_TROOP)/100*SKILLMOD_CAV;
  const dArc = Math.sqrt(nArc*armyMin)*(atkArc/BEAR_DEF_PER_TROOP)/100*SKILLMOD_ARC;

  const total0 = dInf+dCav+dArc;
  const total10 = total0*10;

  return {
    byType:{inf:dInf,cav:dCav,arc:dArc},
    round10Total:total10,
    finalScore:Math.ceil(total10)
  };
}

/* ============================================================
   1:1 RATIO — ORIGINAL OPTIMIZER
   ============================================================ */

function attackFactor(atk, let_){
  return (1 + atk/100) * (1 + let_/100);
}

function originalArcherCoef(tierKey){
  return (tierKey === "T6") ? (4.4/1.25) : (2.78/1.45);
}

function computeExactOptimalFractions(stats, tierKey){
  let Ainf = attackFactor(stats.inf_atk, stats.inf_let);
  let Acav = attackFactor(stats.cav_atk, stats.cav_let);
  let Aarc = attackFactor(stats.arc_atk, stats.arc_let);

  Ainf = Math.max(Ainf, 1e-6);
  Acav = Math.max(Acav, 1e-6);
  Aarc = Math.max(Aarc, 1e-6);

  const KARC = originalArcherCoef(tierKey);

  const alpha = Ainf / 1.12;
  const beta  = Acav;
  const gamma = KARC * Aarc;

  const a2 = alpha*alpha;
  const b2 = beta*beta;
  const g2 = gamma*gamma;

  const sum = a2 + b2 + g2;
  if (!isFinite(sum) || sum <= 0){
    return {fi:0.08, fc:0.12, fa:0.80};
  }

  return { fi: a2/sum, fc: b2/sum, fa: g2/sum };
}

function enforceBounds(fr){
  let i = fr.fi;
  let c = fr.fc;
  let a = fr.fa;

  if(i < INF_MIN_PCT) i = INF_MIN_PCT;
  if(i > INF_MAX_PCT) i = INF_MAX_PCT;
  if(c < CAV_MIN_PCT) c = CAV_MIN_PCT;

  a = 1 - i - c;
  if(a < 0){
    c = Math.max(CAV_MIN_PCT, 1 - i);
    a = 1 - i - c;
    if(a < 0){
      a = 0;
      c = 1 - i;
    }
  }

  const S = i+c+a;
  return { fi:i/S, fc:c/S, fa:a/S };
}
/* ============================================================
   MAGIC RATIO V2 (Call + Joins co-optimizer, stock-aware)
   ============================================================ */

function coeffsByTier(tierKey){
  const t = TIERS?.tiers?.[tierKey];
  if(!t) return {inf:1, cav:1, arc:1};
  return {
    inf: perTroopAttack(t.inf[0]) / BEAR_DEF_PER_TROOP / 100 * SKILLMOD_INF,
    cav: perTroopAttack(t.cav[0]) / BEAR_DEF_PER_TROOP / 100 * SKILLMOD_CAV,
    arc: perTroopAttack(t.arc[0]) / BEAR_DEF_PER_TROOP / 100 * SKILLMOD_ARC
  };
}

function magicWeightsSquared(tierKey, mode){
  const K = coeffsByTier(tierKey);
  const mult = (mode === "magic12") ? {inf:1, cav:1, arc:2} : {inf:1, cav:1, arc:1};
  return {
    wInf: (K.inf * mult.inf) ** 2,
    wCav: (K.cav * mult.cav) ** 2,
    wArc: (K.arc * mult.arc) ** 2
  };
}

/**
 * Plan both Call rally and X join marches together for one window.
 * T = R + X * C. Target per type ~ W_i / sumW capped by stock, with redistribution.
 * Returns: { rally, packs, leftover, fractions }
 */
function planMagicAlloc(mode, stockIn, rallySize, X, cap, tierKey){
  const s = cloneStock(stockIn);
  const R = Math.max(0, rallySize|0);
  const C = Math.max(0, cap|0);
  const Xn = Math.max(0, X|0);
  const T = R + Xn * C;

  const { wInf, wCav, wArc } = magicWeightsSquared(tierKey, mode);
  const sumW = Math.max(1e-9, wInf + wCav + wArc);

  // Initial desired consumption (floored later by stock)
  const base = {
    inf: T * (wInf / sumW),
    cav: T * (wCav / sumW),
    arc: T * (wArc / sumW)
  };

  let target = {
    inf: Math.min(s.inf, Math.round(base.inf)),
    cav: Math.min(s.cav, Math.round(base.cav)),
    arc: Math.min(s.arc, Math.round(base.arc))
  };

  // Redistribute any remaining capacity by priority (arc > cav > inf)
  let used = target.inf + target.cav + target.arc;
  let deficit = T - used;
  const prio = [["arc", wArc], ["cav", wCav], ["inf", wInf]].sort((a,b)=>b[1]-a[1]);

  while (deficit > 0) {
    let progressed = false;
    for (const [k] of prio) {
      const free = s[k] - target[k];
      if (free <= 0) continue;
      const give = Math.min(free, deficit);
      target[k] += give;
      deficit -= give;
      progressed = true;
      if (deficit <= 0) break;
    }
    if (!progressed) break;
  }

  // Global fractions for splitting R and each C
  const TT = Math.max(1, target.inf + target.cav + target.arc);
  const frac = { i: target.inf/TT, c: target.cav/TT, a: target.arc/TT };

  // ---- Build CALL ----
  const rally = {
    inf: Math.min(s.inf, Math.round(frac.i * R)),
    cav: Math.min(s.cav, Math.round(frac.c * R)),
    arc: 0
  };
  rally.arc = Math.min(s.arc, R - (rally.inf + rally.cav));
  s.inf -= rally.inf; s.cav -= rally.cav; s.arc -= rally.arc;

  // ---- Build JOINS ----
  const joins = [];
  for (let i = 0; i < Xn; i++) {
    if (C <= 0) { joins.push({inf:0,cav:0,arc:0}); continue; }
    const m = {
      inf: Math.min(s.inf, Math.round(frac.i * C)),
      cav: Math.min(s.cav, Math.round(frac.c * C)),
      arc: 0
    };
    m.arc = Math.min(s.arc, C - (m.inf + m.cav));
    s.inf -= m.inf; s.cav -= m.cav; s.arc -= m.arc;
    joins.push(m);
  }

  return { rally, packs: joins, leftover: s, fractions: frac };
}

/* ============================================================
   Recommendation support (fill quality)
   ============================================================ */

function meetsTargetFill(fill){ return fill >= FILL_THRESHOLD; }

function evaluateMarchSet(packs, cap){
  const totals = packs.map(p => (p.inf + p.cav + p.arc));
  const fills  = totals.map(t => cap > 0 ? (t / cap) : 0);
  const minFill   = fills.length ? Math.min(...fills) : 0;
  const avgFill   = fills.length ? (fills.reduce((a,b)=>a+b,0) / fills.length) : 0;
  const fullCount = fills.filter(f => meetsTargetFill(f)).length;
  return { minFill, avgFill, fullCount };
}

/* Simple join builder used by recommendation scan (fraction-based, stock-limited) */
function buildJoinRallies(mode, stockIn, X, cap, tierKey, manualTriplet=null){
  const s = cloneStock(stockIn);
  const w = manualTriplet ? {inf:manualTriplet.i, cav:manualTriplet.c, arc:manualTriplet.a}
                          : {inf:1, cav:1, arc:1};
  const W = Math.max(1e-9, w.inf + w.cav + w.arc);

  const packs = [];
  for (let i=0; i<X; i++){
    const tInf = Math.round((w.inf / W) * cap);
    const tCav = Math.round((w.cav / W) * cap);
    const tArc = cap - tInf - tCav;

    const p = {
      inf: Math.min(s.inf, tInf),
      cav: Math.min(s.cav, tCav),
      arc: 0
    };
    const rem = cap - (p.inf + p.cav);
    p.arc = Math.min(s.arc, rem);

    s.inf -= p.inf; s.cav -= p.cav; s.arc -= p.arc;
    packs.push(p);
  }
  return { packs, leftover: s };
}

/* Scan 1..X to recommend march count by fill quality + leftover penalty */
function recommendMarchCount(mode, tierKey, rally, stockAfterCall, X, cap, manualTriplet){
  let best = null;
  for (let n=1; n<=X; n++){
    const sim = buildJoinRallies(mode, stockAfterCall, n, cap, tierKey, manualTriplet);
    const m = evaluateMarchSet(sim.packs, cap);
    const score = m.fullCount*1e9 + m.minFill*1e6 + m.avgFill*1e3 - (sim.leftover.inf + sim.leftover.cav + sim.leftover.arc);
    if (!best || score > best.score) best = { marchCount:n, score, metrics:m };
  }
  return best;
}
/* ============================================================
   RENDERING FUNCTIONS
   ============================================================ */

function renderCallTable(r){
  $("callRallyTable").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Type</th><th>Inf</th><th>Cav</th><th>Arc</th><th>Total</th>
        </tr>
      </thead>
      <tbody>
        <tr style="background:#162031;">
          <td><strong>CALL</strong></td>
          <td>${r.inf}</td>
          <td>${r.cav}</td>
          <td>${r.arc}</td>
          <td>${sumTroops(r)}</td>
        </tr>
      </tbody>
    </table>
  `;
}

function renderJoinTable(joins){
  let out = `
    <table>
      <thead>
        <tr>
          <th>#</th><th>Inf</th><th>Cav</th><th>Arc</th><th>Total</th>
        </tr>
      </thead>
      <tbody>
  `;
  joins.forEach((p,i)=>{
    out += `
      <tr>
        <td>#${i+1}</td>
        <td>${p.inf}</td>
        <td>${p.cav}</td>
        <td>${p.arc}</td>
        <td>${sumTroops(p)}</td>
      </tr>
    `;
  });

  out += `
      </tbody>
    </table>
  `;
  $("joinTableWrap").innerHTML = out;
}

function renderScoreboardCompact(rally, joins, tierKey){
  const callScore = computeFormationDamage(rally, tierKey).finalScore;
  let joinScore = 0;
  for(const p of joins){
    joinScore += computeFormationDamage(p, tierKey).finalScore;
  }

  let out = `
    <table>
      <thead>
        <tr>
          <th>Window</th><th>Call</th><th>Joins</th><th>Total</th>
        </tr>
      </thead>
      <tbody>
  `;

  for(let w=1; w<=WINDOWS; w++){
    out += `
      <tr>
        <td>${w}</td>
        <td>${callScore}</td>
        <td>${joinScore}</td>
        <td>${callScore + joinScore}</td>
      </tr>
    `;
  }

  out += `
      </tbody>
    </table>
  `;

  $("scoreboardTableWrap").innerHTML = out;
}

/* ============================================================
   MAIN COMPUTE FLOW
   ============================================================ */

function compute(mode){
  const tierKey = $("troopTier").value;
  const tier = TIERS?.tiers?.[tierKey];

  $("selectedTierNote").textContent = tier
    ? `Using tier ${tierKey} — Base ATK ${tier.inf[0]}/${tier.cav[0]}/${tier.arc[0]}`
    : "";

  const stock0 = {
    inf: nval("stockInf"),
    cav: nval("stockCav"),
    arc: nval("stockArc")
  };

  const rallySize = nval("rallySize");
  const joinCap   = nval("marchSize");
  const X         = nval("numFormations");

  const parsed = parseTriplet($("compInput").value);
  const manual = parsed ? parsed : null;

  let rally, joins, leftover, fractions;

  /* ------ MAGIC RATIO MODE ------ */
  if(mode === "magic12"){
    ({ rally, packs:joins, leftover, fractions } =
      planMagicAlloc("magic12", stock0, rallySize, X, joinCap, tierKey));
  }

  else {
/* ------ 1:1 RESTORED MODE ------ */
let stats = {
  inf_atk:nval("inf_atk"),
  inf_let:nval("inf_let"),
  cav_atk:nval("cav_atk"),
  cav_let:nval("cav_let"),
  arc_atk:nval("arc_atk"),
  arc_let:nval("arc_let")
};

// Safe minimums so we never get 0 or NaN
for (const k of ["inf_atk","inf_let","cav_atk","cav_let","arc_atk","arc_let"]) {
  if (!Number.isFinite(stats[k]) || stats[k] <= 0) stats[k] = 1;
}

// Original optimizer → returns {fi,fc,fa}
let opt = computeExactOptimalFractions(stats, tierKey);
opt = enforceBounds(opt);
if (!isFinite(opt.fi) || !isFinite(opt.fc) || !isFinite(opt.fa)) {
  opt = { fi:0.08, fc:0.12, fa:0.80 };
}

// 🔧 Map to the shape builders expect: {i,c,a}
const frac = { i: opt.fi, c: opt.fc, a: opt.fa };

// If user typed a manual override (Inf/Cav/Arc), use it; else use the mapped fractions
const useFrac = manual ? manual : frac;

// Build call rally + joins using {i,c,a}
const cr = buildCallRally("ratio11", stock0, rallySize, tierKey, useFrac);
const jr = buildJoinRallies("ratio11", cr.stockAfter, X, joinCap, tierKey, useFrac);

rally = cr.rally;
joins = jr.packs;
leftover = jr.leftover;

// This is what we print in “Using: I/C/A”
fractions = useFrac;
  }

  /* --- RECOMMENDATION SYSTEM --- */
  const best = recommendMarchCount(
    mode, tierKey, rally, cloneStock(stock0),
    X, joinCap, manual
  );

  window.__recommendedMarches = best?.marchCount || X;

  $("recommendedDisplay").textContent =
    `Best: ${window.__recommendedMarches} marches (min ${(best.metrics.minFill*100).toFixed(1)}%, avg ${(best.metrics.avgFill*100).toFixed(1)}%)`;

  /* --- Display tables --- */
  renderCallTable(rally);
  renderJoinTable(joins);

  $("fractionReadout").textContent =
    `Using: ${toPctTriplet(fractions)} (Inf/Cav/Arc)`;

  const formed = joins.reduce((s,p)=>s+sumTroops(p),0);
  const before = sumTroops(stock0);
  const used   = sumTroops(rally) + formed;

  $("inventoryReadout").textContent =
`Rally ${sumTroops(rally)} used → INF ${rally.inf}, CAV ${rally.cav}, ARC ${rally.arc}.

Formations built: ${joins.length} × ${joinCap} → ${formed} troops.

Leftover → INF ${leftover.inf}, CAV ${leftover.cav}, ARC ${leftover.arc}.

Stock used: ${used} / ${before}.`;

  renderScoreboardCompact(rally, joins, tierKey);

  $("hiddenLastMode").value = mode;
  $("hiddenBestFractions").value = toPctTriplet(fractions);
}
/* ============================================================
   SIMPLE CALL BUILDER (used for 1:1 mode)
   ============================================================ */

function buildCallRally(mode, stock, rallySize, tierKey, manual){
  const s = cloneStock(stock);
  if(rallySize <= 0) return {rally:{inf:0, cav:0, arc:0}, stockAfter:s};

  const w = manual ? {inf:manual.i, cav:manual.c, arc:manual.a}
                   : {inf:1,        cav:1,        arc:1};

  const W = Math.max(1e-9, w.inf + w.cav + w.arc);
  const t = rallySize;

  let idealInf = Math.round((w.inf / W) * t);
  let idealCav = Math.round((w.cav / W) * t);
  let idealArc = t - idealInf - idealCav;

  const r = {
    inf: Math.min(s.inf, idealInf),
    cav: Math.min(s.cav, idealCav),
    arc: 0
  };

  const remaining = t - (r.inf + r.cav);
  r.arc = Math.min(s.arc, remaining);

  s.inf -= r.inf;
  s.cav -= r.cav;
  s.arc -= r.arc;

  return { rally:r, stockAfter:s };
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
function wire(){
  const safe = (id) => document.getElementById(id);

  safe("btnRatio11")?.addEventListener("click", () => compute("ratio11"));
  safe("btnMagic12")?.addEventListener("click", () => compute("magic12"));
  safe("btnRecompute")?.addEventListener("click", () => {
    compute(safe("hiddenLastMode").value || "ratio11");
  });

  safe("btnUseRecommended")?.addEventListener("click", () => {
    if(window.__recommendedMarches){
      safe("numFormations").value = window.__recommendedMarches;
      compute(safe("hiddenLastMode").value || "ratio11");
    }
  });

  safe("troopTier")?.addEventListener("change", () => {
    compute(safe("hiddenLastMode").value || "ratio11");
  });

  safe("compInput")?.addEventListener("input", () => {
    const p = parseTriplet(safe("compInput").value);
    safe("compHint").textContent =
      p ? `Manual override: ${toPctTriplet(p)}`
        : `Invalid or empty → auto fractions`;
  });
}
$("hiddenLastMode").value = "magic12";
/* ============================================================
   INIT
   ============================================================ */
async function init(){
  try {
    const res = await fetch("tiers.json", {cache:"no-store"});
    TIERS = await res.json();
  } catch(e){
    console.error("tiers.json failed", e);
    TIERS = { tiers:{} };
  }
  wire();
  compute("magic12");
}

window.addEventListener("DOMContentLoaded", init);
