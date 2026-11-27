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

  // Static JSON is versioned by the last site refresh, so repeat visits come from the browser cache.
  let DATA_V = Date.now().toString().slice(0, -5);
  async function getJSON(url, v) {
    if (!v && url !== "data/index.json") await bootIndex();
    const r = await fetch(url + "?v=" + (v || DATA_V));
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
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------- private error reporting (shows in the owner's Library)
  let ERR_N = 0;
  function reportError(msg, src, line, stack) {
    msg = String(msg || ""); src = String(src || "");
    if (ERR_N >= 3 || !msg || /ResizeObserver loop|Script error\.?$|extension:\/\/|chrome-extension/.test(msg + src)) return;
    if (src && !src.startsWith(location.origin)) return;                // only errors from the site's own code
    ERR_N++;
    apiBase().then((base) => base && fetch(base + "/api/error", { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ msg, src: src.replace(location.origin, ""), line, stack: String(stack || "").slice(0, 1200), route: location.hash.slice(0, 80), build: document.querySelector("script[src*='app.js']")?.src.split("?")[1] || "" }) })).catch(() => {});
  }
  window.addEventListener("error", (e) => reportError(e.message, e.filename, e.lineno, e.error?.stack));
  window.addEventListener("unhandledrejection", (e) => { const r = e.reason || {}; if (r.name === "AbortError" || /Failed to fetch|NetworkError|Load failed/.test(String(r.message || r))) return;
    reportError("Unhandled: " + String(r.message || r), (String(r.stack || "").match(/https?:[^\s)]+app\.js/) || [location.origin + "/assets/app.js"])[0], null, r.stack); });

  // ------------------------------------------------------------- watchlist (kept in this browser only)
  const WL = {
    get: () => { try { return JSON.parse(store.get("mb_watch") || "[]"); } catch { return []; } },
    set: (a) => { store.set("mb_watch", a.length ? JSON.stringify(a.slice(0, 40)) : ""); watchNav(); },
    has: (t) => WL.get().includes(t),
    toggle: (t) => { const a = WL.get(), i = a.indexOf(t); if (i >= 0) a.splice(i, 1); else a.unshift(t); WL.set(a); return i < 0; },
  };
  const starBtn = (t) => { const on = WL.has(t);
    return `<button type="button" class="star${on ? " on" : ""}" data-star="${esc(t)}" aria-pressed="${on}" aria-label="${on ? "Remove " + esc(t) + " from" : "Add " + esc(t) + " to"} watchlist" title="${on ? "On your watchlist" : "Add to watchlist"}">${on ? "★" : "☆"}</button>`; };
  function watchNav() { const a = document.getElementById("nav-watch"); if (!a) return; const n = WL.get().length;
    a.innerHTML = `<span aria-hidden="true">★</span><span class="sr-only">Watchlist</span>${n ? ` <span class="badge" aria-label="${n} companies">${n}</span>` : ""}`; a.title = "Watchlist"; }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-star]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const t = b.dataset.star, on = WL.toggle(t);
    document.querySelectorAll(`[data-star="${CSS.escape(t)}"]`).forEach((x) => { x.outerHTML = starBtn(t); });
    announce(on ? `${t} added to your watchlist` : `${t} removed from your watchlist`);
  });
  function announce(msg) { const el = document.getElementById("sr-live"); if (el) { el.textContent = ""; setTimeout(() => (el.textContent = msg), 50); } }

  // ------------------------------------------------------------- plain-English definitions on hover / focus
  const GLOSS = {
    "WACC": "Weighted average cost of capital: the blended return that lenders and shareholders expect. Future cash flows are discounted at this rate, so a higher WACC means a lower value.",
    "DCF": "Discounted cash flow: estimate the cash a business will generate, then convert it to today's dollars using the WACC.",
    "Reverse DCF": "Works the DCF backwards: what growth would the business need to justify today's share price?",
    "EV/EBITDA": "Enterprise value divided by EBITDA. Compares what the whole business costs (debt included) with its operating profit before non-cash charges. Lower is cheaper.",
    "EBITDA": "Earnings before interest, taxes, depreciation and amortization: a rough measure of operating cash profit.",
    "P/E": "Share price divided by earnings per share: how many years of current profit you pay for.",
    "P/B": "Price to book value: share price compared with the accounting value of equity. Used for banks and insurers.",
    "P/FFO": "Price to funds from operations, the REIT version of a P/E ratio.",
    "FFO": "Funds from operations: net income plus real-estate depreciation, minus gains on property sales. The standard profit measure for REITs.",
    "EPS": "Earnings per share: net income divided by shares outstanding.",
    "Beta": "How much a stock has moved compared with the S&P 500. 1.0 moves with the market; below 1 moves less, above 1 moves more.",
    "Terminal growth": "The growth rate assumed for every year after the five-year forecast. Small changes move the value a lot.",
    "Exit multiple": "The EV/EBITDA multiple the business is assumed to sell for at the end of the forecast.",
    "Free cash flow": "Cash from operations minus capital spending: the cash left over for lenders and shareholders.",
    "Market cap": "Market capitalization: share price times shares outstanding, the market value of the equity.",
    "Market value": "Share price times shares outstanding, the market value of the equity.",
    "Dividend yield": "Dividends paid over the past year divided by today's share price.",
    "Payout": "The share of profit paid out as dividends. Above 100% means paying more than the company earns.",
    "Debt-to-equity": "Total debt divided by shareholders' equity: how much the company leans on borrowing.",
    "Upside": "How far the price target is above (or below) today's share price.",
    "Price target": "What the model thinks one share is worth in 12 months.",
    "Comps": "Comparable companies: valuing a business by the multiples similar companies trade at.",
    "Street median": "The middle price target among Wall Street analysts who cover the stock.",
    "Operating margin": "Operating profit as a share of revenue.",
    "Gross margin": "Revenue minus the direct cost of goods sold, as a share of revenue.",
    "10-K": "The annual report every US-listed company files with the SEC, with audited financial statements.",
    "10-Q": "The quarterly report US-listed companies file with the SEC (unaudited).",
    "13F": "A quarterly SEC filing that lists the US stocks a fund with over $100M owns, filed up to 45 days after the quarter ends.",
    "Sensitivity": "A grid showing how the value changes as two assumptions move together.",
  };
  const GL_KEYS = Object.keys(GLOSS).sort((a, b) => b.length - a.length);
  const GL_RE = new RegExp(`(^|[^A-Za-z0-9/-])(${GL_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})(?![A-Za-z0-9])`, "i");
  const GL_SEL = ".kpi .k, th, .card-h h2, .card-h .note, h2.sec, .sf > label, .preset span, .kvrow .note, .fin td:first-child, #sec-cases td:first-child, .rdcf b, .hero p, .tcard .note";
  let GL_SEEN = new Set();
  function glossify(root) {
    root.querySelectorAll(GL_SEL).forEach((el) => {
      if (el.dataset.gl) return; el.dataset.gl = "1";
      const done = new Set();
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest("a, button, .gl, input, select, option, output, .num") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      const nodes = []; while (walk.nextNode()) nodes.push(walk.currentNode);
      for (const n of nodes) {
        const m = GL_RE.exec(n.nodeValue); if (!m) continue;
        const key = GL_KEYS.find((k) => k.toLowerCase() === m[2].toLowerCase());
        if (!key || done.has(key)) continue; done.add(key);
        const start = m.index + m[1].length, word = n.splitText(start); word.splitText(m[2].length);
        const span = document.createElement("span"); span.className = "gl"; span.dataset.g = key; span.textContent = word.nodeValue;
        if (!GL_SEEN.has(key)) { span.tabIndex = 0; GL_SEEN.add(key); }   // keyboard users get one stop per term per page
        word.replaceWith(span);
      }
    });
  }
  const glTip = (el) => { const r = el.getBoundingClientRect(); el.setAttribute("aria-describedby", "tip");
    showTip(`<b class="gl-t">${esc(el.dataset.g)}</b><br>${esc(GLOSS[el.dataset.g])}`, r.left, r.top); tip.classList.add("wide"); };
  const glHide = (el) => { el?.removeAttribute?.("aria-describedby"); tip.classList.remove("wide"); hideTip(); };
  document.addEventListener("mouseover", (e) => { const g = e.target.closest?.(".gl"); if (g) glTip(g); });
  document.addEventListener("mouseout", (e) => { const g = e.target.closest?.(".gl"); if (g) glHide(g); });
  document.addEventListener("focusin", (e) => { if (e.target.classList?.contains("gl")) glTip(e.target); });
  document.addEventListener("click", (e) => { const g = e.target.closest?.(".gl"); if (g) { e.preventDefault(); glTip(g); } else if (tip.classList.contains("wide")) glHide(); });
  document.addEventListener("focusout", (e) => { if (e.target.classList?.contains("gl")) glHide(e.target); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { glHide(document.activeElement); document.querySelector("#tour .tour-x")?.click(); } });
  let glTimer = null;
  // wide tables on phones: a fade on the right edge says "there's more, swipe"
  // tables with many columns become label/value cards on phones (CSS: table.stack); statements, grids and the screener keep scrolling
  function stackTables(root) {
    root.querySelectorAll(".scroll > table:not(.stack-done)").forEach((t) => {
      t.classList.add("stack-done");
      const heads = [...t.querySelectorAll("thead th")].map((th) => th.textContent.trim());
      if (heads.length < 5 || t.matches(".scr, .fin, .hist, .cmp, .pf-in, .sens") || t.closest("#sec-sens")) return;
      t.classList.add("stack");
      t.querySelectorAll("tbody tr").forEach((tr) => [...tr.children].forEach((td, i) => { if (i && !td.dataset.l && heads[i]) td.dataset.l = heads[i]; }));
    });
  }
  function markScroll(root) {
    stackTables(root);
    root.querySelectorAll(".scroll").forEach((el) => {
      const upd = () => el.classList.toggle("more", el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
      upd(); if (!el.dataset.sw) { el.dataset.sw = "1"; el.addEventListener("scroll", upd, { passive: true }); }
      // keyboard users can scroll a table that doesn't fit
      if (el.scrollWidth > el.clientWidth + 4 && !el.querySelector("a, button, input")) { el.tabIndex = 0; el.setAttribute("role", "region"); const sec = el.closest("section, .card"), all = sec ? [...sec.querySelectorAll(".scroll")] : [el];
        el.setAttribute("aria-label", `${sec?.querySelector("h2")?.textContent.trim() || "Table"}${all.length > 1 ? ", table " + (all.indexOf(el) + 1) : ""}, scrolls sideways`); }
    });
  }
  window.addEventListener("resize", () => markScroll(app));
  new MutationObserver(() => { clearTimeout(glTimer); glTimer = setTimeout(() => { glossify(app); markScroll(app); }, 120); }).observe(app, { childList: true, subtree: true });
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
      <div class="card-h"><h2>${starBtn(m.ticker)} <a href="#/m/${esc(m.ticker)}" class="plain">${esc(m.ticker)} · ${esc(m.name)}</a></h2><span class="note">${esc(m.exchange || "")} · ${esc(m.sector)} · ${esc(m.industry || "")}</span></div>
      <div class="kpis" style="padding:18px">
        <div class="kpi hero-n"><div class="k">Price target</div><div class="v">${usd(m.target)}</div><div class="n">${pill(m.rating)} &nbsp;anchored to street and peers</div></div>
        <div class="kpi"><div class="k">Price</div><div class="v">${usd(m.price)}</div><div class="n">${esc(m.price_date || "")}</div></div>
        <div class="kpi"><div class="k">Upside</div><div class="v">${signed(m.upside)}</div></div>
        <div class="kpi kpi-wide"><div class="k">Bear / Base / Bull</div><div class="v" style="font-size:17px">${usd(sc.bear, 0)} / ${usd(sc.base, 0)} / ${usd(sc.bull, 0)}</div></div>
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
        <p>Type a ticker. We pull the company's 10-K data from SEC EDGAR and build a full Excel model: three linked statements with PP&amp;E, debt and revolver schedules, WACC, a five-year DCF with a sensitivity grid, same-industry comps, and bull, base and bear cases you can switch inside the workbook. You also get a summary research report and a model page you can share. It usually takes about a minute.</p></section>
      ${store.get("mb_start_off") ? "" : `<section class="start" aria-label="Where to start">
        <button type="button" class="start-card" id="start-tk"><span class="start-k">I have a company in mind</span><span class="note">Type its ticker or name below and get the full model.</span></button>
        <a class="start-card" href="#/screener"><span class="start-k">I want ideas</span><span class="note">Filter every NYSE and Nasdaq company by size, growth, dividends and price, or start from five ready-made screens.</span></a>
        <a class="start-card" href="#/quiz"><span class="start-k">I want to learn</span><span class="note">Short quizzes on valuation basics. Every model page also has an "Explain this model" walkthrough.</span></a>
        <button type="button" class="start-x" id="start-x" aria-label="Hide these suggestions">×</button></section>`}
      <div class="card gen-box">
        <form id="gen-form" autocomplete="off">
          <div class="gen-row">
            <div class="gen-input"><input id="tk" placeholder="Ticker or company name, e.g. XOM, AAPL or Coca-Cola" aria-label="NYSE or Nasdaq ticker" spellcheck="false" autocapitalize="characters">
              <div id="sugg" class="sugg" hidden></div></div>
            <button class="btn primary big" id="go" type="submit">Generate model</button>
          </div>
          <p class="note" id="gen-hint">${base ? "NYSE and Nasdaq SEC filers (funds and trusts excluded). A model built in the last 6 hours is reused instantly." : "The generation service is being set up."}</p>
        </form>
        <div id="gen-status" aria-live="polite"></div>
      </div>
      <div id="gen-result"></div>
      <section class="section" id="trend-sec" hidden><h2 class="sec">Most generated this week</h2><div class="trend" id="trend"></div></section>
      <section class="section"><h2 class="sec">Generated in the past 24 hours</h2><div class="card" id="recent"><p class="muted loading" style="padding:14px 18px">Loading…</p></div></section>
      <section class="section" id="insights"></section>`;
    // the track record and sector tables sit below the fold: load them when they come into view
    const ins = document.getElementById("insights");
    if ("IntersectionObserver" in window) { const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); insightsStrip(); } }, { rootMargin: "300px" }); io.observe(ins); }
    else insightsStrip();
    document.getElementById("start-tk")?.addEventListener("click", () => document.getElementById("tk").focus());
    document.getElementById("start-x")?.addEventListener("click", () => { store.set("mb_start_off", "1"); document.querySelector(".start")?.remove(); });

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
    tk.addEventListener("pointerenter", load, { once: true });   // start loading the ticker list as soon as the visitor heads for the box
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
    const steps = ["Request accepted", "Starting a build machine", "Pulling the 10-K, share price and same-industry peers", "Building the three statements, DCF and scenarios",
                   "Recalculating in the Excel engine and writing the PDF", "Publishing to the site", "Ready"];
    const TYPICAL = 60;   // seconds, from recent builds
    const t0 = Date.now();
    const draw = (k, msg) => {
      const el = (Date.now() - t0) / 1000, left = Math.round(Math.min([60, 50, 40, 28, 15, 5, 0][k], TYPICAL - el));
      const eta = k >= 6 ? "" : left > 5 ? `about ${left}s left` : el < TYPICAL * 2.5 ? "almost done" : "taking longer than usual";
      stat.innerHTML = `<ol class="progress">${steps.map((s, i) => `<li class="${i < k ? "done" : i === k ? "now" : ""}"${i === k ? ' aria-current="step"' : ""}>${s}</li>`).join("")}</ol>
        <div class="pbar" role="progressbar" aria-label="Build progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((k / 6) * 100)}"><span style="width:${Math.max(4, Math.min(100, (k / 6) * 100))}%"></span></div>
        <p class="note">${esc(t)} · ${Math.round(el)}s elapsed${eta ? " · " + eta : ""}${msg ? " · " + msg : ""}</p>`; };
    // map the live GitHub Actions step to our steps; inside the long build step, use how long it has been running
    const phaseOf = (s) => {
      if (s.status === "queued") return 1;
      if (s.status === "finishing") return 5;
      const st = s.step || "";
      if (/Add to the shared library|Post |Stop containers|Complete job/.test(st)) return 5;
      if (/Build model/.test(st)) { const run = s.step_started ? (Date.now() - Date.parse(s.step_started)) / 1000 : 0; return run > 14 ? 4 : run > 5 ? 3 : 2; }
      return 1;
    };
    draw(0);
    try {
      const r = await fetch(base + "/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: t, force }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      if (j.status === "ready") { stat.innerHTML = ""; out.innerHTML = resultCard(j.model, `Built ${ago(j.model.generated_at)} — reused <a href="#" id="regen">rebuild now</a>`); hookRegen(t); return; }
      const since = j.since || new Date(Date.now() - 5000).toISOString();
      for (let i = 0; i < 160; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        const s = await fetch(`${base}/api/status?ticker=${encodeURIComponent(t)}&since=${encodeURIComponent(since)}`).then((x) => x.json());
        if (s.status === "ready") { draw(6); RECENT = null; announce(`${t} model is ready`); out.innerHTML = resultCard(s.model, "Fresh build"); stat.innerHTML = ""; return; }
        if (s.status === "failed") throw new Error(`We couldn't build ${esc(t)}. The usual reasons: no annual US-GAAP XBRL financials on file yet (new registrants, recent reorganizations), a foreign filer reporting in another currency, or a fund or trust. <a href="${esc(s.run_url)}" target="_blank" rel="noopener">Build log</a>.`);
        draw(phaseOf(s), s.status === "queued" ? "waiting for a free build machine" : "");
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
  // ------------------------------------------------------------- Monte Carlo (same spreads as the Excel tab)
  function rng32(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const hashStr = (str) => [...str].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);
  function mcSpreads(cs) {
    const z = 1.2816;
    const g = Math.abs((cs.bull?.growth_delta?.[0] ?? 0.03) - (cs.bear?.growth_delta?.[0] ?? -0.03)) / 2 / z;
    const mrg = Math.abs((cs.bull?.margin_delta ?? 0.01) - (cs.bear?.margin_delta ?? -0.01)) / 2 / z;
    const tg = Math.abs((cs.bull?.tg ?? 0.03) - (cs.bear?.tg ?? 0.02)) / 2 / z;
    const ex = Math.abs(Math.log((cs.bull?.exit_factor || 1.1) / (cs.bear?.exit_factor || 0.9))) / 2 / z;
    return { g, m: mrg, wacc: 0.0075, tg, ex };
  }
  function runMonteCarlo(m, seed, N = 10000) {
    const el = document.getElementById("mc-body"); if (!el) return;
    const d = m.detail || {}, x = d.dcf_inputs, cs = d.cases || {}, sd = mcSpreads(cs);
    const bounded = Math.min(30, Math.max(4, nz(x.ev_ebitda_now) ? x.ev_ebitda_now : 4)), mult0 = bounded * (cs.base?.exit_factor || 1);
    const R = rng32(hashStr(m.ticker + ":" + (m.version || 0)) + seed * 7919);
    const norm = () => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const out = new Float64Array(N); let n = 0;
    for (let i = 0; i < N; i++) {
      const w = Math.max(0.04, x.wacc + sd.wacc * norm());
      const o = { dg: sd.g * norm(), dm: sd.m * norm(), wacc: w, g: Math.min(w - 0.005, x.g + sd.tg * norm()), mult: mult0 * Math.exp(sd.ex * norm()) };
      const t = valuate(x, o).target; if (isFinite(t) && t > 0) out[n++] = t;
    }
    const a = Array.from(out.subarray(0, n)).sort((p, q) => p - q);
    const q = (p) => a[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))];
    const price = x.price, above = a.filter((v) => v > price).length / n, buy = a.filter((v) => v > price * 1.15).length / n, sell = a.filter((v) => v < price * 0.85).length / n;
    const lo = q(0.01), hi = q(0.99), B = 30, wdt = (hi - lo) / B || 1, bins = new Array(B).fill(0);
    a.forEach((v) => { if (v >= lo && v <= hi) bins[Math.min(B - 1, Math.floor((v - lo) / wdt))]++; });
    const W = 640, H = 170, pad = 28, bw = (W - pad * 2) / B, top = Math.max(...bins), X = (v) => pad + ((v - lo) / (hi - lo)) * (W - pad * 2);
    const bars = bins.map((c, i) => { const from = lo + i * wdt, h = (c / top) * (H - 40);
      return `<rect x="${(pad + i * bw + 1).toFixed(1)}" y="${(H - 20 - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="var(${from + wdt / 2 >= price ? "--up" : "--down"})" opacity="0.75"><title>${usd(from)}–${usd(from + wdt)}: ${c.toLocaleString()} trials</title></rect>`; }).join("");
    const near = Math.abs(X(price) - X(m.target)) < 120, left = X(m.target) < X(price);
    const mark = (v, lab, dash, side) => (v >= lo && v <= hi ? `<line x1="${X(v)}" x2="${X(v)}" y1="14" y2="${H - 20}" stroke="var(--ink)" stroke-width="1.5"${dash ? ' stroke-dasharray="4 3"' : ""}/><text x="${X(v) + (near ? side * 4 : 0)}" y="11" text-anchor="${near ? (side < 0 ? "end" : "start") : "middle"}" font-size="11" fill="var(--ink-2)">${lab}</text>` : "");
    el.innerHTML = `<div class="kpis" style="padding:12px 18px 0">
        <div class="kpi hero-n"><div class="k">Chance the target beats today's price</div><div class="v">${pct(above, 0)}</div><div class="n">price ${usd(price)}</div></div>
        <div class="kpi"><div class="k">Middle outcome</div><div class="v">${usd(q(0.5))}</div><div class="n">model target ${usd(m.target)}</div></div>
        <div class="kpi"><div class="k">Bad case (10th percentile)</div><div class="v">${usd(q(0.1))}</div></div>
        <div class="kpi"><div class="k">Good case (90th percentile)</div><div class="v">${usd(q(0.9))}</div></div>
        <div class="kpi"><div class="k">15%+ upside / 15%+ downside</div><div class="v">${pct(buy, 0)} / ${pct(sell, 0)}</div></div></div>
      <div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" class="mc-svg" role="img" aria-label="Histogram of ${n.toLocaleString()} simulated targets from ${usd(lo)} to ${usd(hi)}. ${pct(above, 0)} are above today's price of ${usd(price)}.">
        ${bars}<line x1="${pad}" x2="${W - pad}" y1="${H - 20}" y2="${H - 20}" stroke="var(--line)"/>
        ${mark(price, "Price " + usd(price), false, left ? 1 : -1)}${mark(m.target, "Target " + usd(m.target), true, left ? -1 : 1)}
        <text x="${pad}" y="${H - 5}" font-size="11" fill="var(--ink-3)">${usd(lo)}</text><text x="${W - pad}" y="${H - 5}" font-size="11" text-anchor="end" fill="var(--ink-3)">${usd(hi)}</text></svg></div>
      <div class="scroll"><table><thead><tr><th>Input</th><th class="r">Base</th><th class="r">Moves by (1 st. dev.)</th><th>Where the spread comes from</th></tr></thead><tbody>
        <tr><td>Revenue growth, every year</td><td class="r num">${pct(cs.base?.growth?.[0])} (yr 1)</td><td class="r num">± ${(sd.g * 100).toFixed(1)} pts</td><td class="note">bull vs. bear case</td></tr>
        <tr><td>Operating margin</td><td class="r num">—</td><td class="r num">± ${(sd.m * 100).toFixed(1)} pts</td><td class="note">bull vs. bear case</td></tr>
        <tr><td>WACC</td><td class="r num">${pct(x.wacc)}</td><td class="r num">± 0.75 pts</td><td class="note">fixed</td></tr>
        <tr><td>Terminal growth</td><td class="r num">${pct(x.g)}</td><td class="r num">± ${(sd.tg * 100).toFixed(1)} pts</td><td class="note">bull vs. bear case</td></tr>
        <tr><td>Exit multiple</td><td class="r num">${mult(mult0)}</td><td class="r num">± ${(sd.ex * 100).toFixed(0)}%</td><td class="note">bull vs. bear case</td></tr></tbody></table></div>
      <div class="gen-actions" style="padding:10px 18px 14px"><button class="btn sm" id="mc-again">Run again</button>
        <span class="note">Each trial draws all five inputs at random (bell curve; the bear and bull cases sit at the 10th and 90th percentiles) and re-runs the valuation. Green bars are above today's price. A wide spread means the value depends heavily on assumptions nobody can know.</span></div>`;
    document.getElementById("mc-again").addEventListener("click", () => runMonteCarlo(m, seed + 1));
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

  const secSlug = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // "Newer filing available" when SEC EDGAR has a 10-K/10-Q the model didn't use; "priced N days ago" when the build is old
  function staleBanner(m, live) {
    const used = m.last_filing || {}, seen = live || m.latest_filing_seen;
    const days = Math.floor((Date.now() - Date.parse(m.generated_at)) / 864e5);
    const btn = `<a class="btn sm primary" href="#/" id="stale-rebuild">Rebuild with the latest data</a>`;
    if (seen && used.accession && seen.accession !== used.accession && seen.filed >= (used.filed || "")) {
      return `<div class="warn section stale"><div><b>Newer filing available.</b> ${esc(m.name)} filed a ${esc(seen.form)} on ${esc(seen.filed)}${seen.period ? ` (period ending ${esc(seen.period)})` : ""}, after this model was built from the ${esc(used.form || "10-K")} filed ${esc(used.filed || "earlier")}. <a href="${esc(seen.url)}" target="_blank" rel="noopener">Open the filing ↗</a></div>${btn}</div>`;
    }
    if (days >= 30) return `<div class="warn section stale"><div><b>Priced ${days} days ago.</b> The share price, rates and street targets in this model are from ${esc(m.price_date)}. No newer 10-K or 10-Q has been filed, so the financials are current.</div>${btn}</div>`;
    return "";
  }
  function forecastPanel(m) {
    const bt = m.backtest || [], fc = m.forecast_check || [];
    if (!bt.length && !fc.length) return "";
    const errCell = (e) => (nz(e) ? `<span class="${Math.abs(e) <= 0.05 ? "ok" : Math.abs(e) <= 0.1 ? "" : "bad"}">${signed(e)}</span>` : "—");
    return `<section class="section card" id="sec-fva"><div class="card-h"><h2>Forecast vs. actual</h2><span class="note">how well the model's forecasting rules have done for this company</span></div>
      ${fc.length ? `<p class="note" style="padding:12px 18px 0"><b>Earlier builds of this model, graded.</b></p><div class="scroll"><table><thead><tr><th>Year</th><th>Forecast made</th><th class="r">Revenue forecast</th><th class="r">Actual</th><th class="r">Miss</th><th class="r">Gross margin forecast → actual</th><th class="r hide-sm">EPS forecast → actual</th></tr></thead><tbody>
        ${fc.map((r) => `<tr><td>${esc(r.year)}</td><td class="note">${esc(r.made)} (v${r.version}, from ${esc(r.from)} 10-K)</td><td class="r num">${mm(r.revenue[0])}</td><td class="r num">${mm(r.revenue[1])}</td><td class="r num">${errCell(r.rev_err)}</td>
          <td class="r num">${pct(r.gm[0])} → ${pct(r.gm[1])}</td><td class="r num hide-sm">${usd(r.eps[0])} → ${usd(r.eps[1])}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${bt.length ? `<p class="note" style="padding:12px 18px 0"><b>Backtest.</b> The same rules this model uses, applied to the data available a year earlier, against what ${esc(m.name)} then reported.</p>
        <div class="scroll"><table><thead><tr><th>Year</th><th class="r">Growth forecast</th><th class="r">Actual growth</th><th class="r">Revenue forecast</th><th class="r">Actual</th><th class="r">Miss</th><th class="r hide-sm">Gross margin forecast → actual</th></tr></thead><tbody>
        ${bt.map((b) => `<tr><td>${esc(b.year)} <span class="note">from ${esc(b.from)}</span></td><td class="r num">${pct(b.growth_fc)}</td><td class="r num">${pct(b.growth_act)}</td><td class="r num">${mm(b.rev_fc)}</td><td class="r num">${mm(b.rev_act)}</td><td class="r num">${errCell(b.rev_err)}</td>
          <td class="r num hide-sm">${pct(b.gm_fc)} → ${pct(b.gm_act)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <p class="note" style="padding:10px 18px 14px">Miss = forecast ÷ actual − 1, so +5% means the forecast was 5% too high. Green is within 5%, red is more than 10% off. Next-year revenue is forecast from the median of the past three years' growth, kept between −5% and +12%. The <a href="#/track">Track record</a> page sums this up across every model.</p></section>`;
  }
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
    document.getElementById("cmp").innerHTML = `<div class="card"><div class="scroll"><table class="cmp"><thead><tr><th><span class="sr-only">Measure</span></th>${ms.map((m) => `<th class="r">${m.missing ? esc(m.ticker) : `<a class="tk" href="#/m/${esc(m.ticker)}">${esc(m.ticker)}</a><span class="co">${esc(m.name)}</span>`}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(([lab, f]) => `<tr><td>${lab}</td>${ms.map((m) => `<td class="r num">${m.missing ? (lab === "Price target" ? `<a href="#/" data-gen="${esc(m.ticker)}">Generate ${esc(m.ticker)}</a>` : "") : f(m)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
    document.querySelectorAll("[data-gen]").forEach((a) => a.addEventListener("click", () => sessionStorage.setItem("mb_prefill", a.dataset.gen)));
  }

  // ------------------------------------------------------------- update an existing model
  // ------------------------------------------------------------- Check my model (audit runs in the browser)
  function loadAudit() {
    if (window.MBAudit) return Promise.resolve();
    return new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "assets/audit.js?v=" + (document.querySelector("script[src*='app.js']")?.src.split("v=")[1] || "1");
      sc.onload = res; sc.onerror = () => rej(new Error("Couldn't load the checker.")); document.head.appendChild(sc); });
  }
  function initCheck() {
    const inp = document.getElementById("chk-file"), out = document.getElementById("chk-out");
    inp.addEventListener("change", () => { document.getElementById("chk-name").textContent = inp.files[0]?.name || "Choose .xlsx…"; });
    inp.addEventListener("click", () => loadAudit().catch(() => {}), { once: true });
    document.getElementById("chk-f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = inp.files[0]; if (!f) { out.innerHTML = `<p class="note" style="padding:0 18px 14px">Choose a file first.</p>`; return; }
      if (!("DecompressionStream" in window)) { out.innerHTML = `<div class="warn" style="margin:0 18px 14px">Your browser is too old for the checker. Try a current Chrome, Edge, Safari or Firefox.</div>`; return; }
      out.innerHTML = `<p class="note loading" style="padding:0 18px 14px">Checking ${esc(f.name)}…</p>`;
      try {
        await loadAudit();
        const t0 = performance.now(), res = await window.MBAudit.run(await f.arrayBuffer()), ms = performance.now() - t0;
        drawCheck(out, f.name, res, ms);
      } catch (err) { out.innerHTML = `<div class="warn" style="margin:0 18px 14px">${esc(err.message || String(err))}</div>`; }
    });
  }
  const SEV = { high: ["Fix first", "bad"], medium: ["Should fix", "hold-t"], low: ["Tidy up", "note"], info: ["Note", "note"] };
  function drawCheck(out, name, { issues, stats }, ms) {
    const cnt = (s) => issues.filter((i) => i.sev === s).length;
    const has = (chk) => issues.some((i) => i.check === chk);
    const tick = (ok, label, na) => `<li class="${na ? "na" : ok ? "pass" : "fail"}">${na ? "–" : ok ? "✓" : "✗"} ${label}</li>`;
    const verdict = cnt("high") ? "Needs work before anyone relies on it" : cnt("medium") ? "Mostly sound, with a few things to fix" : "Clean: no structural problems found";
    out.innerHTML = `<div style="padding:0 18px">
      <p class="chk-v"><b>${esc(name)}:</b> ${verdict}.</p>
      <div class="kpis"><div class="kpi"><div class="k">Fix first</div><div class="v">${cnt("high")}</div></div><div class="kpi"><div class="k">Should fix</div><div class="v">${cnt("medium")}</div></div>
        <div class="kpi"><div class="k">Tidy up</div><div class="v">${cnt("low")}</div></div><div class="kpi"><div class="k">Formulas checked</div><div class="v">${stats.formulas.toLocaleString()}</div><div class="n">${stats.sheets} tabs · ${(ms / 1000).toFixed(1)}s</div></div></div>
      <ul class="checks chk-list">
        ${tick(!has("Formula error") && !has("Broken reference"), "No formula errors or #REF! links")}
        ${tick(!has("Balance sheet doesn't balance") && !has("Balance check is not zero"), "Balance sheet balances", !stats.balanced && !has("Balance sheet doesn't balance") && !has("Balance check is not zero"))}
        ${tick(!stats.circular, stats.circular ? "Circular reference found (see below)" : "No circular references")}
        ${tick(!has("Typed number in a row of formulas"), "No numbers typed over formulas")}
        ${tick(!has("Formula doesn't match its neighbours"), "Every formula follows the pattern of its row")}
        ${tick(!has("Link to another workbook"), "No links to other workbooks")}
        ${tick(!has("Colour coding"), "Blue inputs, black formulas, green links", !stats.colourConvention)}
      </ul>
      ${!stats.colourConvention ? `<p class="note">Colour coding wasn't checked: this model doesn't use blue for typed inputs. Most banks and funds expect blue inputs, black formulas and green links to other tabs.</p>` : ""}
      ${!stats.balanced && !has("Balance sheet doesn't balance") ? `<p class="note">No "Total assets" and "Total liabilities and equity" rows were found, so the balance check was skipped.</p>` : ""}</div>
      ${issues.length ? `<div class="scroll"><table><thead><tr><th>Priority</th><th>Problem</th><th>Where</th><th>Details</th></tr></thead><tbody>
        ${issues.slice(0, 250).map((i) => `<tr><td><span class="${SEV[i.sev][1]}">${SEV[i.sev][0]}</span></td><td>${esc(i.check)}</td><td class="num">${esc(i.sheet)}${i.cell ? "!" + esc(i.cell) : ""}</td><td class="note">${esc(i.detail)}</td></tr>`).join("")}</tbody></table></div>
        <p class="note" style="padding:10px 18px 14px">${issues.length > 250 ? `Showing 250 of ${issues.length}. ` : ""}<a href="#" id="chk-csv">Download all ${issues.length} as CSV</a>. The checker reads the values saved in the file, so open and save it in Excel first if it was built by a script.</p>`
        : `<p class="note" style="padding:4px 18px 14px">Nothing to report.</p>`}`;
    document.getElementById("chk-csv")?.addEventListener("click", (e) => {
      e.preventDefault();
      const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = ["Priority,Problem,Tab,Cell,Details", ...issues.map((i) => [SEV[i.sev][0], i.check, i.sheet, i.cell, i.detail].map(q).join(","))].join("\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = name.replace(/\.xls[xm]$/i, "") + "_check.csv"; a.click();
    });
  }
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
      </form><div id="up-status"></div></div><div id="up-result"></div>
      <section class="card section" id="chk"><div class="card-h"><h2>Check my model</h2><span class="note">runs in your browser · the file never leaves your computer</span></div>
        <p style="padding:12px 18px 0;margin:0">Drop in any Excel model, yours or a classmate's, and get the review a senior analyst would do: formula errors, broken links, a balance sheet that doesn't balance, numbers typed over formulas, formulas that break the pattern of their row, circular references and colour-coding slips.</p>
        <form id="chk-f" class="gen-row" style="padding:12px 18px 16px"><label class="btn file-btn"><input id="chk-file" type="file" accept=".xlsx,.xlsm"><span id="chk-name">Choose .xlsx…</span></label>
          <button class="btn primary" type="submit" id="chk-go">Check it</button><span class="note">.xlsx or .xlsm · nothing is uploaded or stored</span></form>
        <div id="chk-out" aria-live="polite"></div></section>`;
    initCheck();
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
        <div class="card"><div class="card-h"><h2>Track record</h2><a class="note" href="#/track">full record →</a></div>
          ${t.scored ? `<div class="kvrow" style="border:0;padding:14px 18px">
            <div><div class="note">Calls scored</div><b>${t.scored}</b></div><div><div class="note">Working</div><b>${pct(t.hit_rate, 0)}</b></div>
            <div><div class="note">Avg. return since call</div><b>${signed(t.avg_return)}</b></div><div><div class="note">vs S&amp;P 500</div><b>${nz(t.avg_excess) ? signed(t.avg_excess) : "—"}</b></div></div>`
          : `<p class="note" style="padding:14px 18px">Each call is checked against the share price 30 days after it's made, and against the S&amp;P 500. The first results appear once calls are a month old.</p>`}</div>
        <div class="card"><div class="card-h"><h2>Sector snapshot</h2><span class="note">medians across models</span></div>
          <div class="scroll"><table><thead><tr><th>Sector</th><th class="r">Models</th><th class="r">Upside</th><th class="r">Buy</th><th class="r hide-sm">EV/EBITDA</th></tr></thead><tbody>
            ${sec.map((s) => `<tr><td><a class="plain-l" href="#/sector/${secSlug(s.name)}">${esc(s.name)}</a></td><td class="r num">${s.n}</td><td class="r num">${signed(s.median_upside)}</td><td class="r num">${pct(s.buy_share, 0)}</td><td class="r num hide-sm">${mult(s.median_ev_ebitda)}</td></tr>`).join("")}
          </tbody></table></div></div>
      </div>`;
  }

  // ------------------------------------------------------------- theme + keyboard shortcuts
  function initChrome() {
    const root = document.documentElement;
    // phone menu: one button opens every tab as a grid of large targets
    const top = document.querySelector(".top"), mb = document.getElementById("menu-btn");
    const setMenu = (open) => { top.classList.toggle("open", open); mb.setAttribute("aria-expanded", String(open)); document.getElementById("menu-lab").textContent = open ? "Close" : "Menu"; };
    mb?.addEventListener("click", () => setMenu(!top.classList.contains("open")));
    window.addEventListener("hashchange", () => setMenu(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && top.classList.contains("open")) { setMenu(false); mb.focus(); } });
    document.addEventListener("click", (e) => { if (top.classList.contains("open") && !top.contains(e.target)) setMenu(false); });
    const saved = store.get("mb_theme"); if (saved) root.dataset.theme = saved;
    const nav = document.getElementById("nav");
    if (nav && !document.getElementById("theme-btn")) {
      nav.insertAdjacentHTML("beforeend", `<button id="theme-btn" class="theme-btn" aria-label="Toggle dark mode" title="Toggle dark mode (t)">◐</button>`);
      document.getElementById("theme-btn").addEventListener("click", toggleTheme);
    }
    document.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;
      const go = { g: "#/", u: "#/update", c: "#/compare/", m: "#/method", p: "#/portfolio", q: "#/quiz", s: "#/screener", f: "#/funds", r: "#/track", w: "#/watch", a: "#/about", x: "#/sectors", e: "#/earnings", i: "#/index" }[e.key];
      if (e.key === "/") { e.preventDefault(); if (location.hash.replace(/^#\/?/, "")) { location.hash = "#/"; setTimeout(() => document.getElementById("tk")?.focus(), 300); } else document.getElementById("tk")?.focus(); }
      else if (e.key === "t") toggleTheme();
      else if (go) location.hash = go;
    });
  }
  function beacon() {
    const tok = INDEX?.site?.analytics_token;
    if (tok && !document.getElementById("cf-beacon")) {
      const s = document.createElement("script"); s.id = "cf-beacon"; s.defer = true; s.src = "https://static.cloudflareinsights.com/beacon.min.js";
      s.setAttribute("data-cf-beacon", JSON.stringify({ token: tok, spa: true })); document.head.appendChild(s);
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
      if (box) { box.classList.add("spot"); box.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "center" }); }
    };
    const opener = document.activeElement;
    const close = () => { tour.remove(); document.querySelectorAll(".spot").forEach((e) => e.classList.remove("spot")); opener?.focus?.({ preventScroll: true }); };
    tour.querySelector(".tour-x").addEventListener("click", close);
    document.getElementById("tour-back").addEventListener("click", () => { if (i > 0) { i--; show(); } });
    document.getElementById("tour-next").addEventListener("click", () => { if (i < steps.length - 1) { i++; show(); } else close(); });
    window.addEventListener("hashchange", close, { once: true });
    show(); document.getElementById("tour-next").focus({ preventScroll: true });
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
      rowsEl.innerHTML = P.rows.length ? `<div class="scroll"><table class="pf-in"><thead><tr><th>Stock</th><th class="r">Amount ($)</th><th class="r">Share of budget</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>
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
      <section class="section card" id="pf-funds"><div class="card-h"><h2>How it compares to the famous funds</h2><span class="note">overlap with each fund's latest 13F</span></div><p class="muted loading" style="padding:12px 18px">Comparing…</p></section>
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
    fundOverlap(H);
  }
  // overlap = the share of your money that sits in the same stocks at no more than the fund's weight: sum of min(your weight, fund weight)
  async function fundOverlap(H) {
    const el = document.getElementById("pf-funds"); if (!el) return;
    let owners, funds; try { [owners, funds] = await Promise.all([loadOwners(), loadFunds()]); } catch { el.remove(); return; }
    const byFund = {};
    H.forEach((h) => (owners[h.t] || []).forEach(([slug, w]) => { const f = (byFund[slug] ||= { overlap: 0, shared: [] }); f.overlap += Math.min(h.w, w); f.shared.push([h.t, h.w, w]); }));
    const name = Object.fromEntries((funds.funds || []).map((f) => [f.slug, f]));
    const rows = Object.entries(byFund).map(([slug, f]) => ({ slug, ...f, f: name[slug] })).filter((r) => r.f).sort((a, b) => b.overlap - a.overlap);
    const head = el.querySelector(".card-h").outerHTML;
    if (!rows.length) { el.innerHTML = `${head}<p class="note" style="padding:12px 18px">None of the ${(funds.funds || []).length} tracked funds own any of these stocks. Your portfolio is its own thing.</p>`; return; }
    const best = rows[0];
    el.innerHTML = `${head}<p style="padding:12px 18px 0;margin:0">Your portfolio looks most like <b>${esc(best.f.name)}</b>${best.f.person ? ` (${esc(best.f.person)})` : ""}: <b>${pct(best.overlap, 0)}</b> overlap.</p>
      <div class="bars">${rows.slice(0, 8).map((r) => `<div class="bar-r"><span><a href="#/funds/${esc(r.slug)}">${esc(r.f.name)}</a></span><div class="bar"><i style="width:${Math.max(1, r.overlap * 100).toFixed(1)}%"></i></div><b>${pct(r.overlap, 0)}</b></div>`).join("")}</div>
      <div class="scroll"><table><thead><tr><th>Fund</th><th>Stocks you share</th></tr></thead><tbody>${rows.slice(0, 8).map((r) => `<tr><td>${esc(r.f.name)}</td><td class="note">${r.shared.sort((a, b) => b[2] - a[2]).map(([t, mine, theirs]) => `${esc(t)} (you ${pct(mine, 0)}, fund ${pct(theirs, 1)})`).join(" · ")}</td></tr>`).join("")}</tbody></table></div>
      <p class="note" style="padding:10px 18px 14px">Overlap adds up, stock by stock, the smaller of your weight and the fund's weight. 100% would mean identical portfolios; above about 30% is a lot. 13F filings list US stocks only and arrive up to 45 days after each quarter ends.</p>`;
  }

  // ------------------------------------------------------------- guided screener
  let SCREEN = null, OWNERS = null, FUNDS = null;
  const loadScreen = async () => (SCREEN = SCREEN || await getJSON("universe/screener.json"));
  const loadOwners = async () => { if (OWNERS) return OWNERS; try { OWNERS = await getJSON("funds/owners.json"); } catch { OWNERS = {}; } return OWNERS; };
  const loadFunds = async () => (FUNDS = FUNDS || await getJSON("funds/index.json"));
  const SCREEN_PRESETS = [
    { id: "growers", t: "Profitable and growing", d: "Companies making a profit whose sales grew more than 10% last year. Growth plus profit is what most investors pay up for.", f: { net_m_min: 0.0001, rev_growth_min: 0.10 } },
    { id: "dividends", t: "Steady dividend payers", d: "Over $1B in market value, yield above 2%, paying out no more than 75% of profits and modest debt. Stocks down more than 30% in a year are left out, since a falling price can make a yield look higher than it will stay.", f: { div_yield_min: 0.02, payout_max: 0.75, de_max: 1.0, mcap_min: 1000, chg_1y_min: -0.3 } },
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
      <div class="sf-in"><input type="number" step="any" placeholder="min" aria-label="${lab}, minimum" data-k="${k}_min" value="${val(F[k + "_min"])}"><span>to</span><input type="number" step="any" placeholder="max" aria-label="${lab}, maximum" data-k="${k}_max" value="${val(F[k + "_max"])}"></div>
      <p class="note">${help}</p></div>`;
  }
  const b64u = { enc: (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
                 dec: (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))))) };
  async function screenerView(qs) {
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
    const Q = new URLSearchParams(qs || "");
    if (Q.get("f") || Q.get("p")) {     // opened from a shared link
      try { if (Q.get("f")) F = b64u.dec(Q.get("f")); } catch { F = {}; }
      const pr = SCREEN_PRESETS.find((x) => x.id === Q.get("p")); active = pr ? pr.id : null; if (pr && !Q.get("f")) F = { ...pr.f };
      const so = (Q.get("sort") || "").split("."); if (so[0] && (so[0] === "ticker" || d.fields.includes(so[0]))) sort = [so[0], so[1] === "asc" ? 1 : -1];
    }
    if (Q.get("sector")) F = { ...F, sector: Q.get("sector") };
    const shareQs = () => { const q = new URLSearchParams(); if (active) q.set("p", active); if (Object.keys(F).length) q.set("f", b64u.enc(F)); q.set("sort", sort[0] + "." + (sort[1] > 0 ? "asc" : "desc")); return q.toString(); };
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
      history.replaceState(null, "", "#/screener?" + shareQs());
      document.querySelectorAll(".preset").forEach((b) => b.classList.toggle("on", b.dataset.p === active));
      const hits = rows.filter(pass);
      const [sk, sd] = sort;
      hits.sort((a, b) => sk === "ticker" ? sd * a.ticker.localeCompare(b.ticker) : (a[sk] == null) - (b[sk] == null) || sd * ((a[sk] ?? 0) - (b[sk] ?? 0)));
      const p = SCREEN_PRESETS.find((x) => x.id === active);
      document.getElementById("sr").innerHTML = `
        ${p ? `<p class="note preset-why"><b>${esc(p.t)}.</b> ${esc(p.d)}</p>` : ""}
        <div class="card"><div class="card-h"><h2>${hits.length.toLocaleString()} compan${hits.length === 1 ? "y" : "ies"} match</h2><span class="note">data as of ${esc(d.as_of)} · fiscal ${d.fiscal_year} 10-Ks · <a href="#" id="sr-csv">download CSV</a> · <a href="#" id="sr-link">copy link to this screen</a></span></div>
        <div class="scroll"><table class="scr"><thead><tr>${COLS.map(([k, lab]) => `<th class="${k === "ticker" ? "" : "r"} sortable" data-k="${k}" tabindex="0" aria-sort="${sk === k ? (sd > 0 ? "ascending" : "descending") : "none"}">${lab}${sk === k ? (sd > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}<th><span class="sr-only">Links</span></th></tr></thead><tbody>
          ${hits.slice(0, shown).map((r) => `<tr><td>${starBtn(r.ticker)}<span class="tk">${esc(r.ticker)}</span><span class="co">${esc(r.name)} · ${esc(r.sector)}</span>${notes(r)}</td>${COLS.slice(1).map(([k]) => `<td class="r num">${cell(r, k)}</td>`).join("")}<td class="r"><a class="btn sm" href="#/m/${esc(r.ticker)}">Model</a></td></tr>`).join("")}
        </tbody></table></div>
        ${hits.length > shown ? `<div class="gen-actions"><button class="btn sm" id="sr-more">Show 50 more</button><span class="note">${(hits.length - shown).toLocaleString()} more</span></div>` : ""}</div>
        <p class="note" style="margin-top:10px">Shows companies that match your filters, not what to buy. Figures come from each company's latest 10-K (fiscal ${d.fiscal_year}) via SEC XBRL, so they can lag by up to a year; a dash means the company didn't report that figure in a comparable way.</p>`;
      document.querySelectorAll("th.sortable").forEach((th) => {
        const go = () => { sort = [th.dataset.k, sort[0] === th.dataset.k ? -sort[1] : (th.dataset.k === "ticker" ? 1 : -1)]; apply(); document.querySelector(`th.sortable[data-k="${th.dataset.k}"]`)?.focus(); };
        th.addEventListener("click", go); th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }); });
      document.getElementById("sr-more")?.addEventListener("click", () => { shown += 50; apply(); });
      document.getElementById("sr-link").addEventListener("click", async (e) => { e.preventDefault(); const u = location.href;
        try { await navigator.clipboard.writeText(u); e.target.textContent = "link copied"; announce("Link copied"); } catch { prompt("Copy this link", u); } });
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
        <div class="scroll"><table><thead><tr><th>Company</th><th class="r">Value</th><th class="r">Weight</th><th class="r hide-sm">Shares</th><th>Change</th><th class="r"><span class="sr-only">Model</span></th></tr></thead><tbody>
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
        <div><div class="note">${esc(m.exchange || "NYSE")}: ${esc(m.ticker)} · <a href="#/sector/${secSlug(m.sector)}">${esc(m.sector)}</a> · ${esc(m.industry || "")}</div>
          <h1 class="dname">${esc(m.name)} ${starBtn(m.ticker)}</h1>
          <div class="note">Version ${m.version} · generated ${ago(m.generated_at)} · 10-K filed ${esc(d.dates?.tenk_filed || "n/a")} · priced ${esc(m.price_date)} ${qualityPill(m.quality)}</div></div>
        <div class="actions">${dl(m)}${m.files?.tearsheet ? ` <a class="btn sm" href="${esc(m.files.tearsheet)}" target="_blank" rel="noopener">⤓ Tear sheet</a>` : ""} <button class="btn sm primary-o" id="explain">Explain this model</button> <button type="button" class="btn sm more-btn" id="more-acts" aria-expanded="false" aria-controls="acts2">More ▾</button><span class="acts2" id="acts2"> <a class="btn sm" href="#/compare/${esc(m.ticker)}">Compare</a> <button class="btn sm" id="share">Copy share link</button> <a class="btn sm" href="#/" id="rebuild">Rebuild</a> <a class="btn sm" href="#/earnings/${esc(m.ticker)}">Earnings notes</a> <button class="btn sm" id="fb-open" aria-expanded="false" aria-controls="fb">Something look off?</button></span></div>
      </div>
      <form class="card section fb" id="fb" hidden>
        <div class="card-h"><h2>Report a problem with this model</h2><span class="note">goes privately to the site owner · no sign-in, no email needed</span></div>
        <fieldset><legend class="note">What looks off?</legend>
          ${[["number", "A number looks wrong"], ["peer", "A peer doesn't fit"], ["target", "The target seems off"], ["other", "Something else"]].map(([k, l], i) =>
            `<label class="fb-k"><input type="radio" name="fb-kind" value="${k}"${i === 0 ? " checked" : ""}> ${l}</label>`).join("")}</fieldset>
        <label class="fb-t">Details (optional, but they help)<textarea id="fb-text" maxlength="1000" rows="3" placeholder="e.g. 2024 revenue should be about $47B, not $4.7B"></textarea></label>
        <input type="text" name="website" id="fb-web" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
        <div class="gen-actions"><button class="btn sm primary" type="submit">Send</button><button class="btn sm" type="button" id="fb-cancel">Cancel</button><span class="note" id="fb-msg" role="status"></span></div>
      </form>
      <div class="kpis">
        <div class="kpi hero-n"><div class="k">12-month price target</div><div class="v">${usd(m.target)}</div><div class="n">${pill(m.rating)} &nbsp;${signed(m.upside)} vs ${usd(m.price)}</div></div>
        <div class="kpi kpi-wide"><div class="k">Bear / Base / Bull</div><div class="v" style="font-size:17px">${usd(sc.bear, 0)} / ${usd(sc.base, 0)} / ${usd(sc.bull, 0)}</div></div>
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

      <div id="stale-slot">${staleBanner(m, null)}</div>
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

      ${x?.rev ? `<section class="section card" id="sec-mc"><div class="card-h"><h2>Monte Carlo: the range of outcomes</h2><span class="note">10,000 trials in your browser · the Excel file has a 1,000-trial tab</span></div>
        <div id="mc-body"><p class="muted loading" style="padding:12px 18px">Running…</p></div></section>` : ""}
      ${quarterPanel(m)}
      ${guidancePanel(m)}
      ${forecastPanel(m)}
      <div id="owners-slot"></div>
      <section class="section card" id="sec-fin"><div class="card-h"><h2>Financial summary</h2><span class="note">$mm except per share · shaded columns are projections (base case)</span></div>
        <div class="scroll"><table class="fin"><thead><tr><th><span class="sr-only">Line item</span></th>${years.map((y, i) => `<th class="r${i >= hn ? " proj" : ""}">${esc(y)}</th>`).join("")}</tr></thead><tbody>
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
        <div class="scroll"><table class="fin hist"><thead><tr><th><span class="sr-only">Line item</span></th>${years.slice(0, hn).map((y, i) => { const l = d.tenk_links?.[i];
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
    document.getElementById("more-acts").addEventListener("click", (e) => { const a = document.getElementById("acts2"), on = !a.classList.contains("open");
      a.classList.toggle("open", on); e.currentTarget.setAttribute("aria-expanded", String(on)); e.currentTarget.textContent = on ? "Less ▴" : "More ▾"; });
    if (x?.rev) setTimeout(() => runMonteCarlo(m, 1), 30);
    const fbForm = document.getElementById("fb"), fbBtn = document.getElementById("fb-open");
    const fbToggle = (open) => { fbForm.hidden = !open; fbBtn.setAttribute("aria-expanded", String(open)); if (open) fbForm.querySelector("input[type=radio]").focus(); else fbBtn.focus(); };
    fbBtn.addEventListener("click", () => fbToggle(fbForm.hidden));
    document.getElementById("fb-cancel").addEventListener("click", () => fbToggle(false));
    fbForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("fb-msg"), btn = fbForm.querySelector("button[type=submit]");
      const body = { ticker: m.ticker, version: m.version, kind: fbForm.querySelector("input[name=fb-kind]:checked").value,
                     text: document.getElementById("fb-text").value, website: document.getElementById("fb-web").value };
      btn.disabled = true; msg.textContent = "Sending…";
      try {
        const r = await fetch(base + "/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
        fbForm.innerHTML = `<p class="fb-done">Thanks. The report went to the site owner, who reviews every one.</p>`;
      } catch (err) { msg.textContent = String(err.message || err); btn.disabled = false; }
    });
    ownersPanel(m.ticker).then((h) => { const el = document.getElementById("owners-slot"); if (el) el.innerHTML = h; });
    fetch(`${base}/api/filing?t=${encodeURIComponent(m.ticker)}`).then((r) => (r.ok ? r.json() : null)).then((f) => {
      const el = document.getElementById("stale-slot"); if (el && f?.latest) { el.innerHTML = staleBanner(m, f.latest); document.getElementById("stale-rebuild")?.addEventListener("click", () => sessionStorage.setItem("mb_prefill", m.ticker)); }
    }).catch(() => {});
    document.getElementById("stale-rebuild")?.addEventListener("click", () => sessionStorage.setItem("mb_prefill", m.ticker));

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

  // ------------------------------------------------------------- track record
  const closeOn = (series, day) => { let b = null; for (const [d, c] of series || []) { if (d <= day) b = c; else break; } return b; };
  async function quotesFor(tickers) {
    const base = await apiBase(), out = {}; let spy = [];
    for (let i = 0; i < tickers.length; i += 12) {
      try { const j = await fetch(base + "/api/quotes?t=" + tickers.slice(i, i + 12).join(",")).then((r) => (r.ok ? r.json() : null));
            if (j) { (j.quotes || []).forEach((q) => (out[q.ticker] = q)); spy = j.spy || spy; } } catch { /* leave blank */ }
    }
    return { q: out, spy };
  }
  const bar = (v, scale) => { if (!nz(v)) return ""; const w = Math.min(50, (Math.abs(v) / scale) * 50);
    return `<span class="dbar" aria-hidden="true"><span class="${v >= 0 ? "pos" : "neg"}" style="${v >= 0 ? "left:50%" : `right:50%`};width:${w}%"></span></span>`; };
  async function trackView() {
    document.title = "Track record · " + SITE;
    app.innerHTML = `<p class="muted loading">Loading the track record…</p>`;
    const base = await apiBase();
    let d; try { d = await fetch(base + "/api/track").then((r) => r.json()); } catch { app.innerHTML = `<div class="warn">The track record isn't available right now.</div>`; return; }
    const S = d.summary || {}, sc = d.scored || [], open = d.open || [];
    const scale = Math.max(0.1, ...sc.map((c) => Math.abs(c.excess ?? c.ret ?? 0)));
    app.innerHTML = `<section class="hero"><h1>Track record</h1>
        <p>Every model makes a call: Buy, Hold or Sell with a 12-month price target. Each call is graded once it's 30 days old, against the share price and against the S&amp;P 500 over the same days. Nothing is removed: if a call goes wrong, it stays on this page.</p></section>
      <div class="kpis">
        <div class="kpi hero-n"><div class="k">Calls graded</div><div class="v">${S.scored || 0}</div><div class="n">${S.scored ? `average ${Math.round(S.avg_days || 0)} days old` : d.first_grade ? `first grades on ${esc(d.first_grade)}` : "none yet"}</div></div>
        <div class="kpi"><div class="k">Calls that worked</div><div class="v">${S.scored ? pct(S.hit_rate, 0) : "—"}</div><div class="n">Buy: price rose · Sell: fell · Hold: within 10%</div></div>
        <div class="kpi"><div class="k">Average return since call</div><div class="v">${S.scored ? signed(S.avg_return) : "—"}</div></div>
        <div class="kpi"><div class="k">Versus the S&amp;P 500</div><div class="v">${S.scored && nz(S.avg_excess) ? signed(S.avg_excess) : "—"}</div><div class="n">positive means the call beat the index</div></div>
        <div class="kpi"><div class="k">Calls being tracked</div><div class="v">${d.open_count || 0}</div><div class="n">not graded yet</div></div>
      </div>
      ${Object.keys(S.by_rating || {}).length ? `<section class="section card"><div class="card-h"><h2>By rating</h2></div><div class="scroll"><table><thead><tr><th>Rating</th><th class="r">Calls</th><th class="r">Worked</th><th class="r">Average return</th></tr></thead><tbody>
        ${["Buy", "Hold", "Sell"].filter((k) => S.by_rating[k]).map((k) => `<tr><td>${pill(k)}</td><td class="r num">${S.by_rating[k].n}</td><td class="r num">${pct(S.by_rating[k].hit_rate, 0)}</td><td class="r num">${signed(S.by_rating[k].avg_return)}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
      <section class="section card"><div class="card-h"><h2>Graded calls</h2><span class="note">best to worst against the S&amp;P 500</span></div>
        ${sc.length ? `<div class="scroll"><table><thead><tr><th>Company</th><th>Call</th><th class="r hide-sm">Price then</th><th class="r hide-sm">Target</th><th class="r">Price graded</th><th class="r">Return</th><th class="r">S&amp;P 500</th><th class="r">Difference</th><th class="hide-sm" aria-hidden="true"></th><th>Result</th></tr></thead><tbody>
          ${sc.map((c) => `<tr><td><a class="tk" href="#/m/${esc(c.ticker)}">${esc(c.ticker)}</a><span class="co">${esc(c.name)}</span></td><td>${pill(c.rating)} <span class="note">${esc(c.call_date)}</span></td>
            <td class="r num hide-sm">${usd(c.call_price)}</td><td class="r num hide-sm">${usd(c.call_target)}</td><td class="r num">${usd(c.mark)}</td>
            <td class="r num">${signed(c.ret)}</td><td class="r num">${nz(c.spy_ret) ? signed(c.spy_ret) : "—"}</td><td class="r num">${nz(c.excess) ? signed(c.excess) : "—"}</td>
            <td class="hide-sm">${bar(c.excess, scale)}</td><td>${c.hit ? '<span class="ok">✓ worked</span>' : '<span class="bad">✗ missed</span>'}</td></tr>`).join("")}</tbody></table></div>`
          : `<p class="note" style="padding:14px 18px">No call is 30 days old yet${d.first_grade ? `. The first ones are graded on ${esc(d.first_grade)}` : ""}. Until then, the calls below are tracked live.</p>`}</section>
      <section class="section card"><div class="card-h"><h2>Calls being tracked</h2><span class="note">live, not graded yet · prices refresh every 30 minutes</span></div>
        ${open.length ? `<div class="scroll"><table><thead><tr><th>Company</th><th>Call</th><th class="r">Price then</th><th class="r">Target</th><th class="r">Price now</th><th class="r">So far</th><th class="r hide-sm">S&amp;P 500</th><th class="hide-sm">Graded on</th></tr></thead><tbody id="open-rows">
          ${open.map((c) => `<tr data-t="${esc(c.ticker)}"><td><a class="tk" href="#/m/${esc(c.ticker)}">${esc(c.ticker)}</a><span class="co">${esc(c.name)}</span></td><td>${pill(c.rating)} <span class="note">${esc(c.call_date)}</span></td>
            <td class="r num">${usd(c.call_price)}</td><td class="r num">${usd(c.call_target)}</td><td class="r num px">…</td><td class="r num ret">…</td><td class="r num hide-sm spy">…</td><td class="hide-sm note">${esc(c.graded_on)}</td></tr>`).join("")}</tbody></table></div>
          ${d.open_count > open.length ? `<p class="note" style="padding:10px 18px">Showing the ${open.length} most recent of ${d.open_count}.</p>` : ""}` : `<p class="note" style="padding:14px 18px">No calls yet.</p>`}</section>
      ${(() => { const f = d.forecast || {}; if (!f.n) return "";
        return `<section class="section card"><div class="card-h"><h2>Forecast accuracy</h2><span class="note">the model's revenue rules re-run on each company's data from one and two years earlier</span></div>
          <div class="kvrow" style="border:0;padding:14px 18px"><div><div class="note">Forecasts checked</div><b>${f.n}</b> <span class="note">across ${f.companies} companies</span></div>
            <div><div class="note">Typical miss (median)</div><b>${pct(f.median_abs_rev_err)}</b></div><div><div class="note">Within 5% of actual</div><b>${pct(f.within_5, 0)}</b></div>
            <div><div class="note">Within 10%</div><b>${pct(f.within_10, 0)}</b></div><div><div class="note">Gross margin, typical miss</div><b>${nz(f.median_abs_gm_pts) ? (f.median_abs_gm_pts * 100).toFixed(1) + " pts" : "—"}</b></div></div>
          <div class="scroll"><table><thead><tr><th>Company</th><th>Year</th><th class="r">Growth forecast</th><th class="r">Actual</th><th class="r">Revenue miss</th><th class="hide-sm" aria-hidden="true"></th></tr></thead><tbody>
            ${f.rows.slice(0, 40).map((b) => `<tr><td><a class="tk" href="#/m/${esc(b.ticker)}">${esc(b.ticker)}</a><span class="co">${esc(b.name)}</span></td><td>${esc(b.year)}</td><td class="r num">${pct(b.growth_fc)}</td><td class="r num">${pct(b.growth_act)}</td><td class="r num">${signed(b.rev_err)}</td><td class="hide-sm">${bar(b.rev_err, 0.25)}</td></tr>`).join("")}</tbody></table></div>
          <p class="note" style="padding:10px 18px 14px">Most accurate first. A positive miss means the forecast was too high. Revenue is the line every other forecast in the model hangs on, so it's the one graded here; each model page shows its own detail.</p></section>`; })()}
      <p class="note section">How grading works: a Buy works if the price is higher on the grading date, a Sell if it's lower, and a Hold if the price moved less than 10% either way. The S&amp;P 500 return uses SPY over the same dates. When a model is rebuilt, its newest call is graded separately once it's 30 days old. Dividends aren't included. For education only, not investment advice.</p>`;
    if (!open.length) return;
    const { q, spy } = await quotesFor([...new Set(open.map((c) => c.ticker))]);
    const spyNow = spy.at(-1)?.[1];
    open.forEach((c) => {
      const tr = document.querySelector(`#open-rows tr[data-t="${CSS.escape(c.ticker)}"]`); if (!tr) return;
      const px = q[c.ticker]?.price, s0 = closeOn(spy, c.call_date);
      tr.querySelector(".px").textContent = px ? usd(px) : "—";
      tr.querySelector(".ret").innerHTML = px ? signed(px / c.call_price - 1) : "—";
      tr.querySelector(".spy").innerHTML = s0 && spyNow ? signed(spyNow / s0 - 1) : "—";
    });
  }

  // ------------------------------------------------------------- watchlist page
  async function watchView() {
    document.title = "Watchlist · " + SITE;
    const list = WL.get();
    if (!list.length) {
      app.innerHTML = `<section class="hero"><h1>Watchlist</h1><p>Tap the ☆ next to any company (on a model page, a result card or in the Screener) to keep it here. Your list is saved in this browser only: no account, nothing sent to us.</p></section>
        <div class="card empty">Nothing on your watchlist yet. <a href="#/screener">Find ideas in the Screener</a> or <a href="#/">build a model</a>.</div>`;
      return;
    }
    app.innerHTML = `<section class="hero"><h1>Watchlist</h1><p>Each company's price against its latest model. Saved in this browser only. Tick two to compare them side by side.</p></section>
      <div class="gen-actions" style="padding:0 0 12px"><button class="btn sm" id="wl-cmp" disabled>Compare selected</button><span class="note" id="wl-n">Select two</span></div>
      <div class="card" id="wl"><p class="muted loading" style="padding:14px 18px">Loading ${list.length} compan${list.length > 1 ? "ies" : "y"}…</p></div>`;
    const base = await apiBase();
    let models = []; try { models = (await fetch(base + "/api/models?t=" + list.join(",")).then((r) => r.json())).models || []; } catch { /* still show prices */ }
    const M = Object.fromEntries(models.map((m) => [m.ticker, m]));
    const { q } = await quotesFor(list);
    const names = Object.fromEntries((await searchList()).map(([t, n]) => [t, n]));
    const el = document.getElementById("wl"); if (!el) return;
    el.innerHTML = `<div class="scroll"><table><thead><tr><th><span class="sr-only">Select</span></th><th>Company</th><th class="r">Price</th><th class="r">Model target</th><th class="r">Upside now</th><th>Rating</th><th class="hide-sm">Model built</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${list.map((t) => { const m = M[t], px = q[t]?.price ?? m?.mark?.price ?? m?.price;
        return `<tr><td><input type="checkbox" class="wl-c" value="${esc(t)}" aria-label="Select ${esc(t)} to compare"></td>
          <td>${starBtn(t)}<a class="tk" href="#/m/${esc(t)}">${esc(t)}</a><span class="co">${esc(m?.name || q[t]?.name || names[t] || "")}</span></td>
          <td class="r num">${usd(px)}</td><td class="r num">${m ? usd(m.target) : "—"}</td><td class="r num">${m && px ? signed(m.target / px - 1) : "—"}</td>
          <td>${m ? pill(m.rating) : ""}</td><td class="hide-sm note">${m ? ago(m.generated_at) : "no model yet"}</td>
          <td class="r">${m ? `<a class="btn sm" href="#/m/${esc(t)}">Model page</a>` : `<a class="btn sm primary" href="#/" data-gen="${esc(t)}">Build model</a>`}</td></tr>`; }).join("")}</tbody></table></div>`;
    el.querySelectorAll("[data-gen]").forEach((a) => a.addEventListener("click", () => sessionStorage.setItem("mb_prefill", a.dataset.gen)));
    const sync = () => { const sel = [...el.querySelectorAll(".wl-c:checked")].map((c) => c.value); const btn = document.getElementById("wl-cmp");
      btn.disabled = sel.length !== 2; document.getElementById("wl-n").textContent = sel.length === 2 ? sel.join(" vs ") : "Select two"; btn.dataset.sel = sel.join(","); };
    el.addEventListener("change", sync);
    document.getElementById("wl-cmp").addEventListener("click", (e) => { location.hash = "#/compare/" + e.target.dataset.sel; });
  }

  // ------------------------------------------------------------- earnings notes
  function attachSuggest(input, box, onPick) {
    let list = null; const load = async () => (list = list || await searchList());
    input.addEventListener("focus", load, { once: true });
    input.addEventListener("input", async () => {
      const q = input.value.trim().toUpperCase().replace(/[./]/g, "-"), qn = input.value.trim().toUpperCase();
      if (!q) { box.hidden = true; return; }
      const hits = (await load()).filter(([t, n]) => t.startsWith(q) || n.toUpperCase().includes(qn)).sort((a, b) => (a[0] === q ? -1 : b[0] === q ? 1 : a[0].length - b[0].length)).slice(0, 8);
      box.innerHTML = hits.map(([t, n, sct, x]) => `<div class="sg" data-t="${esc(t)}"><b>${esc(t)}</b> ${esc(n)} <span class="note">${esc(x || "NYSE")} · ${esc(sct)}</span></div>`).join("");
      box.hidden = !hits.length;
      box.querySelectorAll(".sg").forEach((el) => el.addEventListener("mousedown", (e) => { e.preventDefault(); input.value = el.dataset.t; box.hidden = true; onPick?.(el.dataset.t); }));
    });
    input.addEventListener("blur", () => setTimeout(() => (box.hidden = true), 100));
  }
  async function earningsView(tk) {
    document.title = (tk ? tk + " earnings · " : "Earnings · ") + SITE;
    app.innerHTML = `<section class="hero"><h1>Earnings, in plain English</h1>
        <p>Look up any NYSE or Nasdaq company. We read the earnings release it filed with the SEC and pull out what matters: the numbers, what management said and what they expect next. Lines in quotation marks are word for word from the filing, each with a link to the original.</p></section>
      <div class="card gen-box"><form id="er-f" autocomplete="off" class="gen-row"><div class="gen-input"><input id="er-t" placeholder="Ticker or company name, e.g. NVDA or Coca-Cola" aria-label="Company" spellcheck="false" autocapitalize="characters" value="${esc(tk || "")}"><div id="er-sugg" class="sugg" hidden></div></div>
        <button class="btn primary big" type="submit">Get the notes</button></form>
        <p class="note">Try: ${["NVDA", "AAPL", "JPM", "KO", "PG", "CVX"].map((t) => `<a href="#/earnings/${t}">${t}</a>`).join(" · ")}</p></div>
      <div id="er-out" aria-live="polite"></div>`;
    const inp = document.getElementById("er-t");
    const go = (t) => { t = String(t || "").trim().toUpperCase().replace(/[./]/g, "-"); if (t) location.hash = "#/earnings/" + t; };
    attachSuggest(inp, document.getElementById("er-sugg"), go);
    document.getElementById("er-f").addEventListener("submit", (e) => { e.preventDefault(); go(inp.value); });
    if (tk) loadEarnings(tk);
  }
  async function loadEarnings(t) {
    const out = document.getElementById("er-out"), base = await apiBase();
    if (!out) return;
    const msg = (h) => { if (location.hash.split("/")[2] === t) out.innerHTML = h; };
    msg(`<p class="muted loading">Looking up ${esc(t)}…</p>`);
    let s;
    try {
      s = await fetch(`${base}/api/earnings?t=${encodeURIComponent(t)}`).then((r) => r.json());
      if (s.status === "ready" && s.age_hours < 8) { msg(earningsHTML(s.notes)); return; }
      if (s.status === "ready") msg(earningsHTML(s.notes, "Checking for a newer earnings release…"));
      if (!["running", "queued", "finishing"].includes(s.status)) {
        const r = await fetch(`${base}/api/earnings?t=${encodeURIComponent(t)}`, { method: "POST" });
        const j = await r.json();
        if (!r.ok) { if (s.status !== "ready") msg(`<div class="warn">${esc(j.error || "Couldn't start.")}</div>`); return; }
        if (j.status === "ready") { msg(earningsHTML(j.notes)); return; }
      }
      const t0 = Date.now(), had = s.status === "ready";
      for (let i = 0; i < 70; i++) {
        if (!had) msg(`<div class="card" style="padding:16px 18px"><p class="loading" style="margin:0">Reading ${esc(t)}'s latest earnings filings on SEC EDGAR… ${Math.round((Date.now() - t0) / 1000)}s</p><p class="note" style="margin:6px 0 0">The first lookup for a company takes about 30–45 seconds. After that it's instant for everyone.</p></div>`);
        await new Promise((res) => setTimeout(res, 3000));
        const g = await fetch(`${base}/api/earnings?t=${encodeURIComponent(t)}`).then((r) => r.json());
        if (g.status === "ready" && (!had || g.age_hours < 1)) { msg(earningsHTML(g.notes)); return; }
        if (g.status === "failed") { if (!had) msg(`<div class="warn">${esc(g.error)}</div>`); return; }
        if (g.status === "missing" && Date.now() - t0 > 150e3 && !had) { msg(`<div class="warn">The lookup didn't finish. Try again in a minute.</div>`); return; }
      }
    } catch (err) { msg(`<div class="warn">Earnings notes aren't available right now.</div>`); }
  }
  function earningsHTML(n, banner) {
    const ev = (n.events || [])[0];
    if (!ev) return `<div class="card empty">${esc(n.name || n.ticker)} hasn't filed an earnings release with the SEC recently.${n.edgar ? ` <a href="${esc(n.edgar)}" target="_blank" rel="noopener">Its filings on EDGAR ↗</a>` : ""}</div>`;
    const src = (u, lab) => `<a class="src" href="${esc(u)}" target="_blank" rel="noopener">${esc(lab || "source")} ↗</a>`;
    const q = (txt, u, lab) => `<li><q>${esc(txt.replace(/^[“"]|[”"]$/g, ""))}</q> ${src(u, lab)}</li>`;
    const N = n.numbers || {}, Q = N.quarter || {};
    const row = (lab, k, f) => Q[k] && nz(Q[k].cur) ? `<tr><td>${lab}</td><td class="r num">${f(Q[k].cur)}</td><td class="r num">${nz(Q[k].prior) ? f(Q[k].prior) : "—"}</td><td class="r num">${nz(Q[k].chg) ? signed(Q[k].chg) : "—"}</td><td class="r num hide-sm">${nz(N.ttm?.[k]) ? f(N.ttm[k]) : "—"}</td></tr>` : "";
    const docs = (ev.docs || []).map((d) => `<a class="chip" href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.label)} ↗</a>`).join(" ");
    const srcLab = !ev.source_label || /^Exhibit/.test(ev.source_label) ? "Press release" : ev.source_label;
    return `${banner ? `<p class="note loading">${esc(banner)}</p>` : ""}
      <section class="card section er">
        <div class="card-h"><h2>${starBtn(n.ticker)} ${esc(n.name)} (${esc(n.ticker)})</h2><span class="note">${esc(ev.period || "")} · filed ${esc(ev.filed)}</span></div>
        ${ev.headline ? `<p class="er-head">${esc(ev.headline)}</p>` : ""}
        <div class="er-links"><a class="btn sm primary" href="${esc(ev.source_url || ev.filing_url)}" target="_blank" rel="noopener">Read the ${esc(srcLab.toLowerCase())} ↗</a>
          <a class="btn sm" href="${esc(ev.filing_url)}" target="_blank" rel="noopener">8-K filing on SEC EDGAR ↗</a>
          ${ev.call?.url ? `<a class="btn sm" href="${esc(ev.call.url)}" target="_blank" rel="noopener">Webcast / investor site ↗</a>` : ""}
          <a class="btn sm" href="#/m/${esc(n.ticker)}">Full model</a></div>
        ${(n.summary || []).length ? `<h3>In short</h3><ul class="er-sum">${n.summary.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
          <p class="note">Written from the figures the company tagged in its ${esc(N.form || "10-Q")} for ${esc((N.label || "the latest period").replace(/^Quarter/, "the quarter").replace(/^Year/, "the year"))}.${N.as_of && ev.filed && Date.parse(ev.filed) - Date.parse(N.as_of) > 70 * 864e5 ? " The 10-Q for the newest quarter isn't filed yet, so these figures are one quarter behind the release." : ""}</p>` : ""}
        ${Q.revenue || Q.eps_diluted ? `<h3>The numbers</h3><div class="scroll"><table><thead><tr><th>$ millions except per share</th><th class="r">This quarter</th><th class="r">Year ago</th><th class="r">Change</th><th class="r hide-sm">Last 12 months</th></tr></thead><tbody>
          ${row("Revenue", "revenue", mm)}${row("Operating income", "operating_income", mm)}${row("Net income", "net_income", mm)}${row("Diluted EPS", "eps_diluted", usd)}${row("Capital spending", "capex", mm)}</tbody></table></div>` : ""}
        ${(ev.results || []).length ? `<h3>What they reported</h3><ul class="er-q">${ev.results.map((x) => q(x, ev.source_url, srcLab)).join("")}</ul>` : ""}
        ${(ev.quotes || []).length ? `<h3>What management said</h3><ul class="er-q">${ev.quotes.map((x) => `<li><q>${esc(x.text)}</q><span class="er-who">— ${esc(x.who)}</span> ${src(x.url || ev.source_url, x.url ? "remarks" : srcLab)}</li>`).join("")}</ul>` : ""}
        <h3>What they expect next</h3>${(ev.outlook || []).length ? `<ul class="er-q">${ev.outlook.map((x) => q(x, ev.source_url, srcLab)).join("")}</ul>` : `<p class="note">No outlook or guidance in this release. Some companies only give it on the call.</p>`}
        ${(ev.capital || []).length ? `<h3>Dividends and buybacks</h3><ul class="er-q">${ev.capital.map((x) => q(x, ev.source_url, srcLab)).join("")}</ul>` : ""}
        <h3>The call</h3><p>${ev.call?.sentence ? `<q>${esc(ev.call.sentence)}</q> ` : ""}${ev.call?.url ? `<a href="${esc(ev.call.url)}" target="_blank" rel="noopener">Replay and webcast ↗</a>` : "Replays are on the company's investor relations site."} <span class="note">Most companies don't file call transcripts with the SEC, so the call itself isn't quoted here${(ev.docs || []).some((d) => /transcript|remarks/i.test(d.label)) ? ", but this company filed its remarks (below)" : ""}.</span></p>
        ${docs ? `<h3>Everything filed with this release</h3><p class="er-docs">${docs}</p>` : ""}
      </section>
      ${(n.events || []).length > 1 ? `<section class="card section"><div class="card-h"><h2>Earlier earnings releases</h2></div><div class="scroll"><table><thead><tr><th>Filed</th><th>Documents</th></tr></thead><tbody>
        ${n.events.slice(1).map((e) => `<tr><td class="num">${esc(e.filed)}</td><td>${(e.docs || []).map((d) => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.label)} ↗</a>`).join(" · ") || `<a href="${esc(e.filing_url)}" target="_blank" rel="noopener">8-K ↗</a>`}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
      <p class="note section">Pulled automatically from ${esc(n.name)}'s SEC filings on ${esc((n.built_at || "").slice(0, 10))}. Quoted lines are word for word from the linked documents; the “In short” lines are our summary of the tagged figures. Check the original before relying on any number. Not investment advice.</p>`;
  }

  // ------------------------------------------------------------- index funds
  const IX_Q = [
    ["horizon", "When will you need this money?", [["lt2", "Within 2 years"], ["2to5", "In 2–5 years"], ["5to10", "In 5–10 years"], ["10p", "10+ years from now"]]],
    ["debt", "Do you carry credit card or other debt above about 8% interest?", [["yes", "Yes"], ["no", "No"]]],
    ["emergency", "Do you have 3–6 months of expenses saved for emergencies?", [["yes", "Yes"], ["some", "Some, not that much"], ["no", "No"]]],
    ["match", "Does your employer match 401(k) contributions you aren't fully getting yet?", [["yes", "Yes"], ["no", "No, or I already get all of it"], ["na", "No 401(k)"]]],
    ["drop", "If your investment fell 30% in a few months, what would you do?", [["sell", "Probably sell"], ["hold", "Hold and wait"], ["buy", "Buy more"]]],
    ["goal", "Which sounds more like you?", [["simple", "I want something simple that grows over time"], ["beat", "I want to pick stocks and try to beat the market"]]],
  ];
  function ixAssess(A, D) {
    const R = D.spy?.rolling || {}, spy = D.spy || {};
    const steps = [], why = [], cautions = [];
    if (A.debt === "yes") steps.push(`<b>Pay off high-interest debt first.</b> A credit card charging 20%+ costs more than the stock market has paid: the S&amp;P 500 returned about ${pct(spy.since, 1)} a year since ${esc((spy.start || "1993").slice(0, 4))}, with dividends. Paying down the card is a guaranteed return.`);
    if (A.match === "yes") steps.push(`<b>Get the full employer match.</b> A 50% or 100% match is an instant return no fund can beat, and most 401(k) plans offer an S&amp;P 500 or target-date index fund to put it in.`);
    if (A.emergency === "no" || A.emergency === "some") steps.push(`<b>Build an emergency fund${A.emergency === "some" ? " to 3–6 months" : ""}.</b> Keep it in a high-yield savings account, so a surprise bill never forces you to sell stocks when they're down.`);
    let verdict, cls, stock;
    if (A.horizon === "lt2") {
      verdict = "Not for money you need within 2 years"; cls = "bad"; stock = [0, 10];
      why.push(`Over single 12-month stretches since ${esc(spy.start?.slice(0, 4) || "1993")}, the S&amp;P 500 lost money ${pct(1 - (R["1"]?.positive || 0), 0)} of the time, and the worst one was ${signed(R["1"]?.worst)}.`);
      why.push("Money you'll need soon belongs in a high-yield savings account, CDs or Treasury bills, where it can't drop right before you need it.");
    } else if (A.horizon === "2to5") {
      verdict = "Partly: mix it with safer holdings"; cls = "hold-t"; stock = [30, 50];
      why.push(`Over 5-year stretches the S&amp;P 500 made money ${pct(R["5"]?.positive, 0)} of the time, but the worst 5 years still lost ${signed(R["5"]?.worst)} a year.`);
      why.push("With a few years to go, a bond index fund (like BND) or Treasury bills alongside a stock index fund softens the swings.");
    } else {
      verdict = steps.length ? "A good fit, after the steps above" : "A good fit"; cls = "ok"; stock = A.horizon === "10p" ? [80, 100] : [60, 80];
      const r = A.horizon === "10p" ? R["10"] : R["5"];
      why.push(`Across all ${A.horizon === "10p" ? "10" : "5"}-year stretches since ${esc(spy.start?.slice(0, 4) || "1993")}, the S&amp;P 500 made money ${pct(r?.positive, 0)} of the time. The middle result was ${signed(r?.median)} a year, the worst ${signed(r?.worst)}.`);
      if (A.horizon === "10p" && R["20"]?.n) why.push(`Over 20-year stretches it was positive ${pct(R["20"].positive, 0)} of the time, never worse than ${signed(R["20"].worst)} a year.`);
      why.push("Time is the main thing an index fund needs: the longer you hold, the less any one bad year matters.");
    }
    if (A.drop === "sell") { stock = [Math.max(0, stock[0] - 20), Math.max(0, stock[1] - 20)]; cautions.push(`You said you'd probably sell after a 30% drop. The S&amp;P 500 has done that: it fell ${signed(spy.max_dd)} from its peak to the low in ${esc(spy.max_dd_at || "2009")}. Selling then locked in the loss for anyone who did. Holding more bonds and investing automatically every month makes it easier to sit still.`); }
    if (A.drop === "buy") why.push("You said you'd buy more after a drop. That habit (buying when prices are low) is what makes regular monthly investing work.");
    if (A.goal === "beat") cautions.push(`Most professionals don't beat the index over time (see "Hard to beat" above). A common approach is "core and explore": keep most of your money (say 80–90%) in an index fund and use a small slice for stock picks. You can research picks with the <a href="#/">model builder</a> and <a href="#/screener">screener</a>.`);
    const mix = stock[1] === 0 ? "Cash, CDs or Treasury bills" :
      `${stock[0]}–${stock[1]}% stock index funds (for example a US fund like VTI or VOO with some international, like VXUS), the rest in a bond fund like BND or Treasury bills`;
    return { verdict, cls, steps, why, cautions, mix };
  }
  function ixResult(A, D) {
    const done = IX_Q.every(([k]) => A[k]);
    if (!done) return `<p class="note">Answer all ${IX_Q.length} to see the result. ${IX_Q.filter(([k]) => A[k]).length} of ${IX_Q.length} done.</p>`;
    const r = ixAssess(A, D);
    return `<div class="ix-res"><p class="ix-v"><span class="${r.cls}">${esc(r.verdict)}</span></p>
      ${r.steps.length ? `<h3>Before you invest</h3><ol>${r.steps.map((x) => `<li>${x}</li>`).join("")}</ol>` : ""}
      <h3>Why</h3><ul>${r.why.map((x) => `<li>${x}</li>`).join("")}</ul>
      ${r.cautions.length ? `<h3>Worth knowing</h3><ul>${r.cautions.map((x) => `<li>${x}</li>`).join("")}</ul>` : ""}
      <h3>A common starting mix for your timeline</h3><p>${r.mix}.</p>
      <p class="note">A rule of thumb from what's typical, not a recommendation for you personally. Before investing a large amount, talk to a fee-only financial planner.</p></div>`;
  }
  function ixDca(D, amt, yrs) {
    const v = D.spy?.v || [], n = yrs * 12, outs = [];
    for (let s0 = 0; s0 + n < v.length; s0++) {
      let val = 0; for (let k = 0; k < n; k++) val += amt * v[s0 + n] / v[s0 + k];
      outs.push([val, s0]);
    }
    if (!outs.length) return null;
    outs.sort((a, b) => a[0] - b[0]);
    const [y0, m0] = (D.spy.start || "1993-01").split("-").map(Number);
    const when = (i) => { const t = y0 * 12 + (m0 - 1) + i; return `${Math.floor(t / 12)}`; };
    const put = amt * n, pick = (p) => outs[Math.min(outs.length - 1, Math.floor(p * (outs.length - 1)))];
    return { put, n: outs.length, worst: outs[0], med: pick(0.5), best: outs[outs.length - 1], ahead: outs.filter((o) => o[0] > put).length / outs.length, when };
  }
  async function indexView() {
    document.title = "Index funds · " + SITE;
    app.innerHTML = `<p class="muted loading">Loading index fund data…</p>`;
    let D; try { D = await getJSON("index/data.json"); } catch { app.innerHTML = `<div class="warn">Index fund data isn't available yet. It's rebuilt every weekday evening.</div>`; return; }
    const F = D.funds || [], spy = D.spy || {}, mk = D.market || {}, R = spy.rolling || {};
    const voo = F.find((f) => f.t === "VOO") || {}, vti = F.find((f) => f.t === "VTI") || {};
    const fv = (rate, fee, yrs = 30, p = 10000) => p * Math.pow(1 + rate - fee, yrs);
    const A = JSON.parse(sessionStorage.getItem("mb_ix") || "{}");
    app.innerHTML = `<section class="hero"><h1>Index funds: are they right for you?</h1>
        <p>An index fund buys every company in a market index, like the S&amp;P 500, instead of trying to pick winners. You own a small slice of all of them for a tiny yearly fee. Below: why people use them, what can go wrong, a one-minute check of whether one fits you, and what history says monthly investing could have turned into.</p></section>
      <div class="grid3 section">
        <div class="card ix-card"><div class="k">Cheap</div><p>${esc(voo.t || "VOO")} costs <b>${pct(voo.er, 2)}</b> a year: <b>${usd((voo.er || 0.0003) * 10000)}</b> on every $10,000. Over 30 years at a 7% return, $10,000 grows to about <b>${usd(fv(0.07, voo.er || 0.0003))}</b>. At a 1% yearly fee it would be about <b>${usd(fv(0.07, 0.01))}</b>.</p></div>
        <div class="card ix-card"><div class="k">Hard to beat</div><p>In 2025, <b>79%</b> of actively managed large-company US funds did worse than the S&amp;P 500, and over 20 years it's more than <b>9 in 10</b>. <a href="https://www.spglobal.com/spdji/en/spiva/article/spiva-us/" target="_blank" rel="noopener">S&amp;P SPIVA scorecard ↗</a></p></div>
        <div class="card ix-card"><div class="k">Spread out</div><p>${esc(vti.t || "VTI")} owns about 3,500 US companies. If one fails, you barely notice. Picking 5 or 10 stocks yourself, one bad pick can sink the whole portfolio.</p></div>
      </div>
      <section class="section card"><div class="card-h"><h2>The honest downsides</h2></div><ul class="ix-list">
        <li><b>You get every crash.</b> The S&amp;P 500 fell <b>${signed(spy.max_dd)}</b> from its peak to the bottom in ${esc(spy.max_dd_at || "")}. It lost money in <b>${spy.down_years ?? "—"} of the last ${spy.years ?? "—"}</b> calendar years, the worst being ${esc(spy.worst_year?.[0] || "")} (${signed(spy.worst_year?.[1])}).</li>
        <li><b>It's top-heavy.</b> The 10 largest US companies (${esc((mk.top10 || []).slice(0, 5).join(", "))} and others) make up about <b>${pct(mk.top10_share, 0)}</b> of the 500 largest. An "S&amp;P 500 fund" leans heavily on a handful of tech giants.</li>
        <li><b>You'll never beat the market.</b> You'll get the market's return minus a tiny fee. For most people that's the point.</li>
        <li><b>Short-term, anything can happen.</b> Over single 12-month stretches since ${esc((spy.start || "").slice(0, 4))}, results ranged from ${signed(R["1"]?.worst)} to ${signed(R["1"]?.best)}.</li></ul></section>

      <section class="section card" id="ix-quiz"><div class="card-h"><h2>Is an index fund right for you?</h2><span class="note">6 questions · nothing is saved or sent</span></div>
        <form id="ix-f" class="ix-f">${IX_Q.map(([k, q, opts]) => `<fieldset><legend>${q}</legend>${opts.map(([v, l]) => `<label><input type="radio" name="${k}" value="${v}"${A[k] === v ? " checked" : ""}> ${l}</label>`).join("")}</fieldset>`).join("")}</form>
        <div id="ix-out" aria-live="polite">${ixResult(A, D)}</div></section>

      <section class="section card"><div class="card-h"><h2>What could investing every month have become?</h2><span class="note">real S&amp;P 500 history, dividends reinvested</span></div>
        <form class="gen-row ix-calc" id="ix-c"><label>Each month <input id="ix-amt" type="number" min="10" step="10" value="200"></label>
          <label>For <select id="ix-yrs">${[5, 10, 15, 20, 25, 30].map((y) => `<option${y === 10 ? " selected" : ""}>${y}</option>`).join("")}</select> years</label></form>
        <div id="ix-dca"></div></section>

      <section class="section card"><div class="card-h"><h2>Popular index funds compared</h2><span class="note">returns are yearly averages with dividends reinvested · as of ${esc(D.built_at)}</span></div>
        <div class="scroll"><table class="stack"><thead><tr><th>Fund</th><th class="r">Yearly fee</th><th class="r">1 year</th><th class="r">5 years</th><th class="r">10 years</th><th class="r">Worst drop</th><th class="r hide-sm">Yield</th></tr></thead><tbody>
          ${F.map((f) => `<tr><td><a class="tk" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.t)}</a><span class="co">${esc(f.name)}</span><span class="co ix-tr">${esc(f.tracks)}</span></td>
            <td class="r num" data-l="Yearly fee">${pct(f.er, 2)}<span class="co">${usd(f.er * 10000)} per $10k</span></td><td class="r num" data-l="1 year">${signed(f.r1)}</td><td class="r num" data-l="5 years">${nz(f.r5) ? signed(f.r5) : "—"}</td><td class="r num" data-l="10 years">${nz(f.r10) ? signed(f.r10) : "—"}</td>
            <td class="r num" data-l="Worst drop">${signed(f.max_dd)}<span class="co">${esc(f.max_dd_at || "")} · data from ${esc((f.start || "").slice(0, 4))}</span></td><td class="r num" data-l="Yield">${nz(f.yield) ? pct(f.yield, 1) : "—"}</td></tr>`).join("")}</tbody></table></div>
        <div class="ix-hold">${F.filter((f) => (f.top || []).length).map((f) => `<details><summary>${esc(f.t)}: biggest holdings</summary><p class="note">${f.top.map((h) => `${esc(h.t || h.name)} ${pct(h.w, 1)}`).join(" · ")}${f.top.length ? ` · top ${f.top.length} together ${pct(f.top.reduce((a, h) => a + (h.w || 0), 0), 0)}` : ""}</p></details>`).join("")}</div>
        <p class="note" style="padding:10px 18px 14px">"Worst drop" is the biggest fall from a high to a low since the fund started, using month-end prices. These are ETFs; Vanguard, Schwab and Fidelity also sell mutual-fund versions of the same indexes. Past returns don't predict future ones.</p></section>

      ${mk.pe ? `<section class="section card"><div class="card-h"><h2>Is the market expensive right now?</h2></div>
        <div class="kvrow" style="border:0;padding:14px 18px 4px"><div><div class="note">P/E of the 500 largest US companies</div><b>${mult(mk.pe)}</b></div><div><div class="note">Their earnings yield (1 ÷ P/E)</div><b>${pct(1 / mk.pe, 1)}</b></div>${nz(mk.t10) ? `<div><div class="note">10-year Treasury yield</div><b>${pct(mk.t10, 2)}</b></div>` : ""}</div>
        <p style="padding:0 18px">${nz(mk.t10) ? (1 / mk.pe > mk.t10 ? "Stocks' earnings yield is above what a 10-year Treasury pays, so stocks are still being paid something extra for their risk." : "Stocks' earnings yield is below what a risk-free 10-year Treasury pays, which means investors are paying up for growth they expect later.") : ""} Research by Robert Shiller and others found that when prices are high relative to earnings, the following 10 years have tended to return less. It has been a poor guide to the next year or two, which is why most people keep investing every month rather than waiting for a dip.</p>
        <p class="note" style="padding:0 18px 14px">Our estimate: the market value of the 500 largest US-based companies on NYSE and Nasdaq divided by their latest annual earnings (profitable companies only). It's close to, but not the same as, the official S&amp;P 500 figure.</p></section>` : ""}
      <p class="note section">For education only. This is general information, not personal financial advice, and Model Builder isn't a registered investment adviser. Fund data from Yahoo Finance and each fund's issuer; fund performance figures are calculated by Model Builder.</p>`;
    const f = document.getElementById("ix-f");
    f.addEventListener("change", () => { const a = Object.fromEntries(new FormData(f)); sessionStorage.setItem("mb_ix", JSON.stringify(a)); document.getElementById("ix-out").innerHTML = ixResult(a, D); });
    const calc = () => {
      const amt = Math.max(1, +document.getElementById("ix-amt").value || 200), yrs = +document.getElementById("ix-yrs").value, r = ixDca(D, amt, yrs), el = document.getElementById("ix-dca");
      if (!r) { el.innerHTML = `<p class="note" style="padding:0 18px 14px">Not enough history for ${yrs} years.</p>`; return; }
      el.innerHTML = `<div class="kpis" style="padding:12px 18px 0"><div class="kpi"><div class="k">You put in</div><div class="v">${usd(r.put, 0)}</div></div>
          <div class="kpi"><div class="k">Worst start (${r.when(r.worst[1])})</div><div class="v">${usd(r.worst[0], 0)}</div></div>
          <div class="kpi hero-n"><div class="k">Typical result</div><div class="v">${usd(r.med[0], 0)}</div></div>
          <div class="kpi"><div class="k">Best start (${r.when(r.best[1])})</div><div class="v">${usd(r.best[0], 0)}</div></div></div>
        <p style="padding:8px 18px 14px;margin:0">Investing ${usd(amt, 0)} every month for ${yrs} years in the S&amp;P 500 ended with more than you put in <b>${pct(r.ahead, 0)}</b> of the time, across ${r.n} different starting months since ${esc((D.spy.start || "").slice(0, 4))}. <span class="note">Before taxes and fund fees; uses SPY's monthly prices with dividends reinvested.</span></p>`;
    };
    document.getElementById("ix-c").addEventListener("input", calc); calc();
  }

  // ------------------------------------------------------------- about JJ
  function aboutView() {
    document.title = "About JJ · " + SITE;
    const site = INDEX?.site || {};
    const job = (t, org, place, when, pts) => `<div class="cv-job"><div class="cv-h"><b>${t}</b> · ${org}<span class="note">${when}</span></div><div class="note">${place}</div><ul>${pts.map((x) => `<li>${x}</li>`).join("")}</ul></div>`;
    app.innerHTML = `<div class="doc about">
      <h1>Jash (JJ) Rajgandhi</h1>
      <p class="lede">MS in Finance at Hofstra University's Frank G. Zarb School of Business, graduating December 2026. Senior Financial Analyst on Hofstra's Student Managed Investment Fund. I built this site.</p>
      <div class="gen-actions" style="padding:0;margin:14px 0 6px">
        <a class="btn primary" href="mailto:jrajgandhi1@pride.hofstra.edu">Email me</a>
        ${site.linkedin ? `<a class="btn" href="${esc(site.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a>` : ""}
        ${site.portfolio ? `<a class="btn" href="${esc(site.portfolio)}" target="_blank" rel="noopener">Portfolio ↗</a>` : ""}
        <span class="note">jrajgandhi1@pride.hofstra.edu · Long Island, New York</span></div>
      <h2>Why I built Model Builder</h2>
      <p>On the investment fund I build DCFs, comps and three-statement models, and I review the ones our junior analysts build. A lot of that time goes to the same mechanical work every time: pulling numbers out of the 10-K, linking the statements, rolling the schedules and the DCF. I wanted to see how much of that could be automated without cutting corners, so the time goes into the judgment calls instead.</p>
      <p>Model Builder builds the model the way I would by hand, for any NYSE or Nasdaq company. It uses SEC filings for the historicals, keeps every cell color-coded and linked so a reviewer can audit it, and runs bull, base and bear cases. Every call is graded in public on the <a href="#/track">Track record</a> page, because a model you can't check isn't worth much.</p>
      <h2>Experience</h2>
      ${job("Senior Financial Analyst", "Student Managed Investment Fund, Hofstra University", "Hempstead, New York", "Jun 2025 – present", [
        "Fundamental equity research on 8+ public companies across healthcare and consumer sectors for a $500K student-managed portfolio, with buy/sell recommendations built on Bloomberg Terminal work and financial statement analysis.",
        "DCF models, trading comparables and scenario analysis to assess intrinsic value and risk; investment theses presented to faculty advisors and the investment committee.",
        "Review junior analysts' three-statement models, applying margin decomposition to meet institutional standards."])}
      ${job("Graduate Assistant", "Speech-Language-Hearing Sciences Department, Hofstra University", "Hempstead, New York", "Jun 2025 – present", [
        "Lead cross-functional student initiatives and marketing campaigns (Adobe Creative Suite, Canva, Photoshop) that drove a 50% increase in program visibility and participation.",
        "Revamped records and orientation logistics with advanced Excel (pivot tables, VLOOKUP, conditional formatting), improving cross-department collaboration through weekly data sharing.",
        "Manage departmental budget allocations in Excel, keeping spending cost-efficient and program reporting accurate."])}
      ${job("Financial Planning &amp; Analysis Associate", "MedMart Pharma", "Mumbai, India", "Jan – Dec 2024", [
        "Built integrated three-statement forecast models with revenue drivers, R&amp;D spending and product launch timelines, improving cash-runway forecast accuracy by 30%.",
        "Margin analysis and revenue forecasting for pharma and surgical product lines; reporting packages and variance analysis for management and investor updates."])}
      ${job("Financial Research Analyst Intern", "Motilal Oswal", "Mumbai, India", "Apr – Jun 2023", [
        "Financial analysis on 10+ public companies supporting M&amp;A and capital-raising mandates: DCF models, trading comps and precedent transactions for internal deal materials.",
        "Helped prepare equity research reports, pitch decks and client presentations."])}
      <h2>Projects</h2>
      ${job("Automated Financial Modeling &amp; Forecasting Platform", "Model Builder, this site", "", "Nov 2026", [
        "Built a financial modeling platform from scratch with forecasting, statement generation, analysis, equity reporting and sandbox simulation features.",
        "Automated financial projections by pulling data from 10-K and 10-Q filings, updating linked assumptions, applying formulas and checking model outputs. Built with Python, Excel/LibreOffice, GitHub Actions and Cloudflare Workers. <a href=\"#/built\">How I built it</a>."])}
      ${job("Cheniere Energy (LNG): equity research and valuation", "Independent project", "", "Oct 2026", [
        "Wrote an equity research report with a Buy rating and a price target 17.6% above the price at the time, from a blended FCFF DCF, exit EV/EBITDA multiple and trading comps.",
        "Projected a 6.7% revenue CAGR and 35–36% EBITDA margins through FY2029, and stress-tested the assumptions with bear, base and bull cases and a 50,000-trial Monte Carlo simulation."])}
      ${job("AMCOR valuation, team lead", "Hofstra course project", "", "Apr 2026", [
        "Five-year three-statement forecast with bear, base and bull cases, stress-testing operating leverage and working capital (DSO, DIO, DPO) to derive an implied per-share equity value."])}
      ${job("Pacira BioSciences (PCRX) equity research report", "Independent project", "", "Nov 2025", [
        "Full-length report with an FCFE-based DCF at a 10% cost of equity and scenario analysis across margin, market share and terminal growth, ending in a price target and recommendation."])}
      <h2>Education</h2>
      <div class="cv-job"><div class="cv-h"><b>MS in Finance</b> · Frank G. Zarb School of Business, Hofstra University<span class="note">Jan 2025 – Dec 2026</span></div>
        <div class="note">GPA 3.95 / 4.0 · Financial Modeling, Corporate Finance, Investments, Derivatives, Econometrics</div></div>
      <div class="cv-job"><div class="cv-h"><b>Bachelor of Management Studies, Finance</b> · University of Mumbai<span class="note">Jul 2021 – May 2024</span></div></div>
      <h2>Skills</h2>
      <ul class="cv-skills">
        <li><b>Modeling and valuation:</b> three-statement models, DCF, trading comparables, sensitivity and scenario analysis, DDM, WACC</li>
        <li><b>Financial analysis:</b> revenue drivers, operating leverage, margin, working capital and variance analysis</li>
        <li><b>Tools:</b> Excel (advanced), VBA, PowerPoint, Bloomberg Terminal, Claude Code</li>
        <li><b>Certifications:</b> Bloomberg Market Concepts (BMC)</li>
        <li><b>Languages:</b> English (fluent), Hindi and Gujarati (native)</li>
        <li><b>Leadership:</b> Treasurer, ZGBA student club (2026 – present). Ran the budget for 10+ events and cut costs about 20% through competitive sourcing.</li>
      </ul>
    </div>`;
  }

  // ------------------------------------------------------------- sector pages
  const SEC_STAT = [["pe", "P/E", mult], ["ev_ebitda", "EV/EBITDA", mult], ["rev_growth", "Revenue growth", pct], ["op_m", "Operating margin", pct], ["net_m", "Net margin", pct], ["div_yield", "Dividend yield", pct]];
  const medOf = (xs) => { const a = xs.filter((v) => nz(v)).sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[a.length >> 1] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null; };
  async function screenRows() {
    const d = await loadScreen(); const I = Object.fromEntries(d.fields.map((f, i) => [f, i]));
    return { d, rows: d.rows.map((r) => Object.fromEntries(d.fields.map((f) => [f, r[I[f]]]))).filter((r) => !r.country || r.country === "United States") };
  }
  async function sectorsView() {
    document.title = "Sectors · " + SITE;
    app.innerHTML = `<p class="muted loading">Loading sectors…</p>`;
    let S; try { S = await screenRows(); } catch { app.innerHTML = `<div class="warn">Sector data isn't available right now.</div>`; return; }
    const by = {}; S.rows.forEach((r) => (by[r.sector] ||= []).push(r));
    const secs = Object.entries(by).filter(([k]) => k && k !== "Other").sort((a, b) => b[1].reduce((x, r) => x + (r.mcap || 0), 0) - a[1].reduce((x, r) => x + (r.mcap || 0), 0));
    app.innerHTML = `<section class="hero"><h1>Sectors</h1><p>Every US-based NYSE and Nasdaq company, grouped into the 11 standard sectors. Medians show what's normal for each sector, which is the fair way to judge a company's numbers: a P/E of 25 is cheap for software and expensive for a utility.</p></section>
      <div class="card"><div class="scroll"><table><thead><tr><th>Sector</th><th class="r">Companies</th><th class="r">Market value</th>${SEC_STAT.map(([, l]) => `<th class="r${l.length > 12 ? " hide-sm" : ""}">${l}</th>`).join("")}</tr></thead><tbody>
        ${secs.map(([n, rs]) => `<tr><td><a class="plain-l" href="#/sector/${secSlug(n)}">${esc(n)}</a></td><td class="r num">${rs.length.toLocaleString()}</td><td class="r num">${big(rs.reduce((x, r) => x + (r.mcap || 0), 0))}</td>
          ${SEC_STAT.map(([k, l, f]) => `<td class="r num${l.length > 12 ? " hide-sm" : ""}">${f(medOf(rs.filter((r) => (r.mcap || 0) >= 300 && (k !== "pe" || r.pe > 0)).map((r) => r[k])))}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>
      <p class="note section">Medians across companies worth $300M or more in each sector (P/E counts profitable companies only). Data from each company's latest 10-K and recent prices, rebuilt nightly. Click a sector for its largest companies, standouts and the site's models.</p>`;
  }
  async function sectorPage(slug) {
    app.innerHTML = `<p class="muted loading">Loading…</p>`;
    let S; try { S = await screenRows(); } catch { app.innerHTML = `<div class="warn">Sector data isn't available right now.</div>`; return; }
    const name = [...new Set(S.rows.map((r) => r.sector))].find((n) => secSlug(n) === slug);
    if (!name) { app.innerHTML = `<a class="crumb" href="#/sectors">← Sectors</a><div class="card empty">No sector called “${esc(slug)}”.</div>`; return; }
    document.title = `${name} · ${SITE}`;
    const rs = S.rows.filter((r) => r.sector === name);
    const top = (f, k, dir, n = 6) => rs.filter(f).sort((a, b) => dir * ((a[k] ?? 0) - (b[k] ?? 0))).slice(0, n);
    const list = (title, why, xs, k, fmt) => `<section class="card"><div class="card-h"><h2>${title}</h2><span class="note">${why}</span></div>
      ${xs.length ? xs.map((r) => `<div class="kv"><span>${starBtn(r.ticker)}<a class="tk" href="#/m/${esc(r.ticker)}">${esc(r.ticker)}</a> <span class="co-i">${esc(r.name)}</span></span><span class="num">${fmt(r[k])}</span></div>`).join("") : `<p class="note" style="padding:12px 18px">None qualify.</p>`}</section>`;
    const owners = await loadOwners().catch(() => ({}));
    const fav = rs.map((r) => ({ ...r, nf: (owners[r.ticker] || []).length })).filter((r) => r.nf).sort((a, b) => b.nf - a.nf || (b.mcap || 0) - (a.mcap || 0)).slice(0, 6);
    app.innerHTML = `<a class="crumb" href="#/sectors">← Sectors</a>
      <section class="hero"><h1>${esc(name)}</h1><p>${rs.length.toLocaleString()} US-based NYSE and Nasdaq companies worth ${big(rs.reduce((x, r) => x + (r.mcap || 0), 0))} in total. <a href="#/screener?sector=${encodeURIComponent(name)}">Screen this sector →</a></p></section>
      <div class="kpis">${SEC_STAT.map(([k, l, f]) => `<div class="kpi"><div class="k">Median ${l}</div><div class="v">${f(medOf(rs.filter((r) => (r.mcap || 0) >= 300 && (k !== "pe" || r.pe > 0)).map((r) => r[k])))}</div></div>`).join("")}</div>
      <p class="note">Medians cover companies worth $300M or more (P/E: profitable ones only), so thousands of tiny companies don't drown out what's typical.</p>
      <section class="section card" id="sec-models"><div class="card-h"><h2>Models on this site</h2><span class="note">built by visitors</span></div><p class="muted loading" style="padding:12px 18px">Loading…</p></section>
      <div class="grid2 section">
        ${list("Largest companies", "by market value", top((r) => r.mcap, "mcap", -1, 8), "mcap", big)}
        ${list("Most owned by famous funds", "of the 15 tracked 13F filers", fav, "nf", (n) => `${n} fund${n > 1 ? "s" : ""}`)}
        ${list("Growing fastest", "profitable, over $1B, revenue growth", top((r) => r.mcap >= 1000 && r.net_m > 0 && nz(r.rev_growth), "rev_growth", -1), "rev_growth", pct)}
        ${list("Lowest P/E", "profitable, over $2B", top((r) => r.mcap >= 2000 && r.pe > 0, "pe", 1), "pe", mult)}
        ${list("Highest dividend yield", "over $1B, paying out under 90% of profit", top((r) => r.mcap >= 1000 && r.div_yield > 0 && nz(r.payout) && r.payout <= 0.9 && (r.chg_1y ?? 0) > -0.3, "div_yield", -1), "div_yield", pct)}
        ${list("Highest operating margin", "over $1B", top((r) => r.mcap >= 1000 && nz(r.op_m) && r.op_m < 0.9, "op_m", -1), "op_m", pct)}
      </div>
      <p class="note section">Lists show companies that stand out on one number, not recommendations. Figures from the latest 10-K (fiscal ${esc(S.d.fiscal_year)}) and recent prices; stocks down more than 30% in a year are left out of the dividend list.</p>`;
    const base = await apiBase();
    let ms = []; try { ms = (await fetch(base + "/api/sector?name=" + encodeURIComponent(name)).then((r) => r.json())).models || []; } catch { /* leave empty */ }
    const el = document.getElementById("sec-models"); if (!el) return;
    const head = el.querySelector(".card-h").outerHTML;
    el.innerHTML = head + (ms.length ? `<div class="kvrow" style="border:0;padding:12px 18px 0"><div><div class="note">Models</div><b>${ms.length}</b></div><div><div class="note">Median upside</div><b>${signed(medOf(ms.map((m) => m.upside)))}</b></div>
        <div><div class="note">Rated Buy</div><b>${pct(ms.filter((m) => m.rating === "Buy").length / ms.length, 0)}</b></div><div><div class="note">Median WACC</div><b>${pct(medOf(ms.map((m) => m.wacc)))}</b></div></div>
      <div class="scroll"><table><thead><tr><th>Company</th><th class="r">Target</th><th class="r">Price</th><th class="r">Upside</th><th>Rating</th><th class="r hide-sm">EV/EBITDA</th><th class="hide-sm">Built</th></tr></thead><tbody>
        ${ms.sort((a, b) => (b.upside ?? -9) - (a.upside ?? -9)).map((m) => `<tr><td>${starBtn(m.ticker)}<a class="tk" href="#/m/${esc(m.ticker)}">${esc(m.ticker)}</a><span class="co">${esc(m.name)}</span></td><td class="r num">${usd(m.target)}</td><td class="r num">${usd(m.price)}</td><td class="r num">${signed(m.upside)}</td><td>${pill(m.rating)}</td><td class="r num hide-sm">${mult(m.ev_ebitda)}</td><td class="hide-sm note">${ago(m.generated_at)}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="note" style="padding:12px 18px">No models in ${esc(name)} yet. <a href="#/">Build the first one</a>.</p>`);
  }

  // ------------------------------------------------------------- site errors (owner only)
  async function loadErrors() {
    const el = document.getElementById("err-list"); if (!el) return;
    const base = await apiBase();
    let items = [];
    try { const r = await fetch(base + "/api/error", { headers: { "X-Owner-Key": ownerKey() } }); if (r.ok) items = (await r.json()).items || []; } catch { return; }
    const groups = {}; items.forEach((e) => { const g = (groups[e.msg] ||= { msg: e.msg, n: 0, ids: [], last: e.at, ex: e }); g.n++; g.ids.push(e.id); if (e.at > g.last) { g.last = e.at; g.ex = e; } });
    const gs = Object.values(groups).sort((a, b) => b.last.localeCompare(a.last));
    el.innerHTML = `<div class="card section"><div class="card-h"><h2>Site errors</h2><span class="note">${items.length ? `${items.length} in the past 30 days` : "none in the past 30 days"}</span></div>
      ${gs.length ? `<div class="scroll"><table><thead><tr><th>Error</th><th class="r">Times</th><th>Page</th><th class="hide-sm">Last seen</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
        ${gs.map((g, i) => `<tr><td><details><summary>${esc(g.msg)}</summary><pre class="err-pre">${esc(g.ex.src || "")}${g.ex.line ? ":" + g.ex.line : ""}
${esc(g.ex.stack || "")}
${esc(g.ex.ua || "")}</pre></details></td><td class="r num">${g.n}</td><td class="note">${esc(g.ex.route || "")}</td><td class="hide-sm note">${ago(g.last)}</td><td class="r"><button class="btn sm" data-err="${i}">Clear</button></td></tr>`).join("")}</tbody></table></div>`
        : `<p class="note" style="padding:12px 18px">If something breaks in a visitor's browser, it shows up here.</p>`}</div>`;
    el.querySelectorAll("[data-err]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      const r = await fetch(base + "/api/error?ids=" + encodeURIComponent(gs[b.dataset.err].ids.join(",")), { method: "DELETE", headers: { "X-Owner-Key": ownerKey() } });
      if (r.ok) setTimeout(loadErrors, 800); else b.disabled = false;
    }));
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
      <div id="fb-list"></div>
      <div id="err-list"></div>
      <div id="lib-body"></div>`;
    loadFeedback(); loadErrors();
    let sel = "";
    const q = document.getElementById("lib-q");
    q.addEventListener("input", () => render(q.value, sel));
    app.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { sel = c.dataset.s; app.querySelectorAll(".chip").forEach((z) => z.classList.toggle("on", z === c)); render(q.value, sel); }));
    document.getElementById("lock").addEventListener("click", (e) => { e.preventDefault(); store.set("mb_owner", ""); navLib(); location.hash = "#/"; });
    render("", "");
  }
  const FB_KIND = { number: "A number looks wrong", peer: "A peer doesn't fit", target: "The target seems off", other: "Something else" };
  async function loadFeedback() {
    const el = document.getElementById("fb-list"); if (!el) return;
    const base = await apiBase();
    let items = [];
    try { const r = await fetch(base + "/api/feedback", { headers: { "X-Owner-Key": ownerKey() } }); if (r.ok) items = (await r.json()).items || []; } catch { return; }
    el.innerHTML = `<div class="card section"><div class="card-h"><h2>Visitor reports</h2><span class="note">${items.length ? items.length + " open · kept 180 days" : "none right now"}</span></div>
      ${items.length ? `<div class="scroll"><table><thead><tr><th>Model</th><th>Problem</th><th>Details</th><th class="hide-sm">Sent</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
        ${items.map((f) => `<tr><td><a class="tk" href="#/m/${esc(f.ticker)}">${esc(f.ticker)}</a>${f.version ? `<span class="co">v${f.version}</span>` : ""}</td><td>${esc(FB_KIND[f.kind] || f.kind)}</td>
          <td>${esc(f.text || "—")}</td><td class="hide-sm note">${ago(f.at)}</td><td class="r"><button class="btn sm" data-fb="${esc(f.id)}">Done</button></td></tr>`).join("")}</tbody></table></div>`
        : `<p class="note" style="padding:12px 18px">When a visitor uses "Something look off?" on a model page, it shows up here.</p>`}</div>`;
    el.querySelectorAll("[data-fb]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      const r = await fetch(base + "/api/feedback?id=" + encodeURIComponent(b.dataset.fb), { method: "DELETE", headers: { "X-Owner-Key": ownerKey() } });
      if (r.ok) loadFeedback(); else b.disabled = false;
    }));
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
      <p class="muted">Model Builder turns a ticker into a full analyst-style Excel model in about a minute, with no server of my own to run.</p>
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
  // site settings load alongside the first page instead of before it
  let INDEX_P = null;
  function bootIndex() {
    if (INDEX_P) return INDEX_P;
    INDEX_P = getJSON("data/index.json", Date.now().toString().slice(0, -5))
      .then((x) => { INDEX = x; if (x.generated_at) DATA_V = String(x.generated_at).replace(/\D/g, "").slice(0, 12); })
      .catch(() => { INDEX = { coverage: [], site: {}, generated_at: "— first refresh pending" }; })
      .then(() => {
        const site = INDEX.site || {}, fb = document.getElementById("foot-btns");
        if (fb && site.portfolio) fb.insertAdjacentHTML("beforeend", `<a class="btn sm" href="${esc(site.portfolio)}" target="_blank" rel="noopener">Portfolio ↗</a>`);
        document.getElementById("foot-right").textContent = INDEX.owner ? "© " + new Date().getFullYear() + " " + INDEX.owner : "";
        beacon();
        return INDEX;
      });
    return INDEX_P;
  }
  async function route() {
    hideTip();
    bootIndex(); apiBase();
    const h = location.hash.replace(/^#\/?/, "");
    if (h === "built" || h === "about") await bootIndex();
    navLib();
    if (!window.__mbChrome) { window.__mbChrome = true; initChrome(); }
    const TABS = ["method", "library", "built", "update", "portfolio", "quiz", "screener", "funds", "track", "watch", "about", "sectors", "earnings", "index"];
    const hb = h.split("?")[0];
    const tab = TABS.includes(hb) ? hb : h.startsWith("funds/") ? "funds" : h.startsWith("sector/") ? "sectors" : h.startsWith("earnings/") ? "earnings" : h ? "__" : "";
    document.querySelectorAll("nav a").forEach((a) => { const on = a.getAttribute("href") === "#/" + tab; a.classList.toggle("on", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    window.scrollTo(0, 0);
    GL_SEEN = new Set(); watchNav();
    if (window.__mbRouted) { app.focus({ preventScroll: true }); } window.__mbRouted = true;   // screen readers start at the new page
    if (!h || h === "coverage" || h === "fund") { if (h) history.replaceState(null, "", "#/"); generateView(); }
    else if (h === "library") libraryView();
    else if (h === "owner") ownerView();
    else if (h === "method") method();
    else if (h === "built") built();
    else if (h === "update") updateView();
    else if (h === "portfolio") portfolioView();
    else if (hb === "screener") screenerView(h.split("?")[1] || "");
    else if (h === "about") aboutView();
    else if (h === "index") indexView();
    else if (h === "earnings" || h.startsWith("earnings/")) earningsView(decodeURIComponent(h.split("/")[1] || ""));
    else if (h === "sectors") sectorsView();
    else if (h.startsWith("sector/")) sectorPage(decodeURIComponent(h.slice(7)));
    else if (h === "funds") fundsView();
    else if (h.startsWith("funds/")) fundPage(decodeURIComponent(h.slice(6)));
    else if (h === "quiz") quizView();
    else if (h === "track") trackView();
    else if (h === "watch") watchView();
    else if (h === "compare" || h.startsWith("compare/")) comparePage(decodeURIComponent(h.slice(8)));
    else if (h.startsWith("m/")) modelPage(decodeURIComponent(h.slice(2)));
    else modelPage(decodeURIComponent(h));
  }
  window.addEventListener("hashchange", route);
  route();
})();
