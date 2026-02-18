/* ============================================================
   #1079 LoL App – Kingshot Bear Optimizer
   FINAL PATCHED APP.JS (entity-free)
   - Restored 1:1 Ratio (original formula)
   - Magic Ratio V2
   - Compact scoreboard
   - No NaN output
   - Safe input handling
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
  const el = $(id);
  if (!el) return 0;
  const v = (el.value ?? "").toString().trim();
  if (v === "" || v == null) return 0;
  const parsed = parseFloat(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumTroops(o){ return (o.inf|0)+(o.cav|0)+(o.arc|0); }

function cloneStock(s){
  return { inf: Math.max(0, s.inf|0), cav: Math.max(0, s.cav|0), arc: Math.max(0, s.arc|0) };
}

/* ------------------- Triplet parser ------------------- */
function parseTriplet(str){
  if(!str) return null;
  const parts = str.replace(/%/g,"").trim().split(/[/,\s]+/).map(Number).filter(x => Number.isFinite(x));
  if(!parts.length) return null;
  let i = parts[0] ?? 0;
  let c = parts[1] ?? 0;
  let a = parts[2] ?? (100 - (i + c));
  const S = i + c + a;
  if (S <= 0) return null;
  return { i:i/S, c:c/S, a:a/S };
}
function toPctTriplet(fr){
  const S = fr.i + fr.c + fr.a || 1;
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
  if(!t) return {finalScore:0, byType:{inf:0,cav:0,arc:0}, round10Total:0};

  const nInf = pack.inf|0, nCav = pack.cav|0, nArc = pack.arc|0;
  const total = nInf + nCav + nArc;
  if(total <= 0) return {finalScore:0, byType:{inf:0,cav:0,arc:0}, round10Total:0};

  const armyMin = Math.min(total, BEAR_TROOPS);

  const atkInf = perTroopAttack(t.inf[0]);
  const atkCav = perTroopAttack(t.cav[0]);
  const atkArc = perTroopAttack(t.arc[0]);

  const dInf = Math.sqrt(nInf*armyMin) * (atkInf/BEAR_DEF_PER_TROOP) / 100 * SKILLMOD_INF;
  const dCav = Math.sqrt(nCav*armyMin) * (atkCav/BEAR_DEF_PER_TROOP) / 100 * SKILLMOD_CAV;
  const dArc = Math.sqrt(nArc*armyMin) * (atkArc/BEAR_DEF_PER_TROOP) / 100 * SKILLMOD_ARC;

  const total0 = dInf + dCav + dArc;
  const total10 = total0 * 10;

  return { byType:{inf:dInf,cav:dCav,arc:dArc}, round10Total: total10, finalScore: Math.ceil(total10) };
}

/* ============================================================
   1:1 RATIO — ORIGINAL FRACTIONS
   ============================================================ */
function attackFactor(atk, let_){ return (1 + atk/100) * (1 + let_/100); }
function originalArcherCoef(tierKey){ return (tierKey === "T6") ? (4.4/1.25) : (2.78/1.45); }

function computeExactOptimalFractions(stats, tierKey){
  let Ainf = attackFactor(stats.inf_atk, stats.inf_let);
  let Acav = attackFactor(stats.cav_atk, stats.cav_let);
  let Aarc = attackFactor(stats.arc_atk, stats.arc_let);

  Ainf = Math.max(Ainf, 1e-6);
  Acav = Math.max(Acav, 1e-6);
  Aarc = Math.max(Aarc, 1e-6);

  const KARC = originalArcherCoef(tierKey);
  const alpha = Ainf / 1.12, beta = Acav, gamma = KARC * Aarc;

  const a2 = alpha*alpha, b2 = beta*beta, g2 = gamma*gamma;
  const sum = a2 + b2 + g2;

  if (!isFinite(sum) || sum <= 0) return {fi:0.08, fc:0.12, fa:0.80};
  return { fi: a2/sum, fc: b2/sum, fa: g2/sum };
}
function enforceBounds(fr){
  let i = fr.fi, c = fr.fc, a = fr.fa;

  if(i < INF_MIN_PCT) i = INF_MIN_PCT;
  if(i > INF_MAX_PCT) i = INF_MAX_PCT;
  if(c < CAV_MIN_PCT) c = CAV_MIN_PCT;

  a = 1 - i - c;
  if(a < 0){
    c = Math.max(CAV_MIN_PCT, 1 - i);
    a = 1 - i - c;
    if(a < 0){ a = 0; c = 1 - i; }
  }
  const S = i+c+a;
  return { fi:i/S, fc:c/S, fa:a/S };
}

