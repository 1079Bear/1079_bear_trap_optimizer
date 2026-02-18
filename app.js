/* ============================================================
   #1079 LoL App – Kingshot Bear Optimizer
   FULL NEW APP.JS (Magic Ratio Optimizer v2 + Compact Scoreboard)
   ============================================================ */

/* ------------------- Bear & Battle Constants ------------------- */
const WINDOWS = 5;
const BEAR_TROOPS = 5000;
const BEAR_DEF = 10;
const BEAR_HP = 83.3333;
const BEAR_DEF_PER_TROOP = (BEAR_HP * BEAR_DEF) / 100; // 8.33333
const BEAR_ATK_BONUS = 0.25;
const BASE_LETHALITY = 10;
const SKILLMOD_INF = 1.00;
const SKILLMOD_CAV = 1.00;
const SKILLMOD_ARC = 1.10;
const FILL_THRESHOLD = 0.923;

let TIERS = null;

/* ------------------- Helpers ------------------- */
const $ = (id) => document.getElementById(id);

const nval = (id) => {
  const el = $(id);
  const v = parseFloat(el?.value || "0");
  return Number.isFinite(v) ? v : 0;
};

const cloneStock = (s) => ({
  inf: Math.max(0, Math.floor(s.inf || 0)),
  cav: Math.max(0, Math.floor(s.cav || 0)),
  arc: Math.max(0, Math.floor(s.arc || 0)),
});

const sumTroops = (o) => (o.inf | 0) + (o.cav | 0) + (o.arc | 0);

function parseTriplet(str) {
  if (!str) return null;
  const parts = str.replace(/%/g,"").trim()
    .split(/[/,\s]+/)
    .map(Number)
    .filter((x)=>Number.isFinite(x));
  if (!parts.length) return null;
  let i = parts[0] ?? 0;
  let c = parts[1] ?? 0;
  let a = parts[2] ?? (100 - (i+c));
  const sum = i + c + a;
  if (sum <= 0) return null;
  return { i:i/sum, c:c/sum, a:a/sum };
}

function toPctTriplet({i,c,a}) {
  const sum = Math.max(1, i+c+a);
  const pi = Math.round((i/sum)*100);
  const pc = Math.round((c/sum)*100);
  const pa = 100 - pi - pc;
  return `${pi}/${pc}/${pa}`;
}

/* ------------------- Damage Engine ------------------- */
function perTroopAttack(baseAtk) {
  return baseAtk * (1 + BEAR_ATK_BONUS) * (BASE_LETHALITY / 100);
}

function computeFormationDamage(pack, tierKey) {
  const t = TIERS?.tiers?.[tierKey];
  if (!t) return { finalScore:0, byType:{inf:0,cav:0,arc:0}, round10Total:0 };

  const nInf = pack.inf, nCav = pack.cav, nArc = pack.arc;
  const total = nInf + nCav + nArc;
  if (total <= 0) return { finalScore:0, byType:{inf:0,cav:0,arc:0}, round10Total:0 };

  const armyMin = Math.min(total, BEAR_TROOPS);

  const atkInf = perTroopAttack(t.inf[0]);
  const atkCav = perTroopAttack(t.cav[0]);
  const atkArc = perTroopAttack(t.arc[0]);

  const dmgInf = Math.sqrt(nInf * armyMin) * (atkInf / BEAR_DEF_PER_TROOP) / 100 * SKILLMOD_INF;
  const dmgCav = Math.sqrt(nCav * armyMin) * (atkCav / BEAR_DEF_PER_TROOP) / 100 * SKILLMOD_CAV;
  const dmgArc = Math.sqrt(nArc * armyMin) * (atkArc / BEAR_DEF_PER_TROOP) / 100 * SKILLMOD_ARC;

  const total0 = dmgInf + dmgCav + dmgArc;
  const total10 = total0 * 10;
  return {
    byType:{inf:dmgInf,cav:dmgCav,arc:dmgArc},
    round10Total: total10,
    finalScore: Math.ceil(total10)
  };
}

/* ------------------- Coefficient Systems ------------------- */
function coeffsByTier(tierKey) {
  const t = TIERS?.tiers?.[tierKey];
  if (!t) return {inf:1,cav:1,arc:1};

  return {
    inf: perTroopAttack(t.inf[0]) / BEAR_DEF_PER_TROOP / 100 * SKILLMOD_INF,
    cav: perTroopAttack(t.cav[0]) / BEAR_DEF_PER_TROOP / 100 * SKILLMOD_CAV,
    arc: perTroopAttack(t.arc[0]) / BEAR_DEF_PER_TROOP / 100 * SKILLMOD_ARC,
  };
}

