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
      <section class="section"><h2 class="sec">Generated in the past 24 hours</h2><div class="card" id="recent"><p class="muted loading" style="padding:14px 18px">Loading…</p></div></section>`;

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
    const bridge = (ev) => ((ev + x.debt + x.cash) * (1 - x.nci_ratio)) / x.shares;
    const g = Math.min(o.g, o.wacc - 0.005);
    const dcf = bridge(spv + (ufcf[4] * (1 + g)) / (o.wacc - g) * df[4]);
    const exit = Math.max(0, bridge(spv + o.mult * ebitda5 * df[4]));
    const model = x.w_dcf * dcf + x.w_exit * exit + x.w_comps * x.comps_value;
    const target = x.anchored_base * (x.base_model ? model / x.base_model : 1);
    return { dcf, exit, model, target, upside: target / x.price - 1, rev5: rev[5], margin5: ebit5 / rev[5], ufcf };
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
          <div class="note">Version ${m.version} · generated ${ago(m.generated_at)} · 10-K filed ${esc(d.dates?.tenk_filed || "n/a")} · priced ${esc(m.price_date)}</div></div>
        <div class="actions">${dl(m)} <button class="btn sm" id="share">Copy share link</button> <a class="btn sm" href="#/" id="rebuild">Rebuild</a></div>
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
        <p class="note" style="padding:0 18px 16px">At base settings this matches the Excel model exactly (target ${usd(x.check?.target)}). Away from base it re-runs the same DCF, exit-multiple and comps blend and the street/peer anchoring; it tracks the Excel engine to within about 1%, since the workbook also re-runs its PP&amp;E, debt and interest schedules.</p></section>` : ""}

      <section class="section card"><div class="card-h"><h2>Financial summary</h2><span class="note">$mm except per share · shaded columns are projections (base case)</span></div>
        <div class="scroll"><table class="fin"><thead><tr><th></th>${years.map((y, i) => `<th class="r${i >= hn ? " proj" : ""}">${esc(y)}</th>`).join("")}</tr></thead><tbody>
          ${row("Revenue", d.is?.revenue, mm)}${row("Revenue growth", d.is?.growth, pct, 1)}${row("Gross margin", d.is?.gm, pct)}
          ${row("EBITDA margin", d.is?.ebitda_m, pct)}${row("EBIT margin", d.is?.ebit_m, pct)}${row("Net income to common", d.is?.ni, mm)}
          ${row("Diluted EPS", d.is?.eps, (z) => usd(z))}
          <tr><td>Unlevered free cash flow</td>${years.map((_, i) => `<td class="r num${i >= hn ? " proj" : ""}">${i >= hn ? mm(d.fcf?.[i - hn]) : ""}</td>`).join("")}</tr>
        </tbody></table></div></section>

      <section class="section card"><div class="card-h"><h2>Peers</h2><span class="note">same SEC industry group, NYSE and Nasdaq</span></div>
        <div class="scroll"><table><thead><tr><th>Company</th><th class="r">Price</th><th class="r">Market cap</th><th class="r">EV / EBITDA</th><th class="r">P / E</th></tr></thead><tbody>
          ${(d.comps || []).map((p) => `<tr><td><span class="tk">${esc(p.ticker)}</span><span class="co">${esc(p.name)}</span></td><td class="r num">${usd(p.price)}</td><td class="r num">${big(p.mcap)}</td><td class="r num">${mult(p.ev_ebitda)}</td><td class="r num">${mult(p.pe)}</td></tr>`).join("")}
          <tr class="tot"><td>Peer median</td><td></td><td></td><td class="r num">${mult(d.comps_median?.ev_ebitda)}</td><td class="r num">${mult(d.comps_median?.pe)}</td></tr>
          <tr class="tot"><td>${esc(m.ticker)}</td><td class="r num">${usd(m.price)}</td><td></td><td class="r num">${mult(d.comps_self?.ev_ebitda)}</td><td class="r num">${mult(d.comps_self?.pe)}</td></tr>
        </tbody></table></div></section>

      <section class="section card"><div class="card-h"><h2>Where every historical number comes from</h2><span class="note"><a href="${esc(d.filings_index)}" target="_blank" rel="noopener">all ${esc(m.ticker)} 10-K filings on EDGAR ↗</a></span></div>
        <div class="scroll"><table class="src"><thead><tr><th>Line item</th><th>XBRL tag</th>${(d.sources_years || []).map((y) => `<th class="r">${esc(y)}</th>`).join("")}</tr></thead><tbody>
          ${(d.sources || []).map((s) => `<tr><td>${esc(s.label)}</td><td class="mono">${s.concept_url ? `<a href="${esc(s.concept_url)}" target="_blank" rel="noopener">${esc(s.concept)}</a>` : esc(s.concept || "")}</td>
            ${(s.values || []).map((val, i) => { const f = s.filings?.[i]; const txt = s.key === "eps_diluted" ? usd(val) : mm(val);
              return `<td class="r num">${f ? `<a href="${esc(f.url)}" target="_blank" rel="noopener" title="${esc(f.form)} filed ${esc(f.filed)} · ${esc(f.accn)}">${txt}</a>` : txt}</td>`; }).join("")}</tr>`).join("")}
        </tbody></table></div>
        <p class="note" style="padding:10px 18px 14px">Each figure links to the 10-K it was taken from (latest filing wins, so restatements are picked up); each tag links to SEC's raw XBRL data for that line. Prices and consensus come from Yahoo Finance as of ${esc(m.price_date)}.</p></section>`;

    footballChart(document.getElementById("ff"), ff, m.price, m.target);
    historyChart(document.getElementById("hist"), ph, m.history);
    document.getElementById("share").addEventListener("click", async (e) => {
      try { await navigator.clipboard.writeText(shareUrl); e.target.textContent = "Link copied"; } catch { prompt("Copy this link", shareUrl); }
    });
    document.getElementById("rebuild").addEventListener("click", () => sessionStorage.setItem("mb_prefill", m.ticker));

    if (x) {
      const bounded = Math.min(30, Math.max(4, x.ev_ebitda_now || 10));
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
      <p>Historical financials come only from the company's 10-K filings, read from SEC EDGAR's XBRL company facts. When a company restates, the latest filing wins. Every figure on a model page links back to the filing it came from. Prices, beta and analyst consensus come from Yahoo Finance; the 10-year Treasury yield is the risk-free rate.</p>
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
      <h2>5. Peers</h2>
      <p>Up to five NYSE or Nasdaq companies in the same SEC industry code (4-digit first, widening to 3 and 2 digits), within 0.2–5× the company's revenue.</p>
      <h2>6. Limits</h2>
      <ul>
        <li>Revenue is modelled at the consolidated level: segment detail isn't in standardized XBRL.</li>
        <li>No management guidance, backlog, pricing or one-offs. A company in transition can be badly mispriced.</li>
        <li>US-GAAP filers reporting in dollars only. Foreign IFRS filers, funds and trusts can't be modelled yet.</li>
        <li>Banks, insurers and REITs don't fit EV/EBITDA and free cash flow. Their pages add P/B, P/TBV and ROE, or P/FFO, against peers, and say so plainly.</li>
        <li>Peers are picked by industry code and size, which sometimes pairs unlike businesses.</li>
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
    document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#/" + (["method", "library", "built"].includes(h) ? h : h.startsWith("m/") ? "__" : "")));
    window.scrollTo(0, 0);
    if (!h || h === "coverage" || h === "fund") { if (h) history.replaceState(null, "", "#/"); generateView(); }
    else if (h === "library") libraryView();
    else if (h === "owner") ownerView();
    else if (h === "method") method();
    else if (h === "built") built();
    else if (h.startsWith("m/")) modelPage(decodeURIComponent(h.slice(2)));
    else modelPage(decodeURIComponent(h));
  }
  window.addEventListener("hashchange", route);
  route();
})();