/* ============================================================
   MAGIC RATIO V2
   ============================================================ */
function coeffsByTier(tierKey){
  const t = TIERS?.tiers?.[tierKey];
  if(!t) return {inf:1,cav:1,arc:1};
  return {
    inf: perTroopAttack(t.inf[0])/BEAR_DEF_PER_TROOP/100*SKILLMOD_INF,
    cav: perTroopAttack(t.cav[0])/BEAR_DEF_PER_TROOP/100*SKILLMOD_CAV,
    arc: perTroopAttack(t.arc[0])/BEAR_DEF_PER_TROOP/100*SKILLMOD_ARC
  };
}
function magicWeightsSquared(tierKey, mode){
  const K = coeffsByTier(tierKey);
  const mult = (mode==="magic12") ? {inf:1,cav:1,arc:2} : {inf:1,cav:1,arc:1};
  return { wInf:(K.inf*mult.inf)**2, wCav:(K.cav*mult.cav)**2, wArc:(K.arc*mult.arc)**2 };
}
function planMagicAlloc(mode, stockIn, rallySize, X, cap, tierKey){
  const s = cloneStock(stockIn);
  const R = rallySize|0, C = cap|0, Xn = X|0;
  const T = R + Xn*C;

  const {wInf,wCav,wArc} = magicWeightsSquared(tierKey, mode);
  const sw = Math.max(1e-9, wInf+wCav+wArc);

  const base = { inf: T*(wInf/sw), cav: T*(wCav/sw), arc: T*(wArc/sw) };

  let target = {
    inf: Math.min(s.inf, Math.round(base.inf)),
    cav: Math.min(s.cav, Math.round(base.cav)),
    arc: Math.min(s.arc, Math.round(base.arc))
  };

  let used = target.inf + target.cav + target.arc;
  let deficit = T - used;

  const pr = [["arc",wArc],["cav",wCav],["inf",wInf]].sort((a,b)=>b[1]-a[1]);
  while(deficit > 0){
    let moved = false;
    for(const [k] of pr){
      const free = s[k] - target[k];
      if(free > 0){
        const give = Math.min(free, deficit);
        target[k]+=give; deficit-=give; moved = true;
        if(deficit<=0) break;
      }
    }
    if(!moved) break;
  }

  const TT = Math.max(1, target.inf+target.cav+target.arc);
  const frac = { i:target.inf/TT, c:target.cav/TT, a:target.arc/TT };

  // Call
  const rally = {
    inf: Math.min(s.inf, Math.round(frac.i*R)),
    cav: Math.min(s.cav, Math.round(frac.c*R)),
    arc: 0
  };
  rally.arc = Math.min(s.arc, R - rally.inf - rally.cav);
  s.inf -= rally.inf; s.cav -= rally.cav; s.arc -= rally.arc;

  // Joins
  const joins = [];
  for(let i=0;i<Xn;i++){
    const m = { inf: Math.min(s.inf, Math.round(frac.i*C)),
                cav: Math.min(s.cav, Math.round(frac.c*C)),
                arc: 0 };
    m.arc = Math.min(s.arc, C - (m.inf + m.cav));
    s.inf -= m.inf; s.cav -= m.cav; s.arc -= m.arc;
    joins.push(m);
  }

  return { rally, packs: joins, leftover: s, fractions: frac };
}

/* ============================================================
   Recommend march count
   ============================================================ */