function magicWeightsSquared(tierKey, mode) {
  const K = coeffsByTier(tierKey);
  const mult = (mode === "magic12") ? {inf:1,cav:1,arc:2} : {inf:1,cav:1,arc:1};
  return {
    wInf:(K.inf*mult.inf)**2,
    wCav:(K.cav*mult.cav)**2,
    wArc:(K.arc*mult.arc)**2
  };
}

/* ------------------- Magic Ratio Optimizer v2 ------------------- */
function planMagicAlloc(mode, stockIn, rallySize, X, cap, tierKey) {
  const s = cloneStock(stockIn);
  const R = Math.max(0,rallySize|0);
  const C = Math.max(0,cap|0);
  const Xn = Math.max(0,X|0);
  const T = R + Xn*C;

  const {wInf, wCav, wArc} = magicWeightsSquared(tierKey, mode);
  const sumW = Math.max(1e-9, wInf+wCav+wArc);

  const baseTarget = {
    inf: T*(wInf/sumW),
    cav: T*(wCav/sumW),
    arc: T*(wArc/sumW)
  };

  let target = {
    inf: Math.min(s.inf, Math.round(baseTarget.inf)),
    cav: Math.min(s.cav, Math.round(baseTarget.cav)),
    arc: Math.min(s.arc, Math.round(baseTarget.arc)),
  };

  let used = target.inf + target.cav + target.arc;
  let deficit = T - used;
  const prio = [["arc",wArc],["cav",wCav],["inf",wInf]].sort((a,b)=>b[1]-a[1]);

  while (deficit>0) {
    let progressed=false;
    for (const [k] of prio) {
      const free = s[k]-target[k];
      if (free<=0) continue;
      const give = Math.min(deficit, free);
      target[k]+=give;
      deficit-=give;
      progressed=true;
      if (deficit<=0) break;
    }
    if (!progressed) break;
  }

  const sumT = Math.max(1,target.inf+target.cav+target.arc);
  const frac = { i:target.inf/sumT, c:target.cav/sumT, a:target.arc/sumT };

  /* --- Build CALL --- */
  const rally = {
    inf:Math.min(s.inf, Math.round(frac.i*R)),
    cav:Math.min(s.cav, Math.round(frac.c*R)),
    arc:0
  };
  rally.arc = Math.min(s.arc, R-rally.inf-rally.cav);
  s.inf-=rally.inf; s.cav-=rally.cav; s.arc-=rally.arc;

  /* --- Build JOINS --- */
  const packs=[];
  for(let i=0;i<Xn;i++){
    if (C<=0){packs.push({inf:0,cav:0,arc:0});continue;}
    const m={
      inf:Math.min(s.inf,Math.round(frac.i*C)),
      cav:Math.min(s.cav,Math.round(frac.c*C)),
      arc:0
    };
    m.arc = Math.min(s.arc,C-m.inf-m.cav);
    s.inf-=m.inf; s.cav-=m.cav; s.arc-=m.arc;
    packs.push(m);
  }

  return {rally, packs, leftover:s, fractions:frac};
}

/* ------------------- 1:1 Ratio Simple Alloc ------------------- */
function buildCallRally(mode, stock, rallySize, tierKey, manual) {
  const s = cloneStock(stock);
  if (rallySize <= 0) return {rally:{inf:0,cav:0,arc:0}, stockAfter:s};

  const we = manual || (mode==="magic12"
    ? {i:1,c:1,a:2}
    : {i:1,c:1,a:1});

  const t = rallySize;
  const W = Math.max(1e-9, we.i+we.c+we.a);

  const target = {
    inf: Math.round((we.i/W)*t),
    cav: Math.round((we.c/W)*t),
    arc: t - Math.round((we.i/W)*t) - Math.round((we.c/W)*t)
  };

  const r = {
    inf:Math.min(s.inf,target.inf),
    cav:Math.min(s.cav,target.cav),
    arc:0
  };
  const leftoverArc = t - (r.inf + r.cav);
  r.arc = Math.min(s.arc, leftoverArc);

  s.inf-=r.inf; s.cav-=r.cav; s.arc-=r.arc;
  return { rally:r, stockAfter:s };
}

