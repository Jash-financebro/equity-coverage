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
      const go = { g: "#/", u: "#/update", c: "#/compare/", m: "#/method", p: "#/portfolio", q: "#/quiz", s: "#/screener", f: "#/funds" }[e.key];
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

  // ------------------------------------------------------------- "Explain this model" walkthrough (opens on click)
  function explainSteps(m) {
    const d = m.detail || {}, x = d.dcf_inputs || {}, v = d.valuation || {}, cs = d.cases || {}, an = v.anchor || {}, w = d.wacc || {};
    const hn = d.hist_n || 3, yrs = d.years || [], is = d.is || {};
    const lastY = yrs[hn - 1], y5 = yrs[yrs.length - 1];
    const g = cs.base?.growth || [];
    const lq = m.latest_quarter?.quarter?.revenue;
    const tvShare = (() => { try { if (!x.rev) return null; const S = { dg: 0, dm: 0, wacc: x.wacc, g: x.g, mult: 10 };
      const r = valuate(x, S); const df5 = 1 / (1 + x.wacc) ** 5; const tv = (r.ufcf[4] * (1 + x.g)) / (x.wacc - x.g) * df5;
      const spv = r.ufcf.reduce((a, u, i) => a + u / (1 + x.wacc) ** (i + 1), 0); return tv / (tv + spv); } catch { return null; } })();
    return [
      { t: "The answer first", sel: ".kpis", b: `We think ${esc(m.name)} is worth <b>${usd(m.target)}</b> a share over the next 12 months, against ${usd(m.price)} today: ${signed(m.upside)}, so the rating is <b>${esc(m.rating)}</b> (Buy needs 15%+ upside, Sell 10%+ downside). The next steps show where that number comes from.` },
      { t: "Where the revenue comes from", sel: "#sec-fin", b: `Revenue was ${big(is.revenue?.[hn - 1])} in ${esc(lastY)}${nz(is.growth?.[hn - 1]) ? `, up ${pct(is.growth[hn - 1])} on the year before` : ""}. The base case grows it ${pct(g[0])} next year, fading to ${pct(g[4])} by ${esc(y5)} as growth settles toward the long-run economy${lq && nz(lq.chg) ? `. For context, the latest quarter was ${signed(lq.chg)} year on year` : ""}.` },
      { t: "How much of it is profit", sel: "#sec-fin", b: `Out of each dollar of sales, ${pct(is.gm?.[hn - 1])} is left after the direct cost of making the product (gross margin) and ${pct(is.ebitda_m?.[hn - 1])} after running the business (EBITDA margin). The model holds these near their three-year medians, so one unusual year doesn't drive the forecast.` },
      { t: "Turning profit into cash", sel: "#sec-fin", b: `What a business is worth depends on the cash it can hand back to owners. Free cash flow is operating profit after tax, plus non-cash charges like depreciation, minus what it spends on equipment (capex) and extra working capital. Year-one free cash flow comes to ${big(d.fcf?.[0])}.` },
      { t: "The discount rate (WACC)", sel: ".kpis", b: `A dollar next year is worth less than a dollar today, and a risky dollar less still. The cost of equity is the risk-free rate ${pct(w.rf)} plus beta ${nz(w.beta) ? Number(w.beta).toFixed(2) : "—"} × the market's extra return ${pct(w.erp)}, which gives ${pct(w.ke)}. Blended with the after-tax cost of debt (${pct(w.kd_at)}), the WACC is <b>${pct(w.wacc, 2)}</b>. A higher WACC means a lower value.` },
      { t: "Three ways to value it", sel: "#ff", b: `<b>DCF, perpetuity growth:</b> discount five years of cash flow, then assume ${pct(x.g)} growth forever: ${usd(v.dcf)} a share${nz(tvShare) ? ` (about ${pct(tvShare, 0)} of that comes from the years after year 5, which is normal and why terminal growth matters)` : ""}. <b>DCF, exit multiple:</b> assume it sells in year 5 at today's EV/EBITDA: ${usd(v.exit)}. <b>Comps:</b> price it like its peers: ${usd(v.comps)}. Blended 40/40/20, that's a <b>model value of ${usd(v.model_value)}</b>.` },
      { t: "A sanity check against the market", sel: "#ff", b: `A formula can land far from what professionals expect. So the final target blends the model value with the street's median target (${usd(an.street)}) and a peer-relative value (today's price × the ${pct(an.peer_up)} average upside analysts see for its peers), then keeps the result within 15 points of that peer average. That's how ${usd(v.model_value)} becomes <b>${usd(m.target)}</b>.` },
      { t: "What could go better or worse", sel: "#sec-cases", b: `The bull case adds 3 points of growth a year and a little margin; the bear case takes them away. That moves the target from <b>${usd(cs.bear?.target)}</b> (bear) to <b>${usd(cs.bull?.target)}</b> (bull). In the Excel file you can flip between them on the Scenarios tab, cell D4.` },
      { t: "Now try it yourself", sel: "#sl", b: `Drag the sliders to see how much each assumption matters. Notice how sensitive the value is to WACC and terminal growth; that's the main lesson of any DCF. The reverse DCF line tells you what growth today's price already assumes.` },
    ];
  }
  function openExplain(m) {
    const steps = explainSteps(m);
    let i = 0;
    document.getElementById("tour")?.remove();
    document.body.insertAdjacentHTML("beforeend", `<div id="tour" class="tour" role="dialog" aria-label="Explain this model"><div class="tour-h"><span class="note" id="tour-n"></span><button class="tour-x" aria-label="Close">×</button></div><h3 id="tour-t"></h3><p id="tour-b"></p>
      <div class="tour-f"><button class="btn sm" id="tour-back">Back</button><button class="btn sm primary" id="tour-next">Next</button></div></div>`);
    const tour = document.getElementById("tour");
    const show = () => {
      const s = steps[i];
      document.getElementById("tour-n").textContent = `Step ${i + 1} of ${steps.length}`;
      document.getElementById("tour-t").textContent = s.t;
      document.getElementById("tour-b").innerHTML = s.b;
      document.getElementById("tour-back").disabled = i === 0;
      document.getElementById("tour-next").textContent = i === steps.length - 1 ? "Done" : "Next";
      document.querySelectorAll(".spot").forEach((e) => e.classList.remove("spot"));
      const el = document.querySelector(s.sel);
      const box = el?.closest("section") || el;
      if (box) { box.classList.add("spot"); box.scrollIntoView({ behavior: "smooth", block: "center" }); }
    };
    const close = () => { tour.remove(); document.querySelectorAll(".spot").forEach((e) => e.classList.remove("spot")); };
    tour.querySelector(".tour-x").addEventListener("click", close);
    document.getElementById("tour-back").addEventListener("click", () => { if (i > 0) { i--; show(); } });
    document.getElementById("tour-next").addEventListener("click", () => { if (i < steps.length - 1) { i++; show(); } else close(); });
    window.addEventListener("hashchange", close, { once: true });
    show();
  }

  // ------------------------------------------------------------- quiz
  const CONCEPTS = [
    { q: "A company's P/E ratio is 20. What does that mean?", o: ["Investors pay $20 for each $1 of yearly earnings", "The stock has risen 20% this year", "It earns 20% on its equity", "It trades at 20 times its revenue"], a: 0, e: "P/E is share price divided by earnings per share. At 20×, you pay $20 for every $1 the company earns in a year." },
    { q: "Why must terminal growth be lower than WACC in a DCF?", o: ["Otherwise the formula gives an infinite or negative value", "Because regulators require it", "Because WACC is always 10%", "It doesn't have to be"], a: 0, e: "The perpetuity value is cash flow × (1+g) / (WACC − g). If g reaches WACC the denominator hits zero, and no business can outgrow the economy forever anyway." },
    { q: "Which is a better measure of the cash a business can return to owners?", o: ["Free cash flow", "Revenue", "Gross profit", "Number of employees"], a: 0, e: "Free cash flow is what's left after running the business and investing in it: the cash that can pay dividends, buy back shares or pay down debt." },
    { q: "A stock has a beta of 1.5. If the market falls 10%, it would typically fall about…", o: ["15%", "10%", "5%", "1.5%"], a: 0, e: "Beta measures how much a stock tends to move with the market. 1.5 means roughly 1.5× the market's moves, up and down." },
    { q: "What's the difference between enterprise value and market cap?", o: ["Enterprise value adds debt and subtracts cash", "They're the same thing", "Market cap includes debt", "Enterprise value only counts cash"], a: 0, e: "Market cap is the value of the shares. Enterprise value is what you'd pay for the whole business: shares plus debt, minus the cash you'd get with it." },
    { q: "A 10-Q is…", o: ["A company's quarterly report to the SEC", "An annual report", "A filing about insider trades", "A credit rating"], a: 0, e: "Companies file a 10-K once a year and a 10-Q for each of the other three quarters. Both are on SEC EDGAR for free." },
    { q: "If a company's WACC goes up, what happens to its DCF value, all else equal?", o: ["It goes down", "It goes up", "Nothing", "It doubles"], a: 0, e: "Future cash flows are discounted at the WACC. A higher rate makes each future dollar worth less today." },
    { q: "Owning 10 stocks all in the same industry is…", o: ["Less diversified than it looks", "Perfectly diversified", "The same as owning an index fund", "Risk-free"], a: 0, e: "Stocks in one industry tend to rise and fall together. Spreading across sectors does more to reduce risk than adding more of the same kind of company." },
    { q: "Dividend yield is…", o: ["Annual dividends per share ÷ share price", "Dividends ÷ revenue", "The share price ÷ dividends", "The growth rate of dividends"], a: 0, e: "A $100 stock paying $3 a year in dividends yields 3%. A very high yield can be a warning sign that the market expects a cut." },
    { q: "EBITDA margin measures…", o: ["Operating profit before depreciation and amortization, as a share of revenue", "Net income ÷ assets", "How much debt a company has", "The share price trend"], a: 0, e: "EBITDA is earnings before interest, taxes, depreciation and amortization. Dividing by revenue shows how much of each sales dollar the core business keeps." },
    { q: "Why do analysts use 'comps' (comparable companies)?", o: ["To check a valuation against how the market prices similar businesses", "To copy other analysts' targets", "To calculate taxes", "Because DCFs are illegal"], a: 0, e: "If peers trade at 12× EBITDA and the model implies 25×, either this company is special or the model is too optimistic: comps keep it honest." },
    { q: "A company with negative earnings has a P/E that is…", o: ["Not meaningful", "Very attractive", "Zero", "Infinite and good"], a: 0, e: "P/E only makes sense with positive earnings. For loss-making companies, analysts look at revenue multiples or cash flow instead." },
    { q: "Market cap of $300 million to $2 billion is usually called…", o: ["Small cap", "Mega cap", "Large cap", "Penny stock"], a: 0, e: "Rough ranges: small cap $300M–$2B, mid cap $2B–$10B, large cap above $10B, mega cap above about $200B." },
    { q: "Which part of a DCF usually holds most of the value?", o: ["The terminal value (everything after the forecast years)", "Year 1 cash flow", "The tax rate", "The share count"], a: 0, e: "For most healthy companies, more than half of DCF value comes from the years after the explicit forecast. That's why terminal growth and WACC deserve the most thought." },
    { q: "Gross margin is…", o: ["(Revenue − cost of goods sold) ÷ revenue", "Net income ÷ revenue", "Revenue ÷ assets", "Cash ÷ debt"], a: 0, e: "It shows how much of each sale is left after the direct cost of making the product, before overheads like marketing and R&D." },
    { q: "A 'margin of safety' means…", o: ["Buying only when the price is well below your estimate of value", "Keeping cash in a savings account", "A stop-loss order", "Borrowing to invest"], a: 0, e: "Valuations are estimates. Buying at a discount to your value leaves room for being wrong." },
  ];
  const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const numOpts = (right, f, spread = [0.75, 0.88, 1.15, 1.3]) => {
    const picks = shuffle(spread).slice(0, 3).map((k) => right * k);
    const all = shuffle([right, ...picks]);
    const o = all.map(f);
    if (new Set(o).size < o.length) return null;  // options would look identical once rounded
    return { o, a: all.indexOf(right) };
  };
  function modelQuestions(m) {
    const d = m.detail || {}, x = d.dcf_inputs, cs = d.cases || {}, T = esc(m.ticker), out = [];
    if (x) {
      const S = { dg: 0, dm: 0, wacc: x.wacc, g: x.g, mult: Math.min(30, Math.max(4, nz(x.ev_ebitda_now) ? x.ev_ebitda_now : 4)) };
      const base = valuate(x, S), hi = valuate(x, { ...S, wacc: x.wacc + 0.01 });
      out.push({ q: `${T}'s WACC is ${pct(x.wacc, 1)}. If it rose to ${pct(x.wacc + 0.01, 1)}, what would happen to the perpetuity DCF value (now ${usd(base.dcf)})?`,
        o: ["It would fall", "It would rise", "It wouldn't change"], a: 0, e: `It falls to about ${usd(hi.dcf)} (${signed(hi.dcf / base.dcf - 1)}). Every future cash flow is discounted harder, and the terminal value shrinks most.` });
      const up = valuate(x, { ...S, dg: 0.03 });
      const n = numOpts(up.target, (v) => usd(v, 0));
      if (n) out.push({ q: `If ${T} grew revenue 3 points faster every year than the base case, roughly where would the target land (base: ${usd(m.target, 0)})?`, ...n,
        e: `About ${usd(up.target, 0)}. Faster growth means more cash flow every year and a bigger business at year 5, which also lifts the exit and terminal values.` });
    }
    if (nz(m.upside) && nz(m.target)) {
      const n = Math.abs(m.upside) >= 0.01 ? numOpts(m.upside, (v) => pct(v), [m.upside >= 0 ? 0.5 : 1.5, 2, -1, 0.25]) : null;
      if (n) out.push({ q: `${T}'s price is ${usd(m.price)} and the model's target is ${usd(m.target)}. What's the upside?`, ...n,
        e: `(${usd(m.target)} ÷ ${usd(m.price)}) − 1 = ${pct(m.upside)}. That's what sets the ${esc(m.rating)} rating: Buy at 15%+, Sell at 10%+ downside.` });
    }
    const sm = d.comps_self?.ev_ebitda, pm = d.comps_median?.ev_ebitda;
    if (nz(sm) && nz(pm) && sm > 0 && pm > 0) {
      out.push({ q: `${T} trades at ${mult(sm)} EV/EBITDA. Its peers' median is ${mult(pm)}. On this measure, ${T} is…`,
        o: [`More expensive than its peers`, `Cheaper than its peers`, `Priced exactly like its peers`], a: sm > pm ? 0 : 1,
        e: sm > pm ? `At ${mult(sm)} vs ${mult(pm)}, investors pay more per dollar of EBITDA, usually because they expect faster growth or steadier profits.` : `At ${mult(sm)} vs ${mult(pm)}, investors pay less per dollar of EBITDA. That can mean a bargain, or that the market sees more risk or slower growth.` });
    }
    if (nz(cs.bear?.target) && nz(cs.bull?.target)) {
      out.push({ q: `Which change moves ${T} from the base case to the bull case?`,
        o: ["Faster revenue growth and a slightly lower cost of revenue", "A higher WACC", "Fewer shares outstanding", "A lower tax rate"], a: 0,
        e: `The bull case adds 3 points of growth a year and trims cost of revenue by 1 point, taking the target from ${usd(m.target, 0)} to ${usd(cs.bull.target, 0)}. Everything else stays at base.` });
    }
    return shuffle(out).slice(0, 4);
  }
  async function quizView() {
    document.title = "Quiz · " + SITE;
    const r = await recentData();
    const seen = new Set(), models = [...(r.trending || []), ...(r.models || [])].filter((m) => !seen.has(m.ticker) && seen.add(m.ticker));
    const best = Number(store.get("mb_quiz_best") || 0);
    app.innerHTML = `<section class="hero"><h1>Quiz</h1><p>Six questions: some on investing basics, some on a real company's model from this site, so you see the ideas at work on actual numbers. ${best ? `Your best so far: ${best}/6.` : ""}</p></section>
      <div class="card gen-box"><form id="qz-f" class="gen-row" autocomplete="off">
        <div class="gen-input"><input id="qz-t" list="qz-l" placeholder="Company to quiz on, e.g. ${esc(models[0]?.ticker || "KO")}" aria-label="Ticker" value="${esc(models[0]?.ticker || "")}" autocapitalize="characters">
          <datalist id="qz-l">${models.map((m) => `<option value="${esc(m.ticker)}">${esc(m.name)}</option>`).join("")}</datalist></div>
        <button class="btn primary big" type="submit">Start quiz</button></form>
        <p class="note">Any company that has a model on the site works. No model yet? <a href="#/">Generate one</a> first.</p></div>
      <div id="qz"></div>`;
    document.getElementById("qz-f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const t = document.getElementById("qz-t").value.trim().toUpperCase().replace(/[./]/g, "-");
      const box = document.getElementById("qz");
      box.innerHTML = `<p class="muted loading">Loading ${esc(t)}…</p>`;
      let m = null;
      if (t) { try { const base = await apiBase(); const res = await fetch(`${base}/api/model?ticker=${encodeURIComponent(t)}`); if (res.ok) m = await res.json(); } catch { /* concept-only round */ } }
      const mq = m ? modelQuestions(m) : [];
      const qs = [...mq, ...shuffle(CONCEPTS).slice(0, 6 - mq.length)].slice(0, 6).map((q) => ({ ...q, ...(q.o.length && q.a === 0 && !q.fixed ? reorder(q) : {}) }));
      runQuiz(box, qs, m);
    });
  }
  function reorder(q) { const idx = shuffle(q.o.map((_, i) => i)); return { o: idx.map((i) => q.o[i]), a: idx.indexOf(q.a), fixed: true }; }
  function runQuiz(box, qs, m) {
    let i = 0, score = 0;
    const draw = () => {
      if (i >= qs.length) {
        const best = Math.max(score, Number(store.get("mb_quiz_best") || 0)); store.set("mb_quiz_best", String(best));
        box.innerHTML = `<div class="card qz-card"><h2 class="sec">Done</h2><p class="qz-score">${score} / ${qs.length}</p>
          <p class="muted">${score === qs.length ? "Perfect round." : score >= 4 ? "Solid. Review the explanations you missed and try another company." : "Every analyst started here. Open the model page and use \"Explain this model\" to see these ideas step by step."}</p>
          <div class="gen-actions">${m ? `<a class="btn sm" href="#/m/${esc(m.ticker)}">Open the ${esc(m.ticker)} model</a>` : ""}<button class="btn sm primary" id="qz-again">Another round</button></div></div>`;
        document.getElementById("qz-again").addEventListener("click", () => document.getElementById("qz-f").requestSubmit());
        return;
      }
      const q = qs[i];
      box.innerHTML = `<div class="card qz-card"><div class="note">Question ${i + 1} of ${qs.length} · score ${score}</div><h3 class="qz-q">${q.q}</h3>
        <div class="qz-opts">${q.o.map((o, k) => `<button class="qz-o" data-k="${k}">${o}</button>`).join("")}</div><div id="qz-e"></div></div>`;
      box.querySelectorAll(".qz-o").forEach((b) => b.addEventListener("click", () => {
        const k = Number(b.dataset.k), right = k === q.a;
        if (right) score++;
        box.querySelectorAll(".qz-o").forEach((x) => { x.disabled = true; const kk = Number(x.dataset.k); if (kk === q.a) x.classList.add("ok"); else if (kk === k) x.classList.add("no"); });
        document.getElementById("qz-e").innerHTML = `<p class="qz-exp"><b>${right ? "Right." : "Not quite."}</b> ${q.e}</p><button class="btn sm primary" id="qz-n">${i === qs.length - 1 ? "See score" : "Next"}</button>`;
        document.getElementById("qz-n").addEventListener("click", () => { i++; draw(); });
      }));
    };
    draw();
  }

  // ------------------------------------------------------------- practice portfolio
  function portfolioChart(el, series) {
    const W = 1040, H = 260, L = 64, R = 20, T = 14, B = 28;
    const all = series.flatMap((s) => s.pts.map((p) => p[1]));
    if (!all.length) { el.innerHTML = `<p class="empty">Not enough price history.</p>`; return; }
    const ticks = niceTicks(Math.min(...all) * 0.98, Math.max(...all) * 1.02, 5);
    const mn = ticks[0], mx = ticks[ticks.length - 1], n = series[0].pts.length;
    const x = (i) => L + (i / Math.max(1, n - 1)) * (W - L - R), y = (v) => T + (1 - (v - mn) / (mx - mn)) * (H - T - B);
    el.innerHTML = `<div class="legend">${series.map((s) => `<span><i style="background:${s.c}"></i>${esc(s.name)} ${usd(s.pts.at(-1)[1], 0)}</span>`).join("")}</div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Portfolio value over the past year vs the S&P 500"><style>.ax{font:11px var(--mono);fill:var(--ink-3)}</style>
      ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line-2)"/><text class="ax" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">$${Math.round(t).toLocaleString()}</text>`).join("")}
      ${series.map((s) => `<path d="${s.pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join("")}" fill="none" stroke="${s.c}" stroke-width="2"/>`).join("")}
      <text class="ax" x="${L}" y="${H - 8}">${esc(series[0].pts[0][0])}</text><text class="ax" x="${W - R}" y="${H - 8}" text-anchor="end">${esc(series[0].pts.at(-1)[0])}</text></svg>`;
  }
  async function portfolioView() {
    document.title = "Practice portfolio · " + SITE;
    let saved; try { saved = JSON.parse(store.get("mb_portfolio") || "null"); } catch { saved = null; }
    const P = saved || { budget: 10000, rows: [] };
    app.innerHTML = `<section class="hero"><h1>Practice portfolio</h1><p>Pick 5 to 12 stocks and split $10,000 of play money between them. You'll see what you'd own, how spread out it is across sectors, what you're paying for earnings, the dividends it would pay, and how the same mix did over the past year against the S&amp;P 500. It's for learning how portfolios behave, not a recommendation.</p></section>
      <div class="card gen-box"><form id="pf-add" class="gen-row" autocomplete="off">
          <div class="gen-input"><input id="pf-t" placeholder="Add a ticker or company, e.g. KO" aria-label="Add a stock" autocapitalize="characters"><div id="pf-sugg" class="sugg" hidden></div></div>
          <button class="btn" type="submit">Add</button>
          <label class="pf-budget">Budget $<input id="pf-b" type="number" min="100" step="100" value="${P.budget}"></label></form>
        <div id="pf-rows"></div>
        <div class="gen-actions"><button class="btn primary" id="pf-go">Analyze portfolio</button> <button class="btn sm" id="pf-eq">Split evenly</button> <button class="btn sm" id="pf-clear">Clear</button><span class="note">Saved in this browser only.</span></div></div>
      <div id="pf-out"></div>`;
    const save = () => store.set("mb_portfolio", JSON.stringify(P));
    const rowsEl = document.getElementById("pf-rows");
    const drawRows = () => {
      rowsEl.innerHTML = P.rows.length ? `<div class="scroll"><table class="pf-in"><thead><tr><th>Stock</th><th class="r">Amount ($)</th><th class="r">Share of budget</th><th></th></tr></thead><tbody>
        ${P.rows.map((r, i) => `<tr><td><span class="tk">${esc(r.t)}</span><span class="co">${esc(r.n || "")}</span></td>
          <td class="r"><input class="pf-amt" data-i="${i}" type="number" min="0" step="50" value="${Math.round(r.amt)}"></td>
          <td class="r num">${pct(r.amt / (P.rows.reduce((a, z) => a + z.amt, 0) || 1), 0)}</td><td class="r"><button class="btn sm pf-del" data-i="${i}" aria-label="Remove ${esc(r.t)}">×</button></td></tr>`).join("")}
        </tbody></table></div>${(() => { const tot = P.rows.reduce((a, z) => a + z.amt, 0), gap = tot - P.budget;
          return Math.abs(gap) < 1 ? `<p class="note" style="padding:6px 0 0">Total ${usd(tot, 0)}: the full budget is invested.</p>`
            : `<p class="${gap > 0 ? "down" : "note"}" style="padding:6px 0 0;font-size:13px">Total ${usd(tot, 0)}: ${gap > 0 ? `${usd(gap, 0)} over` : `${usd(-gap, 0)} left`} of the ${usd(P.budget, 0)} budget. <button class="btn sm" id="pf-scale">Scale to budget</button></p>`; })()}` : `<p class="note" style="padding:8px 0">No stocks yet. Add at least five for a meaningful picture.</p>`;
      rowsEl.querySelectorAll(".pf-amt").forEach((el) => el.addEventListener("change", () => { P.rows[el.dataset.i].amt = Math.max(0, Number(el.value) || 0); save(); drawRows(); }));
      const sc = document.getElementById("pf-scale");
      if (sc) sc.addEventListener("click", () => { const tot = P.rows.reduce((a, z) => a + z.amt, 0) || 1; P.rows.forEach((r) => (r.amt = r.amt * P.budget / tot)); save(); drawRows(); });
      rowsEl.querySelectorAll(".pf-del").forEach((el) => el.addEventListener("click", () => { P.rows.splice(Number(el.dataset.i), 1); save(); drawRows(); }));
    };
    const even = () => { const k = P.rows.length || 1; P.rows.forEach((r) => (r.amt = P.budget / k)); save(); drawRows(); };
    const tk = document.getElementById("pf-t"), sugg = document.getElementById("pf-sugg");
    tk.addEventListener("input", async () => {
      const q = tk.value.trim().toUpperCase().replace(/[./]/g, "-"), qn = tk.value.trim().toUpperCase();
      if (!q) { sugg.hidden = true; return; }
      const hits = (await searchList()).filter(([t, n]) => t.startsWith(q) || n.toUpperCase().includes(qn)).sort((a, b) => (a[0] === q ? -1 : b[0] === q ? 1 : a[0].length - b[0].length)).slice(0, 6);
      sugg.innerHTML = hits.map(([t, n, sct]) => `<div class="sg" data-t="${esc(t)}" data-n="${esc(n)}"><b>${esc(t)}</b> ${esc(n)} <span class="note">${esc(sct)}</span></div>`).join("");
      sugg.hidden = !hits.length;
      sugg.querySelectorAll(".sg").forEach((el) => el.addEventListener("mousedown", (e) => { e.preventDefault(); tk.value = el.dataset.t; sugg.hidden = true; }));
    });
    tk.addEventListener("blur", () => setTimeout(() => (sugg.hidden = true), 100));
    document.getElementById("pf-add").addEventListener("submit", async (e) => {
      e.preventDefault();
      const raw = tk.value.trim().toUpperCase(); if (!raw) return;
      const list = await searchList();
      let hit = list.find(([t]) => t === raw.replace(/[./]/g, "-")) || list.find(([, n]) => n.toUpperCase().startsWith(raw));
      if (!hit) { tk.value = ""; tk.placeholder = `${raw} isn't an NYSE or Nasdaq ticker we know`; return; }
      if (P.rows.length >= 12) { tk.value = ""; tk.placeholder = "Up to 12 stocks"; return; }
      if (!P.rows.find((r) => r.t === hit[0])) { P.rows.push({ t: hit[0], n: hit[1], amt: 0 }); even(); }
      tk.value = ""; tk.focus();
    });
    document.getElementById("pf-b").addEventListener("change", (e) => { const old = P.budget; P.budget = Math.max(100, Number(e.target.value) || 10000); P.rows.forEach((r) => (r.amt = r.amt * P.budget / old)); save(); drawRows(); });
    document.getElementById("pf-eq").addEventListener("click", even);
    document.getElementById("pf-clear").addEventListener("click", () => { P.rows = []; save(); drawRows(); document.getElementById("pf-out").innerHTML = ""; });
    document.getElementById("pf-go").addEventListener("click", () => analyzePortfolio(P));
    drawRows();
    if (P.rows.length) analyzePortfolio(P);
  }
  async function analyzePortfolio(P) {
    const out = document.getElementById("pf-out");
    const rows = P.rows.filter((r) => r.amt > 0);
    if (!rows.length) { out.innerHTML = `<div class="warn">Add some stocks and amounts first.</div>`; return; }
    out.innerHTML = `<p class="muted loading">Getting prices…</p>`;
    const base = await apiBase();
    let d;
    try { const r = await fetch(`${base}/api/quotes?t=${rows.map((r) => encodeURIComponent(r.t)).join(",")}`); d = await r.json(); if (!r.ok) throw new Error(d.error || r.status); }
    catch (e) { out.innerHTML = `<div class="warn">Couldn't get prices (${esc(String(e.message || e))}).</div>`; return; }
    const Q = Object.fromEntries(d.quotes.map((q) => [q.ticker, q]));
    const total = rows.reduce((a, r) => a + r.amt, 0);
    const H = rows.map((r) => { const q = Q[r.t] || {}; const w = r.amt / total;
      const c = q.closes || []; const ret = c.length > 1 ? c.at(-1)[1] / c[0][1] - 1 : null;
      return { ...r, q, w, shares: q.price ? r.amt / q.price : null, ret }; });
    const wsum = (f) => { let s = 0, ww = 0; H.forEach((h) => { const v = f(h); if (nz(v)) { s += h.w * v; ww += h.w; } }); return ww ? s / ww : null; };
    const posPE = H.filter((h) => nz(h.q.pe) && h.q.pe > 0);
    const pe = posPE.length ? posPE.reduce((a, h) => a + h.w, 0) / posPE.reduce((a, h) => a + h.w / h.q.pe, 0) : null;
    const lossMakers = H.filter((h) => !(nz(h.q.pe) && h.q.pe > 0));
    const beta = wsum((h) => h.q.beta), yld = wsum((h) => h.q.div_yield);
    const eff = 1 / H.reduce((a, h) => a + h.w * h.w, 0);
    const top = H.reduce((a, h) => (h.w > a.w ? h : a), H[0]);
    const sectors = {}; H.forEach((h) => (sectors[h.q.sector || "Other"] = (sectors[h.q.sector || "Other"] || 0) + h.w));
    const secList = Object.entries(sectors).sort((a, b) => b[1] - a[1]);
    // the same mix bought a year ago, held, vs the S&P 500
    const dates = (d.spy || []).map((p) => p[0]);
    const at = (c, day) => { let v = null; for (const [dd, cc] of c) { if (dd <= day) v = cc; else break; } return v; };
    let series = [];
    if (dates.length > 4) {
      const start = dates[0];
      const sh = H.map((h) => { const p0 = at(h.q.closes || [], start) ?? (h.q.closes || [])[0]?.[1]; return p0 ? h.amt / p0 : 0; });
      const pts = dates.map((dd) => [dd, H.reduce((a, h, i) => a + sh[i] * (at(h.q.closes || [], dd) ?? (h.q.closes || [])[0]?.[1] ?? 0), 0)]);
      const s0 = d.spy[0][1];
      series = [{ name: "Your mix", c: "var(--s1)", pts }, { name: "S&P 500 (SPY)", c: "var(--s2)", pts: d.spy.map(([dd, c]) => [dd, total * c / s0]) }];
    }
    const yr = series.length ? series[0].pts.at(-1)[1] / total - 1 : null, spyr = series.length ? series[1].pts.at(-1)[1] / total - 1 : null;
    let peak = -Infinity, mdd = 0; (series[0]?.pts || []).forEach(([, v]) => { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); });
    const checks = [];
    const ok = (good, text) => checks.push(`<li class="${good ? "chk-ok" : "chk-warn"}">${text}</li>`);
    ok(H.length >= 5, H.length >= 5 ? `${H.length} stocks: enough that one bad result won't sink the portfolio.` : `Only ${H.length} stock${H.length > 1 ? "s" : ""}. With fewer than five, one company's bad news can dominate.`);
    ok(top.w <= 0.25, top.w <= 0.25 ? `Largest position is ${esc(top.t)} at ${pct(top.w, 0)}.` : `${esc(top.t)} is ${pct(top.w, 0)} of the money. Above about 25% in one stock, your result mostly depends on that company.`);
    ok(secList[0][1] <= 0.4, secList[0][1] <= 0.4 ? `Spread across ${secList.length} sectors; the biggest is ${esc(secList[0][0])} at ${pct(secList[0][1], 0)}.` : `${pct(secList[0][1], 0)} is in ${esc(secList[0][0])}. Companies in one sector tend to fall together, so this is less diversified than the number of stocks suggests.`);
    ok(eff >= 4, `Behaves like about ${eff.toFixed(1)} equally sized stocks ("effective number of holdings").`);
    if (nz(beta)) ok(beta <= 1.3, beta <= 1.3 ? `Beta ${beta.toFixed(2)}: moves about ${beta < 0.9 ? "less than" : "in line with"} the market.` : `Beta ${beta.toFixed(2)}: expect swings about ${beta.toFixed(1)}× the market's, both ways.`);
    if (lossMakers.length) ok(false, `${lossMakers.map((h) => esc(h.t)).join(", ")} ${lossMakers.length > 1 ? "have no positive earnings right now, so their prices rest" : "has no positive earnings right now, so its price rests"} on future profits.`);
    out.innerHTML = `
      <div class="kpis section">
        <div class="kpi hero-n"><div class="k">Portfolio</div><div class="v">${usd(total, 0)}</div><div class="n">${H.length} stocks · ${secList.length} sectors</div></div>
        <div class="kpi"><div class="k">Portfolio P/E</div><div class="v">${mult(pe)}</div><div class="n">what you pay per $1 of earnings</div></div>
        <div class="kpi"><div class="k">Dividend yield</div><div class="v">${pct(yld)}</div><div class="n">about ${usd(total * (yld || 0), 0)} a year</div></div>
        <div class="kpi"><div class="k">Beta</div><div class="v">${nz(beta) ? beta.toFixed(2) : "—"}</div><div class="n">1.00 = moves with the market</div></div>
        <div class="kpi"><div class="k">Past year, same mix</div><div class="v">${signed(yr)}</div><div class="n">S&amp;P 500 ${nz(spyr) ? signed(spyr) : "—"}${mdd < 0 ? ` · worst drop ${pct(-mdd, 0)}` : ""}</div></div>
      </div>
      <section class="section card"><div class="card-h"><h2>What this portfolio tells you</h2></div><ul class="checks">${checks.join("")}</ul></section>
      <div class="grid2 section">
        <section class="card"><div class="card-h"><h2>Sector mix</h2></div><div class="bars">${secList.map(([s, w]) => `<div class="bar-r"><span>${esc(s)}</span><div class="bar"><i style="width:${(w * 100).toFixed(1)}%"></i></div><b>${pct(w, 0)}</b></div>`).join("")}</div></section>
        <section class="card"><div class="card-h"><h2>If you'd bought this mix a year ago</h2><span class="note">buy and hold, weekly closes</span></div><div class="chart-wrap" id="pf-chart"></div></section>
      </div>
      <section class="section card"><div class="card-h"><h2>Holdings</h2><span class="note">prices from Yahoo Finance · ${esc(d.as_of.slice(0, 10))}</span></div>
        <div class="scroll"><table><thead><tr><th>Stock</th><th class="hide-sm">Sector</th><th class="r">Amount</th><th class="r">Weight</th><th class="r">Shares</th><th class="r">Price</th><th class="r">P/E</th><th class="r">Yield</th><th class="r hide-sm">Beta</th><th class="r">1 year</th><th class="r">Model</th></tr></thead><tbody>
        ${H.map((h) => `<tr><td><span class="tk">${esc(h.t)}</span><span class="co">${esc(h.q.name || h.n || "")}</span></td><td class="hide-sm note">${esc(h.q.sector || "")}</td><td class="r num">${usd(h.amt, 0)}</td><td class="r num">${pct(h.w, 0)}</td>
          <td class="r num">${nz(h.shares) ? h.shares.toFixed(2) : "—"}</td><td class="r num">${usd(h.q.price)}</td><td class="r num">${nz(h.q.pe) && h.q.pe > 0 ? mult(h.q.pe) : "n/m"}</td><td class="r num">${pct(h.q.div_yield)}</td>
          <td class="r num hide-sm">${nz(h.q.beta) ? h.q.beta.toFixed(2) : "—"}</td><td class="r num">${signed(h.ret)}</td><td class="r"><a class="btn sm" href="#/m/${esc(h.t)}">Model</a></td></tr>`).join("")}
        </tbody></table></div>
        <p class="note" style="padding:10px 18px 14px">Portfolio P/E is the weighted harmonic mean of positive P/Es (loss-makers excluded); yield and beta are weighted averages. The one-year line assumes you bought these amounts 52 weeks ago and held; it's history, not a forecast. Practice only, not investment advice.</p></section>`;
    if (series.length) portfolioChart(document.getElementById("pf-chart"), series);
  }

  // ------------------------------------------------------------- guided screener
  let SCREEN = null, OWNERS = null, FUNDS = null;
  const loadScreen = async () => (SCREEN = SCREEN || await getJSON("universe/screener.json"));
  const loadOwners = async () => { if (OWNERS) return OWNERS; try { OWNERS = await getJSON("funds/owners.json"); } catch { OWNERS = {}; } return OWNERS; };
  const loadFunds = async () => (FUNDS = FUNDS || await getJSON("funds/index.json"));
  const SCREEN_PRESETS = [
    { id: "growers", t: "Profitable and growing", d: "Companies making a profit whose sales grew more than 10% last year. Growth plus profit is what most investors pay up for.", f: { net_m_min: 0.0001, rev_growth_min: 0.10 } },
    { id: "dividends", t: "Steady dividend payers", d: "Yield above 2%, paying out no more than 75% of profits (so the dividend is affordable) and modest debt.", f: { div_yield_min: 0.02, payout_max: 0.75, de_max: 1.0 } },
    { id: "cheap", t: "Cheap versus earnings", d: "Profitable companies whose P/E is below the median of their own sector. Cheap can mean a bargain, or that the market sees trouble.", f: { pe_min: 0.01, cheap_vs_sector: true, mcap_min: 300 } },
    { id: "bigstable", t: "Big and stable", d: "Over $50B in market value with a beta below 0.9: large companies that have moved less than the market.", f: { mcap_min: 50000, beta_max: 0.9 } },
    { id: "smallprofit", t: "Small but profitable", d: "$300M to $2B in market value and generating free cash flow. Small companies can grow faster, but they swing more.", f: { mcap_min: 300, mcap_max: 2000, fcf_pos: true } },
  ];
  // [key, label, unit, help]
  const SCREEN_FILTERS = [
    ["mcap", "Market cap ($B)", "b", "Share price × shares. Small cap is about $0.3–2B, mid $2–10B, large above $10B."],
    ["pe", "P/E", "x", "Price ÷ earnings. Many large US companies sit around 15–25×; fast growers often higher."],
    ["ev_ebitda", "EV / EBITDA", "x", "Whole-business value ÷ operating profit before depreciation. Often 8–15×; not meaningful for banks."],
    ["rev_growth", "Revenue growth (last year)", "%", "How fast sales grew. Mature companies 0–5%, growth companies 15%+."],
    ["gross_m", "Gross margin", "%", "Sales left after the direct cost of the product. Software 70%+, retailers 20–40%."],
    ["op_m", "Operating margin", "%", "Profit from running the business ÷ sales. 10–20% is healthy for many industries."],
    ["net_m", "Net margin", "%", "Bottom-line profit ÷ sales. Negative means the company lost money."],
    ["div_yield", "Dividend yield", "%", "Yearly dividends ÷ market value. The S&P 500 averages around 1–2%; very high yields can signal a cut ahead."],
    ["payout", "Payout ratio", "%", "Dividends ÷ profit. Above about 80% leaves little room if profits dip."],
    ["de", "Debt ÷ equity", "x", "Borrowing relative to shareholders' money. Below 1× is conservative; utilities and banks run higher."],
    ["beta", "Beta", "x", "How much the stock moves with the market (2 years, weekly). 1.0 = in step; below 1 = calmer."],
    ["chg_1y", "Price change, 1 year", "%", "Past performance only; it says nothing reliable about the next year."],
  ];
  function screenFilterRow([k, lab, u, help], F) {
    const sc = u === "%" ? 100 : u === "b" ? 0.001 : 1;
    const val = (v) => (v == null ? "" : +(v * sc).toFixed(2));
    return `<div class="sf"><label>${lab} <span class="note">${u === "%" ? "%" : u === "b" ? "$B" : "×"}</span></label>
      <div class="sf-in"><input type="number" step="any" placeholder="min" data-k="${k}_min" value="${val(F[k + "_min"])}"><span>to</span><input type="number" step="any" placeholder="max" data-k="${k}_max" value="${val(F[k + "_max"])}"></div>
      <p class="note">${help}</p></div>`;
  }
  async function screenerView() {
    document.title = "Screener · " + SITE;
    app.innerHTML = `<section class="hero"><h1>Screener</h1><p>Find companies that match what you're looking for. Start from one of the ideas below, or open all filters and set your own. It covers every NYSE and Nasdaq company (US-based by default), using each one's latest 10-K and today's prices. Each result links to a full model.</p></section>
      <div class="presets-grid">${SCREEN_PRESETS.map((p) => `<button class="preset" data-p="${p.id}"><b>${esc(p.t)}</b><span>${esc(p.d)}</span></button>`).join("")}</div>
      <details class="card section sf-box" id="sf-box"><summary>All filters</summary><div id="sf"></div></details>
      <div id="sr" class="section"><p class="muted loading">Loading ${"6,000"} companies…</p></div>`;
    let d;
    try { d = await loadScreen(); } catch { document.getElementById("sr").innerHTML = `<div class="warn">The screener data isn't available yet. It's rebuilt every night.</div>`; return; }
    const owners = await loadOwners();
    const I = Object.fromEntries(d.fields.map((f, i) => [f, i]));
    const rows = d.rows.map((r) => Object.fromEntries(d.fields.map((f, i) => [f, r[i]])));
    rows.forEach((r) => (r.funds = (owners[r.ticker] || []).length));
    const sectors = [...new Set(rows.map((r) => r.sector))].sort();
    const med = {};
    sectors.forEach((s) => { const pes = rows.filter((r) => r.sector === s && r.pe > 0).map((r) => r.pe).sort((a, b) => a - b); med[s] = pes.length ? pes[pes.length >> 1] : null; });
    let F = {}, sort = ["mcap", -1], shown = 50, active = null;
    try { F = JSON.parse(sessionStorage.getItem("mb_screen") || "{}"); } catch { F = {}; }
    const drawFilters = () => {
      document.getElementById("sf").innerHTML = `
        <div class="sf-top">
          <div class="sf"><label>Sector</label><select id="sf-sector"><option value="">All sectors</option>${sectors.map((s) => `<option ${F.sector === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
          <div class="sf"><label>Exchange</label><select id="sf-ex"><option value="">NYSE and Nasdaq</option><option ${F.exchange === "NYSE" ? "selected" : ""}>NYSE</option><option ${F.exchange === "Nasdaq" ? "selected" : ""}>Nasdaq</option></select></div>
          <label class="sf-chk"><input type="checkbox" id="sf-fcf" ${F.fcf_pos ? "checked" : ""}> Positive free cash flow</label>
          <label class="sf-chk"><input type="checkbox" id="sf-cheap" ${F.cheap_vs_sector ? "checked" : ""}> P/E below its sector's median</label>
          <label class="sf-chk"><input type="checkbox" id="sf-funds" ${F.funds ? "checked" : ""}> Owned by a tracked fund</label>
          <label class="sf-chk"><input type="checkbox" id="sf-nofin" ${F.no_fin ? "checked" : ""}> Exclude banks, insurers and REITs</label>
          <label class="sf-chk" title="Foreign companies often report in other currencies, so some ratios are less reliable"><input type="checkbox" id="sf-intl" ${F.intl ? "checked" : ""}> Include companies based outside the US</label>
        </div>
        <div class="sf-grid">${SCREEN_FILTERS.map((x) => screenFilterRow(x, F)).join("")}</div>
        <div class="gen-actions"><button class="btn sm" id="sf-reset">Clear all filters</button></div>`;
      const sf = document.getElementById("sf");
      sf.querySelectorAll("input[data-k]").forEach((el) => el.addEventListener("input", () => {
        const k = el.dataset.k, base = k.replace(/_(min|max)$/, ""), u = SCREEN_FILTERS.find((x) => x[0] === base)[2];
        const sc = u === "%" ? 100 : u === "b" ? 0.001 : 1;
        if (el.value === "") delete F[k]; else F[k] = Number(el.value) / sc;
        active = null; apply();
      }));
      const bind = (id, k, f) => document.getElementById(id).addEventListener("change", (e) => { const v = f(e.target); if (v) F[k] = v; else delete F[k]; active = null; apply(); });
      bind("sf-sector", "sector", (t) => t.value); bind("sf-ex", "exchange", (t) => t.value);
      bind("sf-fcf", "fcf_pos", (t) => t.checked); bind("sf-cheap", "cheap_vs_sector", (t) => t.checked);
      bind("sf-funds", "funds", (t) => t.checked); bind("sf-nofin", "no_fin", (t) => t.checked); bind("sf-intl", "intl", (t) => t.checked);
      document.getElementById("sf-reset").addEventListener("click", () => { F = {}; active = null; drawFilters(); apply(); });
    };
    const pass = (r) => {
      for (const [k, lab, u] of SCREEN_FILTERS) {
        const lo = F[k + "_min"], hi = F[k + "_max"];
        if (lo == null && hi == null) continue;
        if (r[k] == null) return false;
        if (lo != null && r[k] < lo) return false;
        if (hi != null && r[k] > hi) return false;
      }
      if (F.sector && r.sector !== F.sector) return false;
      if (F.exchange && r.exchange !== F.exchange) return false;
      if (F.fcf_pos && !(r.fcf > 0)) return false;
      if (F.cheap_vs_sector && !(r.pe > 0 && med[r.sector] && r.pe < med[r.sector])) return false;
      if (F.funds && !r.funds) return false;
      if (F.no_fin && r.fin) return false;
      if (!F.intl && r.country && r.country !== "United States") return false;
      return true;
    };
    const COLS = [["ticker", "Company"], ["mcap", "Mkt cap"], ["pe", "P/E"], ["ev_ebitda", "EV/EBITDA"], ["rev_growth", "Rev. growth"],
                  ["op_m", "Op. margin"], ["div_yield", "Yield"], ["de", "Debt/eq."], ["beta", "Beta"], ["chg_1y", "1 year"]];
    const cell = (r, k) => k === "mcap" ? big(r.mcap) : ["pe", "ev_ebitda", "de"].includes(k) ? (r[k] == null ? "—" : mult(r[k])) :
      k === "beta" ? (r.beta == null ? "—" : r.beta.toFixed(2)) : k === "chg_1y" ? signed(r.chg_1y) : pct(r[k]);
    const notes = (r) => [r.net_m != null && r.net_m < 0 ? `<span class="tag warn-t" title="Net loss in the latest fiscal year">loss</span>` : "",
      r.fin ? `<span class="tag" title="Banks, insurers and REITs: EV/EBITDA and margins work differently">financial</span>` : "",
      r.country && r.country !== "United States" ? `<span class="tag" title="${r.country === "Outside US" ? "Based outside the US" : "Based in " + esc(r.country)}; figures may be translated from another currency">outside US</span>` : "",
      r.funds ? `<span class="tag fund-t" title="Held by ${r.funds} tracked fund${r.funds > 1 ? "s" : ""}">${r.funds} fund${r.funds > 1 ? "s" : ""}</span>` : ""].join("");
    function apply() {
      sessionStorage.setItem("mb_screen", JSON.stringify(F));
      document.querySelectorAll(".preset").forEach((b) => b.classList.toggle("on", b.dataset.p === active));
      const hits = rows.filter(pass);
      const [sk, sd] = sort;
      hits.sort((a, b) => sk === "ticker" ? sd * a.ticker.localeCompare(b.ticker) : (a[sk] == null) - (b[sk] == null) || sd * ((a[sk] ?? 0) - (b[sk] ?? 0)));
      const p = SCREEN_PRESETS.find((x) => x.id === active);
      document.getElementById("sr").innerHTML = `
        ${p ? `<p class="note preset-why"><b>${esc(p.t)}.</b> ${esc(p.d)}</p>` : ""}
        <div class="card"><div class="card-h"><h2>${hits.length.toLocaleString()} compan${hits.length === 1 ? "y" : "ies"} match</h2><span class="note">data as of ${esc(d.as_of)} · fiscal ${d.fiscal_year} 10-Ks · <a href="#" id="sr-csv">download CSV</a></span></div>
        <div class="scroll"><table class="scr"><thead><tr>${COLS.map(([k, lab]) => `<th class="${k === "ticker" ? "" : "r"} sortable" data-k="${k}">${lab}${sk === k ? (sd > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}<th></th></tr></thead><tbody>
          ${hits.slice(0, shown).map((r) => `<tr><td><span class="tk">${esc(r.ticker)}</span><span class="co">${esc(r.name)} · ${esc(r.sector)}</span>${notes(r)}</td>${COLS.slice(1).map(([k]) => `<td class="r num">${cell(r, k)}</td>`).join("")}<td class="r"><a class="btn sm" href="#/m/${esc(r.ticker)}">Model</a></td></tr>`).join("")}
        </tbody></table></div>
        ${hits.length > shown ? `<div class="gen-actions"><button class="btn sm" id="sr-more">Show 50 more</button><span class="note">${(hits.length - shown).toLocaleString()} more</span></div>` : ""}</div>
        <p class="note" style="margin-top:10px">Shows companies that match your filters, not what to buy. Figures come from each company's latest 10-K (fiscal ${d.fiscal_year}) via SEC XBRL, so they can lag by up to a year; a dash means the company didn't report that figure in a comparable way.</p>`;
      document.querySelectorAll("th.sortable").forEach((th) => th.addEventListener("click", () => { sort = [th.dataset.k, sort[0] === th.dataset.k ? -sort[1] : (th.dataset.k === "ticker" ? 1 : -1)]; apply(); }));
      document.getElementById("sr-more")?.addEventListener("click", () => { shown += 50; apply(); });
      document.getElementById("sr-csv").addEventListener("click", (e) => {
        e.preventDefault();
        const csv = [d.fields.filter((f) => f !== "fin").concat("tracked_funds").join(","), ...hits.map((r) => d.fields.filter((f) => f !== "fin").map((f) => JSON.stringify(r[f] ?? "")).concat(r.funds).join(","))].join("\n");
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `screen_${d.as_of}.csv`; a.click();
      });
    }
    document.querySelectorAll(".preset").forEach((b) => b.addEventListener("click", () => {
      const p = SCREEN_PRESETS.find((x) => x.id === b.dataset.p); F = { ...p.f, ...(F.intl ? { intl: true } : {}) }; active = p.id; shown = 50; sort = ["mcap", -1]; drawFilters(); apply();
    }));
    drawFilters(); apply();
  }

  // ------------------------------------------------------------- funds (13F)
  const chgBadge = (h) => h.change === "new" ? `<span class="tag up-t">New</span>` : h.change === "add" ? `<span class="tag up-t">Added ${nz(h.chg_shares) ? pct(h.chg_shares, 0) : ""}</span>`
    : h.change === "trim" ? `<span class="tag down-t">Trimmed ${nz(h.chg_shares) ? pct(Math.abs(h.chg_shares), 0) : ""}</span>` : h.change === "same" ? `<span class="note">—</span>` : "";
  const bn = (v) => (nz(v) ? (v >= 1e9 ? "$" + (v / 1e9).toFixed(1) + "B" : "$" + (v / 1e6).toFixed(0) + "M") : "—");
  const tickLink = (t, name) => (t ? `<a class="tk" href="#/m/${esc(t)}">${esc(t)}</a><span class="co">${esc(name)}</span>` : `<span class="co">${esc(name)}</span>`);
  async function fundsView() {
    document.title = "Funds · " + SITE;
    app.innerHTML = `<p class="muted loading">Loading…</p>`;
    let d; try { d = await loadFunds(); } catch { app.innerHTML = `<div class="warn">Fund data isn't available yet.</div>`; return; }
    const list = (rows, k, lab) => rows.map((a) => `<tr><td>${tickLink(a.ticker, a.name)}</td><td class="r num">${a[k]}</td><td class="r num hide-sm">${bn(a.value)}</td></tr>`).join("") || `<tr><td class="note" colspan="3">None</td></tr>`;
    app.innerHTML = `<section class="hero"><h1>What the big funds own</h1><p>The US stock holdings of ${d.funds.length} closely followed investment firms, from the 13F reports they must file with the SEC every quarter, and what each one bought and sold since the quarter before. Click any holding to open or build its model.</p>
      <p class="note">13Fs are filed up to 45 days after each quarter ends, so they're one to four months old. They show long positions in US-listed stocks and options only: no short positions, bonds, cash or foreign holdings. Names refer to the firms; the person is the best-known investor associated with each. This is not a list of recommendations.</p></section>
      <div class="fund-grid">${d.funds.map((f) => `<a class="fcard" href="#/funds/${esc(f.slug)}"><b>${esc(f.name)}</b><span class="note">${esc(f.person)}</span>
        <span class="fv">${bn(f.value)} <span class="note">${f.positions} stocks</span></span>
        <span class="ftop">${f.top.slice(0, 3).map((t) => esc(t[0] || t[1].split(" ")[0])).join(" · ")}</span>
        <span class="note">${f.new} new · ${f.exits} sold out · Q${Math.floor((+f.period.slice(5, 7) - 1) / 3) + 1} ${esc(f.period.slice(0, 4))}, filed ${esc(f.filed)}</span></a>`).join("")}</div>
      <div class="grid3 section">
        <section class="card"><div class="card-h"><h2>Most owned</h2><span class="note">by number of funds</span></div><div class="scroll"><table><thead><tr><th>Company</th><th class="r">Funds</th><th class="r hide-sm">Held</th></tr></thead><tbody>${list(d.most_owned.slice(0, 12), "funds")}</tbody></table></div></section>
        <section class="card"><div class="card-h"><h2>Most bought</h2><span class="note">new or added last quarter</span></div><div class="scroll"><table><thead><tr><th>Company</th><th class="r">Funds</th><th class="r hide-sm">Held</th></tr></thead><tbody>${list(d.most_bought.slice(0, 12), "bought")}</tbody></table></div></section>
        <section class="card"><div class="card-h"><h2>Most sold</h2><span class="note">trimmed or sold out</span></div><div class="scroll"><table><thead><tr><th>Company</th><th class="r">Funds</th><th class="r hide-sm">Held</th></tr></thead><tbody>${list(d.most_sold.slice(0, 12), "sold")}</tbody></table></div></section>
      </div>`;
  }
  async function fundPage(slug) {
    app.innerHTML = `<p class="muted loading">Loading…</p>`;
    let f; try { f = await getJSON(`funds/${encodeURIComponent(slug)}.json`); } catch { app.innerHTML = `<a class="crumb" href="#/funds">← Funds</a><div class="warn">No data for that fund.</div>`; return; }
    document.title = `${f.name} · ${SITE}`;
    const H = f.holdings || [];
    app.innerHTML = `<a class="crumb" href="#/funds">← Funds</a>
      <div class="dhead"><div><div class="note">${esc(f.person)} · 13F for the quarter ended ${esc(f.period)}, filed ${esc(f.filed)}</div><h1 class="dname">${esc(f.name)}</h1>
        <div class="note">SEC filer: ${esc(f.filer)} · <a href="${esc(f.url)}" target="_blank" rel="noopener">all 13F filings ↗</a></div></div></div>
      <div class="kpis"><div class="kpi hero-n"><div class="k">Reported US stock holdings</div><div class="v">${bn(f.value)}</div><div class="n">${f.positions} positions</div></div>
        <div class="kpi"><div class="k">Top 10 share</div><div class="v">${pct(f.top10_share, 0)}</div><div class="n">how concentrated</div></div>
        <div class="kpi"><div class="k">New positions</div><div class="v">${f.new}</div></div><div class="kpi"><div class="k">Added / trimmed</div><div class="v">${f.adds} / ${f.trims}</div></div>
        <div class="kpi"><div class="k">Sold out</div><div class="v">${f.exits}</div><div class="n">vs ${esc(f.prev_period || "previous quarter")}</div></div></div>
      <div class="grid2 section"><section class="card"><div class="card-h"><h2>Sector mix</h2></div><div class="bars">${(f.sectors || []).slice(0, 9).map(([s, w]) => `<div class="bar-r"><span>${esc(s)}</span><div class="bar"><i style="width:${(w * 100).toFixed(1)}%"></i></div><b>${pct(w, 0)}</b></div>`).join("")}</div></section>
        <section class="card"><div class="card-h"><h2>Sold out last quarter</h2></div><div class="scroll"><table><tbody>${(f.exits || []).slice(0, 10).map((e) => `<tr><td>${tickLink(e.ticker, e.name)}</td><td class="r num">${pct(e.prev_weight)} of the fund</td></tr>`).join("") || `<tr><td class="note">No positions sold out.</td></tr>`}</tbody></table></div></section></div>
      <section class="section card"><div class="card-h"><h2>Holdings</h2><span class="note">${f.options ? `${f.options} option positions not shown · ` : ""}value as reported at quarter end</span></div>
        <div class="scroll"><table><thead><tr><th>Company</th><th class="r">Value</th><th class="r">Weight</th><th class="r hide-sm">Shares</th><th>Change</th><th class="r"></th></tr></thead><tbody>
        ${H.map((h) => `<tr><td>${tickLink(h.ticker, h.name)}</td><td class="r num">${bn(h.value)}</td><td class="r num">${pct(h.weight)}</td><td class="r num hide-sm">${h.shares.toLocaleString()}</td><td>${chgBadge(h)}</td>
          <td class="r">${h.ticker && h.listed ? `<a class="btn sm" href="#/m/${esc(h.ticker)}">Model</a>` : ""}</td></tr>`).join("")}</tbody></table></div></section>`;
  }
  async function ownersPanel(t) {
    const own = (await loadOwners())[t] || [];
    if (!own.length) return "";
    let names = {}; try { names = Object.fromEntries((await loadFunds()).funds.map((f) => [f.slug, f])); } catch { /* names optional */ }
    return `<section class="section card"><div class="card-h"><h2>Tracked funds that own it</h2><span class="note">latest 13F filings · <a href="#/funds">all funds</a></span></div>
      <div class="scroll"><table><tbody>${own.sort((a, b) => b[1] - a[1]).map(([s, w, c]) => `<tr><td><a href="#/funds/${esc(s)}">${esc(names[s]?.name || s)}</a> <span class="note">${esc(names[s]?.person || "")}</span></td><td class="r num">${pct(w)} of the fund</td><td>${chgBadge({ change: c })}</td></tr>`).join("")}</tbody></table></div></section>`;
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
        <div class="actions">${dl(m)}${m.files?.tearsheet ? ` <a class="btn sm" href="${esc(m.files.tearsheet)}" target="_blank" rel="noopener">⤓ Tear sheet</a>` : ""} <button class="btn sm primary-o" id="explain">Explain this model</button> <a class="btn sm" href="#/compare/${esc(m.ticker)}">Compare</a> <button class="btn sm" id="share">Copy share link</button> <a class="btn sm" href="#/" id="rebuild">Rebuild</a></div>
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

      <section class="section card" id="sec-cases"><div class="card-h"><h2>Bull, base and bear cases</h2><span class="note">switch them in the Excel file on the Scenarios tab (cell D4)</span></div>
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
      <div id="owners-slot"></div>
      <section class="section card" id="sec-fin"><div class="card-h"><h2>Financial summary</h2><span class="note">$mm except per share · shaded columns are projections (base case)</span></div>
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
    document.getElementById("explain").addEventListener("click", () => openExplain(m));
    ownersPanel(m.ticker).then((h) => { const el = document.getElementById("owners-slot"); if (el) el.innerHTML = h; });

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
      <h2>8. Learning tools</h2>
      <p>Every model page has an <b>Explain this model</b> button that walks through the valuation step by step using that company's own numbers. The <b>Quiz</b> mixes investing basics with questions computed from a real model on the site, and the <b>Practice portfolio</b> shows how a mix of stocks behaves: sector concentration, what you pay for earnings, dividend income, and how the same mix did over the past year against the S&amp;P 500. All educational, none of it advice.</p>
      <h2>9. Screener and funds</h2>
      <p>The <b>Screener</b> covers every NYSE and Nasdaq company, rebuilt nightly from SEC XBRL "frames" (one figure for every filer per request) and Yahoo Finance prices; beta uses two years of weekly returns against the S&amp;P 500. The <b>Funds</b> tab reads the latest two 13F filings of 15 closely followed firms, maps each CUSIP to a ticker with OpenFIGI, and compares quarters. 13Fs lag by up to 45 days and show only long US positions.</p>
      <p>Also see <a href="#/built">how I built this</a>.</p>
      <h2>10. Limits</h2>
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
    const TABS = ["method", "library", "built", "update", "portfolio", "quiz", "screener", "funds"];
    const tab = TABS.includes(h) ? h : h.startsWith("funds/") ? "funds" : h ? "__" : "";
    document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#/" + tab));
    window.scrollTo(0, 0);
    if (!h || h === "coverage" || h === "fund") { if (h) history.replaceState(null, "", "#/"); generateView(); }
    else if (h === "library") libraryView();
    else if (h === "owner") ownerView();
    else if (h === "method") method();
    else if (h === "built") built();
    else if (h === "update") updateView();
    else if (h === "portfolio") portfolioView();
    else if (h === "screener") screenerView();
    else if (h === "funds") fundsView();
    else if (h.startsWith("funds/")) fundPage(decodeURIComponent(h.slice(6)));
    else if (h === "quiz") quizView();
    else if (h === "compare" || h.startsWith("compare/")) comparePage(decodeURIComponent(h.slice(8)));
    else if (h.startsWith("m/")) modelPage(decodeURIComponent(h.slice(2)));
    else modelPage(decodeURIComponent(h));
  }
  window.addEventListener("hashchange", route);
  route();
})();
