/* Equity Coverage — static front end. Reads data/*.json written by the pipeline. */
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
  function sparkline(vals) {
    if (!vals || vals.length < 2) return "";
    const w = 96, h = 26, mn = Math.min(...vals), mx = Math.max(...vals), span = mx - mn || 1;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 2 - ((v - mn) / span) * (h - 4)}`).join(" ");
    const col = vals[vals.length - 1] >= vals[0] ? "var(--up)" : "var(--down)";
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  }

  function niceTicks(mn, mx, n = 4) {
    const span = mx - mn || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || mag * 10;
    const lo = Math.floor(mn / step) * step, hi = Math.ceil(mx / step) * step, out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(6));
    return out;
  }

  function priceChart(el, series, target) {
    if (!series || series.length < 2) { el.innerHTML = `<p class="empty">Price history will appear after the next refresh.</p>`; return; }
    const W = 1040, H = 300, L = 56, R = 70, T = 14, B = 28;
    const vals = series.map((p) => p[1]);
    let mn = Math.min(...vals), mx = Math.max(...vals);
    if (nz(target)) { mn = Math.min(mn, target); mx = Math.max(mx, target); }
    const ticks = niceTicks(mn * 0.97, mx * 1.03);
    mn = ticks[0]; mx = ticks[ticks.length - 1];
    const x = (i) => L + (i / (series.length - 1)) * (W - L - R);
    const y = (v) => T + (1 - (v - mn) / (mx - mn)) * (H - T - B);
    const path = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
    const months = [];
    series.forEach((p, i) => { const m = p[0].slice(0, 7); if (!months.length || months[months.length - 1].m !== m) months.push({ m, i }); });
    const mlabels = months.filter((_, k) => k % 2 === 1).map(({ m, i }) => {
      const d = new Date(m + "-15");
      return `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="ax">${d.toLocaleString("en-US", { month: "short" })} ${String(d.getFullYear()).slice(2)}</text>`;
    }).join("");
    const last = series[series.length - 1];
    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Share price, last 12 months${nz(target) ? ", with target price" : ""}">
        <style>.ax{font:11px var(--mono);fill:var(--ink-3)} .gl{stroke:var(--line-2)}</style>
        ${ticks.map((t) => `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">$${t.toLocaleString()}</text>`).join("")}
        ${mlabels}
        <path d="${path}" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round"/>
        ${nz(target) ? `<line x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="5 4"/>
          <text x="${W - R + 6}" y="${y(target) + 4}" style="font:500 11px var(--mono);fill:var(--ink)">Target</text>` : ""}
        <circle cx="${x(series.length - 1)}" cy="${y(last[1])}" r="4" fill="var(--s1)" stroke="var(--panel)" stroke-width="2"/>
        <text x="${W - R + 6}" y="${y(last[1]) + 4}" style="font:11px var(--mono);fill:var(--ink-2)">Price</text>
        <line id="xh" y1="${T}" y2="${H - B}" stroke="var(--ink-3)" stroke-width="1" visibility="hidden"/>
        <circle id="xd" r="4" fill="var(--s1)" stroke="var(--panel)" stroke-width="2" visibility="hidden"/>
        <rect id="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
      </svg>`;
    const svg = el.querySelector("svg"), xh = svg.querySelector("#xh"), xd = svg.querySelector("#xd"), hit = svg.querySelector("#hit");
    hit.addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(series.length - 1, Math.round(((px - L) / (W - L - R)) * (series.length - 1))));
      const p = series[i];
      xh.setAttribute("x1", x(i)); xh.setAttribute("x2", x(i)); xh.setAttribute("visibility", "visible");
      xd.setAttribute("cx", x(i)); xd.setAttribute("cy", y(p[1])); xd.setAttribute("visibility", "visible");
      const gap = nz(target) ? `<br>Upside to target <b>${pct(target / p[1] - 1)}</b>` : "";
      showTip(`${p[0]}<br>Close <b>${usd(p[1])}</b>${gap}`, e.clientX, e.clientY);
    });
    hit.addEventListener("mouseleave", () => { xh.setAttribute("visibility", "hidden"); xd.setAttribute("visibility", "hidden"); hideTip(); });
  }

  function barsChart(el, fin) {
    const labels = fin.labels, a = fin.items.revenue || [], b = fin.items.net_income || [];
    const W = 1040, H = 280, L = 56, R = 10, T = 12, B = 26;
    const all = [...a, ...b].filter(nz);
    if (!all.length) { el.innerHTML = `<p class="empty">No 10-K data.</p>`; return; }
    const ticks = niceTicks(Math.min(0, ...all), Math.max(...all));
    const mn = ticks[0], mx = ticks[ticks.length - 1];
    const y = (v) => T + (1 - (v - mn) / (mx - mn)) * (H - T - B);
    const gw = (W - L - R) / labels.length, bw = Math.min(40, gw / 3.2);
    const bar = (v, xx, col, lab, i) => {
      if (!nz(v)) return "";
      const y0 = y(0), y1 = y(v), top = Math.min(y0, y1), h = Math.max(1, Math.abs(y0 - y1)), rr = Math.min(4, h / 2);
      // rounded only at the data end
      const d = v >= 0
        ? `M${xx},${y0} V${top + rr} Q${xx},${top} ${xx + rr},${top} H${xx + bw - rr} Q${xx + bw},${top} ${xx + bw},${top + rr} V${y0} Z`
        : `M${xx},${y0} V${top + h - rr} Q${xx},${top + h} ${xx + rr},${top + h} H${xx + bw - rr} Q${xx + bw},${top + h} ${xx + bw},${top + h - rr} V${y0} Z`;
      return `<path d="${d}" fill="${col}" data-t="${esc(labels[i])} · ${lab}: $${mm(v)}mm"/>`;
    };
    const fmtT = (t) => (Math.abs(mx) >= 1e5 ? "$" + (t / 1e3).toFixed(0) + "B" : Math.abs(mx) >= 1e3 ? "$" + (t / 1e3).toFixed(1) + "B" : "$" + t + "M");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenue and net income by fiscal year">
      <style>.ax{font:11px var(--mono);fill:var(--ink-3)}</style>
      ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? "var(--ink-3)" : "var(--line-2)"}"/><text class="ax" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${fmtT(t)}</text>`).join("")}
      ${labels.map((lb, i) => {
        const cx = L + gw * i + gw / 2;
        return bar(a[i], cx - bw - 1, "var(--s1)", "Revenue", i) + bar(b[i], cx + 1, "var(--s2)", "Net income", i) +
          `<text class="ax" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(lb)}</text>`;
      }).join("")}
    </svg>`;
    el.querySelectorAll("path[data-t]").forEach((p) => {
      p.addEventListener("mousemove", (e) => showTip(esc(p.dataset.t), e.clientX, e.clientY));
      p.addEventListener("mouseleave", hideTip);
    });
  }

  // ------------------------------------------------------------------ views
  function home() {
    const cov = INDEX.coverage || [];
    const ok = cov.filter((c) => nz(c.upside));
    const avg = ok.length ? ok.reduce((s, c) => s + c.upside, 0) / ok.length : null;
    const count = (r) => cov.filter((c) => c.rating === r).length;
    const site = INDEX.site || {};
    const rows = cov.map((c) => `
      <tr class="link" data-t="${esc(c.ticker)}" tabindex="0">
        <td><span class="tk">${esc(c.ticker)}</span><span class="co">${esc(c.name)}</span></td>
        <td class="r num">${usd(c.price)}</td>
        <td class="hide-sm">${sparkline(c.spark)}</td>
        <td class="r num"><b>${usd(c.target)}</b>${c.target_stale ? ' <span class="note" title="Last value saved by Excel">*</span>' : ""}</td>
        <td class="r num">${signed(c.upside)}</td>
        <td>${pill(c.rating)}${c.status === "error" ? `<br><span class="err">refresh failed</span>` : ""}</td>
        <td class="r num hide-sm">${mult(c.pe)}</td>
        <td class="r num hide-sm">${mult(c.ev_ebitda)}</td>
        <td class="r num hide-sm">${pct(c.op_margin)}</td>
        <td class="r num hide-sm">${big(c.market_cap)}</td>
        <td class="r"><a class="btn sm" href="downloads/${esc(c.ticker)}_model_live.xlsx" download onclick="event.stopPropagation()" aria-label="Download ${esc(c.ticker)} model">⤓ .xlsx</a></td>
      </tr>`).join("");
    app.innerHTML = `
      <section class="hero">
        <h1>${esc(site.title || "Equity Coverage")}</h1>
        <p>${esc(site.tagline || "Live valuation models, refreshed from SEC 10-K filings and market prices.")}</p>
        <div class="fresh"><span class="dot" aria-hidden="true"></span>Models recalculated ${esc(INDEX.generated_at)}</div>
      </section>
      <div class="tiles">
        <div class="tile"><div class="k">Names covered</div><div class="v">${cov.length}</div></div>
        <div class="tile"><div class="k">Avg. upside</div><div class="v">${nz(avg) ? signed(avg) : "—"}</div></div>
        <div class="tile"><div class="k">Buy / Hold / Sell</div><div class="v">${count("Buy")} / ${count("Hold")} / ${count("Sell")}</div></div>
        <div class="tile"><div class="k">Data</div><div class="v" style="font-size:15px;padding-top:5px">SEC EDGAR · 10-K</div></div>
      </div>
      <div class="card">
        <div class="card-h"><h2>Coverage</h2><span class="note">Click a row for the full model page</span></div>
        <div class="scroll">${cov.length ? `<table>
          <thead><tr><th>Company</th><th class="r">Price</th><th class="hide-sm">3M</th><th class="r">Target</th><th class="r">Upside</th><th>Rating</th>
          <th class="r hide-sm">P/E</th><th class="r hide-sm">EV/EBITDA</th><th class="r hide-sm">Op. margin</th><th class="r hide-sm">Mkt cap</th><th class="r">Model</th></tr></thead>
          <tbody>${rows}</tbody></table>` : `<div class="empty">No models yet. Add an Excel model to the <code>models/</code> folder and the next refresh will publish it.</div>`}
        </div>
      </div>`;
    app.querySelectorAll("tr.link").forEach((tr) => {
      const go = () => (location.hash = "#/" + tr.dataset.t);
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", (e) => e.key === "Enter" && go());
    });
  }

  async function detail(t) {
    app.innerHTML = `<p class="muted loading">Loading ${esc(t)}…</p>`;
    let d;
    try { d = cache[t] || (cache[t] = await getJSON(`data/${encodeURIComponent(t)}.json`)); }
    catch { app.innerHTML = `<a class="crumb" href="#/">← Coverage</a><p>No model found for ${esc(t)}.</p>`; return; }
    const s = d.snapshot || {};
    const fin = d.financials || { labels: [], items: {}, meta: {} };
    const tenk = (d.filings || [])[0];
    const list = (arr) => (arr && arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
    const outputs = Object.entries(d.model_outputs || {});
    const outVal = (k, v) => (typeof v !== "number" ? esc(v ?? "—") : Math.abs(v) < 1.5 && /wacc|growth|%|margin|rate/i.test(k) ? pct(v) : Math.abs(v) >= 1000 ? mm(v) : v.toFixed(2));
    const finRows = Object.keys(fin.items).map((k) => `<tr><td>${esc(fin.meta[k]?.label || k)}</td>${fin.items[k].map((v) => `<td class="r num">${k === "eps_diluted" ? (nz(v) ? v.toFixed(2) : "—") : mm(v)}</td>`).join("")}</tr>`).join("");
    document.title = `${d.ticker} — ${usd(d.target)} target · Equity Coverage`;

    app.innerHTML = `
      <a class="crumb" href="#/">← Coverage</a>
      <div class="dhead">
        <div>
          <h1><span class="tk">${esc(d.ticker)}</span>${esc(d.name)}</h1>
          <div class="sub">${[d.sector, d.analyst ? "Analyst: " + d.analyst : "", "Model refreshed " + d.refreshed_at].filter(Boolean).map(esc).join(" · ")}</div>
        </div>
        <div class="actions">
          <a class="btn primary" href="${esc(d.downloads?.live)}" download>⤓ Download live model</a>
          <a class="btn" href="${esc(d.downloads?.original)}" download>Original upload</a>
          ${tenk ? `<a class="btn" href="${esc(tenk.url)}" target="_blank" rel="noopener">Latest 10-K ↗</a>` : ""}
        </div>
      </div>
      ${d.status === "error" ? `<div class="warn">The last refresh failed (${esc(d.error)}). Showing the most recent good data.</div>` : ""}
      <div class="kpis">
        <div class="kpi hero-n"><div class="k">Target price</div><div class="v">${usd(d.target)}</div>
          <div class="n">${pill(d.rating)} &nbsp;from ${esc(d.target_cell || "model")}${d.target_stale ? " · last value saved by Excel" : ""}</div></div>
        <div class="kpi"><div class="k">Price</div><div class="v">${usd(d.price)}</div><div class="n">${esc(d.price_date)} · ${esc(d.price_source)}</div></div>
        <div class="kpi"><div class="k">Upside</div><div class="v">${signed(d.upside)}</div></div>
        <div class="kpi"><div class="k">Market cap</div><div class="v">${big(s.market_cap)}</div></div>
        <div class="kpi"><div class="k">Enterprise value</div><div class="v">${big(s.enterprise_value)}</div></div>
      </div>

      <div class="card section">
        <div class="card-h"><h2>Price vs. target · 12 months</h2><span class="note">Hover for detail</span></div>
        <div class="chart-wrap" id="pc"></div>
        <div class="legend"><span><i style="background:var(--s1)"></i>Share price</span>${nz(d.target) ? `<span><i class="dash"></i>Target ${usd(d.target)}</span>` : ""}</div>
      </div>

      <section class="section">
        <h2 class="sec">Financial ratios <span class="note" style="text-transform:none;letter-spacing:0">· latest 10-K (${esc(fin.labels.at(-1) || "")}) at current price</span></h2>
        <div class="card"><div class="ratios">${(d.ratios || []).map((g) => `
          <div class="rgroup"><h3>${esc(g.name)}</h3>${g.items.map((i) => `<div class="rrow"><span>${esc(i.label)}</span><span class="num">${ratioFmt(i)}</span></div>`).join("")}</div>`).join("")}
        </div></div>
      </section>

      ${d.thesis || (d.catalysts || []).length || (d.risks || []).length ? `
      <div class="grid2 section">
        <div class="card"><div class="card-h"><h2>Thesis</h2></div><div class="prose"><p>${esc(d.thesis)}</p>${d.catalysts?.length ? `<p class="muted" style="margin-top:12px">Catalysts</p>${list(d.catalysts)}` : ""}</div></div>
        <div class="card"><div class="card-h"><h2>Key risks</h2></div><div class="prose">${list(d.risks) || '<p class="muted">—</p>'}</div></div>
      </div>` : ""}

      <div class="card section">
        <div class="card-h"><h2>Historical financials · from 10-K XBRL ($mm)</h2>
          <div class="toggle" role="tablist"><button class="on" data-v="chart">Chart</button><button data-v="table">Table</button></div></div>
        <div id="fin-chart"><div class="chart-wrap" id="bc"></div>
          <div class="legend"><span><i style="background:var(--s1)"></i>Revenue</span><span><i style="background:var(--s2)"></i>Net income</span></div></div>
        <div id="fin-table" class="scroll" hidden><table><thead><tr><th></th>${fin.labels.map((l) => `<th class="r">${esc(l)}</th>`).join("")}</tr></thead><tbody>${finRows}</tbody></table></div>
      </div>

      <div class="grid2 section">
        <div class="card"><div class="card-h"><h2>Model outputs</h2></div>
          ${outputs.length ? outputs.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span class="num">${outVal(k, v)}</span></div>`).join("") : `<div class="kv"><span>Target price cell</span><span class="mono">${esc(d.target_cell || "—")}</span></div>`}
          <div class="kv"><span>Model file</span><span class="mono">${esc(d.model_file)}</span></div>
          ${(d.linked_inputs || []).length ? `<div class="kv"><span>Live links &amp; overrides</span><span class="mono" style="white-space:normal;text-align:right">${d.linked_inputs.map(esc).join("<br>")}</span></div>` : ""}
        </div>
        <div class="card"><div class="card-h"><h2>Annual filings · SEC EDGAR</h2></div>
          ${(d.filings || []).map((f) => `<div class="kv"><span>${esc(f.form)} · period ${esc(f.period)}</span><a class="mono" href="${esc(f.url)}" target="_blank" rel="noopener">filed ${esc(f.filed)} ↗</a></div>`).join("") || '<div class="kv"><span>None found</span></div>'}
        </div>
      </div>
      <p class="note">Fundamentals from the company's own XBRL filings with the SEC (CIK ${esc(d.cik)}). Ratios use the latest fiscal year and the current share price. Educational project, not investment advice.</p>`;

    priceChart(document.getElementById("pc"), d.price_history, d.target);
    barsChart(document.getElementById("bc"), fin);
    app.querySelectorAll(".toggle button").forEach((b) => b.addEventListener("click", () => {
      app.querySelectorAll(".toggle button").forEach((x) => x.classList.toggle("on", x === b));
      document.getElementById("fin-chart").hidden = b.dataset.v !== "chart";
      document.getElementById("fin-table").hidden = b.dataset.v !== "table";
    }));
  }

  function method() {
    app.innerHTML = `<article class="doc">
      <h1>Methodology</h1>
      <p>Every model on this site is a working Excel file. Each trading day an automated job reopens it, refreshes its data from primary sources, recalculates it, and republishes the result.</p>
      <h2>The refresh cycle</h2>
      <ol class="steps">
        <li>Fundamentals are pulled from <b>SEC EDGAR</b>: the XBRL financial data each company files with its 10-K. Five fiscal years of income statement, balance sheet and cash-flow items, plus the latest share count from the 10-K cover page.</li>
        <li>The latest share price and 12 months of history come from Yahoo Finance (Stooq as a fallback).</li>
        <li>That data is written into a <code>Live_Data</code> tab inside each model. Model cells linked to it update automatically.</li>
        <li>The whole workbook is recalculated, and the target price is read from the model's target cell.</li>
        <li>Ratios are computed from the latest 10-K at the current price, and the refreshed workbook is published for download.</li>
      </ol>
      <h2>Target price</h2>
      <p>The target comes straight from each model: a configured cell, a cell named <code>TargetPrice</code>, or the cell labelled "Target Price" / "Implied share price". Ratings follow upside to target: Buy above ${pct(INDEX.ratings?.buy_above ?? 0.15, 0)}, Sell below ${pct(INDEX.ratings?.sell_below ?? -0.1, 0)}, Hold in between.</p>
      <h2>Ratios</h2>
      <p>Valuation multiples use market cap and enterprise value (market cap + total debt − cash) at the current price. Multiples on negative earnings are shown as "—". ROIC uses NOPAT over debt + equity − cash.</p>
      <h2>Starter template</h2>
      <p>The <a href="downloads/DCF_Template.xlsx" download>DCF template</a> is pre-wired to the <code>Live_Data</code> tab. Blue cells are inputs, green cells pull live data, black cells are formulas.</p>
      <p class="note">Educational project. Nothing here is investment advice.</p>
    </article>`;
  }

  // ----------------------------------------------------------------- router
  async function route() {
    hideTip();
    if (!INDEX) {
      try { INDEX = await getJSON("data/index.json"); }
      catch { INDEX = { coverage: [], site: {}, generated_at: "— first refresh pending" }; }
      const site = INDEX.site || {};
      if (site.title) document.getElementById("brand-name").textContent = site.title.split("—")[0].trim();
      const nav = document.getElementById("nav");
      if (site.portfolio) nav.insertAdjacentHTML("beforeend", `<a href="${esc(site.portfolio)}" target="_blank" rel="noopener">Portfolio ↗</a>`);
      if (site.linkedin) nav.insertAdjacentHTML("beforeend", `<a href="${esc(site.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a>`);
      document.getElementById("foot-right").textContent = INDEX.owner ? "© " + new Date().getFullYear() + " " + INDEX.owner : "";
    }
    const h = location.hash.replace(/^#\/?/, "");
    document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#/" + (h === "method" ? "method" : "")));
    window.scrollTo(0, 0);
    if (!h) { document.title = (INDEX.site?.title || "Equity Coverage"); home(); }
    else if (h === "method") method();
    else detail(decodeURIComponent(h).toUpperCase());
  }
  window.addEventListener("hashchange", route);
  route();
})();
