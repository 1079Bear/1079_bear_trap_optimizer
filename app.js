/**
 * FINAL — Option‑A multi‑formation builder
 * Includes Recommended March system
 */

/* ---------- Global Composition Bounds ---------- */
const INF_MIN_PCT = 0.075;
const INF_MAX_PCT = 0.10;
const CAV_MIN_PCT = 0.10;

/* ---------- Basic Helpers ---------- */
function num(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : 0;
}
function attackFactor(atk, leth) {
  return (1 + atk/100) * (1 + leth/100);
}
function normalizeTier(value) {
  return (value || "").replace(/–/g, "-");
}
function getArcherCoefByTier(tierRaw) {
  const tier = normalizeTier(tierRaw).toUpperCase();
  if (tier === "T1-T6") return 4.4/1.25;
  return 2.78/1.45;
}

/* ---------- Composition Bounds ---------- */
function enforceCompositionBounds(fin, fcav, farc) {
  let i = fin, c = fcav, a = farc;

  if (i < INF_MIN_PCT) i = INF_MIN_PCT;
  if (i > INF_MAX_PCT) i = INF_MAX_PCT;
  if (c < CAV_MIN_PCT) c = CAV_MIN_PCT;

  a = 1 - i - c;

  if (a < 0) {
    c = Math.max(CAV_MIN_PCT, 1 - i);
    a = 1 - i - c;
    if (a < 0) {
      a = 0;
      c = 1 - i;
    }
  }

  const S = i + c + a;
  if (S <= 0)
    return { fin: INF_MIN_PCT, fcav: CAV_MIN_PCT, farc: 1 - INF_MIN_PCT - CAV_MIN_PCT };

  return { fin: i/S, fcav: c/S, farc: a/S };
}

/* ---------- Closed-form optimal fractions ---------- */
function computeExactOptimalFractions(stats, tierRaw) {
  const Ainf = attackFactor(stats.inf_atk, stats.inf_let);
  const Acav = attackFactor(stats.cav_atk, stats.cav_let);
  const Aarc = attackFactor(stats.arc_atk, stats.arc_let);
  const KARC = getArcherCoefByTier(tierRaw);

  const alpha = Ainf / 1.12;
  const beta = Acav;
  const gamma = KARC * Aarc;

  const a2 = alpha*alpha, b2 = beta*beta, g2 = gamma*gamma;
  const sum = a2 + b2 + g2;

  return {
    fin: a2/sum,
    fcav: b2/sum,
    farc: g2/sum
  };
}

/* ---------- Plot Evaluation ---------- */
function evaluateForPlot(fin, fcav, farc, stats, tierRaw) {
  const Ainf = attackFactor(stats.inf_atk, stats.inf_let);
  const Acav = attackFactor(stats.cav_atk, stats.cav_let);
  const Aarc = attackFactor(stats.arc_atk, stats.arc_let);
  const KARC = getArcherCoefByTier(tierRaw);

  const termInf = (1/1.45) * Ainf * Math.sqrt(fin);
  const termCav = Acav * Math.sqrt(fcav);
  const termArc = KARC * Aarc * Math.sqrt(farc);

  return termInf + termCav + termArc;
}

/* ================================================================
   User-editable composition helpers
   ================================================================ */
let lastBestTriplet = { fin: INF_MIN_PCT, fcav: CAV_MIN_PCT, farc: 1-INF_MIN_PCT-CAV_MIN_PCT };
let compUserEdited = false;

function getCompEl() { return document.getElementById("compInput"); }
function getCompHintEl() { return document.getElementById("compHint"); }

function roundFractionsTo100(fin, fcav, farc) {
  const S = fin+fcav+farc;
  if (S <= 0) return { i:0, c:0, a:100 };

  const nf = fin/S, nc = fcav/S;
  let i = Math.round(nf*100);
  let c = Math.round(nc*100);
  let a = 100 - i - c;

  if (a < 0) {
    a = 0;
    if (i + c > 100) {
      const over = i + c - 100;
      if (i >= c) i -= over;
      else c -= over;
    }
  }
  return { i, c, a };
}

