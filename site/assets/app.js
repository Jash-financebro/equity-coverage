/* Model Builder — static front end. Reads data/*.json written by the pipeline. */
(() => {
  const app = document.getElementById("app");
  const tip = document.getElementById("tip");
  let INDEX = null;
  const cache = {};

  // ---------------------------------------------------------------- format
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nz = (v) => v !== null && v !== undefined && !Number.isNaN(v);
  const usd = (v, d = 2) => (nz(v) ? "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
  const pct = (v, d = 1) => (nz(v) ? (v * 100).toFixed(d) + "%" : "—");
  const mult = (v) => (nz(v) ? Number(v).toFixed(1) + "x" : "—");
  const big = (mm) => {
    if (!nz(mm)) return "—";
    const a = Math.abs(mm);
    if (a >= 1e6) return "$" + (mm / 1e6).toFixed(2) + "T";
    if (a >= 1e3) return "$" + (mm / 1e3).toFixed(1) + "B";
    return "$" + mm.toFixed(0) + "M";
  };
  const mm = (v) => (nz(v) ? (v < 0 ? "(" + Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 }) + ")" : v.toLocaleString("en-US", { maximumFractionDigits: 0 })) : "—");
  const signed = (v) => (nz(v) ? `<span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "▲" : "▼"} ${pct(Math.abs(v))}</span>` : "—");
  const ratioFmt = (i) => (i.unit === "%" ? pct(i.value) : mult(i.value));
  const pill = (r) => `<span class="pill ${esc(r)}">${esc(r || "—")}</span>`;

  async function getJSON(url) {
    const r = await fetch(url + "?v=" + Date.now().toString().slice(0, -5));
    if (!r.ok) throw new Error(r.status + " " + url);
    return r.json();
  }

  // --------------------------------------------------------------- tooltip
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(window.innerWidth - w - 8, x + 14) + "px";
    tip.style.top = Math.max(8, y - h - 10) + "px";
  }
  const hideTip = () => (tip.hidden = true);

  // ----------------------------------------------------------------- charts


  function niceTicks(mn, mx, n = 4) {
    const span = mx - mn || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || mag * 10;
    const lo = Math.floor(mn / step) * step, hi = Math.ceil(mx / step) * step, out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(6));
    return out;
  }






  function footballChart(el, rows, price, target) {
    if (!rows || !rows.length) { el.innerHTML = `<p class="empty">Valuation ranges appear once peers, consensus and scenarios are available.</p>`; return; }
    const W = 1040, rowH = 34, L = 250, R = 30, T = 26, B = 46, H = T + B + rowH * rows.length;
    const vals = rows.flatMap((r) => [r.low, r.high]).concat([price, target].filter(nz));
    const ticks = niceTicks(Math.min(...vals) * 0.95, Math.max(...vals) * 1.05, 6);
    const mn = ticks[0], mx = ticks[ticks.length - 1];
    const x = (v) => L + ((v - mn) / (mx - mn)) * (W - L - R);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Football field valuation ranges">
      <style>.ax{font:11px var(--mono);fill:var(--ink-3)} .lb{font:12px var(--sans);fill:var(--ink-2)}</style>
      ${ticks.map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="${T - 6}" y2="${H - B}" stroke="var(--line-2)"/><text class="ax" x="${x(t)}" y="${H - B + 16}" text-anchor="middle">$${t.toLocaleString()}</text>`).join("")}
      ${rows.map((r, i) => { const y = T + i * rowH + 6, w = Math.max(2, x(r.high) - x(r.low));
        return `<text class="lb" x="${L - 12}" y="${y + 15}" text-anchor="end">${esc(r.label)}</text>
        <rect x="${x(r.low)}" y="${y}" width="${w}" height="20" rx="4" fill="var(--s1)" opacity=".85" data-t="${esc(r.label)}: ${usd(r.low)} – ${usd(r.high)}${nz(r.mid) ? " · mid " + usd(r.mid) : ""}"/>
        ${nz(r.mid) ? `<line x1="${x(r.mid)}" x2="${x(r.mid)}" y1="${y - 2}" y2="${y + 22}" stroke="var(--panel)" stroke-width="2"/>` : ""}`; }).join("")}
      ${nz(price) ? `<line x1="${x(price)}" x2="${x(price)}" y1="${T - 10}" y2="${H - B}" stroke="var(--ink)" stroke-width="1.5"/><text x="${x(price)}" y="${T - 14}" text-anchor="middle" style="font:500 11px var(--mono);fill:var(--ink)">Price ${usd(price)}</text>` : ""}
      ${nz(target) ? `<line x1="${x(target)}" x2="${x(target)}" y1="${T - 2}" y2="${H - B}" stroke="var(--s2)" stroke-width="2" stroke-dasharray="5 4"/><text x="${x(target)}" y="${H - 6}" text-anchor="middle" style="font:500 11px var(--mono);fill:var(--s2)">Target ${usd(target)}</text>` : ""}
    </svg>`;
    el.querySelectorAll("rect[data-t]").forEach((p) => {
      p.addEventListener("mousemove", (e) => showTip(esc(p.dataset.t), e.clientX, e.clientY));
      p.addEventListener("mouseleave", hideTip);
    });
  }





  // ------------------------------------------------------------------ views
  let API = null, SEARCH = null, RECENT = null;
  const ago = (iso) => { if (!iso) return ""; const s = (Date.now() - Date.parse(iso)) / 1000;
    return s < 90 ? "just now" : s < 5400 ? Math.round(s / 60) + " min ago" : s < 129600 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " days ago"; };
  const SITE = "Model Builder";
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
                  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* private mode */ } } };
  const ownerKey = () => store.get("mb_owner") || "";
  async function apiBase() {
    if (API !== null) return API;
    try { API = (await getJSON("api.json")).api || ""; } catch { API = ""; }
    return API;
  }
  async function searchList() {
    if (!SEARCH) { try { SEARCH = await getJSON("universe/search.json"); } catch { SEARCH = []; } }
    return SEARCH;
  }
  async function libraryIndex() {
    const base = await apiBase();
    const r = await fetch(base + "/api/library", { headers: { "X-Owner-Key": ownerKey() } });
    if (!r.ok) throw new Error(r.status === 403 ? "locked" : "HTTP " + r.status);
    return r.json();
  }
  async function recentData(force) {
    if (RECENT && !force) return RECENT;
    const base = await apiBase();
    try { RECENT = base ? await fetch(base + "/api/recent").then((r) => r.json()) : { models: [], trending: [] }; }
    catch { RECENT = { models: [], trending: [] }; }
    return RECENT;
  }
  const dl = (m) => `<a class="btn sm primary" href="${esc(m.files?.xlsx)}">⤓ Model (.xlsx)</a> <a class="btn sm" href="${esc(m.files?.pdf)}" target="_blank" rel="noopener">⤓ Report (PDF)</a>`;
  const pageLink = (m) => `<a class="btn sm" href="#/m/${esc(m.ticker)}">Model page →</a>`;

  function resultCard(m, note) {
    const sc = m.scenarios || {};
    return `<div class="card result">
      <div class="card-h"><h2><a href="#/m/${esc(m.ticker)}" class="plain">${esc(m.ticker)} · ${esc(m.name)}</a></h2><span class="note">${esc(m.exchange || "")} · ${esc(m.sector)} · ${esc(m.industry || "")}</span></div>
      <div class="kpis" style="padding:18px">
        <div class="kpi hero-n"><div class="k">Price target</div><div class="v">${usd(m.target)}</div><div class="n">${pill(m.rating)} &nbsp;anchored to street and peers</div></div>
        <div class="kpi"><div class="k">Price</div><div class="v">${usd(m.price)}</div><div class="n">${esc(m.price_date || "")}</div></div>
        <div class="kpi"><div class="k">Upside</div><div class="v">${signed(m.upside)}</div></div>
        <div class="kpi"><div class="k">Bear / Base / Bull</div><div class="v" style="font-size:17px">${usd(sc.bear, 0)} / ${usd(sc.base, 0)} / ${usd(sc.bull, 0)}</div></div>
        <div class="kpi"><div class="k">WACC</div><div class="v">${pct(m.wacc, 2)}</div><div class="n">peers: ${esc((m.peers || []).join(", ") || "none")}</div></div>
      </div>
      <div class="gen-actions">${pageLink(m)} ${dl(m)}<span class="note">${note || ""} · version ${m.version} · generated ${ago(m.generated_at)}${m.times_generated > 1 ? ` · ${m.times_generated} builds` : ""}</span></div>
    </div>`;
  }
  const modelRow = (m) => `<div class="kv"><span><a href="#/m/${esc(m.ticker)}" class="tk">${esc(m.ticker)}</a> <span class="co-i">${esc(m.name)}</span> <span class="note">${esc(m.sector)} · ${ago(m.generated_at)}</span></span><span class="num">${usd(m.target)} ${pill(m.rating)} <span class="hide-sm">&nbsp;<a class="btn sm" href="${esc(m.files?.xlsx)}">.xlsx</a> <a class="btn sm" href="${esc(m.files?.pdf)}" target="_blank" rel="noopener">PDF</a></span></span></div>`;

  async function generateView() {
    document.title = "Generate a model · " + SITE;
    const base = await apiBase();
    app.innerHTML = `
      <section class="hero"><h1>Model any NYSE or Nasdaq company</h1>
        <p>Type a ticker. We pull the company's 10-K data from SEC EDGAR and build a full Excel model: three linked statements with PP&amp;E, debt and revolver schedules, WACC, a five-year DCF with a sensitivity grid, same-industry comps, and bull, base and bear cases you can switch inside the workbook. You also get a summary research report and a model page you can share. It takes about two to three minutes.</p></section>
      <div class="card gen-box">
        <form id="gen-form" autocomplete="off">
          <div class="gen-row">
            <div class="gen-input"><input id="tk" placeholder="Ticker or company name, e.g. XOM, AAPL or Coca-Cola" aria-label="NYSE or Nasdaq ticker" spellcheck="false" autocapitalize="characters">
              <div id="sugg" class="sugg" hidden></div></div>
            <button class="btn primary big" id="go" type="submit">Generate model</button>
          </div>
          <p class="note" id="gen-hint">${base ? "NYSE and Nasdaq SEC filers (funds and trusts excluded). A model built in the last 6 hours is reused instantly." : "The generation service is being set up."}</p>
        </form>
        <div id="gen-status"></div>
      </div>
      <div id="gen-result"></div>
      <section class="section" id="trend-sec" hidden><h2 class="sec">Most generated this week</h2><div class="trend" id="trend"></div></section>
      <section class="section"><h2 class="sec">Generated in the past 24 hours</h2><div class="card" id="recent"><p class="muted loading" style="padding:14px 18px">Loading…</p></div></section>
      <section class="section" id="insights"></section>`;
    insightsStrip();

    recentData(true).then((r) => {
      const el = document.getElementById("recent"); if (!el) return;
      el.innerHTML = (r.models || []).map(modelRow).join("") || '<div class="empty">No models in the past 24 hours. Be the first.</div>';
      const tr = r.trending || [];
      if (tr.length) {
        document.getElementById("trend-sec").hidden = false;
        document.getElementById("trend").innerHTML = tr.map((m) => `<a class="tcard" href="#/m/${esc(m.ticker)}"><span class="tk">${esc(m.ticker)}</span>
          <span class="tv">${usd(m.target, 0)}</span><span>${pill(m.rating)} ${signed(m.upside)}</span><span class="note">${m.times_generated || 1}× · ${esc(m.sector)}</span></a>`).join("");
      }
    });

    const tk = document.getElementById("tk"), sugg = document.getElementById("sugg");
    let list = null;
    const load = async () => (list = list || await searchList());
    tk.addEventListener("focus", load, { once: true });
    tk.addEventListener("input", async () => {
      const q = tk.value.trim().toUpperCase().replace(/[./]/g, "-");
      if (!q) { sugg.hidden = true; return; }
      const qn = tk.value.trim().toUpperCase();
      const hits = (await load()).filter(([t, n]) => t.startsWith(q) || n.toUpperCase().includes(qn)).sort((a, b) => (a[0] === q ? -1 : b[0] === q ? 1 : a[0].length - b[0].length)).slice(0, 8);
      sugg.innerHTML = hits.map(([t, n, sct, x]) => `<div class="sg" data-t="${esc(t)}"><b>${esc(t)}</b> ${esc(n)} <span class="note">${esc(x || "NYSE")} · ${esc(sct)}</span></div>`).join("");
      sugg.hidden = !hits.length;
      sugg.querySelectorAll(".sg").forEach((el) => el.addEventListener("mousedown", (e) => { e.preventDefault(); tk.value = el.dataset.t; sugg.hidden = true; }));
    });
    tk.addEventListener("blur", () => setTimeout(() => (sugg.hidden = true), 100));
    document.getElementById("gen-form").addEventListener("submit", (e) => { e.preventDefault(); startGenerate(tk.value, false); });
    const pre = sessionStorage.getItem("mb_prefill"); if (pre) { sessionStorage.removeItem("mb_prefill"); tk.value = pre; startGenerate(pre, true); }
  }

  async function startGenerate(raw, force) {
    const base = await apiBase(), stat = document.getElementById("gen-status"), out = document.getElementById("gen-result");
    const rawU = String(raw || "").trim().toUpperCase();
    let t = rawU.replace(/[./]/g, "-");
    const list = await searchList();
    const byName = list.find(([tt, n]) => n.toUpperCase() === rawU) || list.find(([tt, n]) => n.toUpperCase().startsWith(rawU));
    if (!list.find(([tt]) => tt === t) && byName) t = byName[0];
    out.innerHTML = "";
    if (!t) return;
    if (!base) { stat.innerHTML = `<div class="warn">The generation service isn't connected yet.</div>`; return; }
    const btn = document.getElementById("go"); btn.disabled = true;
    const steps = ["Request accepted", "Pulling SEC 10-K data, prices and same-industry peers", "Building the three-statement model, DCF and scenarios", "Recalculating in the Excel engine and writing the report", "Ready"];
    const t0 = Date.now();
    const draw = (k, msg) => { stat.innerHTML = `<ol class="progress">${steps.map((s, i) => `<li class="${i < k ? "done" : i === k ? "now" : ""}">${s}</li>`).join("")}</ol>
      <p class="note">${esc(t)} · ${Math.round((Date.now() - t0) / 1000)}s elapsed${msg ? " · " + msg : ""}</p>`; };
    draw(0);
    try {
      const r = await fetch(base + "/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: t, force }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      if (j.status === "ready") { stat.innerHTML = ""; out.innerHTML = resultCard(j.model, `Built ${ago(j.model.generated_at)} — reused <a href="#" id="regen">rebuild now</a>`); hookRegen(t); return; }
      const since = j.since || new Date(Date.now() - 5000).toISOString();
      for (let i = 0; i < 120; i++) {
        await new Promise((res) => setTimeout(res, 5000));
        const el = (Date.now() - t0) / 1000;
        const phase = el > 75 ? 3 : el > 30 ? 2 : 1;
        const s = await fetch(`${base}/api/status?ticker=${encodeURIComponent(t)}&since=${encodeURIComponent(since)}`).then((x) => x.json());
        if (s.status === "ready") { draw(4); RECENT = null; out.innerHTML = resultCard(s.model, "Fresh build"); stat.innerHTML = ""; return; }
        if (s.status === "failed") throw new Error(`We couldn't build ${esc(t)}. The usual reasons: no annual US-GAAP XBRL financials on file yet (new registrants, recent reorganizations), a foreign filer reporting in another currency, or a fund or trust. <a href="${esc(s.run_url)}" target="_blank" rel="noopener">Build log</a>.`);
        draw(s.status === "queued" ? 0 : s.status === "finishing" ? 3 : phase, s.status === "queued" ? "waiting for a runner" : "");
      }
      throw new Error("This is taking longer than usual. Try the model page in a few minutes: " + `<a href="#/m/${esc(t)}">${esc(t)}</a>`);
    } catch (e) {
      stat.innerHTML = `<div class="warn">${String(e.message || e)}</div>`;
    } finally { btn.disabled = false; }
  }
  function hookRegen(t) { const a = document.getElementById("regen"); if (a) a.addEventListener("click", (e) => { e.preventDefault(); startGenerate(t, true); }); }

  // ------------------------------------------------------------ model page
  // Browser re-run of the workbook's valuation. At base settings it reproduces the Excel numbers exactly.
  function valuate(x, o) {
    const baseRev = [x.rev0, ...x.rev];
    const rev = [x.rev0];
    for (let i = 0; i < 5; i++) rev.push(rev[i] * (1 + (baseRev[i + 1] / baseRev[i] - 1) + o.dg));
    const ufcf = []; let ebitda5 = 0, ebit5 = 0;
    for (let i = 0; i < 5; i++) {
      const r = rev[i + 1], k = r / baseRev[i + 1];
      const ebit = r * (x.ebit[i] / baseRev[i + 1] + o.dm);
      const drB = baseRev[i + 1] - baseRev[i], dr = r - rev[i];
      const nwc = x.nwc[i] * (drB ? dr / drB : k);           // working capital moves with the change in revenue
      const da = x.da[i] * (1 + 0.5 * (k - 1));              // D&A follows PP&E, which lags revenue
      const capex = x.capex[i] * k;
      ufcf.push(ebit * (1 - x.tax[i]) + da + capex + nwc);
      if (i === 4) { ebitda5 = ebit + da; ebit5 = ebit; }
    }
    const df = [1, 2, 3, 4, 5].map((t) => 1 / (1 + o.wacc) ** t);
    const spv = ufcf.reduce((a, u, i) => a + u * df[i], 0);
    const bridge = (ev) => ((ev + x.debt + x.cash) * (1 + x.nci_ratio)) / x.shares;   // nci_ratio is negative (DCF D26/D25)
    const g = Math.min(o.g, o.wacc - 0.005);
    const dcf = bridge(spv + (ufcf[4] * (1 + g)) / (o.wacc - g) * df[4]);
    const exit = Math.max(0, bridge(spv + o.mult * ebitda5 * df[4]));
    const model = x.w_dcf * dcf + x.w_exit * exit + x.w_comps * x.comps_value;
    const target = x.anchored_base * (x.base_model ? model / x.base_model : 1);
    return { dcf, exit, model, target, upside: target / x.price - 1, rev5: rev[5], margin5: ebit5 / rev[5], ufcf };
  }
  function histRows(d, hn) {
    const take = (arr) => (arr || []).slice(0, hn);
    const fcf = take(d.cf?.cfo).map((c, i) => (nz(c) && nz(d.cf?.capex?.[i]) ? c + d.cf.capex[i] : null));
    const debt = take(d.bs?.debt).map((v, i) => (nz(v) ? v + (d.bs?.revolver?.[i] || 0) : null));
    const sec = (t) => `<tr class="grp"><td colspan="${hn + 1}">${t}</td></tr>`;
    const r = (lab, arr, f = mm, tot = false) => `<tr${tot ? ' class="tot"' : ""}><td>${lab}</td>${take(arr).map((v) => `<td class="r num">${f(v)}</td>`).join("")}</tr>`;
    const neg = (arr) => take(arr).map((v) => (nz(v) ? -v : v));
    return sec("Income statement")
      + r("Revenue", d.is?.revenue, mm, true) + r("Revenue growth", d.is?.growth, (v) => (nz(v) && v !== 0 ? pct(v) : "—"))
      + r("Gross profit", d.is?.gross) + r("Gross margin", d.is?.gm, pct)
      + r("EBITDA", d.is?.ebitda, mm, true) + r("EBITDA margin", d.is?.ebitda_m, pct)
      + r("Operating income (EBIT)", d.is?.ebit) + r("Net income to common", d.is?.ni, mm, true)
      + r("Diluted EPS", d.is?.eps, (v) => usd(v))
      + sec("Balance sheet")
      + r("Cash & equivalents", d.bs?.cash) + r("Total debt", debt) + r("Total assets", d.bs?.ta, mm, true)
      + r("Shareholders' equity", d.bs?.equity, mm, true)
      + sec("Cash flow")
      + r("Cash from operations", d.cf?.cfo, mm, true) + r("Capital expenditures", neg(d.cf?.capex))
      + r("Free cash flow (CFO - capex)", fcf, mm, true) + r("Dividends paid", neg(d.cf?.div)) + r("Share repurchases", neg(d.cf?.buyback));
  }
  // ------------------------------------------------------------- shared bits for the extra panels
  const qualityPill = (q) => (q ? `<span class="qpill q-${esc(q.grade)}" title="${esc((q.reasons || []).join("; "))}">Data quality: ${esc(q.grade)}</span>` : "");
  function impliedGrowth(x, S) {
    // reverse DCF: the constant growth uplift that makes the perpetuity DCF equal today's price
    const f = (dg) => valuate(x, { ...S, dg }).dcf - x.price;
    let lo = -0.5, hi = 0.8, flo = f(lo), fhi = f(hi);
    if (!(flo < 0 && fhi > 0)) return null;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2, fm = f(mid); if (fm > 0) hi = mid; else lo = mid; }
    const r = valuate(x, { ...S, dg: (lo + hi) / 2 });
    return (r.rev5 / x.rev0) ** (1 / 5) - 1;
  }
  const baseCagr = (x) => (x.rev[4] / x.rev0) ** (1 / 5) - 1;

  function quarterPanel(m) {
    const q = m.latest_quarter;
    if (!q || !q.quarter || !Object.keys(q.quarter).length) return "";
    const rows = [["revenue", "Revenue", mm], ["operating_income", "Operating income", mm], ["net_income", "Net income", mm],
                  ["eps_diluted", "Diluted EPS", (v) => usd(v)]].filter(([k]) => q.quarter[k]);
    const ttm = [["revenue", "Revenue"], ["net_income", "Net income"], ["cfo", "Cash from operations"], ["eps_diluted", "Diluted EPS"]].filter(([k]) => nz(q.ttm?.[k]));
    return `<section class="section card"><div class="card-h"><h2>Latest quarter</h2><span class="note">${esc(q.label)} · ${q.is_10q ? "from the 10-Q" : "fourth quarter, from the 10-K"}</span></div>
      <div class="grid2">
        <div class="scroll"><table><thead><tr><th>$mm</th><th class="r">This quarter</th><th class="r">Year ago</th><th class="r">Change</th></tr></thead><tbody>
          ${rows.map(([k, lab, f]) => { const r = q.quarter[k]; return `<tr><td>${lab}</td><td class="r num">${f(r.cur)}</td><td class="r num">${nz(r.prior) ? f(r.prior) : "—"}</td><td class="r num">${nz(r.chg) ? signed(r.chg) : "—"}</td></tr>`; }).join("")}
        </tbody></table></div>
        <div class="scroll"><table><thead><tr><th>Trailing 12 months</th><th class="r">TTM</th><th class="r">Last fiscal year</th></tr></thead><tbody>
          ${ttm.map(([k, lab]) => `<tr><td>${lab}</td><td class="r num">${k === "eps_diluted" ? usd(q.ttm[k]) : mm(q.ttm[k])}</td><td class="r num">${k === "eps_diluted" ? usd(q.fy?.[k]) : mm(q.fy?.[k])}</td></tr>`).join("")}
          ${nz(m.pe_ttm) ? `<tr class="tot"><td>P/E on TTM EPS</td><td class="r num">${mult(m.pe_ttm)}</td><td></td></tr>` : ""}
        </tbody></table></div>
      </div></section>`;
  }
  function guidancePanel(m) {
    const g = m.guidance;
    if (!g || !(g.sentences || []).length) return "";
    const rng = g.revenue_growth_range;
    const cmp = rng && nz(g.model_growth) ? `<p class="${g.flag ? "warn" : "note"}" style="margin:10px 18px">${g.flag ? "<b>Model and guidance disagree.</b> " : ""}Guidance points to revenue growth of ${rng[0] === rng[1] ? pct(rng[0]) : pct(rng[0]) + " to " + pct(rng[1])}; the model's base case has ${pct(g.model_growth)} for next year.</p>` : "";
    return `<section class="section card"><div class="card-h"><h2>Management guidance</h2><span class="note">latest earnings release, filed ${esc(g.filed)} · <a href="${esc(g.url)}" target="_blank" rel="noopener">read it ↗</a></span></div>
      <div class="prose">${g.sentences.map((s) => `<blockquote>${esc(s)}</blockquote>`).join("")}</div>${cmp}</section>`;
  }
  function changesPanel(m) {
    const t = m.track, ch = m.changes || [];
    if (!ch.length && !t) return "";
    return `<section class="section card"><div class="card-h"><h2>Since the last build</h2>${m.rebuilt_for ? `<span class="note">auto-rebuilt on a new filing</span>` : ""}</div>
      <div class="prose">${ch.length ? `<ul class="tight">${ch.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
      ${t ? `<p><b>Track record.</b> On ${esc(t.call_date)} (v${t.version}) the call was ${pill(t.rating)} at ${usd(t.call_price)} with a ${usd(t.call_target)} target. ${t.days} days later the stock is ${usd(t.mark)}, ${signed(t.ret)}${nz(t.spy_ret) ? ` vs ${signed(t.spy_ret)} for the S&amp;P 500` : ""}: ${t.hit ? "the call is working." : "the call isn't working so far."}</p>` : ""}</div></section>`;
  }

  // ------------------------------------------------------------- compare
  async function comparePage(arg) {
    const tickers = [...new Set(String(arg || "").toUpperCase().split(/[,\s]+/).filter(Boolean))].slice(0, 4);
    document.title = "Compare · " + SITE;
    const base = await apiBase();
    app.innerHTML = `<a class="crumb" href="#/">← Generate</a><section class="hero"><h1>Compare models</h1><p>Up to four companies side by side. Only models that have been generated can be compared.</p></section>
      <form id="cmp-f" class="gen-row" autocomplete="off"><div class="gen-input"><input id="cmp-t" value="${esc(tickers.join(", "))}" placeholder="Tickers, e.g. KO, PEP, KDP" aria-label="Tickers to compare"></div><button class="btn primary" type="submit">Compare</button></form>
      <div id="cmp" class="section"></div>`;
    document.getElementById("cmp-f").addEventListener("submit", (e) => { e.preventDefault(); location.hash = "#/compare/" + encodeURIComponent(document.getElementById("cmp-t").value.replace(/\s+/g, "")); });
    if (!tickers.length) return;
    const ms = await Promise.all(tickers.map((t) => fetch(`${base}/api/model?ticker=${encodeURIComponent(t)}`).then(async (r) => (r.ok ? r.json() : { ticker: t, missing: true })).catch(() => ({ ticker: t, missing: true }))));
    const rows = [
      ["Price target", (m) => `<b>${usd(m.target)}</b>`], ["Rating", (m) => pill(m.rating)], ["Upside", (m) => signed(m.upside)],
      ["Price", (m) => usd(m.price)], ["Bear / Base / Bull", (m) => `${usd(m.scenarios?.bear, 0)} / ${usd(m.scenarios?.base, 0)} / ${usd(m.scenarios?.bull, 0)}`],
      ["Model value", (m) => usd(m.model_value)], ["Street median", (m) => usd(m.consensus?.target_median)],
      ["EV / EBITDA", (m) => mult(m.ev_ebitda)], ["P / E (TTM)", (m) => mult(m.pe_ttm)], ["EBITDA margin", (m) => pct(m.ebitda_margin)],
      ["Revenue growth, next year (base)", (m) => pct(m.growth_next)],
      ["Latest quarter revenue growth", (m) => (nz(m.latest_quarter?.quarter?.revenue?.chg) ? signed(m.latest_quarter.quarter.revenue.chg) : "—")],
      ["WACC", (m) => pct(m.wacc, 2)], ["Data quality", (m) => esc(m.quality?.grade || "—")], ["Generated", (m) => esc(ago(m.generated_at))],
    ];
    document.getElementById("cmp").innerHTML = `<div class="card"><div class="scroll"><table class="cmp"><thead><tr><th></th>${ms.map((m) => `<th class="r">${m.missing ? esc(m.ticker) : `<a class="tk" href="#/m/${esc(m.ticker)}">${esc(m.ticker)}</a><span class="co">${esc(m.name)}</span>`}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(([lab, f]) => `<tr><td>${lab}</td>${ms.map((m) => `<td class="r num">${m.missing ? (lab === "Price target" ? `<a href="#/" data-gen="${esc(m.ticker)}">Generate ${esc(m.ticker)}</a>` : "") : f(m)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
    document.querySelectorAll("[data-gen]").forEach((a) => a.addEventListener("click", () => sessionStorage.setItem("mb_prefill", a.dataset.gen)));
  }

  // ------------------------------------------------------------- update an existing model
  async function updateView() {
    document.title = "Update a model · " + SITE;
    const base = await apiBase();
    app.innerHTML = `<section class="hero"><h1>Update an existing model</h1>
        <p>Upload an Excel model you already have. We keep your structure and formulas, and bring it up to date: the latest 10-K figures and market data go into a new Live_Data tab, your share price, share count, risk-free rate and beta inputs are refreshed, restated historicals are corrected, and an Update Log tab lists every change, your old and new target, and how your projections compare with what the company has since reported.</p></section>
      <div class="card gen-box"><form id="up-f" autocomplete="off">
        <div class="gen-row"><div class="gen-input"><input id="up-t" placeholder="Ticker the model is for, e.g. KO" aria-label="Ticker" autocapitalize="characters" required></div>
          <label class="btn file-btn"><input id="up-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required><span id="up-name">Choose .xlsx…</span></label>
          <button class="btn primary big" id="up-go" type="submit">Update model</button></div>
        <p class="note">.xlsx up to 10 MB. Your file is stored privately for six hours to process it, then deleted; it is never published or added to the library. Macros and some chart formatting may not survive the round trip, so keep your original.</p>
      </form><div id="up-status"></div></div><div id="up-result"></div>`;
    const file = document.getElementById("up-file");
    file.addEventListener("change", () => { document.getElementById("up-name").textContent = file.files[0]?.name || "Choose .xlsx…"; });
    document.getElementById("up-f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const stat = document.getElementById("up-status"), out = document.getElementById("up-result"), btn = document.getElementById("up-go");
      const t = document.getElementById("up-t").value.trim().toUpperCase().replace(/[./]/g, "-"), f = file.files[0];
      out.innerHTML = "";
      if (!f) return;
      if (!base) { stat.innerHTML = `<div class="warn">The service isn't connected yet.</div>`; return; }
      btn.disabled = true;
      const t0 = Date.now();
      const draw = (msg) => { stat.innerHTML = `<p class="note loading">${esc(msg)} · ${Math.round((Date.now() - t0) / 1000)}s</p>`; };
      try {
        draw("Uploading");
        const r = await fetch(`${base}/api/update?ticker=${encodeURIComponent(t)}`, { method: "POST", body: f, headers: { "X-Filename": f.name } });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || r.status);
        for (let i = 0; i < 120; i++) {
          await new Promise((res) => setTimeout(res, 4000));
          const s = await fetch(`${base}/api/update/status/${j.id}?token=${j.token}`).then((x) => x.json());
          if (s.status === "ready") { stat.innerHTML = ""; out.innerHTML = updateResult(s.summary, `${base}/api/update/file/${j.id}?token=${j.token}`, f.name); return; }
          if (s.status === "failed") throw new Error(esc(s.summary?.error || "The update failed.") + (s.summary?.run_url ? ` <a href="${esc(s.summary.run_url)}" target="_blank" rel="noopener">Log</a>` : ""));
          draw(s.status === "running" ? "Reading your workbook and pulling the latest SEC and market data" : "Waiting for a runner");
        }
        throw new Error("This is taking longer than usual. Try again in a few minutes.");
      } catch (err) { stat.innerHTML = `<div class="warn">${String(err.message || err)}</div>`; }
      finally { btn.disabled = false; }
    });
  }
  function updateResult(s, href, fname) {
    const d = nz(s.old_target) && nz(s.new_target) ? s.new_target / s.old_target - 1 : null;
    const ch = s.changes || [], cmp = s.compare || [];
    const fmt = (v) => (nz(v) ? (Math.abs(v) < 1 ? Number(v).toFixed(4) : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })) : esc(v ?? ""));
    return `<div class="card result"><div class="card-h"><h2>${esc(s.name)} (${esc(s.ticker)}) · updated</h2><span class="note">10-K ${esc(s.latest_fy)} filed ${esc(s.tenk_filed)} · priced ${esc(s.price_date)}</span></div>
      <div class="kpis" style="padding:18px">
        <div class="kpi hero-n"><div class="k">Your target, now</div><div class="v">${usd(s.new_target)}</div><div class="n">was ${usd(s.old_target)}${nz(d) ? " · " + signed(d) : ""} · cell ${esc(s.target_cell || "not found")}</div></div>
        <div class="kpi"><div class="k">Share price</div><div class="v">${usd(s.price)}</div></div>
        <div class="kpi"><div class="k">Inputs changed</div><div class="v">${ch.length}</div></div>
        <div class="kpi"><div class="k">Projections vs actuals</div><div class="v">${cmp.length}</div></div>
      </div>
      ${s.model_builder_file ? `<p class="note" style="padding:0 18px">This is a Model Builder workbook, so every tab now reads the refreshed data.</p>` : ""}
      ${s.stale ? `<div class="warn" style="margin:0 18px 14px">Your latest actual year is FY${s.stale.model_latest_actual}, and FY${s.stale.available} has since been reported. The new figures are in the Live_Data tab; roll the model forward to use them, or <a href="#/" data-gen="${esc(s.ticker)}">build a fresh model</a>.</div>` : ""}
      <div class="gen-actions"><a class="btn sm primary" href="${esc(href)}" download>⤓ ${esc(fname.replace(/\.xlsx$/i, ""))}_updated.xlsx</a><span class="note">available for six hours</span></div></div>
      <section class="section card"><div class="card-h"><h2>What changed</h2><span class="note">also in the Update Log tab</span></div><div class="scroll"><table><thead><tr><th>What</th><th>Where</th><th>Label</th><th class="r">Before</th><th class="r">After</th></tr></thead><tbody>
        ${ch.map((c) => `<tr><td>${esc(c.kind)}</td><td class="mono">${esc(c.sheet)}!${esc(c.cell)}</td><td>${esc(String(c.label).slice(0, 60))}</td><td class="r num">${fmt(c.old)}</td><td class="r num">${fmt(c.new)}</td></tr>`).join("") || `<tr><td colspan="5" class="note">No typed inputs needed changing. The latest data is in the Live_Data tab.</td></tr>`}
      </tbody></table></div></section>
      ${cmp.length ? `<section class="section card"><div class="card-h"><h2>Your projections vs what was reported</h2></div><div class="scroll"><table><thead><tr><th>Line</th><th>Year</th><th>Where</th><th class="r">Your model</th><th class="r">Actual</th><th class="r">Difference</th></tr></thead><tbody>
        ${cmp.map((c) => `<tr><td>${esc(c.line)}</td><td>FY${c.year}</td><td class="mono">${esc(c.sheet)}!${esc(c.cell)}</td><td class="r num">${fmt(c.model)}</td><td class="r num">${fmt(c.actual)}</td><td class="r num">${signed(c.diff)}</td></tr>`).join("")}</tbody></table></div></section>` : ""}`;
  }

  // ------------------------------------------------------------- home strips: totals, track record, sectors
  async function insightsStrip() {
    const el = document.getElementById("insights"); if (!el) return;
    const base = await apiBase();
    let d; try { d = await fetch(base + "/api/insights").then((r) => r.json()); } catch { return; }
    if (!d || !d.totals) return;
    const t = d.track || {};
    const sec = (d.sectors || []).slice(0, 8);
    el.innerHTML = `<p class="note stat-line">${d.totals.generations.toLocaleString()} models generated for ${d.totals.companies.toLocaleString()} companies across ${d.totals.sectors} sectors.</p>
      <div class="grid2">
        <div class="card"><div class="card-h"><h2>Track record</h2><span class="note">calls scored 30+ days after they're made</span></div>
          ${t.scored ? `<div class="kvrow" style="border:0;padding:14px 18px">
            <div><div class="note">Calls scored</div><b>${t.scored}</b></div><div><div class="note">Working</div><b>${pct(t.hit_rate, 0)}</b></div>
            <div><div class="note">Avg. return since call</div><b>${signed(t.avg_return)}</b></div><div><div class="note">vs S&amp;P 500</div><b>${nz(t.avg_excess) ? signed(t.avg_excess) : "—"}</b></div></div>`
          : `<p class="note" style="padding:14px 18px">Each call is checked against the share price 30 days after it's made, and against the S&amp;P 500. The first results appear once calls are a month old.</p>`}</div>
        <div class="card"><div class="card-h"><h2>Sector snapshot</h2><span class="note">medians across models</span></div>
          <div class="scroll"><table><thead><tr><th>Sector</th><th class="r">Models</th><th class="r">Upside</th><th class="r">Buy</th><th class="r hide-sm">EV/EBITDA</th></tr></thead><tbody>
            ${sec.map((s) => `<tr><td>${esc(s.name)}</td><td class="r num">${s.n}</td><td class="r num">${signed(s.median_upside)}</td><td class="r num">${pct(s.buy_share, 0)}</td><td class="r num hide-sm">${mult(s.median_ev_ebitda)}</td></tr>`).join("")}
          </tbody></table></div></div>
      </div>`;
  }

  // ------------------------------------------------------------- theme + keyboard shortcuts
  function initChrome() {
    const root = document.documentElement;
    const saved = store.get("mb_theme"); if (saved) root.dataset.theme = saved;
    const nav = document.getElementById("nav");
    if (nav && !document.getElementById("theme-btn")) {
      nav.insertAdjacentHTML("beforeend", `<button id="theme-btn" class="theme-btn" aria-label="Toggle dark mode" title="Toggle dark mode (t)">◐</button>`);
      document.getElementById("theme-btn").addEventListener("click", toggleTheme);
    }
    document.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;
      const go = { g: "#/", u: "#/update", c: "#/compare/", m: "#/method" }[e.key];
      if (e.key === "/") { e.preventDefault(); if (location.hash.replace(/^#\/?/, "")) { location.hash = "#/"; setTimeout(() => document.getElementById("tk")?.focus(), 300); } else document.getElementById("tk")?.focus(); }
      else if (e.key === "t") toggleTheme();
      else if (go) location.hash = go;
    });
    const tok = INDEX?.site?.analytics_token;
    if (tok && !document.getElementById("cf-beacon")) {
      const s = document.createElement("script"); s.id = "cf-beacon"; s.defer = true; s.src = "https://static.cloudflareinsights.com/beacon.min.js";
      s.setAttribute("data-cf-beacon", JSON.stringify({ token: tok })); document.head.appendChild(s);
    }
  }
  function toggleTheme() {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark"; store.set("mb_theme", root.dataset.theme);
  }

  const ratingOf = (u) => (u >= 0.15 ? "Buy" : u <= -0.1 ? "Sell" : "Hold");

  function historyChart(el, series, hist) {
    if (!series || series.length < 2) { el.innerHTML = `<p class="empty">Price history appears after the next build.</p>`; return; }
    const W = 1040, H = 280, L = 56, R = 24, T = 16, B = 30;
    const pts = (hist || []).filter((h) => nz(h.target));
    const vals = series.map((p) => p[1]).concat(pts.map((h) => h.target));
    const ticks = niceTicks(Math.min(...vals) * 0.97, Math.max(...vals) * 1.03, 5);
    const mn = ticks[0], mx = ticks[ticks.length - 1];
    const d0 = Date.parse(series[0][0]), d1 = Math.max(Date.parse(series[series.length - 1][0]), ...pts.map((h) => Date.parse(h.date)));
    const x = (d) => L + ((Date.parse(d) - d0) / (d1 - d0 || 1)) * (W - L - R);
    const y = (v) => T + (1 - (v - mn) / (mx - mn)) * (H - T - B);
    const line = series.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
    const step = pts.map((h, i) => `${i ? "L" + x(h.date).toFixed(1) + "," + y(pts[i - 1].target).toFixed(1) : "M" + x(h.date).toFixed(1) + "," + y(h.target).toFixed(1)} L${x(h.date).toFixed(1)},${y(h.target).toFixed(1)}`).join(" ")
      + (pts.length ? ` L${W - R},${y(pts[pts.length - 1].target).toFixed(1)}` : "");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Share price and model target over time">
      <style>.ax{font:11px var(--mono);fill:var(--ink-3)}</style>
      ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line-2)"/><text class="ax" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">$${t.toLocaleString()}</text>`).join("")}
      <path d="${line}" fill="none" stroke="var(--s1)" stroke-width="2"/>
      ${pts.length ? `<path d="${step}" fill="none" stroke="var(--s2)" stroke-width="2" stroke-dasharray="6 4"/>` : ""}
      ${pts.map((h) => `<circle cx="${x(h.date)}" cy="${y(h.target)}" r="5" fill="var(--s2)" stroke="var(--panel)" stroke-width="2" data-t="v${h.version} · ${esc(h.date)} · target ${usd(h.target)} vs price ${usd(h.price)} · ${esc(h.rating)}"/>`).join("")}
      <text class="ax" x="${L}" y="${H - 8}">${esc(series[0][0])}</text><text class="ax" x="${W - R}" y="${H - 8}" text-anchor="end">${esc(series[series.length - 1][0])}</text>
    </svg>`;
    el.querySelectorAll("circle[data-t]").forEach((c) => { c.addEventListener("mousemove", (e) => showTip(esc(c.dataset.t), e.clientX, e.clientY)); c.addEventListener("mouseleave", hideTip); });
  }

  async function modelPage(t) {
    t = t.toUpperCase().replace(/[./]/g, "-");
    document.title = `${t} · ${SITE}`;
    app.innerHTML = `<p class="muted loading">Loading ${esc(t)}…</p>`;
    const base = await apiBase();
    let m;
    try {
      const r = await fetch(`${base}/api/model?ticker=${encodeURIComponent(t)}`);
      m = await r.json();
      if (!r.ok) throw new Error(m.error || r.status);
    } catch (e) {
      app.innerHTML = `<a class="crumb" href="#/">← Generate</a><div class="card empty">${esc(String(e.message || e))}<br><br><a class="btn primary" href="#/" id="gen-this">Generate ${esc(t)}</a></div>`;
      document.getElementById("gen-this").addEventListener("click", () => sessionStorage.setItem("mb_prefill", t));
      return;
    }
    const d = m.detail || {}, sc = m.scenarios || {}, x = d.dcf_inputs, v = d.valuation || {}, cs = d.cases || {};
    document.title = `${m.ticker} ${usd(m.target)} target · ${SITE}`;
    const shareUrl = `${base}/m/${encodeURIComponent(m.ticker)}`;
    const years = d.years || [], hn = d.hist_n || 3;
    const chk = m.sector_check;
    const ph = d.price_history || [];
    const lo52 = ph.length ? Math.min(...ph.map((p) => p[1])) : null, hi52 = ph.length ? Math.max(...ph.map((p) => p[1])) : null;
    const grid = (d.sens?.grid || []).flat().filter((z) => nz(z) && z > 0);
    const methods = [v.dcf, v.exit, v.comps].filter(nz);
    const ff = [
      nz(lo52) && { label: "52-week trading range", low: lo52, high: hi52 },
      nz(sc.bear) && { label: "Bear – bull scenarios", low: sc.bear, high: sc.bull, mid: sc.base },
      grid.length && { label: "DCF sensitivity (WACC × growth)", low: Math.min(...grid), high: Math.max(...grid), mid: v.dcf },
      methods.length && { label: "Model methods (DCF, exit, comps)", low: Math.min(...methods), high: Math.max(...methods), mid: v.model_value },
      nz(m.consensus?.target_median) && { label: "Street median target", low: m.consensus.target_median * 0.98, high: m.consensus.target_median * 1.02, mid: m.consensus.target_median },
      chk && nz(chk.implied_value) && { label: `${chk.metric} vs. peer median`, low: chk.implied_value * 0.95, high: chk.implied_value * 1.05, mid: chk.implied_value },
    ].filter(Boolean);
    const row = (lab, arr, f, from = 0) => `<tr><td>${lab}</td>${years.map((_, i) => `<td class="r num${i >= hn ? " proj" : ""}">${i < from ? "" : f(arr?.[i])}</td>`).join("")}</tr>`;
    const caseRow = (lab, f, k) => `<tr><td>${lab}</td>${["bear", "base", "bull"].map((c) => `<td class="r num">${f(cs[c]?.[k])}</td>`).join("")}</tr>`;
    const deltaPts = (z) => (nz(z) ? (z >= 0 ? "+" : "") + (z * 100).toFixed(1) + " pts" : "—");
    const firstDelta = (c) => (cs[c]?.growth_delta || [0])[0];

    app.innerHTML = `
      <a class="crumb" href="#/">← Generate</a>
      <div class="dhead">
        <div><div class="note">${esc(m.exchange || "NYSE")}: ${esc(m.ticker)} · ${esc(m.sector)} · ${esc(m.industry || "")}</div>
          <h1 class="dname">${esc(m.name)}</h1>
          <div class="note">Version ${m.version} · generated ${ago(m.generated_at)} · 10-K filed ${esc(d.dates?.tenk_filed || "n/a")} · priced ${esc(m.price_date)} ${qualityPill(m.quality)}</div></div>
        <div class="actions">${dl(m)}${m.files?.tearsheet ? ` <a class="btn sm" href="${esc(m.files.tearsheet)}" target="_blank" rel="noopener">⤓ Tear sheet</a>` : ""} <a class="btn sm" href="#/compare/${esc(m.ticker)}">Compare</a> <button class="btn sm" id="share">Copy share link</button> <a class="btn sm" href="#/" id="rebuild">Rebuild</a></div>
      </div>
      <div class="kpis">
        <div class="kpi hero-n"><div class="k">12-month price target</div><div class="v">${usd(m.target)}</div><div class="n">${pill(m.rating)} &nbsp;${signed(m.upside)} vs ${usd(m.price)}</div></div>
        <div class="kpi"><div class="k">Bear / Base / Bull</div><div class="v" style="font-size:17px">${usd(sc.bear, 0)} / ${usd(sc.base, 0)} / ${usd(sc.bull, 0)}</div></div>
        <div class="kpi"><div class="k">Model value</div><div class="v">${usd(m.model_value)}</div><div class="n">before street &amp; peer anchoring</div></div>
        <div class="kpi"><div class="k">Street median</div><div class="v">${usd(m.consensus?.target_median)}</div><div class="n">${m.consensus?.analysts || "n/a"} analysts</div></div>
        <div class="kpi"><div class="k">WACC</div><div class="v">${pct(m.wacc, 2)}</div><div class="n">beta: ${esc(m.beta_source || "")}</div></div>
      </div>
      ${chk ? `<div class="warn section"><b>Model fit:</b> ${esc(chk.note)}
        <div class="kvrow" style="margin-top:10px;border:0">${chk.metric === "P/B" ? `
          <div><div class="note">P/B</div><b>${mult(chk.pb)}</b></div><div><div class="note">P/TBV</div><b>${mult(chk.ptbv)}</b></div>
          <div><div class="note">ROE</div><b>${pct(chk.roe)}</b></div><div><div class="note">Peer median P/B → value</div><b>${mult(chk.peer_multiple)} → ${usd(chk.implied_value)}</b></div>` : `
          <div><div class="note">FFO / share (approx.)</div><b>${usd(chk.ffo_ps)}</b></div><div><div class="note">P/FFO</div><b>${mult(chk.pffo)}</b></div>
          <div><div class="note">Peer median P/FFO</div><b>${mult(chk.peer_multiple)}</b></div><div><div class="note">Implied value</div><b>${usd(chk.implied_value)}</b></div>`}</div></div>` : ""}

      ${changesPanel(m)}
      <section class="section card"><div class="card-h"><h2>Valuation range</h2><span class="note">bars show ranges; the dashed line is the target</span></div><div class="chart-wrap" id="ff"></div></section>

      <section class="section card"><div class="card-h"><h2>Share price and model target over time</h2><span class="note">blue: price · orange: target at each build</span></div><div class="chart-wrap" id="hist"></div>
        ${(m.history || []).length > 1 ? `<div class="scroll"><table><thead><tr><th>Build</th><th>Date</th><th class="r">Price</th><th class="r">Target</th><th>Rating</th></tr></thead><tbody>${[...m.history].reverse().map((h) => `<tr><td>v${h.version}</td><td>${esc(h.date)}</td><td class="r num">${usd(h.price)}</td><td class="r num">${usd(h.target)}</td><td>${pill(h.rating)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note" style="padding:0 18px 14px">Each rebuild adds a point, so this chart shows how the call has moved against the price.</p>`}</section>

      <section class="section card"><div class="card-h"><h2>Bull, base and bear cases</h2><span class="note">switch them in the Excel file on the Scenarios tab (cell D4)</span></div>
        <div class="scroll"><table><thead><tr><th>Assumption</th><th class="r">Bear</th><th class="r">Base</th><th class="r">Bull</th></tr></thead><tbody>
          <tr><td>Revenue growth, first projected year</td>${["bear", "base", "bull"].map((c) => `<td class="r num">${pct(cs[c]?.growth?.[0])}</td>`).join("")}</tr>
          <tr><td>Revenue growth, final projected year</td>${["bear", "base", "bull"].map((c) => `<td class="r num">${pct(cs[c]?.growth?.[4])}</td>`).join("")}</tr>
          ${caseRow("Cost of revenue % of revenue", pct, "cogs")}
          ${caseRow("Terminal growth rate", pct, "tg")}
          ${caseRow("Exit multiple vs. current EV/EBITDA", (z) => (nz(z) ? z.toFixed(2) + "x" : "—"), "exit_factor")}
          ${caseRow("Model value per share", usd, "model")}
          <tr class="tot"><td>Final price target</td>${["bear", "base", "bull"].map((c) => `<td class="r num"><b>${usd(cs[c]?.target)}</b></td>`).join("")}</tr>
          ${caseRow("Upside / (downside)", (z) => signed(z), "upside")}
        </tbody></table></div>
        <p class="note" style="padding:10px 18px 14px">Bull adds ${deltaPts(firstDelta("bull"))} of revenue growth a year and trims cost of revenue; bear does the reverse. SG&amp;A, D&amp;A, capex, working capital, tax and the cost of capital stay at base in every case.</p></section>

      ${x ? `<section class="section card" id="sl"><div class="card-h"><h2>Try your own assumptions</h2><span class="note">recalculates in your browser</span></div>
        <div class="presets"><span class="note">Start from:</span><button class="chip" data-p="bear">Bear</button><button class="chip on" data-p="base">Base</button><button class="chip" data-p="bull">Bull</button></div>
        <div class="sliders">
          <label>Revenue growth vs. base <output id="o-dg"></output><input type="range" id="s-dg" min="-10" max="10" step="0.5"></label>
          <label>Operating margin vs. base <output id="o-dm"></output><input type="range" id="s-dm" min="-10" max="10" step="0.5"></label>
          <label>WACC <output id="o-w"></output><input type="range" id="s-w" min="4" max="16" step="0.1"></label>
          <label>Terminal growth <output id="o-g"></output><input type="range" id="s-g" min="0" max="5" step="0.1"></label>
          <label>Exit EV/EBITDA multiple <output id="o-x"></output><input type="range" id="s-x" min="4" max="30" step="0.5"></label>
        </div>
        <div class="kpis slout" id="sl-out"></div>
        <p class="rdcf" id="rdcf"></p>
        <p class="note" style="padding:0 18px 16px">At base settings this matches the Excel model exactly (target ${usd(x.check?.target)}). Away from base it re-runs the same DCF, exit-multiple and comps blend and the street/peer anchoring; it usually lands within 1% of the Excel engine (a few percent at most), since the workbook also re-runs its PP&amp;E, debt and interest schedules.</p></section>` : ""}

      ${quarterPanel(m)}
      ${guidancePanel(m)}
      <section class="section card"><div class="card-h"><h2>Financial summary</h2><span class="note">$mm except per share · shaded columns are projections (base case)</span></div>
        <div class="scroll"><table class="fin"><thead><tr><th></th>${years.map((y, i) => `<th class="r${i >= hn ? " proj" : ""}">${esc(y)}</th>`).join("")}</tr></thead><tbody>
          ${row("Revenue", d.is?.revenue, mm)}${row("Revenue growth", d.is?.growth, pct, 1)}${row("Gross margin", d.is?.gm, pct)}
          ${row("EBITDA margin", d.is?.ebitda_m, pct)}${row("EBIT margin", d.is?.ebit_m, pct)}${row("Net income to common", d.is?.ni, mm)}
          ${row("Diluted EPS", d.is?.eps, (z) => usd(z))}
          <tr><td>Unlevered free cash flow</td>${years.map((_, i) => `<td class="r num${i >= hn ? " proj" : ""}">${i >= hn ? mm(d.fcf?.[i - hn]) : ""}</td>`).join("")}</tr>
        </tbody></table></div></section>

      <section class="section card"><div class="card-h"><h2>Peers</h2><span class="note">NYSE and Nasdaq · matched on Yahoo Finance industry first, then SEC industry code</span></div>
        <div class="scroll"><table><thead><tr><th>Company</th><th class="hide-sm">Why it's a peer</th><th class="r">Price</th><th class="r">Market cap</th><th class="r">EV / EBITDA</th><th class="r">P / E</th></tr></thead><tbody>
          ${(d.comps || []).map((p) => `<tr><td><a class="tk" href="#/m/${esc(p.ticker)}">${esc(p.ticker)}</a><span class="co">${esc(p.name)}</span></td><td class="hide-sm note">${esc((m.peer_matches || {})[p.ticker] || "Same SEC industry code")}</td><td class="r num">${usd(p.price)}</td><td class="r num">${big(p.mcap)}</td><td class="r num">${mult(p.ev_ebitda)}</td><td class="r num">${mult(p.pe)}</td></tr>`).join("")}
          <tr class="tot"><td>Peer median</td><td class="hide-sm"></td><td></td><td></td><td class="r num">${mult(d.comps_median?.ev_ebitda)}</td><td class="r num">${mult(d.comps_median?.pe)}</td></tr>
          <tr class="tot"><td>${esc(m.ticker)}</td><td class="hide-sm"></td><td class="r num">${usd(m.price)}</td><td></td><td class="r num">${mult(d.comps_self?.ev_ebitda)}</td><td class="r num">${mult(d.comps_self?.pe)}</td></tr>
        </tbody></table></div></section>

      <section class="section card"><div class="card-h"><h2>Historical financials</h2><span class="note">$mm except per share · straight from the Excel model · <a href="${esc(d.filings_index)}" target="_blank" rel="noopener">all 10-K filings ↗</a></span></div>
        <div class="scroll"><table class="fin hist"><thead><tr><th></th>${years.slice(0, hn).map((y, i) => { const l = d.tenk_links?.[i];
            return `<th class="r">${esc(y)}${l ? `<br><a class="note" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.form)} ↗</a>` : ""}</th>`; }).join("")}</tr></thead><tbody>
          ${histRows(d, hn)}
        </tbody></table></div>
        <p class="note" style="padding:10px 18px 14px">Figures come from each company's 10-K filings on SEC EDGAR (XBRL data; when a later filing restates a year, the restated number is used). The link under each year opens that 10-K on EDGAR.</p></section>`;

    footballChart(document.getElementById("ff"), ff, m.price, m.target);
    historyChart(document.getElementById("hist"), ph, m.history);
    document.getElementById("share").addEventListener("click", async (e) => {
      try { await navigator.clipboard.writeText(shareUrl); e.target.textContent = "Link copied"; } catch { prompt("Copy this link", shareUrl); }
    });
    document.getElementById("rebuild").addEventListener("click", () => sessionStorage.setItem("mb_prefill", m.ticker));

    if (x) {
      const bounded = Math.min(30, Math.max(4, nz(x.ev_ebitda_now) ? x.ev_ebitda_now : 4));
      const S = { dg: 0, dm: 0, wacc: x.wacc, g: x.g, mult: bounded * (cs.base?.exit_factor || 1) };
      const el = (id) => document.getElementById(id);
      const sync = () => {
        el("s-dg").value = S.dg * 100; el("s-dm").value = S.dm * 100; el("s-w").value = (S.wacc * 100).toFixed(1);
        el("s-g").value = (S.g * 100).toFixed(1); el("s-x").value = S.mult.toFixed(1);
      };
      const draw = () => {
        el("o-dg").textContent = deltaPts(S.dg); el("o-dm").textContent = deltaPts(S.dm); el("o-w").textContent = pct(S.wacc);
        el("o-g").textContent = pct(S.g); el("o-x").textContent = S.mult.toFixed(1) + "x";
        const r = valuate(x, S);
        el("sl-out").innerHTML = `
          <div class="kpi hero-n"><div class="k">Your target</div><div class="v">${usd(r.target)}</div><div class="n">${pill(ratingOf(r.upside))} ${signed(r.upside)} · model's ${usd(m.target)}</div></div>
          <div class="kpi"><div class="k">DCF (perpetuity)</div><div class="v">${usd(r.dcf)}</div></div>
          <div class="kpi"><div class="k">DCF (exit multiple)</div><div class="v">${usd(r.exit)}</div></div>
          <div class="kpi"><div class="k">Model value</div><div class="v">${usd(r.model)}</div></div>
          <div class="kpi"><div class="k">Year-5 revenue · margin</div><div class="v" style="font-size:17px">${big(r.rev5)} · ${pct(r.margin5)}</div></div>`;
        const ig = impliedGrowth(x, S);
        el("rdcf").innerHTML = nz(ig) ? `<b>Reverse DCF.</b> At this WACC, margin and terminal growth, today's ${usd(x.price)} share price implies revenue growth of <b>${pct(ig)} a year</b> for five years. The model's base case has ${pct(baseCagr(x))}${S.dg ? `, and your setting gives ${pct((r.rev5 / x.rev0) ** 0.2 - 1)}` : ""}.` : "";
      };
      const preset = (c) => {
        const k = cs[c] || {};
        S.dg = (k.growth_delta || [0])[0] || 0; S.dm = k.margin_delta || 0; S.wacc = x.wacc;
        S.g = nz(k.tg) ? k.tg : x.g; S.mult = bounded * (k.exit_factor || 1);
        sync(); draw();
      };
      [["s-dg", "dg", 100], ["s-dm", "dm", 100], ["s-w", "wacc", 100], ["s-g", "g", 100], ["s-x", "mult", 1]].forEach(([id, k, f]) =>
        el(id).addEventListener("input", (e) => { S[k] = Number(e.target.value) / f; document.querySelectorAll(".presets .chip").forEach((c) => c.classList.remove("on")); draw(); }));
      document.querySelectorAll(".presets .chip").forEach((b) => b.addEventListener("click", () => {
        document.querySelectorAll(".presets .chip").forEach((c) => c.classList.toggle("on", c === b)); preset(b.dataset.p); }));
      preset("base");
    }
  }

  // ------------------------------------------------------------- library (owner only)
  async function libraryView() {
    document.title = "Library · " + SITE;
    if (!ownerKey()) { ownerView("The library is private. Enter your owner key to open it."); return; }
    app.innerHTML = `<p class="muted loading">Loading library…</p>`;
    let lib;
    try { lib = await libraryIndex(); } catch (e) {
      if (String(e.message) === "locked") { store.set("mb_owner", ""); ownerView("That key didn't work. Enter it again."); return; }
      app.innerHTML = `<div class="warn">Couldn't load the library (${esc(e.message)}).</div>`; return;
    }
    const models = lib.models || [];
    const sectors = [...new Set(models.map((m) => m.sector))].sort();
    const render = (q, sel) => {
      const ql = q.trim().toLowerCase();
      const pick = models.filter((m) => (!sel || m.sector === sel) && (!ql || m.ticker.toLowerCase().includes(ql) || m.name.toLowerCase().includes(ql)));
      const groups = [...new Set(pick.map((m) => m.sector))].sort();
      document.getElementById("lib-body").innerHTML = groups.map((g) => {
        const rows = pick.filter((m) => m.sector === g);
        return `<div class="card section"><div class="card-h"><h2>${esc(g)}</h2><span class="note">${rows.length} model${rows.length > 1 ? "s" : ""}</span></div>
          <div class="scroll"><table><thead><tr><th>Company</th><th class="r">Target</th><th class="r">Price</th><th class="r">Upside</th><th>Rating</th><th class="r hide-sm">Bear / Base / Bull</th><th class="hide-sm">Generated</th><th class="r">Download</th></tr></thead>
          <tbody>${rows.map((m) => `<tr><td><a class="tk" href="#/m/${esc(m.ticker)}">${esc(m.ticker)}</a><span class="co">${esc(m.name)} · ${esc(m.industry || "")}</span></td>
            <td class="r num"><b>${usd(m.target)}</b></td><td class="r num">${usd(m.price)}</td><td class="r num">${signed(m.upside)}</td><td>${pill(m.rating)}</td>
            <td class="r num hide-sm">${usd(m.scenarios?.bear, 0)} / ${usd(m.scenarios?.base, 0)} / ${usd(m.scenarios?.bull, 0)}</td>
            <td class="hide-sm note">${esc((m.generated_at || "").slice(0, 10))} · v${m.version}${m.times_generated > 1 ? ` · ${m.times_generated}×` : ""}</td>
            <td class="r"><a class="btn sm" href="${esc(m.files?.xlsx)}">.xlsx</a> <a class="btn sm" href="${esc(m.files?.pdf)}" target="_blank" rel="noopener">PDF</a></td></tr>`).join("")}</tbody></table></div></div>`;
      }).join("") || `<div class="empty card">No models match.</div>`;
    };
    app.innerHTML = `<section class="hero"><h1>Model library</h1><p>Every model generated on the site, by sector. Only you can see this page.</p>
      <div class="fresh"><span class="dot" aria-hidden="true"></span>${models.length} companies · ${sectors.length} sectors · updated ${ago(lib.updated_at)} · <a href="#" id="lock">lock</a></div></section>
      <div class="lib-tools"><input id="lib-q" placeholder="Filter by ticker or name" aria-label="Filter library">
        <div class="chips"><button class="chip on" data-s="">All</button>${sectors.map((s) => `<button class="chip" data-s="${esc(s)}">${esc(s)} <span>${models.filter((m) => m.sector === s).length}</span></button>`).join("")}</div></div>
      <div id="lib-body"></div>`;
    let sel = "";
    const q = document.getElementById("lib-q");
    q.addEventListener("input", () => render(q.value, sel));
    app.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { sel = c.dataset.s; app.querySelectorAll(".chip").forEach((z) => z.classList.toggle("on", z === c)); render(q.value, sel); }));
    document.getElementById("lock").addEventListener("click", (e) => { e.preventDefault(); store.set("mb_owner", ""); navLib(); location.hash = "#/"; });
    render("", "");
  }
  function ownerView(msg) {
    document.title = "Owner · " + SITE;
    app.innerHTML = `<div class="doc"><h1>Owner access</h1><p class="muted">${esc(msg || "Enter your owner key.")}</p>
      <form id="own" class="gen-row" autocomplete="off"><div class="gen-input"><input id="own-k" type="password" placeholder="Owner key" aria-label="Owner key"></div><button class="btn primary" type="submit">Unlock</button></form>
      <p class="note">The key stays in this browser only. Use "lock" on the Library page to forget it.</p></div>`;
    document.getElementById("own").addEventListener("submit", (e) => { e.preventDefault(); store.set("mb_owner", document.getElementById("own-k").value.trim()); navLib(); libraryView(); });
  }
  function navLib() { const a = document.getElementById("nav-lib"); if (a) a.hidden = !ownerKey(); }

  // ------------------------------------------------------------- methodology & build notes
  function method() {
    document.title = "Methodology · " + SITE;
    app.innerHTML = `<div class="doc">
      <h1>Methodology</h1>
      <p class="muted">How a generated model gets from a ticker to a price target, and what it can't do.</p>
      <h2>1. Data</h2>
      <p>Historical financials come only from the company's 10-K filings, read from SEC EDGAR's XBRL company facts. When a company restates, the latest filing wins. Each model page lists the key historical figures exactly as they sit in the Excel model, with a link to each year's 10-K. Prices, beta and analyst consensus come from Yahoo Finance; the 10-year Treasury yield is the risk-free rate.</p>
      <h2>2. The workbook</h2>
      <p>Each model is a real, formula-driven Excel file built to one layout: Cover, Scenarios, Revenue Build, Income Statement, Balance Sheet, Cash Flow, Schedules (PP&amp;E, D&amp;A, retained earnings, revolver and interest), WACC, DCF, Comps, Target Price and Financial Ratios, with the raw SEC pull in a hidden tab. Blue cells are typed inputs, black are formulas on the same tab, green are links from another tab. The balance sheet balances in every year; a check row proves it.</p>
      <h2>3. Drivers</h2>
      <p>Base-case growth starts from recent revenue growth and fades toward long-run growth over five years. Margins, capex, working capital and tax use three-year medians, so one odd year doesn't set the forecast. The bull case adds 3 points of growth a year and trims cost of revenue by 1 point; bear does the reverse, with higher and lower terminal growth and exit multiples. Everything else is held at base, so the cases isolate the demand and margin call. Flip cell D4 on the Scenarios tab and the whole workbook follows.</p>
      <h2>4. Valuation</h2>
      <ol class="steps">
        <li><b>Model value.</b> 40% perpetuity-growth DCF, 40% exit-multiple DCF (today's EV/EBITDA, bounded at 4–30×) and 20% trading comps (peer median EV/EBITDA). Cash flows are discounted at a CAPM WACC.</li>
        <li><b>Anchoring.</b> A mechanical model can land far from what the market and the industry's analysts expect. The final target blends 50% model value, 25% the street median target and 25% a peer-relative value (today's price times the average upside analysts see for the peers).</li>
        <li><b>Guardrail.</b> The upside is then kept within 15 points of the peers' average analyst upside, so no call stands far outside its industry. Bull and bear targets scale from that anchored base by each case's model value.</li>
        <li><b>Rating.</b> Buy at 15%+ upside, Sell at 10%+ downside, otherwise Hold.</li>
      </ol>
      <h2>5. Current data, guidance and checks</h2>
      <p>Each model page adds the latest quarter and trailing-twelve-month figures from the most recent 10-Q, the outlook sentences from the latest earnings release (with a flag when the model's growth sits outside management's range), a reverse DCF showing the growth today's price implies, and a data-quality grade. Every workbook ends with an Audit tab of live checks: the balance sheet balances, cash ties out, and historicals tie to the 10-K.</p>
      <h2>6. Track record</h2>
      <p>Every build is saved. Each weekday the site marks every model to market; once a call is 30 days old it is scored (a Buy is working if the stock is up, a Sell if it's down, a Hold if it's within 10%) and compared with the S&amp;P 500. When a company files a new 10-K or 10-Q, its model rebuilds automatically.</p>
      <h2>7. Peers</h2>
      <p>Up to five NYSE or Nasdaq companies, chosen in tiers: first the same Yahoo Finance industry, then the same 4-digit SEC industry code and sector, then the same code, then a related (3-digit) code in the same sector. Candidates come from the SEC code hierarchy plus Yahoo's similar-companies list. A broad 2-digit code group only contributes companies that also share the Yahoo industry, so an appliance maker isn't benchmarked against chip makers. Affiliates (a parent and its listed partnership), blank-check shells and the company's own share classes are excluded. Within a tier the closest in revenue wins: 0.1–10× for same-industry matches, 0.2–5× otherwise. Each model page says why every peer was picked.</p>
      <h2>8. Limits</h2>
      <ul>
        <li>Revenue is modelled at the consolidated level: segment detail isn't in standardized XBRL.</li>
        <li>No management guidance, backlog, pricing or one-offs. A company in transition can be badly mispriced.</li>
        <li>US-GAAP filers reporting in dollars only. Foreign IFRS filers, funds and trusts can't be modelled yet.</li>
        <li>Banks, insurers and REITs don't fit EV/EBITDA and free cash flow. Their pages add P/B, P/TBV and ROE, or P/FFO, against peers, and say so plainly.</li>
        <li>Peer screens depend on Yahoo's industry labels; when Yahoo is unavailable, peers fall back to SEC industry codes only.</li>
      </ul>
      <p class="note">Automated research for educational use. Not investment advice.</p></div>`;
  }
  function built() {
    document.title = "How I built this · " + SITE;
    const site = INDEX?.site || {};
    app.innerHTML = `<div class="doc">
      <h1>How I built this</h1>
      <p class="muted">Model Builder turns a ticker into a full analyst-style Excel model in about two minutes, with no server of my own to run.</p>
      <h2>The pieces</h2>
      <ol class="steps">
        <li><b>Front end.</b> A static site on GitHub Pages: plain HTML, CSS and JavaScript, no framework. Charts are hand-drawn SVG. The scenario sliders re-run the workbook's DCF in the browser.</li>
        <li><b>API.</b> A Cloudflare Worker checks the ticker against the NYSE and Nasdaq universe (rebuilt weekly from SEC data), rate-limits, reuses any model built in the last six hours, and starts a GitHub Actions build. It also serves model pages and link previews.</li>
        <li><b>Data pipeline.</b> Python pulls the 10-K XBRL facts from SEC EDGAR, prices and consensus from Yahoo Finance, and Treasury yields, then picks same-industry peers.</li>
        <li><b>Excel engine.</b> openpyxl writes a formula-driven workbook following my own modelling rules (colour coding, no SUMPRODUCT, a balance check). Headless LibreOffice then recalculates it, runs the bull, base and bear cases, and saves a real .xlsx.</li>
        <li><b>Report.</b> reportlab writes a five-page PDF initiation from the same numbers.</li>
        <li><b>Storage.</b> Each build is committed back to the repo: three versions per ticker, plus a JSON summary and a share image.</li>
      </ol>
      <h2>Why it's built this way</h2>
      <p>Everything runs on free tiers: GitHub Actions does the heavy lifting in a prebuilt container, and the Worker keeps the token that starts builds off the public site. Tests rebuild a model from saved SEC fixtures on every change and check that it balances, ties to the 10-K and matches the skill's formatting rules.</p>
      <h2>Stack</h2>
      <p class="mono note">Python · openpyxl · LibreOffice UNO · reportlab · matplotlib · GitHub Actions · GitHub Pages · Cloudflare Workers · SEC EDGAR XBRL · Yahoo Finance</p>
      <p><a class="btn" href="https://github.com/Jash-financebro/equity-coverage" target="_blank" rel="noopener">Source on GitHub ↗</a>${site.portfolio ? ` <a class="btn" href="${esc(site.portfolio)}" target="_blank" rel="noopener">My portfolio ↗</a>` : ""}${site.linkedin ? ` <a class="btn" href="${esc(site.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a>` : ""}</p>
    </div>`;
  }

  // ----------------------------------------------------------------- router
  async function route() {
    hideTip();
    if (!INDEX) {
      try { INDEX = await getJSON("data/index.json"); }
      catch { INDEX = { coverage: [], site: {}, generated_at: "— first refresh pending" }; }
      const site = INDEX.site || {};
      const nav = document.getElementById("nav");
      if (site.portfolio) nav.insertAdjacentHTML("beforeend", `<a href="${esc(site.portfolio)}" target="_blank" rel="noopener">Portfolio ↗</a>`);
      if (site.linkedin) nav.insertAdjacentHTML("beforeend", `<a href="${esc(site.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a>`);
      document.getElementById("foot-right").textContent = INDEX.owner ? "© " + new Date().getFullYear() + " " + INDEX.owner : "";
    }
    const h = location.hash.replace(/^#\/?/, "");
    navLib();
    if (!window.__mbChrome) { window.__mbChrome = true; initChrome(); }
    document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#/" + (["method", "library", "built", "update"].includes(h) ? h : h.startsWith("m/") ? "__" : "")));
    window.scrollTo(0, 0);
    if (!h || h === "coverage" || h === "fund") { if (h) history.replaceState(null, "", "#/"); generateView(); }
    else if (h === "library") libraryView();
    else if (h === "owner") ownerView();
    else if (h === "method") method();
    else if (h === "built") built();
    else if (h === "update") updateView();
    else if (h === "compare" || h.startsWith("compare/")) comparePage(decodeURIComponent(h.slice(8)));
    else if (h.startsWith("m/")) modelPage(decodeURIComponent(h.slice(2)));
    else modelPage(decodeURIComponent(h));
  }
  window.addEventListener("hashchange", route);
  route();
})();
