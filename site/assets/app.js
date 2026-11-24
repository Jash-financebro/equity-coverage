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

  function indexChart(el, idx) {
    if (!idx || idx.length < 2) { el.innerHTML = `<p class="empty">Not enough history yet.</p>`; return; }
    const W = 1040, H = 280, L = 50, R = 80, T = 14, B = 28;
    const all = idx.flatMap((p) => [p[1], p[2]]);
    const ticks = niceTicks(Math.min(...all), Math.max(...all), 4);
    const mn = ticks[0], mx = ticks[ticks.length - 1];
    const x = (i) => L + (i / (idx.length - 1)) * (W - L - R);
    const y = (v) => T + (1 - (v - mn) / (mx - mn)) * (H - T - B);
    const path = (k) => idx.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
    const last = idx[idx.length - 1];
    let yf = y(last[1]) + 4, ys = y(last[2]) + 4;
    if (Math.abs(yf - ys) < 13) { const mid = (yf + ys) / 2, up = last[1] >= last[2]; yf = mid + (up ? -7 : 7); ys = mid + (up ? 7 : -7); }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Portfolio vs S&P 500, indexed to 100">
      <style>.ax{font:11px var(--mono);fill:var(--ink-3)}</style>
      ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line-2)"/><text class="ax" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join("")}
      <path d="${path(2)}" fill="none" stroke="var(--s2)" stroke-width="2"/>
      <path d="${path(1)}" fill="none" stroke="var(--s1)" stroke-width="2"/>
      <text x="${W - R + 6}" y="${yf}" style="font:11px var(--mono);fill:var(--ink-2)">Fund ${last[1].toFixed(1)}</text>
      <text x="${W - R + 6}" y="${ys}" style="font:11px var(--mono);fill:var(--ink-2)">S&amp;P ${last[2].toFixed(1)}</text>
      <text class="ax" x="${L}" y="${H - 8}">${esc(idx[0][0])}</text><text class="ax" x="${W - R}" y="${H - 8}" text-anchor="end">${esc(last[0])}</text>
      <rect id="hit2" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
    </svg>`;
    const svg = el.querySelector("svg");
    svg.querySelector("#hit2").addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(idx.length - 1, Math.round(((px - L) / (W - L - R)) * (idx.length - 1))));
      showTip(`${idx[i][0]}<br>Fund <b>${idx[i][1].toFixed(1)}</b> · S&amp;P 500 <b>${idx[i][2].toFixed(1)}</b>`, e.clientX, e.clientY);
    });
    svg.querySelector("#hit2").addEventListener("mouseleave", hideTip);
  }

  function hbars(items) { // [{label, value}] value 0..1
    const mx = Math.max(...items.map((i) => i.value), 0.0001);
    return items.map((i) => `<div class="hb"><span>${esc(i.label)}</span><div class="hb-track"><div class="hb-fill" style="width:${(i.value / mx) * 100}%"></div></div><span class="num">${pct(i.value)}</span></div>`).join("");
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
        <td class="r num hide-sm">${usd(c.street_median)}</td>
        <td class="r num">${signed(c.upside)}</td>
        <td>${pill(c.rating)}${c.needs_review ? ` <span class="flag" title="New SEC filing since the model was last updated">Review</span>` : ""}${c.status === "error" ? `<br><span class="err">refresh failed</span>` : ""}</td>
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
          <thead><tr><th>Company</th><th class="r">Price</th><th class="hide-sm">3M</th><th class="r">Target</th><th class="r hide-sm">Street med.</th><th class="r">Upside</th><th>Rating</th>
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


  function trackHtml(d) {
    const tr = d.track_record;
    if (!tr || !tr.calls || !tr.calls.length) return "";
    return `<div class="card section">
      <div class="card-h"><h2>Track record · calls vs. S&amp;P 500</h2><span class="note">Each change in rating or target is a call. Hit = Buy beat the S&amp;P, Sell lagged it, Hold within ±10% (after 30 days)</span></div>
      <div class="kvrow">
        <div class="kv"><span>Tracking since</span><span class="num">${esc(tr.since)}</span></div>
        <div class="kv"><span>Stock since then</span><span class="num">${signed(tr.since_return)}</span></div>
        <div class="kv"><span>S&amp;P 500 since then</span><span class="num">${signed(tr.since_spy)}</span></div>
        <div class="kv"><span>Hit rate</span><span class="num">${nz(tr.hit_rate) ? pct(tr.hit_rate, 0) + ` (${tr.judged} calls)` : "needs 30+ days"}</span></div>
      </div>
      <div class="scroll"><table><thead><tr><th>Date</th><th>Rating</th><th class="r">Target</th><th class="r">Price then</th><th class="r">Return</th><th class="r">S&amp;P 500</th><th class="r">Alpha</th><th>Target hit?</th><th>Call</th></tr></thead>
      <tbody>${tr.calls.slice(0, 12).map((c) => `<tr><td class="mono">${esc(c.date)}</td><td>${pill(c.rating)}</td><td class="r num">${usd(c.target)}</td><td class="r num">${usd(c.price)}</td><td class="r num">${signed(c.return)}</td><td class="r num">${signed(c.spy_return)}</td><td class="r num">${signed(c.alpha)}</td><td>${c.target_reached === true ? "Yes" : c.target_reached === false ? "Not yet" : "—"}</td><td>${c.hit === true ? '<span class="up">✓ Hit</span>' : c.hit === false ? '<span class="down">✗ Miss</span>' : '<span class="note">open</span>'}</td></tr>`).join("")}</tbody></table></div>
    </div>`;
  }

  async function fund() {
    app.innerHTML = `<p class="muted loading">Loading fund…</p>`;
    let f;
    try { f = await getJSON("data/fund.json"); } catch { app.innerHTML = `<p class="empty">Fund dashboard appears after the next refresh.</p>`; return; }
    const st = f.stats;
    document.title = "Fund dashboard · " + (INDEX.site?.title || "Equity Coverage");
    app.innerHTML = `
      <section class="hero"><h1>${esc(f.name)}</h1>
        <p>${f.custom ? "Holdings from config.yml" : "Equal-weight portfolio of every covered name. Add your fund's real holdings under <code>portfolio:</code> in config.yml."} Data through ${esc(f.as_of)}.</p></section>
      <div class="tiles">
        <div class="tile"><div class="k">1Y return</div><div class="v">${signed(st.return_1y)}</div></div>
        <div class="tile"><div class="k">S&amp;P 500 1Y</div><div class="v">${signed(st.spy_return_1y)}</div></div>
        <div class="tile"><div class="k">Sharpe ratio</div><div class="v">${nz(st.sharpe) ? st.sharpe.toFixed(2) : "—"}</div></div>
        <div class="tile"><div class="k">Beta vs S&amp;P</div><div class="v">${nz(st.beta) ? st.beta.toFixed(2) : "—"}</div></div>
      </div>
      <div class="tiles">
        <div class="tile"><div class="k">Volatility (ann.)</div><div class="v">${pct(st.ann_vol)}</div></div>
        <div class="tile"><div class="k">Jensen's alpha</div><div class="v">${signed(st.alpha)}</div></div>
        <div class="tile"><div class="k">Max drawdown</div><div class="v">${pct(st.max_drawdown)}</div></div>
        <div class="tile"><div class="k">Risk-free (3M T-bill)</div><div class="v">${pct(st.risk_free, 2)}</div></div>
      </div>
      <div class="card section"><div class="card-h"><h2>Growth of 100 · fund vs. S&amp;P 500</h2><span class="note">Hover for detail</span></div>
        <div class="chart-wrap" id="ix"></div>
        <div class="legend"><span><i style="background:var(--s1)"></i>Fund</span><span><i style="background:var(--s2)"></i>S&amp;P 500 (SPY)</span></div></div>
      <div class="grid2 section">
        <div class="card"><div class="card-h"><h2>Sector weights</h2></div><div class="prose">${hbars(f.sectors.map((s) => ({ label: s.sector, value: s.weight })))}</div></div>
        <div class="card"><div class="card-h"><h2>Holdings</h2></div>
          ${f.holdings.map((h) => { const c = (f.coverage_targets || []).find((x) => x.ticker === h.ticker);
            return `<div class="kv"><span><a href="#/${esc(h.ticker)}" class="tk">${esc(h.ticker)}</a> <span class="note">${esc(h.sector)}</span></span><span class="num">${pct(h.weight)}${c ? ` · ${pill(c.rating)} ${signed(c.upside)}` : ""}</span></div>`; }).join("")}
        </div>
      </div>
      <p class="note">Sharpe = (annualized return − 3M T-bill) / annualized volatility, from daily returns. Alpha from CAPM with beta estimated against SPY.</p>`;
    indexChart(document.getElementById("ix"), f.index);
  }

  async function detail(t) {
    app.innerHTML = `<p class="muted loading">Loading ${esc(t)}…</p>`;
    let d;
    try { d = cache[t] || (cache[t] = await getJSON(`data/${encodeURIComponent(t)}.json`)); }
    catch { app.innerHTML = `<a class="crumb" href="#/coverage">← Coverage</a><p>No model found for ${esc(t)}.</p>`; return; }
    const s = d.snapshot || {};
    const cons = d.consensus || {};
    const peerImp = d.peers?.implied?.average;
    const fin = d.financials || { labels: [], items: {}, meta: {} };
    const tenk = (d.filings || [])[0];
    const list = (arr) => (arr && arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
    const outputs = Object.entries(d.model_outputs || {});
    const outVal = (k, v) => (typeof v !== "number" ? esc(v ?? "—") : Math.abs(v) < 1.5 && /wacc|growth|%|margin|rate/i.test(k) ? pct(v) : Math.abs(v) >= 1000 ? mm(v) : v.toFixed(2));
    const finRows = Object.keys(fin.items).map((k) => `<tr><td>${esc(fin.meta[k]?.label || k)}</td>${fin.items[k].map((v) => `<td class="r num">${k === "eps_diluted" ? (nz(v) ? v.toFixed(2) : "—") : mm(v)}</td>`).join("")}</tr>`).join("");
    document.title = `${d.ticker} — ${usd(d.target)} target · Equity Coverage`;

    app.innerHTML = `
      <a class="crumb" href="#/coverage">← Coverage</a>
      <div class="dhead">
        <div>
          <h1><span class="tk">${esc(d.ticker)}</span>${esc(d.name)}</h1>
          <div class="sub">${[d.sector, d.analyst ? "Analyst: " + d.analyst : "", "Model refreshed " + d.refreshed_at].filter(Boolean).map(esc).join(" · ")}</div>
        </div>
        <div class="actions">
          <a class="btn primary" href="${esc(d.downloads?.live)}" download>⤓ Download live model</a>
          ${d.report ? `<a class="btn" href="${esc(d.report.pdf || d.report.docx)}" download>Research report</a>` : ""}
          ${d.downloads?.tearsheet ? `<a class="btn" href="${esc(d.downloads.tearsheet)}" download>Tear sheet (PDF)</a>` : ""}
          <a class="btn" href="${esc(d.downloads?.original)}" download>Original upload</a>
          ${tenk ? `<a class="btn" href="${esc(tenk.url)}" target="_blank" rel="noopener">Latest 10-K ↗</a>` : ""}
        </div>
      </div>
      ${d.status === "error" ? `<div class="warn">The last refresh failed (${esc(d.error)}). Showing the most recent good data.</div>` : ""}
      ${d.needs_review ? `<div class="warn"><b>Needs review:</b> ${d.new_filings.map((f) => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.form)} filed ${esc(f.filed)}</a>`).join(", ")} arrived after the model was last updated (${esc(d.model_updated)}).</div>` : ""}
      <div class="kpis">
        <div class="kpi hero-n"><div class="k">Target price</div><div class="v">${usd(d.target)}</div>
          <div class="n">${pill(d.rating)} &nbsp;from ${esc(d.target_cell || "model")}${d.target_stale ? " · last value saved by Excel" : ""}</div></div>
        <div class="kpi"><div class="k">Price</div><div class="v">${usd(d.price)}</div><div class="n">${esc(d.price_date)} · ${esc(d.price_source)}</div></div>
        <div class="kpi"><div class="k">Upside</div><div class="v">${signed(d.upside)}</div></div>
        <div class="kpi"><div class="k">Street mean / median</div><div class="v">${usd(cons.target_mean, 0)} / ${usd(cons.target_median, 0)}</div><div class="n">${cons.analysts ? cons.analysts + " analysts · " : ""}${esc(cons.source || "consensus unavailable")}</div></div>
        <div class="kpi"><div class="k">Peer-implied (avg)</div><div class="v">${usd(peerImp, 2)}</div><div class="n">median EV/EBITDA &amp; P/E</div></div>
      </div>
      ${nz(d.published_target) ? `<p class="note" style="margin:-12px 0 18px">Published target ${usd(d.published_target)} · live model now ${usd(d.target)} (${signed(d.target / d.published_target - 1)}) after refreshing market inputs.</p>` : ""}

      ${Object.values(d.scenarios || {}).some(nz) ? `
      <div class="grid2 section">
        <div class="card"><div class="card-h"><h2>Scenarios · from the model</h2><span class="note">Bear / base / bull toggle recalculated</span></div>
          ${["bear", "base", "bull"].filter((k) => nz(d.scenarios[k])).map((k) => `<div class="kv"><span>${k[0].toUpperCase() + k.slice(1)}</span><span class="num">${usd(d.scenarios[k])} &nbsp;${signed(d.scenarios[k] / d.price - 1)}</span></div>`).join("")}
        </div>
        <div class="card"><div class="card-h"><h2>Cost of capital · market data</h2><span class="note">vs. model</span></div>
          ${d.wacc ? [["Risk-free (10Y)", pct(d.wacc.risk_free, 2)], ["Beta" + (d.wacc.beta_source ? ` (${esc(d.wacc.beta_source)})` : ""), nz(d.wacc.beta) ? d.wacc.beta.toFixed(2) : "—"], ["Cost of equity", pct(d.wacc.cost_of_equity, 2)], ["After-tax cost of debt", pct(d.wacc.after_tax_cost_of_debt, 2)], ["Market-data WACC", pct(d.wacc.wacc, 2)], ["Model WACC", nz((d.model_outputs || {}).WACC) ? pct(d.model_outputs.WACC, 2) : "—"]].map(([k, v]) => `<div class="kv"><span>${k}</span><span class="num">${v}</span></div>`).join("") : ""}
        </div>
      </div>` : ""}

      <div class="card section">
        <div class="card-h"><h2>Football field · valuation ranges</h2><span class="note">Black = price · orange dashed = model target</span></div>
        <div class="chart-wrap" id="ff"></div>
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

      ${d.peers ? `
      <div class="card section">
        <div class="card-h"><h2>Peer comparison · SEC 10-K data at current prices</h2><span class="note">Implied prices on ${esc(d.peers.basis || "10-K figures")} · street targets: Yahoo Finance</span></div>
        <div class="scroll"><table>
          <thead><tr><th>Company</th><th class="r">Price</th><th class="r">P/E</th><th class="r">EV/EBITDA</th><th class="r">EV/Sales</th><th class="r">Op. margin</th><th class="r">Rev. growth</th><th class="r">ROE</th><th class="r">ND/EBITDA</th><th class="r">Street mean</th><th class="r">Street median</th><th class="r">Upside to median</th></tr></thead>
          <tbody>${d.peers.rows.map((r) => r.status === "error" ? `<tr><td><span class="tk">${esc(r.ticker)}</span></td><td colspan="11" class="note">data unavailable</td></tr>` : `<tr${r.self ? ' class="selfrow"' : ""}><td><span class="tk">${esc(r.ticker)}</span><span class="co">${esc(r.name)}</span></td>
            <td class="r num">${usd(r.price)}</td><td class="r num">${mult(r.pe)}</td><td class="r num">${mult(r.ev_ebitda)}</td><td class="r num">${mult(r.ev_sales)}</td><td class="r num">${pct(r.op_margin)}</td><td class="r num">${pct(r.rev_growth)}</td><td class="r num">${pct(r.roe)}</td><td class="r num">${mult(r.net_debt_ebitda)}</td><td class="r num">${usd(r.street_mean)}</td><td class="r num">${usd(r.street_median)}</td><td class="r num">${signed(r.street_upside)}</td></tr>`).join("")}
          <tr class="medrow"><td>Peer median</td><td></td><td class="r num">${mult(d.peers.medians.pe)}</td><td class="r num">${mult(d.peers.medians.ev_ebitda)}</td><td class="r num">${mult(d.peers.medians.ev_sales)}</td><td class="r num">${pct(d.peers.medians.op_margin)}</td><td class="r num">${pct(d.peers.medians.rev_growth)}</td><td class="r num">${pct(d.peers.medians.roe)}</td><td class="r num">${mult(d.peers.medians.net_debt_ebitda)}</td><td></td><td></td><td class="r num">${signed(d.peers.medians.street_upside)}</td></tr>
          </tbody></table></div>
        <div class="kvrow">
          <div class="kv"><span>Implied at peer-median EV/EBITDA</span><span class="num">${usd(d.peers.implied.ev_ebitda.median)}</span></div>
          <div class="kv"><span>Implied at peer-median P/E</span><span class="num">${usd(d.peers.implied.pe.median)}</span></div>
          <div class="kv"><span>Average of peer-implied prices</span><span class="num">${usd(d.peers.implied.average)}</span></div>
          <div class="kv"><span>Peer average upside to street median target</span><span class="num">${signed(d.peers.peer_avg_street_upside)}</span></div>
        </div>
      </div>` : ""}

      ${trackHtml(d)}

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
        <div class="card"><div class="card-h"><h2>Recent filings · SEC EDGAR</h2></div>
          ${(d.recent_filings || d.filings || []).map((f) => `<div class="kv"><span>${esc(f.form)} · period ${esc(f.period)}</span><a class="mono" href="${esc(f.url)}" target="_blank" rel="noopener">filed ${esc(f.filed)} ↗</a></div>`).join("") || '<div class="kv"><span>None found</span></div>'}
        </div>
      </div>
      <p class="note">Fundamentals from the company's own XBRL filings with the SEC (CIK ${esc(d.cik)}). Ratios use the latest fiscal year and the current share price. Educational project, not investment advice.</p>`;

    priceChart(document.getElementById("pc"), d.price_history, d.target);
    footballChart(document.getElementById("ff"), d.football, d.price, d.target);
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


  // --------------------------------------------------------- generate + library
  let API = null, SEARCH = null, LIB = null;
  const ago = (iso) => { if (!iso) return ""; const s = (Date.now() - Date.parse(iso)) / 1000;
    return s < 90 ? "just now" : s < 5400 ? Math.round(s / 60) + " min ago" : s < 129600 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " days ago"; };
  async function apiBase() {
    if (API !== null) return API;
    try { API = (await getJSON("api.json")).api || ""; } catch { API = ""; }
    return API;
  }
  async function searchList() {
    if (!SEARCH) { try { SEARCH = await getJSON("universe/search.json"); } catch { SEARCH = []; } }
    return SEARCH;
  }
  async function libraryIndex(force) {
    if (LIB && !force) return LIB;
    const base = await apiBase();
    try { LIB = base ? await fetch(base + "/api/library").then((r) => r.json())
                     : await getJSON("https://raw.githubusercontent.com/Jash-financebro/equity-coverage/main/library/index.json"); }
    catch { LIB = { models: [], sectors: {}, count: 0 }; }
    return LIB;
  }
  const dl = (m) => `<a class="btn sm primary" href="${esc(m.files?.xlsx)}">⤓ Model (.xlsx)</a> <a class="btn sm" href="${esc(m.files?.pdf)}" target="_blank" rel="noopener">⤓ Report (PDF)</a>`;

  function resultCard(m, note) {
    const sc = m.scenarios || {};
    return `<div class="card result">
      <div class="card-h"><h2>${esc(m.ticker)} · ${esc(m.name)}</h2><span class="note">${esc(m.sector)} · ${esc(m.industry || "")}</span></div>
      <div class="kpis" style="padding:18px">
        <div class="kpi hero-n"><div class="k">Price target</div><div class="v">${usd(m.target)}</div><div class="n">${pill(m.rating)} &nbsp;blend of DCF ${usd(m.dcf_value)} and comps ${usd(m.comps_value)}</div></div>
        <div class="kpi"><div class="k">Price</div><div class="v">${usd(m.price)}</div><div class="n">${esc(m.price_date)}</div></div>
        <div class="kpi"><div class="k">Upside</div><div class="v">${signed(m.upside)}</div></div>
        <div class="kpi"><div class="k">Bear / Base / Bull</div><div class="v" style="font-size:17px">${usd(sc.bear, 0)} / ${usd(sc.base, 0)} / ${usd(sc.bull, 0)}</div></div>
        <div class="kpi"><div class="k">WACC</div><div class="v">${pct(m.wacc, 2)}</div><div class="n">peers: ${esc((m.peers || []).join(", ") || "none")}</div></div>
      </div>
      <div class="gen-actions">${dl(m)}<span class="note">${note || ""} · version ${m.version} · generated ${ago(m.generated_at)}${m.times_generated > 1 ? ` · ${m.times_generated} builds` : ""}</span></div>
    </div>`;
  }

  async function generateView() {
    document.title = "Generate a model · " + (INDEX.site?.title || "Equity Coverage");
    const base = await apiBase();
    const lib = await libraryIndex();
    app.innerHTML = `
      <section class="hero"><h1>Model any NYSE or Nasdaq company</h1>
        <p>Type a ticker. We pull the company's 10-K data from SEC EDGAR and build a full Excel model: three linked statements with PP&amp;E, debt and revolver schedules, WACC, a five-year DCF with sensitivity grid, same-industry comps, and bull, base and bear cases. You also get a summary research report. It takes about two to three minutes.</p></section>
      <div class="card gen-box">
        <form id="gen-form" autocomplete="off">
          <div class="gen-row">
            <div class="gen-input"><input id="tk" placeholder="Ticker or company name, e.g. XOM, AAPL or Coca-Cola" aria-label="NYSE or Nasdaq ticker" spellcheck="false">
              <div id="sugg" class="sugg" hidden></div></div>
            <button class="btn primary big" id="go" type="submit">Generate model</button>
          </div>
          <p class="note" id="gen-hint">${base ? "NYSE and Nasdaq SEC filers (funds and trusts excluded). A model built in the last 6 hours is reused instantly." : "The generation service is being set up. Browse the Library in the meantime."}</p>
        </form>
        <div id="gen-status"></div>
      </div>
      <div id="gen-result"></div>
      <section class="section"><h2 class="sec">Recently generated</h2>
        <div class="card">${(lib.models || []).slice(0, 6).map((m) => `<div class="kv"><span><a href="#/library" class="tk">${esc(m.ticker)}</a> ${esc(m.name)} <span class="note">${esc(m.sector)} · ${ago(m.generated_at)}</span></span><span class="num">${usd(m.target)} ${pill(m.rating)} &nbsp;<a class="btn sm" href="${esc(m.files?.xlsx)}">.xlsx</a> <a class="btn sm" href="${esc(m.files?.pdf)}" target="_blank" rel="noopener">PDF</a></span></div>`).join("") || '<div class="empty">Nothing yet. Be the first.</div>'}</div></section>`;

    const tk = document.getElementById("tk"), sugg = document.getElementById("sugg"), list = await searchList();
    tk.addEventListener("input", () => {
      const q = tk.value.trim().toUpperCase().replace(/[./]/g, "-");
      if (!q) { sugg.hidden = true; return; }
      const qn = tk.value.trim().toUpperCase();
      const hits = list.filter(([t, n]) => t.startsWith(q) || n.toUpperCase().includes(qn)).sort((a, b) => (a[0] === q ? -1 : b[0] === q ? 1 : a[0].length - b[0].length)).slice(0, 8);
      sugg.innerHTML = hits.map(([t, n, sct, x]) => `<div class="sg" data-t="${esc(t)}"><b>${esc(t)}</b> ${esc(n)} <span class="note">${esc(x || "NYSE")} · ${esc(sct)}</span></div>`).join("");
      sugg.hidden = !hits.length;
      sugg.querySelectorAll(".sg").forEach((el) => el.addEventListener("mousedown", (e) => { e.preventDefault(); tk.value = el.dataset.t; sugg.hidden = true; }));
    });
    tk.addEventListener("blur", () => setTimeout(() => (sugg.hidden = true), 100));
    document.getElementById("gen-form").addEventListener("submit", (e) => { e.preventDefault(); startGenerate(tk.value, false); });
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
    const steps = ["Request accepted", "Pulling SEC 10-K data, prices and same-industry peers", "Building the three-statement model, DCF and scenarios", "Recalculating in Excel engine and writing the report", "Ready"];
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
      let phase = 1;
      for (let i = 0; i < 120; i++) {
        await new Promise((res) => setTimeout(res, 5000));
        const el = (Date.now() - t0) / 1000;
        phase = el > 75 ? 3 : el > 30 ? 2 : 1;
        const s = await fetch(`${base}/api/status?ticker=${encodeURIComponent(t)}&since=${encodeURIComponent(since)}`).then((x) => x.json());
        if (s.status === "ready") { draw(4); LIB = null; out.innerHTML = resultCard(s.model, "Fresh build"); stat.innerHTML = ""; return; }
        if (s.status === "failed") throw new Error(`We couldn't build ${esc(t)}. This usually means the company has no annual XBRL financials on file with the SEC yet (new registrants, recent reorganizations, funds and trusts). <a href="${esc(s.run_url)}" target="_blank" rel="noopener">Build log</a>.`);
        draw(s.status === "queued" ? 0 : s.status === "finishing" ? 3 : phase, s.status === "queued" ? "waiting for a runner" : "");
      }
      throw new Error("This is taking longer than usual. Check the Library in a few minutes.");
    } catch (e) {
      stat.innerHTML = `<div class="warn">${String(e.message || e)}</div>`;
    } finally { btn.disabled = false; }
  }
  function hookRegen(t) { const a = document.getElementById("regen"); if (a) a.addEventListener("click", (e) => { e.preventDefault(); startGenerate(t, true); }); }

  async function libraryView() {
    document.title = "Library · " + (INDEX.site?.title || "Equity Coverage");
    app.innerHTML = `<p class="muted loading">Loading library…</p>`;
    const lib = await libraryIndex(true);
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
          <tbody>${rows.map((m) => `<tr><td><span class="tk">${esc(m.ticker)}</span><span class="co">${esc(m.name)} · ${esc(m.industry || "")}</span></td>
            <td class="r num"><b>${usd(m.target)}</b></td><td class="r num">${usd(m.price)}</td><td class="r num">${signed(m.upside)}</td><td>${pill(m.rating)}</td>
            <td class="r num hide-sm">${usd(m.scenarios?.bear, 0)} / ${usd(m.scenarios?.base, 0)} / ${usd(m.scenarios?.bull, 0)}</td>
            <td class="hide-sm note">${esc((m.generated_at || "").slice(0, 10))} · v${m.version}${m.times_generated > 1 ? ` · ${m.times_generated}×` : ""}</td>
            <td class="r"><a class="btn sm" href="${esc(m.files?.xlsx)}">.xlsx</a> <a class="btn sm" href="${esc(m.files?.pdf)}" target="_blank" rel="noopener">PDF</a></td></tr>`).join("")}</tbody></table></div></div>`;
      }).join("") || `<div class="empty card">No models match. <a href="#/">Generate one</a>.</div>`;
    };
    app.innerHTML = `<section class="hero"><h1>Model library</h1><p>Every model anyone has generated on this site, sorted by sector. Each comes with the full Excel model and a summary report.</p>
      <div class="fresh"><span class="dot" aria-hidden="true"></span>${models.length} companies · ${sectors.length} sectors · updated ${ago(lib.updated_at)}</div></section>
      <div class="lib-tools"><input id="lib-q" placeholder="Filter by ticker or name" aria-label="Filter library">
        <div class="chips"><button class="chip on" data-s="">All</button>${sectors.map((s) => `<button class="chip" data-s="${esc(s)}">${esc(s)} <span>${models.filter((m) => m.sector === s).length}</span></button>`).join("")}</div></div>
      <div id="lib-body"></div>`;
    let sel = "";
    const q = document.getElementById("lib-q");
    q.addEventListener("input", () => render(q.value, sel));
    app.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { sel = c.dataset.s; app.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === c)); render(q.value, sel); }));
    render("", "");
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
    document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#/" + (["method", "fund", "library", "coverage"].includes(h) ? h : "")));
    window.scrollTo(0, 0);
    if (!h) generateView();
    else if (h === "coverage") { document.title = (INDEX.site?.title || "Equity Coverage"); home(); }
    else if (h === "library") libraryView();
    else if (h === "method") method();
    else if (h === "fund") fund();
    else detail(decodeURIComponent(h).toUpperCase());
  }
  window.addEventListener("hashchange", route);
  route();
})();