function formatTriplet(fin, fcav, farc) {
  const {i,c,a} = roundFractionsTo100(fin,fcav,farc);
  return `${i}/${c}/${a}`;
}

function parseCompToFractions(str) {
  if (typeof str !== "string") return null;
  const parts = str.replace(/%/g,"").trim()
    .split(/[/,\s]+/)
    .map(s=>s.trim())
    .filter(Boolean)
    .map(Number);

  if (parts.some(v=>!Number.isFinite(v)||v<0)) return null;
  if (parts.length === 0) return null;

  let i = parts[0] ?? 0;
  let c = parts[1] ?? 0;
  let a = parts.length >= 3 ? parts[2] : Math.max(0, 100 - (i+c));

  const sum = i+c+a;
  if (sum <= 0) return null;

  return { fin: i/sum, fcav: c/sum, farc: a/sum };
}

function setCompInputFromBest() {
  const el = getCompEl();
  if (!el) return;
  el.value = formatTriplet(lastBestTriplet.fin, lastBestTriplet.fcav, lastBestTriplet.farc);
  const hint = getCompHintEl();
  if (hint)
    hint.textContent = "Auto-filled from Best (bounded). Edit to override.";
}

function getFractionsForRally() {
  const el = getCompEl();
  const hint = getCompHintEl();
  if (!el) return lastBestTriplet;

  const parsed = parseCompToFractions(el.value);
  if (parsed) {
    const bounded = enforceCompositionBounds(parsed.fin,parsed.fcav,parsed.farc);
    const disp = formatTriplet(bounded.fin,bounded.fcav,bounded.farc);

    if (hint) {
      const orig = formatTriplet(parsed.fin,parsed.fcav,parsed.farc);
      hint.textContent = orig !== disp
        ? `Using (clamped): ${disp} · (Inf 7.5–10%, Cav ≥ 10%)`
        : `Using: ${disp}`;
    }
    return bounded;
  }
  else {
    if (hint) hint.textContent = "Invalid input → using Best (bounded).";
    return lastBestTriplet;
  }
}
/* ---------- Plot Rendering ---------- */
function computePlots() {
  const stats = {
    inf_atk: num("inf_atk"),
    inf_let: num("inf_let"),
    cav_atk: num("cav_atk"),
    cav_let: num("cav_let"),
    arc_atk: num("arc_atk"),
    arc_let: num("arc_let")
  };
  const tierRaw = document.getElementById("troopTier").value;

  const opt = computeExactOptimalFractions(stats, tierRaw);
  const bounded = enforceCompositionBounds(opt.fin, opt.fcav, opt.farc);
  lastBestTriplet = { fin: bounded.fin, fcav: bounded.fcav, farc: bounded.farc };

  if (!compUserEdited) setCompInputFromBest();

  const samples = [];
  const vals = [];
  const steps = 55;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps - i; j++) {
      const fin = i/steps;
      const fcav = j/steps;
      const farc = 1 - fin - fcav;
      const d = evaluateForPlot(fin, fcav, farc, stats, tierRaw);
      samples.push({ fin, fcav, farc, d });
      vals.push(d);
    }
  }
  const vmax = Math.max(...vals);
  const norm = vals.map(v => v/(vmax || 1));

  Plotly.newPlot("ternaryPlot", [
    {
      type: "scatterternary",
      mode: "markers",
      a: samples.map(s => s.fin),
      b: samples.map(s => s.fcav),
      c: samples.map(s => s.farc),
      marker: {
        size: 6,
        opacity: 0.95,
        color: norm,
        colorscale: "Plasma",
        reversescale: false,
        colorbar: { title:"Fraction of maximal damage", tickformat:".2f" }
      },
      hovertemplate:
        "Inf: %{a:.2f}<br>Cav: %{b:.2f}<br>Arc: %{c:.2f}<br>Rel: %{marker.color:.3f}<extra></extra>"
    },
    {
      type: "scatterternary",
      mode: "markers+text",
      a: [bounded.fin],
      b: [bounded.fcav],
      c: [bounded.farc],
      marker: { size:14, color:"#10b981" },
      text: ["Best*"],
      textposition: "top center",
      hovertemplate:
        "Best (bounded)<br>Inf: %{a:.2f}<br>Cav: %{b:.2f}<br>Arc: %{c:.2f}<extra></extra>"
    }
  ], {
    ternary: {
      aaxis: { title:"Infantry", min:0 },
      baxis: { title:"Cavalry",  min:0 },
      caxis: { title:"Archery",  min:0 },
      sum: 1,
      bgcolor: "#0f0f0f"
    },
    paper_bgcolor: "#111",
    plot_bgcolor: "#111",
    font: { color:"#fff" },
    margin: { l:10, r:10, b:10, t:10 },
    showlegend: false
  });

  document.getElementById("bestReadout").innerText =
    `Best composition (bounded) ≈ ${formatTriplet(bounded.fin,bounded.fcav,bounded.farc)} (Inf/Cav/Arc) · [Inf 7.5–10%, Cav ≥ 10%].`;

  updateRecommendedDisplay();
}