function meetsTargetFill(f){ return f >= FILL_THRESHOLD; }
function evaluateMarchSet(packs, cap){
  const totals = packs.map(p => sumTroops(p));
  const fills = totals.map(t => cap ? t/cap : 0);
  const minFill = fills.length ? Math.min(...fills) : 0;
  const avgFill = fills.length ? fills.reduce((a,b)=>a+b,0)/fills.length : 0;
  const fullCount = fills.filter(f => meetsTargetFill(f)).length;
  return { minFill, avgFill, fullCount };
}
function buildJoinRallies(mode, stockIn, X, cap, tierKey, manual=null){
  const s=cloneStock(stockIn);
  const W = manual ? (manual.i+manual.c+manual.a) : 3;
  const wi = manual ? manual.i : 1, wc = manual ? manual.c : 1, wa = manual ? manual.a : 1;

  const packs = [];
  for(let i=0;i<X;i++){
    const infT = Math.round(wi/W*cap);
    const cavT = Math.round(wc/W*cap);
    const arcT = cap - infT - cavT;

    const p = { inf: Math.min(s.inf, infT), cav: Math.min(s.cav, cavT), arc: 0 };
    const rem = cap - (p.inf + p.cav);
    p.arc = Math.min(s.arc, rem);

    s.inf -= p.inf; s.cav -= p.cav; s.arc -= p.arc;
    packs.push(p);
  }
  return { packs, leftover:s };
}
function recommendMarchCount(mode, tierKey, rally, stockAfter, X, cap, manual){
  let best=null;
  for(let n=1;n<=X;n++){
    const sim = buildJoinRallies(mode, stockAfter, n, cap, tierKey, manual);
    const m = evaluateMarchSet(sim.packs, cap);
    const sc = m.fullCount*1e9 + m.minFill*1e6 + m.avgFill*1e3 - sumTroops(sim.leftover);
    if(!best || sc>best.score) best = { marchCount:n, score:sc, metrics:m };
  }
  return best;
}

/* ============================================================
   RENDERING
   ============================================================ */
function renderCallTable(r){
  $("callRallyTable").innerHTML = `
    <table>
      <thead><tr><th>Type</th><th>Inf</th><th>Cav</th><th>Arc</th><th>Total</th></tr></thead>
      <tbody>
        <tr style="background:#162031;">
          <td><strong>CALL</strong></td>
          <td>${r.inf}</td>
          <td>${r.cav}</td>
          <td>${r.arc}</td>
          <td>${sumTroops(r)}</td>
        </tr>
      </tbody>
    </table>`;
}
function renderJoinTable(joins){
  let out = `
    <table>
      <thead><tr><th>#</th><th>Inf</th><th>Cav</th><th>Arc</th><th>Total</th></tr></thead>
      <tbody>`;
  joins.forEach((p,i)=>{
    out += `
      <tr>
        <td>#${i+1}</td>
        <td>${p.inf}</td>
        <td>${p.cav}</td>
        <td>${p.arc}</td>
        <td>${sumTroops(p)}</td>
      </tr>`;
  });
  out += "</tbody></table>";
  $("joinTableWrap").innerHTML = out;
}
function renderScoreboardCompact(rally, joins, tierKey){
  const callScore = computeFormationDamage(rally, tierKey).finalScore;
  let joinScore = 0;
  for(const p of joins) joinScore += computeFormationDamage(p, tierKey).finalScore;

  let out = `
    <table>
      <thead><tr><th>Window</th><th>Call</th><th>Joins</th><th>Total</th></tr></thead>
      <tbody>`;
  for(let w=1; w<=WINDOWS; w++){
    out += `
      <tr>
        <td>${w}</td>
        <td>${callScore}</td>
        <td>${joinScore}</td>
        <td>${callScore + joinScore}</td>
      </tr>`;
  }
  out += "</tbody></table>";
  $("scoreboardTableWrap").innerHTML = out;
}

/* ============================================================
   MAIN COMPUTE
   ============================================================ */