function buildJoinRallies(mode, stock, X, cap, tierKey, manualTriplet=null) {
  const s = cloneStock(stock);
  const we = manualTriplet || (mode==="magic12"
    ? {i:1,c:1,a:2}
    : {i:1,c:1,a:1});
  const W = Math.max(1e-9, we.i+we.c+we.a);

  const packs=[];
  for(let i=0;i<X;i++){
    let infT = Math.round((we.i/W)*cap);
    let cavT = Math.round((we.c/W)*cap);
    let arcT = cap - infT - cavT;

    const p = {
      inf:Math.min(s.inf,infT),
      cav:Math.min(s.cav,cavT),
      arc:0
    };
    const rem = cap - (p.inf+p.cav);
    p.arc = Math.min(s.arc,rem);

    s.inf-=p.inf; s.cav-=p.cav; s.arc-=p.arc;
    packs.push(p);
  }
  return {packs, leftover:s};
}

/* ------------------- Recommendation Engine ------------------- */
function meetsTargetFill(fill){return fill>=FILL_THRESHOLD;}

function evaluateMarchSet(packs, cap){
  const totals=packs.map(p=>sumTroops(p));
  const fills=totals.map(t=>cap>0?t/cap:0);
  const minFill=fills.length?Math.min(...fills):0;
  const avgFill=fills.length?(fills.reduce((a,b)=>a+b,0)/fills.length):0;
  const fullCount=fills.filter(f=>meetsTargetFill(f)).length;
  return {minFill,avgFill,fullCount};
}

function recommendMarchCount(mode,tierKey,rally,stockAfterCall,X,cap,manual){
  let best=null;
  for(let n=1;n<=X;n++){
    const sim=buildJoinRallies(mode,stockAfterCall,n,cap,tierKey,manual);
    const m=evaluateMarchSet(sim.packs,cap);
    const score=m.fullCount*1e9 + m.minFill*1e6 + m.avgFill*1e3 - sumTroops(sim.leftover);
    const c={marchCount:n,score,metrics:m};
    if(!best||score>best.score) best=c;
  }
  return best;
}

/* ------------------- Rendering ------------------- */
function renderCallTable(r){
  const tot=sumTroops(r);
  $("callRallyTable").innerHTML=`
    <table>
      <thead><tr><th>Type</th><th>Inf</th><th>Cav</th><th>Arc</th><th>Total</th></tr></thead>
      <tbody>
        <tr style="background:#162031;">
          <td><strong>CALL</strong></td>
          <td>${r.inf.toLocaleString()}</td>
          <td>${r.cav.toLocaleString()}</td>
          <td>${r.arc.toLocaleString()}</td>
          <td>${tot.toLocaleString()}</td>
        </tr>
      </tbody>
    </table>
  `;
}

function renderJoinTable(packs){
  let html=`
    <table>
      <thead><tr>
        <th>#</th><th>Inf</th><th>Cav</th><th>Arc</th><th>Total</th>
      </tr></thead><tbody>
  `;
  packs.forEach((p,i)=>{
    const tot=sumTroops(p);
    html+=`
      <tr>
        <td>#${i+1}</td>
        <td>${p.inf.toLocaleString()}</td>
        <td>${p.cav.toLocaleString()}</td>
        <td>${p.arc.toLocaleString()}</td>
        <td>${tot.toLocaleString()}</td>
      </tr>`;
  });
  html+=`</tbody></table>`;
  $("joinTableWrap").innerHTML=html;
}

function renderScoreboardCompact(callPack, joinPacks, tierKey){
  const callScore=computeFormationDamage(callPack,tierKey).finalScore;
  let joinScore=0;
  for(const p of joinPacks) joinScore+=computeFormationDamage(p,tierKey).finalScore;

  let html=`
    <table>
      <thead>
        <tr><th>Window</th><th>Call</th><th>Joins</th><th>Total</th></tr>
      </thead><tbody>
  `;
  for(let w=1;w<=WINDOWS;w++){
    html+=`
      <tr>
        <td>${w}</td>
        <td>${callScore.toLocaleString()}</td>
        <td>${joinScore.toLocaleString()}</td>
        <td>${(callScore+joinScore).toLocaleString()}</td>
      </tr>
    `;
  }
  html+=`</tbody></table>`;
  $("scoreboardTableWrap").innerHTML=html;
}