/* ---------- Rally Build ---------- */
function buildRally(fractions, rallySize, stock) {
  if (rallySize <= 0)
    return { inf:0, cav:0, arc:0 };

  const iMin = Math.ceil(INF_MIN_PCT * rallySize);
  const iMax = Math.floor(INF_MAX_PCT * rallySize);
  const cMin = Math.ceil(CAV_MIN_PCT * rallySize);

  let iTarget = Math.round(fractions.fin  * rallySize);
  let cTarget = Math.round(fractions.fcav * rallySize);

  iTarget = Math.min(Math.max(iTarget, iMin), iMax);
  if (cTarget < cMin) cTarget = cMin;

  let aTarget = rallySize - iTarget - cTarget;
  if (aTarget < 0) {
    cTarget = Math.max(cMin, rallySize - iTarget);
    aTarget = rallySize - iTarget - cTarget;
  }

  let i = Math.min(iTarget, stock.inf);
  let c = Math.min(cTarget, stock.cav);
  let a = Math.min(aTarget, stock.arc);

  let placed = i + c + a;
  let deficit = rallySize - placed;

  if (deficit > 0) {
    let give = Math.min(deficit, Math.max(0, stock.arc - a));
    a += give; deficit -= give;
  }
  if (deficit > 0) {
    let give = Math.min(deficit, Math.max(0, stock.cav - c));
    c += give; deficit -= give;
  }
  if (deficit > 0) {
    let canInf = Math.min(iMax, stock.inf) - i;
    let give = Math.min(deficit, Math.max(0, canInf));
    i += give; deficit -= give;
  }

  let surplus = (i+c+a) - rallySize;
  if (surplus > 0) {
    let take = Math.min(surplus, a);
    a -= take; surplus -= take;
  }
  if (surplus > 0) {
    let minC = Math.min(cMin, c);
    let take = Math.min(surplus, c - minC);
    c -= take; surplus -= take;
  }
  if (surplus > 0) {
    let minI = Math.min(iMin, i);
    let take = Math.min(surplus, i - minI);
    i -= take; surplus -= take;
  }

  stock.inf -= i;
  stock.cav -= c;
  stock.arc -= a;

  return { inf: i, cav: c, arc: a };
}

/* ---------- Round Robin ---------- */
function fillRoundRobin(total, caps) {
  const n = caps.length;
  const out = Array(n).fill(0);
  let t = Math.max(0, Math.floor(total));
  let progress = true;

  while (t > 0 && progress) {
    progress = false;
    for (let i=0; i<n && t>0; i++) {
      if (out[i] < caps[i]) {
        out[i] += 1;
        t -= 1;
        progress = true;
      }
    }
  }
  return out;
}