function compute(mode){
  const tierKey = $("troopTier").value;
  const tier = TIERS?.tiers?.[tierKey];

  $("selectedTierNote").textContent = tier
    ? `Using tier ${tierKey} — Base ATK ${tier.inf[0]}/${tier.cav[0]}/${tier.arc[0]}`
    : "";

  const stock0 = { inf:nval("stockInf"), cav:nval("stockCav"), arc:nval("stockArc") };
  const rallySize = nval("rallySize");
  const joinCap = nval("marchSize");
  const X = nval("numFormations");

  const parsed = parseTriplet($("compInput").value);
  const manual = parsed ? parsed : null;

  let rally, joins, leftover, fractions;

  if(mode==="magic12"){
    ({rally, packs:joins, leftover, fractions} = planMagicAlloc(mode, stock0, rallySize, X, joinCap, tierKey));
  } else {
    let stats = {
      inf_atk:nval("inf_atk"), inf_let:nval("inf_let"),
      cav_atk:nval("cav_atk"), cav_let:nval("cav_let"),
      arc_atk:nval("arc_atk"), arc_let:nval("arc_let")
    };
    ["inf_atk","inf_let","cav_atk","cav_let","arc_atk","arc_let"].forEach(id=>{
      if(!Number.isFinite(stats[id]) || stats[id] <= 0) stats[id] = 1;
    });

    let opt = computeExactOptimalFractions(stats, tierKey);
    opt = enforceBounds(opt);
    if(!isFinite(opt.fi) || !isFinite(opt.fc) || !isFinite(opt.fa)) opt = {fi:0.08, fc:0.12, fa:0.80};

    const useFrac = manual ? manual : opt;

    // Call
    const cr = buildCallRally("ratio11", stock0, rallySize, tierKey, useFrac);
    rally = cr.rally;

    // Joins
    const jr = buildJoinRallies("ratio11", cr.stockAfter, X, joinCap, tierKey, useFrac);
    joins = jr.packs;
    leftover = jr.leftover;

    fractions = useFrac;
  }

  const best = recommendMarchCount(mode, tierKey, rally, cloneStock(stock0), X, joinCap, manual);
  window.__recommendedMarches = best?.marchCount || X;
  $("recommendedDisplay").textContent =
    `Best: ${window.__recommendedMarches} marches (min ${(best.metrics.minFill*100).toFixed(1)}%, avg ${(best.metrics.avgFill*100).toFixed(1)}%)`;

  renderCallTable(rally);
  renderJoinTable(joins);
  $("fractionReadout").textContent = `Using: ${toPctTriplet(fractions)} (Inf/Cav/Arc)`;

  const formed = joins.reduce((s,p)=>s+sumTroops(p),0);
  const before = sumTroops(stock0);
  const used = sumTroops(rally) + formed;

  $("inventoryReadout").textContent =
`Rally ${sumTroops(rally)} used → INF ${rally.inf}, CAV ${rally.cav}, ARC ${rally.arc}.

Formations built: ${joins.length} × ${joinCap} → ${formed} troops.

Leftover → INF ${leftover.inf}, CAV ${leftover.cav}, ARC ${leftover.arc}.

Stock used: ${used} / ${before}.`;

  renderScoreboardCompact(rally, joins, tierKey);

  $("hiddenLastMode").value = mode;
  $("hiddenBestFractions").value = toPctTriplet(fractions);
}

/* Simple call builder used by 1:1 mode */
function buildCallRally(mode, stock, rallySize, tierKey, manual){
  const s = cloneStock(stock);
  if(rallySize <= 0) return {rally:{inf:0,cav:0,arc:0}, stockAfter:s};

  const w = manual ? {inf:manual.i, cav:manual.c, arc:manual.a} : {inf:1,cav:1,arc:1};
  const S = Math.max(1e-9, w.inf + w.cav + w.arc);
  const t = rallySize;

  let ideal = { inf: Math.round(w.inf/S*t), cav: Math.round(w.cav/S*t), arc: t - Math.round(w.inf/S*t) - Math.round(w.cav/S*t) };
  const r = { inf:Math.min(s.inf,ideal.inf), cav:Math.min(s.cav,ideal.cav), arc:0 };
  const rem = t - (r.inf + r.cav);
  r.arc = Math.min(s.arc, rem);

  s.inf -= r.inf; s.cav -= r.cav; s.arc -= r.arc;
  return { rally:r, stockAfter:s };
}

/* ============================================================
   WIRING & INIT
   ============================================================ */
function wire(){
  $("btnRatio11")?.addEventListener("click", ()=> compute("ratio11"));
  $("btnMagic12")?.addEventListener("click", ()=> compute("magic12"));
  $("btnRecompute")?.addEventListener("click", ()=> compute($("hiddenLastMode").value || "ratio11"));

  $("btnUseRecommended")?.addEventListener("click", ()=>{
    if(window.__recommendedMarches){
      $("numFormations").value = window.__recommendedMarches;
      compute($("hiddenLastMode").value || "ratio11");
    }
  });

  $("troopTier")?.addEventListener("change", ()=> compute($("hiddenLastMode").value || "ratio11"));

  $("compInput")?.addEventListener("input", ()=>{
    const p = parseTriplet($("compInput").value);
    $("compHint").textContent = p ? `Manual override: ${toPctTriplet(p)}` : `Invalid or empty → auto fractions`;
  });
}

async function init(){
  try{
    const r = await fetch("tiers.json");
    TIERS = await r.json();
  }catch(e){
    console.error("tiers.json failed", e);
    TIERS = {tiers:{}};
  }
  wire();
  compute("ratio11");
}
window.addEventListener("DOMContentLoaded", init);