/* ------------------- MAIN LOOP ------------------- */
function compute(mode){
  const tierKey=$("troopTier").value;
  const t=TIERS?.tiers?.[tierKey];
  $("selectedTierNote").textContent =
    t? `Using tier ${tierKey} — Base ATK Inf/Cav/Arc = ${t.inf[0]}/${t.cav[0]}/${t.arc[0]}`:"";

  const stock0={inf:nval("stockInf"),cav:nval("stockCav"),arc:nval("stockArc")};
  const rallySize=nval("rallySize");
  const joinCap=nval("marchSize");
  const X=nval("numFormations");

  const parsed=parseTriplet($("compInput").value);
  const manual=parsed ? {i:parsed.i,c:parsed.c,a:parsed.a} : null;

  let rally, joins, leftover, fractions;

  if(mode==="magic12"){
    ({rally,packs:joins,leftover,fractions}=
      planMagicAlloc(mode,stock0,rallySize,X,joinCap,tierKey));
  } else {
    const c=buildCallRally(mode,stock0,rallySize,tierKey,manual);
    rally=c.rally;
    const j=buildJoinRallies(mode,c.stockAfter,X,joinCap,tierKey,manual);
    joins=j.packs;
    leftover=j.leftover;

    const tot=Math.max(1,sumTroops(rally));
    fractions={i:rally.inf/tot, c:rally.cav/tot, a:rally.arc/tot};
  }

  const best=recommendMarchCount(mode,tierKey,rally,cloneStock(stock0),X,joinCap,manual);
  window.__recommendedMarches=best?.marchCount || X;
  $("recommendedDisplay").textContent =
    `Best: ${window.__recommendedMarches} marches (min fill ${(best.metrics.minFill*100).toFixed(1)}%, avg ${(best.metrics.avgFill*100).toFixed(1)}%)`;

  renderCallTable(rally);
  renderJoinTable(joins);
  $("fractionReadout").textContent = `Using: ${toPctTriplet(fractions)} (Inf/Cav/Arc)`;

  const formed=joins.reduce((s,p)=>s+sumTroops(p),0);
  const before=sumTroops(stock0);
  const used=sumTroops(rally)+formed;

  $("inventoryReadout").textContent=
`Rally ${sumTroops(rally).toLocaleString()} used → INF ${rally.inf.toLocaleString()}, CAV ${rally.cav.toLocaleString()}, ARC ${rally.arc.toLocaleString()}.

Formations built: ${joins.length} × ${joinCap.toLocaleString()} → ${formed.toLocaleString()} troops.

Leftover → INF ${leftover.inf.toLocaleString()}, CAV ${leftover.cav.toLocaleString()}, ARC ${leftover.arc.toLocaleString()}.

Stock used: ${used.toLocaleString()} / ${before.toLocaleString()}.`;

  renderScoreboardCompact(rally, joins, tierKey);

  $("hiddenLastMode").value = mode;
  $("hiddenBestFractions").value = toPctTriplet(fractions);
}

/* ------------------- Wiring ------------------- */
function wire(){
  $("btnRatio11").addEventListener("click",()=>compute("ratio11"));
  $("btnMagic12").addEventListener("click",()=>compute("magic12"));
  $("btnRecompute").addEventListener("click",()=>{
    compute($("hiddenLastMode").value || "ratio11");
  });

  $("btnUseRecommended").addEventListener("click",()=>{
    if(window.__recommendedMarches){
      $("numFormations").value = window.__recommendedMarches;
      compute($("hiddenLastMode").value || "ratio11");
      const btn=$("btnUseRecommended");
      btn.classList.remove("pulse-recommended");
      void btn.offsetWidth;
      btn.classList.add("pulse-recommended");
    }
  });

  $("troopTier").addEventListener("change",()=>{
    compute($("hiddenLastMode").value || "ratio11");
  });

  $("compInput").addEventListener("input",()=>{
    const p=parseTriplet($("compInput").value);
    $("compHint").textContent= p
      ? `Manual override: ${toPctTriplet(p)}`
      : `Invalid or empty → auto`;
  });
}

/* ------------------- INIT ------------------- */
async function init(){
  try{
    const r=await fetch("tiers.json");
    TIERS=await r.json();
  } catch(e) {
    console.error("Failed to load tiers.json",e);
    TIERS={tiers:{}};
  }
  wire();
  compute("ratio11");
}

window.addEventListener("DOMContentLoaded",init);