/* ---------- Option-A March Builder ---------- */
function buildOptionAFormations(stock, formations, cap) {
  const n = Math.max(1, formations);

  const infMinPer = Math.ceil(INF_MIN_PCT * cap);
  const infMaxPer = Math.floor(INF_MAX_PCT * cap);
  const cavMinPer = Math.ceil(CAV_MIN_PCT * cap);

  const infAlloc = Array(n).fill(0);
  const cavAlloc = Array(n).fill(0);
  const arcAlloc = Array(n).fill(0);

  for (let i=0; i<n; i++) {
    let free = cap;

    if (free > 0) {
      const giveInf = Math.min(infMinPer, stock.inf, free);
      infAlloc[i] += giveInf;
      stock.inf -= giveInf;
      free -= giveInf;
    }

    if (free > 0) {
      const giveCav = Math.min(cavMinPer, stock.cav, free);
      cavAlloc[i] += giveCav;
      stock.cav -= giveCav;
    }
  }

  const arcCaps = Array(n).fill(0).map((_,i)=>Math.max(0, cap - infAlloc[i] - cavAlloc[i]));
  const arcGive = fillRoundRobin(stock.arc, arcCaps);
  for (let i=0; i<n; i++) {
    arcAlloc[i] += arcGive[i];
    stock.arc -= arcGive[i];
  }

  const cavCaps = Array(n).fill(0)
    .map((_,i)=>Math.max(0, cap - infAlloc[i] - cavAlloc[i] - arcAlloc[i]));
  const cavGive = fillRoundRobin(stock.cav, cavCaps);
  for (let i=0; i<n; i++) {
    cavAlloc[i] += cavGive[i];
    stock.cav -= cavGive[i];
  }

  const infCaps = Array(n).fill(0).map((_,i)=>{
    const free = Math.max(0, cap - infAlloc[i] - cavAlloc[i] - arcAlloc[i]);
    const room = Math.max(0, infMaxPer - infAlloc[i]);
    return Math.min(free, room);
  });
  const infGive = fillRoundRobin(stock.inf, infCaps);
  for (let i=0; i<n; i++) {
    infAlloc[i] += infGive[i];
    stock.inf -= infGive[i];
  }

  const packs = [];
  for (let i=0; i<n; i++) {
    packs.push({
      inf: infAlloc[i],
      cav: cavAlloc[i],
      arc: arcAlloc[i]
    });
  }

  return { packs, leftover: { inf:stock.inf, cav:stock.cav, arc:stock.arc } };
}
/* ============================================================
   RECOMMENDED MARCH COUNT SYSTEM — Updated for 92.3% threshold
   ============================================================ */

// A march is "good" if it reaches at least 92.3% of cap
function meetsTargetFill(fill) {
    return fill >= 0.923;
}

function simulateMarchCount(marchCount, fractions, rallySize, joinCap, stockOriginal) {
  const stockAfterRally = { ...stockOriginal };
  const rally = buildRally(fractions, rallySize, stockAfterRally);

  const result = buildOptionAFormations({ ...stockAfterRally }, marchCount, joinCap);
  const { packs, leftover } = result;

  const totals = packs.map(p => p.inf + p.cav + p.arc);
  const fills  = totals.map(t => t / joinCap);

  const minFill   = totals.length ? Math.min(...fills) : 0;
  const avgFill   = totals.length ? fills.reduce((a,b)=>a+b, 0) / fills.length : 0;
  const fullCount = fills.filter(f => meetsTargetFill(f)).length;

  return {
    marchCount,
    minFill,
    avgFill,
    fullCount,
    leftover,
    score: computeRecommendationScore(fullCount, minFill, avgFill, leftover)
  };
}

// Scoring updated to use 92.3% threshold
function computeRecommendationScore(fullCount, minFill, avgFill, leftover) {
  const totalLeft  = leftover.inf + leftover.cav + leftover.arc;
  const cavPenalty = leftover.cav * 3;

  return (
    fullCount * 1e9 +           // # of acceptable-to-send marches
    (minFill * 0.923) * 1e6 +   // hitting threshold weighted
    avgFill * 1e3 -             // smoother distribution preferred
    (totalLeft + cavPenalty)    // penalize waste and cav excess
  );
}

