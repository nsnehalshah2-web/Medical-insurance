(() => {
  "use strict";

  const D = window.INSURANCE_MODEL;
  if (!D || !window.createInsurancePredictor) {
    document.querySelector("main").insertAdjacentHTML("afterbegin",
      '<p class="container" style="padding:24px;color:#b91c1c">Model data not found. Run <code>python -m src.export_web</code> to generate docs/data/model.js.</p>');
    return;
  }
  const model = window.createInsurancePredictor(D.model);
  const predict = (p) => model.predict(p);

  const money = (v) => "$" + Math.round(v).toLocaleString("en-US");
  const fmt = (n, d = 0) => Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
  const pct = (x) => `${Math.round(x * 100)}%`;
  const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const $ = (id) => document.getElementById(id);

  // dataset rows as objects, with the model's prediction for each
  const people = D.people.map((r) => Object.fromEntries(D.people_columns.map((c, i) => [c, r[i]])));
  people.forEach((p) => { p.predicted = predict(p); });
  const sortedCharges = people.map((p) => p.charges).sort((a, b) => a - b);
  const percentileOf = (v) => {
    let lo = 0, hi = sortedCharges.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedCharges[mid] < v) lo = mid + 1; else hi = mid; }
    return lo / sortedCharges.length;
  };

  /* ---------- state ---------- */
  const LIMITS = { age: D.ranges.age, bmi: [15, 54], children: D.ranges.children };
  const state = { age: 35, sex: "female", bmi: 27, children: 1, smoker: "no", region: "southeast" };
  const clamp = (v, [lo, hi], step = 1) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, Math.round(n / step) * step));
  };

  /* ---------- hero stats ---------- */
  function renderStats() {
    const t = D.metrics.test, b = D.metrics.baseline_test;
    const items = [
      ["🎯", fmt(t.r2, 2), "R² accuracy on unseen people"],
      ["💵", `±${money(t.mae)}`, "average error per estimate"],
      ["📉", pct(1 - t.mae / b.mae), "lower error than a linear baseline"],
      ["🔒", "Private", "runs entirely in your browser"],
    ];
    $("stats").innerHTML = items.map(([ic, v, t2]) => `<li><span class="ic" aria-hidden="true">${ic}</span><div><strong>${v}</strong><span class="t">${t2}</span></div></li>`).join("");
  }

  /* ---------- form ---------- */
  const PRESETS = [
    { label: "Young non-smoker", p: { age: 25, sex: "female", bmi: 22.5, children: 0, smoker: "no", region: "northwest" } },
    { label: "Family of four", p: { age: 40, sex: "male", bmi: 28, children: 2, smoker: "no", region: "southeast" } },
    { label: "Smoker, healthy BMI", p: { age: 45, sex: "male", bmi: 24, children: 1, smoker: "yes", region: "northeast" } },
    { label: "Smoker, obese", p: { age: 50, sex: "female", bmi: 34, children: 2, smoker: "yes", region: "southeast" } },
  ];
  const RADIOS = ["sex", "smoker", "region"];

  function setPerson(changes) {
    Object.assign(state, changes);
    state.age = clamp(state.age, LIMITS.age);
    state.bmi = clamp(state.bmi, LIMITS.bmi, 0.1);
    state.bmi = Math.round(state.bmi * 10) / 10;
    state.children = clamp(state.children, LIMITS.children);
    syncForm();
    update();
  }

  function syncForm() {
    $("age").value = $("age-num").value = state.age;
    $("bmi").value = $("bmi-num").value = state.bmi;
    $("kids-out").textContent = state.children;
    $("kids-minus").disabled = state.children <= LIMITS.children[0];
    $("kids-plus").disabled = state.children >= LIMITS.children[1];
    for (const name of RADIOS) {
      document.querySelectorAll(`input[name="${name}"]`).forEach((r) => { r.checked = r.value === state[name]; });
    }
    const cat = model.bmiCategory(state.bmi);
    const chip = $("bmi-chip");
    chip.textContent = cat;
    chip.className = `bmi-chip ${cat}`;
  }

  function bindForm() {
    $("age").addEventListener("input", (e) => setPerson({ age: e.target.value }));
    $("age-num").addEventListener("change", (e) => setPerson({ age: e.target.value }));
    $("bmi").addEventListener("input", (e) => setPerson({ bmi: e.target.value }));
    $("bmi-num").addEventListener("change", (e) => setPerson({ bmi: e.target.value }));
    $("kids-minus").addEventListener("click", () => setPerson({ children: state.children - 1 }));
    $("kids-plus").addEventListener("click", () => setPerson({ children: state.children + 1 }));
    for (const name of RADIOS) {
      document.querySelectorAll(`input[name="${name}"]`).forEach((r) => r.addEventListener("change", () => setPerson({ [name]: r.value })));
    }
    const presets = document.querySelector(".presets");
    for (const { label, p } of PRESETS) {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "chip", textContent: label });
      b.addEventListener("click", () => { setPerson({ ...p }); showStep(2); });
      presets.append(b);
    }
    bindBmiCalculator();
  }

  /* ---------- step-by-step quote ---------- */
  let step = 0;
  const STEP_COUNT = 3;
  function showStep(n) {
    step = Math.max(0, Math.min(STEP_COUNT - 1, n));
    document.querySelectorAll(".step").forEach((el) => { el.hidden = Number(el.dataset.step) !== step; });
    document.querySelectorAll("#stepper-nav button").forEach((b) => {
      const i = Number(b.dataset.goto);
      b.classList.toggle("done", i < step);
      if (i === step) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
    });
    $("step-back").disabled = step === 0;
    $("step-next").textContent = step === STEP_COUNT - 1 ? "See what changes your cost ↓" : "Continue →";
  }
  function bindSteps() {
    document.querySelectorAll("#stepper-nav button").forEach((b) => b.addEventListener("click", () => showStep(Number(b.dataset.goto))));
    $("step-back").addEventListener("click", () => showStep(step - 1));
    $("step-next").addEventListener("click", () => {
      if (step < STEP_COUNT - 1) showStep(step + 1);
      else $("change-title").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
    showStep(0);
  }

  function bindBmiCalculator() {
    const h = $("height-cm"), w = $("weight-kg"), out = $("bmi-calc-out");
    const calc = () => {
      const hm = Number(h.value) / 100, kg = Number(w.value);
      if (!(hm >= 1.2 && hm <= 2.2 && kg >= 30 && kg <= 250)) { out.textContent = "Enter a height of 120–220 cm and a weight of 30–250 kg."; return null; }
      const bmi = Math.round((kg / (hm * hm)) * 10) / 10;
      out.textContent = `Your BMI is ${bmi} (${model.bmiCategory(bmi)}).` + (bmi < LIMITS.bmi[0] || bmi > LIMITS.bmi[1] ? ` The model accepts ${LIMITS.bmi[0]}–${LIMITS.bmi[1]}, so it will use the nearest value.` : "");
      return bmi;
    };
    h.addEventListener("input", calc);
    w.addEventListener("input", calc);
    $("bmi-apply").addEventListener("click", () => {
      const bmi = calc();
      if (bmi !== null) setPerson({ bmi });
    });
  }

  /* ---------- prediction ---------- */
  function whatIfs() {
    const base = predict(state);
    const items = [];
    const add = (icon, label, desc, changes) => {
      const value = predict({ ...state, ...changes });
      items.push({ icon, label, desc, value, delta: value - base });
    };
    if (state.smoker === "yes") add("🚭", "If you quit smoking", "Same profile as a non-smoker", { smoker: "no" });
    else add("🚬", "If you smoked", "Same profile as a smoker", { smoker: "yes" });
    if (state.bmi >= 25) add("⚖️", "Reach a healthy BMI", `BMI ${state.bmi} → 24.9`, { bmi: 24.9 });
    else if (state.bmi < 18.5) add("⚖️", "Reach a healthy BMI", `BMI ${state.bmi} → 22`, { bmi: 22 });
    if (state.smoker === "yes" && state.bmi < 30) add("⚠️", "If your BMI reached 30", `BMI ${state.bmi} → 30 (obese)`, { bmi: 30 });
    if (state.age <= LIMITS.age[1] - 10) add("🎂", "In 10 years", `Age ${state.age} → ${state.age + 10}`, { age: state.age + 10 });
    if (state.children < LIMITS.children[1]) add("👶", "One more child", `${state.children} → ${state.children + 1} children`, { children: state.children + 1 });
    return items.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 4);
  }

  function renderPrediction() {
    const value = predict(state);
    const band = D.error_bands_80[state.smoker];
    $("pred-value").textContent = money(value);
    $("sticky-value").textContent = `${money(value)}/yr`;
    $("pred-month").textContent = `≈ ${money(value / 12)} per month`;
    $("pred-range").textContent = `${money(Math.max(0, value - band))} – ${money(value + band)}`;
    $("pred-range").parentElement.title = `In testing, 8 in 10 predictions for ${state.smoker === "yes" ? "smokers" : "non-smokers"} were within ±${money(band)} of the actual charges.`;
    const p = percentileOf(value);
    $("pred-pct").textContent = `Costlier than ${pct(p)}`;
    $("pct-marker").style.left = `${p * 100}%`;

    $("whatif").innerHTML = whatIfs().map((w) => {
      const flat = Math.abs(w.delta) < 50;
      const dir = flat ? "flat" : w.delta < 0 ? "down" : "up";
      const badge = flat ? "≈ no change" : `${w.delta < 0 ? "−" : "+"}${money(Math.abs(w.delta))} /yr`;
      return `<li><span class="wi-icon" aria-hidden="true">${w.icon}</span><span class="wi-label">${w.label}</span><span class="wi-new">${w.desc} · new estimate ${money(w.value)}</span><span class="delta ${dir}">${badge}</span></li>`;
    }).join("");
  }

  function bindChrome() {
    const header = document.querySelector(".site-header");
    const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    // phones: keep the estimate visible once the estimate card scrolls away
    const sticky = $("sticky-estimate");
    new IntersectionObserver(([e]) => sticky.classList.toggle("show", !e.isIntersecting && e.boundingClientRect.top < 0))
      .observe(document.querySelector(".estimate-card"));
  }

  /* ---------- people chart ---------- */
  const W = 720, H = 420, PAD = { l: 64, r: 16, t: 14, b: 44 };
  const Y_MAX = 65000;
  const X_DOMAINS = { age: [16, 66], bmi: [14, 56] };
  let xKey = "age";
  const sx = (v) => PAD.l + ((v - X_DOMAINS[xKey][0]) / (X_DOMAINS[xKey][1] - X_DOMAINS[xKey][0])) * (W - PAD.l - PAD.r);
  const sy = (v) => H - PAD.b - (v / Y_MAX) * (H - PAD.t - PAD.b);
  const chart = $("people-chart");
  const tooltip = $("tooltip");
  let axesG, dotsG, youG;

  function buildPeopleChart() {
    chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
    axesG = svgEl("g"); dotsG = svgEl("g"); youG = svgEl("g", { "aria-hidden": "true" });
    chart.append(axesG, dotsG, youG);
    people.forEach((p, i) => {
      const c = svgEl("circle", { class: `pp ${p.smoker === "yes" ? "s" : "n"}`, r: 3.6, "data-i": i });
      dotsG.append(c);
    });
    youG.innerHTML = `<circle class="pulse" r="8"/><circle class="you-ring" r="11"/><circle class="you-dot" r="6.5"/><text class="you-label" dy="-17" text-anchor="middle">You</text>`;

    dotsG.addEventListener("mouseover", (e) => {
      const i = e.target.dataset?.i;
      if (i === undefined) return;
      const p = people[i];
      tooltip.innerHTML = `<strong>${money(p.charges)} actual</strong>Model predicts ${money(p.predicted)}<br>${p.sex}, age ${p.age}, BMI ${p.bmi}<br>${p.smoker === "yes" ? "Smoker" : "Non-smoker"}, ${p.children} child${p.children === 1 ? "" : "ren"}, ${p.region}<br><em style="opacity:.75">Click to load this profile</em>`;
      const box = chart.getBoundingClientRect(), wrap = chart.parentElement.getBoundingClientRect(), k = box.width / W;
      tooltip.style.left = `${box.left - wrap.left + e.target.cx.baseVal.value * k}px`;
      tooltip.style.top = `${box.top - wrap.top + e.target.cy.baseVal.value * k}px`;
      tooltip.hidden = false;
    });
    dotsG.addEventListener("mouseout", () => { tooltip.hidden = true; });
    dotsG.addEventListener("click", (e) => {
      const i = e.target.dataset?.i;
      if (i === undefined) return;
      const { age, sex, bmi, children, smoker, region } = people[i];
      setPerson({ age, sex, bmi, children, smoker, region });
    });
    document.querySelectorAll('input[name="xaxis"]').forEach((r) => r.addEventListener("change", () => { xKey = r.value; drawPeopleChart(); renderYou(); }));
  }

  function drawPeopleChart() {
    const [x0, x1] = X_DOMAINS[xKey];
    let out = "";
    for (let v = 0; v <= Y_MAX; v += 10000) {
      out += `<line class="grid-line" x1="${PAD.l}" x2="${W - PAD.r}" y1="${sy(v)}" y2="${sy(v)}"/><text class="axis-label" x="${PAD.l - 8}" y="${sy(v) + 4}" text-anchor="end">$${v / 1000}k</text>`;
    }
    const step = xKey === "age" ? 10 : 5;
    for (let v = Math.ceil(x0 / step) * step; v <= x1; v += step) {
      out += `<line class="grid-line" x1="${sx(v)}" x2="${sx(v)}" y1="${PAD.t}" y2="${H - PAD.b}"/><text class="axis-label" x="${sx(v)}" y="${H - PAD.b + 18}" text-anchor="middle">${v}</text>`;
    }
    if (xKey === "bmi") out += `<line x1="${sx(30)}" x2="${sx(30)}" y1="${PAD.t}" y2="${H - PAD.b}" stroke="var(--axis)" stroke-dasharray="4 4"/><text class="axis-label" x="${sx(30) + 6}" y="${PAD.t + 12}">BMI 30 (obese)</text>`;
    out += `<line class="axis-line" x1="${PAD.l}" x2="${W - PAD.r}" y1="${H - PAD.b}" y2="${H - PAD.b}"/>`;
    out += `<text class="axis-title" x="${(PAD.l + W - PAD.r) / 2}" y="${H - 6}" text-anchor="middle">${xKey === "age" ? "Age (years)" : "BMI (kg/m²)"}</text>`;
    out += `<text class="axis-title" x="${-(PAD.t + H - PAD.b) / 2}" y="14" transform="rotate(-90)" text-anchor="middle">Annual charges</text>`;
    axesG.innerHTML = out;
    dotsG.querySelectorAll("circle").forEach((c) => {
      const p = people[c.dataset.i];
      c.setAttribute("cx", sx(p[xKey]));
      c.setAttribute("cy", sy(Math.min(p.charges, Y_MAX)));
    });
  }

  function renderYou() {
    const x = sx(state[xKey]), y = sy(Math.min(predict(state), Y_MAX));
    for (const c of youG.children) {
      c.setAttribute(c.tagName === "text" ? "x" : "cx", x);
      c.setAttribute(c.tagName === "text" ? "y" : "cy", y);
    }
  }

  /* ---------- what-if explorer ---------- */
  const FACTORS = [
    { key: "age", label: "Age", type: "num", range: [18, 64], step: 1, unit: "" },
    { key: "bmi", label: "BMI", type: "num", range: [16, 53], step: 0.1, unit: "" },
    { key: "smoker", label: "Smoking", type: "cat", values: ["no", "yes"], names: ["Non-smoker", "Smoker"] },
    { key: "children", label: "Children", type: "cat", values: [0, 1, 2, 3, 4, 5], names: ["0", "1", "2", "3", "4", "5"] },
    { key: "region", label: "Region", type: "cat", values: D.categories.region, names: ["Northeast", "Northwest", "Southeast", "Southwest"] },
    { key: "sex", label: "Sex", type: "cat", values: ["female", "male"], names: ["Female", "Male"] },
  ];
  let factor = FACTORS[1];
  const EW = 720, EH = 320, EP = { l: 64, r: 18, t: 20, b: 40 };

  function bindExplorer() {
    const tabs = $("factor-tabs");
    for (const f of FACTORS) {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "tab", textContent: f.label });
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(f === factor));
      b.addEventListener("click", () => {
        factor = f;
        tabs.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t === b)));
        renderExplorer();
      });
      tabs.append(b);
    }
    $("explorer-chart").setAttribute("viewBox", `0 0 ${EW} ${EH}`);
  }

  function renderExplorer() {
    const svg = $("explorer-chart");
    const f = factor;
    const current = predict(state);
    let pts;
    if (f.type === "num") {
      pts = [];
      for (let v = f.range[0]; v <= f.range[1] + 1e-9; v += f.step) {
        const val = Math.round(v * 10) / 10;
        pts.push({ v: val, y: predict({ ...state, [f.key]: val }) });
      }
    } else {
      pts = f.values.map((v, i) => ({ v, name: f.names[i], y: predict({ ...state, [f.key]: v }) }));
    }
    const ys = pts.map((p) => p.y);
    const yMax = Math.max(...ys, current) * 1.12;
    const Y = (v) => EH - EP.b - (v / yMax) * (EH - EP.t - EP.b);
    const tick = yMax > 40000 ? 10000 : yMax > 15000 ? 5000 : 2000;
    let out = "";
    for (let v = 0; v <= yMax; v += tick) out += `<line class="grid-line" x1="${EP.l}" x2="${EW - EP.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis-label" x="${EP.l - 8}" y="${Y(v) + 4}" text-anchor="end">$${fmt(v / 1000)}k</text>`;
    out += `<line class="axis-line" x1="${EP.l}" x2="${EW - EP.r}" y1="${EH - EP.b}" y2="${EH - EP.b}"/>`;

    if (f.type === "num") {
      const X = (v) => EP.l + ((v - f.range[0]) / (f.range[1] - f.range[0])) * (EW - EP.l - EP.r);
      const step = f.key === "age" ? 5 : 5;
      for (let v = Math.ceil(f.range[0] / step) * step; v <= f.range[1]; v += step) out += `<text class="axis-label" x="${X(v)}" y="${EH - EP.b + 18}" text-anchor="middle">${v}</text>`;
      if (f.key === "bmi") out += `<line x1="${X(30)}" x2="${X(30)}" y1="${EP.t}" y2="${EH - EP.b}" stroke="var(--axis)" stroke-dasharray="4 4"/><text class="axis-label" x="${X(30) + 6}" y="${EP.t + 10}">obese ≥ 30</text>`;
      const line = pts.map((p) => `${X(p.v)},${Y(p.y)}`).join(" ");
      out += `<polygon class="curve-area" points="${X(pts[0].v)},${Y(0)} ${line} ${X(pts[pts.length - 1].v)},${Y(0)}"/>`;
      out += `<polyline class="curve" points="${line}"/>`;
      const cx = X(Math.min(Math.max(state[f.key], f.range[0]), f.range[1]));
      out += `<line x1="${cx}" x2="${cx}" y1="${Y(current)}" y2="${EH - EP.b}" stroke="var(--text)" stroke-dasharray="3 3" opacity=".5"/>`;
      out += `<circle class="you-ring" cx="${cx}" cy="${Y(current)}" r="10"/><circle class="you-dot" cx="${cx}" cy="${Y(current)}" r="6"/>`;
      out += `<text class="you-label" x="${cx}" y="${Y(current) - 16}" text-anchor="middle">${money(current)}</text>`;
      out += `<text class="axis-title" x="${(EP.l + EW - EP.r) / 2}" y="${EH - 4}" text-anchor="middle">${f.label}</text>`;
    } else {
      const slot = (EW - EP.l - EP.r) / pts.length;
      const bw = Math.min(90, slot * 0.6);
      pts.forEach((p, i) => {
        const x = EP.l + slot * i + (slot - bw) / 2;
        const isCur = String(state[f.key]) === String(p.v);
        out += `<rect class="bar-rect${isCur ? " current" : ""}" x="${x}" y="${Y(p.y)}" width="${bw}" height="${Y(0) - Y(p.y)}" rx="6"/>`;
        out += `<text class="bar-value" x="${x + bw / 2}" y="${Y(p.y) - 8}" text-anchor="middle">${money(p.y)}</text>`;
        out += `<text class="axis-label" x="${x + bw / 2}" y="${EH - EP.b + 18}" text-anchor="middle">${p.name}${isCur ? " (now)" : ""}</text>`;
      });
    }
    svg.innerHTML = out;

    const lo = Math.min(...ys), hi = Math.max(...ys);
    const at = (v) => predict({ ...state, [f.key]: v });
    let insight;
    if (f.key === "smoker") insight = `For this profile, smoking multiplies the predicted cost by ${fmt(at("yes") / at("no"), 1)}× (${money(at("no"))} → ${money(at("yes"))}).`;
    else if (f.key === "bmi") {
      // locate the steepest rise on the curve itself rather than assuming where it is
      let j = 1;
      for (let i = 1; i < pts.length; i++) if (pts[i].y - pts[i - 1].y > pts[j].y - pts[j - 1].y) j = i;
      const span = pts.slice(Math.max(0, j - 10), Math.min(pts.length, j + 11));
      const rise = span[span.length - 1].y - span[0].y;
      insight = state.smoker === "yes"
        ? `For a smoker, the predicted cost jumps by ${money(rise)} between BMI ${span[0].v} and ${span[span.length - 1].v}${Math.abs(pts[j].v - 30) <= 1 ? ", right at the obesity threshold of 30" : ""}.`
        : `For a non-smoker, BMI matters little: across the whole range the prediction moves by only ${money(hi - lo)}.`;
    } else if (f.key === "age") insight = `Cost rises steadily with age: ${money(at(18))} at 18 to ${money(at(64))} at 64, about ${money((at(64) - at(18)) / 46)} more per year of age.`;
    else if (f.key === "children") insight = `The number of children changes the prediction by at most ${money(hi - lo)}.`;
    else insight = `${f.label} changes the prediction by at most ${money(hi - lo)}, small compared with smoking, age or BMI.`;
    $("explorer-insight").textContent = insight;
    $("explorer-stats").innerHTML = [
      ["Now", money(current)], ["Lowest in range", money(lo)], ["Highest in range", money(hi)],
    ].map(([k, v]) => `<div class="metric"><span>${k}</span><strong>${v}</strong></div>`).join("");
  }

  /* ---------- batch predictions ---------- */
  const HEADER_ALIASES = {
    age: ["age"], sex: ["sex", "gender"], bmi: ["bmi", "bodymassindex"], children: ["children", "kids", "dependents", "child"],
    smoker: ["smoker", "smoking", "smokes"], region: ["region"], charges: ["charges", "charge", "actualcharges", "cost"],
  };
  const MAX_ROWS = 200000, PREVIEW_ROWS = 100;
  let batchOutput = null;

  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const nl = text.indexOf("\n");
    const first = nl === -1 ? text : text.slice(0, nl);
    const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delim) { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((v) => v.trim() !== ""));
  }
  const csvCell = (v) => (/[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const toCSV = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

  const norm = {
    sex: (v) => ({ male: "male", m: "male", female: "female", f: "female" })[v.toLowerCase()],
    smoker: (v) => ({ yes: "yes", y: "yes", true: "yes", 1: "yes", no: "no", n: "no", false: "no", 0: "no" })[v.toLowerCase()],
    region: (v) => { const r = v.toLowerCase().replace(/[\s_-]/g, ""); return D.categories.region.includes(r) ? r : undefined; },
  };

  function scoreRows(rows) {
    const header = rows[0].map((h) => h.trim());
    const key = (h) => h.toLowerCase().replace(/[^a-z]/g, "");
    const col = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([k, al]) => [k, header.findIndex((h) => al.includes(key(h)))]));
    const missing = ["age", "sex", "bmi", "children", "smoker", "region"].filter((k) => col[k] < 0);
    if (missing.length) throw new Error(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Columns found: ${header.join(", ") || "(none)"}.`);
    if (rows.length - 1 > MAX_ROWS) throw new Error(`The file has ${fmt(rows.length - 1)} rows. The limit is ${fmt(MAX_ROWS)}.`);

    const [aLo, aHi] = D.ranges.age, [bLo, bHi] = D.ranges.bmi, [, cHi] = D.ranges.children;
    return {
      header, hasCharges: col.charges >= 0,
      results: rows.slice(1).map((r, idx) => {
        const line = idx + 2;
        const cell = (k) => String(r[col[k]] ?? "").trim();
        const age = Number(cell("age")), bmi = Number(cell("bmi")), children = Number(cell("children"));
        const sex = norm.sex(cell("sex")), smoker = norm.smoker(cell("smoker")), region = norm.region(cell("region"));
        const bad = (msg) => ({ raw: r, line, error: msg });
        if (!cell("age") || !Number.isFinite(age) || age < 0 || age > 120) return bad(`age "${cell("age")}" is not valid`);
        if (!cell("bmi") || !Number.isFinite(bmi) || bmi < 10 || bmi > 80) return bad(`BMI "${cell("bmi")}" is not valid`);
        if (!cell("children") || !Number.isInteger(children) || children < 0 || children > 20) return bad(`children "${cell("children")}" must be a whole number`);
        if (!sex) return bad(`sex "${cell("sex")}" must be male or female`);
        if (!smoker) return bad(`smoker "${cell("smoker")}" must be yes or no`);
        if (!region) return bad(`region "${cell("region")}" must be northeast, northwest, southeast or southwest`);
        const person = { age, sex, bmi, children, smoker, region };
        const notes = [];
        if (age < aLo || age > aHi) notes.push(`age outside training range (${aLo}-${aHi})`);
        if (bmi < bLo || bmi > bHi) notes.push(`BMI outside training range (${bLo}-${bHi})`);
        if (children > cHi) notes.push(`more children than in training data (max ${cHi})`);
        const actual = col.charges >= 0 && cell("charges") !== "" ? Number(cell("charges")) : NaN;
        return { raw: r, line, person, pred: predict(person), actual, note: notes.join("; ") };
      }),
    };
  }

  function showBatchError(msg) {
    $("batch-error").textContent = msg;
    $("batch-error").hidden = false;
    $("batch-results").hidden = true;
  }

  function runBatch(text, fileName, isSample = false) {
    $("batch-error").hidden = true;
    try {
      const rows = parseCSV(text);
      if (rows.length < 2) throw new Error("The file has no data rows.");
      const res = scoreRows(rows);
      if (!res.results.some((r) => !r.error)) throw new Error("No rows could be priced. Check the values in each column.");
      renderBatch(res, fileName, isSample);
    } catch (e) { showBatchError(e.message); }
  }

  function renderBatch({ header, hasCharges, results }, fileName, isSample) {
    const ok = results.filter((r) => !r.error), skipped = results.filter((r) => r.error);
    const total = ok.reduce((s, r) => s + r.pred, 0);
    const smokers = ok.filter((r) => r.person.smoker === "yes");
    const flagged = ok.filter((r) => r.note).length;
    $("batch-file").textContent = fileName;
    $("batch-summary").textContent = `${fmt(ok.length)} ${ok.length === 1 ? "person" : "people"} priced`;

    const kpis = [
      ["Total predicted charges", money(total)],
      ["Average per person", money(total / ok.length)],
      ["Smokers", `${fmt(smokers.length)} (${pct(smokers.length / ok.length)})`],
    ];
    const withActual = ok.filter((r) => Number.isFinite(r.actual));
    const accNote = $("batch-accuracy-note");
    accNote.hidden = true;
    if (hasCharges && withActual.length) {
      const mae = withActual.reduce((s, r) => s + Math.abs(r.actual - r.pred), 0) / withActual.length;
      const mean = withActual.reduce((s, r) => s + r.actual, 0) / withActual.length;
      const ssRes = withActual.reduce((s, r) => s + (r.actual - r.pred) ** 2, 0);
      const ssTot = withActual.reduce((s, r) => s + (r.actual - mean) ** 2, 0);
      kpis.push(["Error vs actual (MAE)", money(mae)], ["R² vs actual", fmt(1 - ssRes / ssTot, 3)]);
      if (isSample) {
        accNote.textContent = `This sample mixes the ${fmt(D.metrics.n_train)} people the model was trained on with the ${fmt(D.metrics.n_test)} it never saw. The fair accuracy figure is from the unseen people only: MAE ${money(D.metrics.test.mae)}, R² ${fmt(D.metrics.test.r2, 3)}.`;
        accNote.hidden = false;
      }
    }
    $("batch-kpis").innerHTML = kpis.map(([k, v]) => `<div class="metric"><span>${k}</span><strong>${v}</strong></div>`).join("");

    const sk = $("batch-skipped");
    sk.hidden = !skipped.length;
    if (skipped.length) {
      sk.querySelector("summary").textContent = `${skipped.length} row${skipped.length === 1 ? "" : "s"} skipped. They stay in the download with the reason in the "note" column.`;
      const ul = sk.querySelector("ul");
      ul.replaceChildren(...skipped.slice(0, 50).map((r) => Object.assign(document.createElement("li"), { textContent: `Line ${r.line}: ${r.error}` })));
      if (skipped.length > 50) ul.append(Object.assign(document.createElement("li"), { textContent: `…and ${skipped.length - 50} more` }));
    }

    const cols = header.slice(0, 7);
    const table = $("batch-table");
    const hr = document.createElement("tr");
    [...cols, "Predicted charges"].forEach((h) => hr.append(Object.assign(document.createElement("th"), { textContent: h })));
    table.tHead.replaceChildren(hr);
    table.tBodies[0].replaceChildren(...ok.slice(0, PREVIEW_ROWS).map((r) => {
      const tr = document.createElement("tr");
      cols.forEach((_, i) => tr.append(Object.assign(document.createElement("td"), { textContent: r.raw[i] ?? "" })));
      tr.append(Object.assign(document.createElement("td"), { className: "num pred", textContent: money(r.pred) }));
      return tr;
    }));
    const notes = [];
    if (ok.length > PREVIEW_ROWS) notes.push(`Showing the first ${PREVIEW_ROWS} of ${fmt(ok.length)} rows. Download the CSV for all of them.`);
    if (flagged) notes.push(`${flagged} ${flagged === 1 ? "row is" : "rows are"} outside the range the model was trained on, so treat ${flagged === 1 ? "that prediction" : "those predictions"} with care (see the "note" column).`);
    $("batch-table-note").textContent = notes.join(" ");

    batchOutput = {
      name: fileName.replace(/\.csv$/i, "") + "_predicted.csv",
      rows: [[...header, "predicted_charges", "note"], ...results.map((r) => [
        ...header.map((_, i) => r.raw[i] ?? ""),
        r.error ? "" : r.pred.toFixed(2),
        r.error ? `skipped: ${r.error}` : r.note,
      ])],
    };
    $("batch-results").hidden = false;
  }

  function downloadText(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function bindBatch() {
    const input = $("csv-file"), zone = $("dropzone");
    const readFile = async (file) => {
      if (!file) return;
      if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") return showBatchError(`"${file.name}" is not a CSV file. Export your sheet as .csv and try again.`);
      runBatch(await file.text(), file.name);
    };
    input.addEventListener("change", () => { readFile(input.files[0]); input.value = ""; });
    document.querySelector(".link-label").addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });
    ["dragenter", "dragover"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove("drag"); }));
    zone.addEventListener("drop", (e) => readFile(e.dataTransfer.files[0]));
    $("batch-sample").addEventListener("click", () => {
      runBatch(toCSV([D.people_columns, ...D.people]), "insurance.csv", true);
    });
    $("batch-template").addEventListener("click", () => downloadText("people_template.csv", toCSV([
      ["name", "age", "sex", "bmi", "children", "smoker", "region"],
      ["Asha", "29", "female", "23.4", "0", "no", "northeast"],
      ["Ravi", "47", "male", "31.2", "2", "yes", "southeast"],
      ["Meera", "58", "female", "27.9", "1", "no", "southwest"],
    ])));
    $("batch-download").addEventListener("click", () => { if (batchOutput) downloadText(batchOutput.name, toCSV(batchOutput.rows)); });
  }

  /* ---------- model section ---------- */
  function hbarChart(id, rows, { valueFmt, alt } = {}) {
    const svg = $(id);
    const w = 520, rowH = 26, labelW = 150, padR = 70;
    const h = rows.length * rowH + 10;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const max = Math.max(...rows.map((r) => r.value));
    svg.innerHTML = rows.map((r, i) => {
      const y = 5 + i * rowH, bw = Math.max(2, (r.value / max) * (w - labelW - padR));
      return `<text class="hbar-label" x="${labelW - 8}" y="${y + 15}" text-anchor="end">${r.label}</text>
        <rect class="hbar${alt && alt(r) ? " alt" : ""}" x="${labelW}" y="${y + 3}" width="${bw}" height="${rowH - 9}" rx="4"/>
        <text class="hbar-value" x="${labelW + bw + 6}" y="${y + 15}">${valueFmt(r.value)}</text>`;
    }).join("");
  }

  function renderModel() {
    const rows = [...D.cv].sort((a, b) => a.cv_mae - b.cv_mae)
      .map((r) => ({ label: `${r.model}${r.features === "engineered" ? " +FE" : ""}`, value: r.cv_mae, fs: r.features }));
    hbarChart("cv-chart", rows, { valueFmt: (v) => money(v), alt: (r) => r.fs === "base" });
    const names = { bmi_smoker: "BMI × smoker", age_smoker: "Age × smoker", bmi_category: "BMI category" };
    hbarChart("importance-chart", D.importance.map((r) => ({ label: names[r.feature] || r.feature, value: Math.max(0, r.importance) })),
      { valueFmt: (v) => `+${money(v)}` });
    const t = D.metrics.test, b = D.metrics.baseline_test;
    $("scorecard").innerHTML = [
      ["Test R²", fmt(t.r2, 3), `baseline ${fmt(b.r2, 3)}`],
      ["Mean absolute error", money(t.mae), `${pct(1 - t.mae / b.mae)} lower than baseline`],
      ["Root mean squared error", money(t.rmse), `${pct(1 - t.rmse / b.rmse)} lower than baseline`],
      ["8 in 10 predictions within", `±${money(D.error_bands_80.no)}`, `non-smokers (±${money(D.error_bands_80.yes)} for smokers)`],
    ].map(([k, v, e]) => `<div class="score"><span>${k}</span><strong>${v}</strong><em>${e}</em></div>`).join("");
  }

  /* ---------- theme ---------- */
  function bindTheme() {
    $("theme-toggle").addEventListener("click", () => {
      const dark = getComputedStyle(document.documentElement).colorScheme === "dark";
      const next = dark ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (e) {}
    });
  }

  /* ---------- wire up ---------- */
  function update() { renderPrediction(); renderYou(); renderExplorer(); }

  renderStats();
  bindForm();
  bindSteps();
  bindChrome();
  buildPeopleChart();
  drawPeopleChart();
  bindExplorer();
  bindBatch();
  renderModel();
  bindTheme();
  setPerson({});
})();