function computeRecommendedMarches(maxMarches, fractions, rallySize, joinCap, stock) {
  const results = [];
  for (let n=1; n<=maxMarches; n++) {
    results.push(simulateMarchCount(n, fractions, rallySize, joinCap, stock));
  }
  results.sort((a,b)=>b.score - a.score);
  return results[0];
}

function updateRecommendedDisplay() {
  const recommendedEl = document.getElementById("recommendedDisplay");
  if (!recommendedEl) return;

  const fractions = getFractionsForRally();
  const rallySize = Math.max(0, Math.floor(num("rallySize")));
  const joinCap = Math.max(1, Math.floor(num("marchSize")));
  const maxMarches = Math.max(1, Math.floor(num("numFormations")));

  const stock = {
    inf: Math.max(0, Math.floor(num("stockInf"))),
    cav: Math.max(0, Math.floor(num("stockCav"))),
    arc: Math.max(0, Math.floor(num("stockArc")))
  };

  const best = computeRecommendedMarches(maxMarches, fractions, rallySize, joinCap, stock);

  // Detect changes (old -> new)
  const oldValue = window.__recommendedMarches;
  const newValue = best.marchCount;

  recommendedEl.textContent =
      `Best: ${newValue} marches (min fill ${(best.minFill*100).toFixed(1)}%)`;

  // Update global cache
  window.__recommendedMarches = newValue;

  // Pulse only when recommended value changed
  const btn = document.getElementById("btnUseRecommended");
  if (btn && oldValue !== undefined && oldValue !== newValue) {
      btn.classList.remove("pulse-recommended");      // reset if active
      void btn.offsetWidth;                           // force reflow to restart animation
      btn.classList.add("pulse-recommended");
  }
    // Pulse only when best value changed
  const btn2 = document.getElementById("btnUseBest");
  if (btn2 && oldValue !== undefined && oldValue !== newValue) {
      btn2.classList.remove("pulse-recommended");      // reset if active
      void btn2.offsetWidth;                           // force reflow to restart animation
      btn2.classList.add("pulse-recommended");
  }
}

/* ============================================================
   OPTION‑A OPTIMIZER HANDLER
   ============================================================ */

function onOptimize() {
  const stats = {
    inf_atk: num("inf_atk"),
    inf_let: num("inf_let"),
    cav_atk: num("cav_atk"),
    cav_let: num("cav_let"),
    arc_atk: num("arc_atk"),
    arc_let: num("arc_let")
  };
  const tierRaw = document.getElementById("troopTier").value;
  const opt = computeExactOptimalFractions(stats, tierRaw);
  const bounded = enforceCompositionBounds(opt.fin,opt.fcav,opt.farc);
  lastBestTriplet = { fin: bounded.fin, fcav: bounded.fcav, farc: bounded.farc };

  const usedFractions = getFractionsForRally();
  const usedDisp = formatTriplet(usedFractions.fin,usedFractions.fcav,usedFractions.farc);
  const bestDisp = formatTriplet(bounded.fin,bounded.fcav,bounded.farc);

  const fracEl = document.getElementById("fractionReadout");
  if (fracEl)
    fracEl.innerText =
      `Target fractions (bounded · Inf 7.5–10%, Cav ≥ 10%): ${usedDisp}   ·   Best: ${bestDisp}`;

  const stock = {
    inf: Math.max(0, Math.floor(num("stockInf"))),
    cav: Math.max(0, Math.floor(num("stockCav"))),
    arc: Math.max(0, Math.floor(num("stockArc")))
  };

  const cap = Math.max(1, Math.floor(num("marchSize")));
  const formations = Math.max(1, Math.floor(num("numFormations")));
  const rallySize = Math.max(0, Math.floor(num("rallySize")));

  const totalAvailBefore = stock.inf + stock.cav + stock.arc;

  const rally = buildRally(usedFractions, rallySize, stock);
  const rallyTotal = rally.inf + rally.cav + rally.arc;

  const { packs, leftover } = buildOptionAFormations({ ...stock }, formations, cap);

  let html = `<table><thead>
  <tr>
      <th>Type</th>
      <th>Infantry</th>
      <th>Cavalry</th>
      <th>Archers</th>
      <th>Total</th>
  </tr>
  </thead><tbody>`;

  if (rallySize > 0) {
    html += `<tr style="background:#162031;">
        <td><strong>CALL RALLY</strong></td>
        <td>${rally.inf.toLocaleString()}</td>
        <td>${rally.cav.toLocaleString()}</td>
        <td>${rally.arc.toLocaleString()}</td>
        <td>${rallyTotal.toLocaleString()}</td>
    </tr>`;
  }

  packs.forEach((p, idx) => {
    const tot = p.inf + p.cav + p.arc;
    html += `<tr><td>#${idx+1}</td>
      <td>${p.inf.toLocaleString()}</td>
      <td>${p.cav.toLocaleString()}</td>
      <td>${p.arc.toLocaleString()}</td>
      <td>${tot.toLocaleString()}</td></tr>`;
  });

  html += `</tbody></table>`;
  const tableEl = document.getElementById("optTableWrap");
  if (tableEl) tableEl.innerHTML = html;

  const formedTroops = packs.reduce((s,p)=>s+p.inf+p.cav+p.arc, 0);
  const totalUsed = (totalAvailBefore - (leftover.inf+leftover.cav+leftover.arc));

  const msgParts = [];
  if (rallySize > 0) {
    msgParts.push(
      `Rally used → INF ${rally.inf.toLocaleString()}, ` +
      `CAV ${rally.cav.toLocaleString()}, ` +
      `ARC ${rally.arc.toLocaleString()} ` +
      `(total ${rallyTotal.toLocaleString()}).`
    );
  } else {
    msgParts.push(`Rally not built (set "Call rally size" to consume troops first).`);
  }

  msgParts.push(
    `Formations built: ${packs.length} × cap ${cap.toLocaleString()} ` +
    `(troops placed: ${formedTroops.toLocaleString()}).`
  );

  msgParts.push(
    `Leftover → INF ${leftover.inf.toLocaleString()}, ` +
    `CAV ${leftover.cav.toLocaleString()}, ARC ${leftover.arc.toLocaleString()}.`
  );

  msgParts.push(
    `Stock used: ${totalUsed.toLocaleString()} of ${totalAvailBefore.toLocaleString()}.`
  );

  const invEl = document.getElementById("inventoryReadout");
  if (invEl) {
    invEl.style.whiteSpace = "pre-line";
    invEl.innerText = msgParts.join("\n\n");
  }

  updateRecommendedDisplay();
}

/* ============================================================
   UI WIRING
   ============================================================ */

function wireUp() {
  const btnPlot = document.getElementById("btnPlot");
  if (btnPlot)
    btnPlot.addEventListener("click", () => {
      computePlots();
      onOptimize();
    });

  const btnOpt = document.getElementById("btnOptimize");
  if (btnOpt)
    btnOpt.addEventListener("click", onOptimize);

  const compEl = getCompEl();
  if (compEl) {
    compEl.addEventListener("input", () => {
      compUserEdited = true;
      onOptimize();
    });
  }

  const btnBest = document.getElementById("btnUseBest");
  if (btnBest) {
    btnBest.addEventListener("click", () => {
      compUserEdited = false;
      setCompInputFromBest();
      onOptimize();
    });
  }

  const btnUseRecommended = document.getElementById("btnUseRecommended");
  if (btnUseRecommended) {
    btnUseRecommended.addEventListener("click", () => {
      if (window.__recommendedMarches) {
        document.getElementById("numFormations").value = window.__recommendedMarches;
        onOptimize();
        updateRecommendedDisplay();
      }
    });
  }

  computePlots();
  onOptimize();
  updateRecommendedDisplay();
}

window.addEventListener("DOMContentLoaded", wireUp);