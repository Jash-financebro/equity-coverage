// Model Builder API - Cloudflare Worker.
// POST /api/generate {ticker}      validate NYSE / Nasdaq ticker, dedupe, rate-limit, dispatch the GitHub build
// GET  /api/status?ticker=T&since= queued / running / ready / failed (+ model when ready)
// GET  /api/recent                 models generated in the past 24 hours + most-generated this week (public, light)
// GET  /api/model?ticker=T         one model's full meta (summary page, sliders, sources)
// GET  /api/library                full library index - owner only (X-Owner-Key header)
// GET  /m/T                        share page with Open Graph tags, redirects to the model page
// GET  /api/insights               track record, sector snapshot, totals (aggregates only, no tickers)
// GET  /api/quotes?t=A,B           practice-portfolio data: price, market cap, P/E, yield, beta, 1y weekly closes (+SPY)
// POST /api/update?ticker=T        upload an existing model (.xlsx) to be refreshed; returns {id, token}
// GET  /api/update/status|file/ID  poll / download (token required). Runner endpoints use the GH token.
// Uploads live in KV (binding UPLOADS) for 6 hours and never touch the public repo.
// GET  /api/track                calls graded 30+ days after they were made, plus open calls still being tracked
// GET  /api/models?t=A,B           summary of the models for a list of tickers (watchlist)
// POST /api/feedback               "this looks off" report for a model; GET / DELETE are owner only
// GET  /api/filing?t=T             newest 10-K / 10-Q on SEC EDGAR for a model's company (stale-model banner)
// GET  /api/sector?name=S          models in one sector (sector pages)
// POST /api/error                  browser error report; GET / DELETE are owner only
// GET  /api/earnings?t=T           earnings notes (from the company's 8-K) if built; POST starts a build
// PUT  /api/earnings/result?t=T    runner stores the notes (Bearer GH_TOKEN)
// GET  /api/health
// Secrets/vars: GH_TOKEN (fine-grained PAT: Actions RW, Contents R), GH_REPO, ALLOWED_ORIGINS (comma list)

const WORKFLOW = "generate.yml";
const FRESH_HOURS = 6;          // reuse a model generated within this window instead of rebuilding
const PER_IP_PER_HOUR = 8;
const DAILY_CAP = 150;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === "/api/health") return json({ ok: true, repo: env.GH_REPO }, 200, cors);
      if (url.pathname === "/api/library" && req.method === "GET") {
        if (!(await isOwner(req, env))) return json({ error: "The library is private." }, 403, cors);
        return json(await indexFresh(env), 200, cors);
      }
      if (url.pathname === "/api/quotes" && req.method === "GET") return json(await quotes(url, env, ctx), 200, cors, 300);
      if (url.pathname === "/api/insights" && req.method === "GET") return json(await insights(env, ctx), 200, cors, 300);
      if (url.pathname.startsWith("/api/update")) return await updateRoutes(req, url, env, ctx, cors);
      if (url.pathname === "/api/track" && req.method === "GET") return json(await track(env, ctx), 200, cors, 300);
      if (url.pathname === "/api/models" && req.method === "GET") return json(await modelsFor(url, env, ctx), 200, cors, 60);
      if (url.pathname === "/api/feedback") return await feedbackRoutes(req, url, env, ctx, cors);
      if (url.pathname === "/api/error") return await errorRoutes(req, url, env, ctx, cors);
      if (url.pathname.startsWith("/api/earnings")) return await earningsRoutes(req, url, env, ctx, cors);
      if (url.pathname === "/api/filing" && req.method === "GET") return json(await latestFiling(url, env, ctx), 200, cors, 3600);
      if (url.pathname === "/api/sector" && req.method === "GET") return json(await sectorModels(url, env, ctx), 200, cors, 120);
      if (url.pathname === "/api/recent" && req.method === "GET") return json(await recent(env, ctx), 200, cors, 30);
      if (url.pathname === "/api/model" && req.method === "GET") return json(await model(url, env, ctx), 200, cors, 60);
      if (url.pathname.startsWith("/m/") && req.method === "GET") return sharePage(url, env, ctx);
      if (url.pathname === "/api/status" && req.method === "GET") return json(await status(url, env, ctx), 200, cors);
      if (url.pathname === "/api/generate" && req.method === "POST") return json(await generate(req, env, ctx), 200, cors);
      return json({ error: "not found" }, 404, cors);
    } catch (e) {
      const code = e.status || 500;
      return json({ error: e.message || String(e) }, code, cors);
    }
  },
};

// ------------------------------------------------------------------ helpers
function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
  const ok = allowed.includes("*") || allowed.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  return { "Access-Control-Allow-Origin": ok ? origin || "*" : allowed[0], "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
           "Access-Control-Allow-Headers": "Content-Type, X-Owner-Key, X-Filename", "Access-Control-Expose-Headers": "Content-Disposition", Vary: "Origin" };
}
function json(obj, status, headers, maxAge = 0) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json",
    "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" } });
}
function fail(msg, status = 400) { const e = new Error(msg); e.status = status; throw e; }

async function gh(env, path, init = {}) {
  const r = await fetch(`https://api.github.com${path}`, { ...init, headers: { Authorization: `Bearer ${env.GH_TOKEN}`,
    Accept: init.accept || "application/vnd.github+json", "User-Agent": "equity-coverage-worker",
    "X-GitHub-Api-Version": "2022-11-28", ...(init.headers || {}) } });
  return r;
}

async function cached(ctx, key, ttl, loader) {
  const cache = caches.default, req = new Request(`https://cache.local/${key}`);
  const hit = await cache.match(req);
  if (hit) return hit.json();
  const val = await loader();
  ctx.waitUntil(cache.put(req, new Response(JSON.stringify(val), { headers: { "Cache-Control": `max-age=${ttl}` } })));
  return val;
}

async function rawFile(env, path) {
  const r = await gh(env, `/repos/${env.GH_REPO}/contents/${path}`, { accept: "application/vnd.github.raw" });
  if (r.status === 404) return null;
  if (!r.ok) fail(`GitHub ${r.status} reading ${path}`, 502);
  return r.json();
}

const listed = (env, ctx) => cached(ctx, "universe-v2", 6 * 3600, async () => {
  const list = (await rawFile(env, "site/universe/search.json")) || [];
  return Object.fromEntries(list.map(([t, n, s, x]) => [t, { name: n, sector: s, exchange: x || "NYSE" }]));
});
const indexFresh = (env) => rawFile(env, "library/index.json").then((x) => x || { models: [], sectors: {}, count: 0 });
const library = (env, ctx) => cached(ctx, "library-v1", 20, () => indexFresh(env));

async function runsFor(env, ticker, sinceIso, workflow = WORKFLOW) {
  const r = await gh(env, `/repos/${env.GH_REPO}/actions/workflows/${workflow}/runs?per_page=30&event=workflow_dispatch`);
  if (!r.ok) fail(`GitHub ${r.status} listing runs`, 502);
  const { workflow_runs = [] } = await r.json();
  const title = /^(Update|Earnings) /.test(ticker) ? ticker : `Generate ${ticker}`;
  return workflow_runs.filter((w) => w.display_title === title && (!sinceIso || w.created_at >= sinceIso));
}

async function rateLimit(req, ctx) {
  const ip = req.headers.get("CF-Connecting-IP") || "anon";
  const hour = new Date().toISOString().slice(0, 13);
  const key = new Request(`https://rl.local/${encodeURIComponent(ip)}/${hour}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  const n = hit ? Number(await hit.text()) : 0;
  if (n >= PER_IP_PER_HOUR) fail(`Rate limit: ${PER_IP_PER_HOUR} new models per hour. Try again later.`, 429);
  ctx.waitUntil(cache.put(key, new Response(String(n + 1), { headers: { "Cache-Control": "max-age=3600" } })));
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function isOwner(req, env) {
  const k = req.headers.get("X-Owner-Key") || "";
  return !!(k && env.OWNER_KEY_SHA256 && (await sha256(k)) === env.OWNER_KEY_SHA256);
}
const slim = (m) => ({ ticker: m.ticker, name: m.name, sector: m.sector, industry: m.industry, exchange: m.exchange,
  price: m.price, target: m.target, upside: m.upside, rating: m.rating, scenarios: m.scenarios,
  generated_at: m.generated_at, version: m.version, times_generated: m.times_generated, files: m.files, wacc: m.wacc,
  peers: m.peers, dcf_value: m.dcf_value, comps_value: m.comps_value });
const metaPath = (m) => {
  const u = (m.files && m.files.xlsx) || "";
  const i = u.indexOf("/main/");
  return i < 0 ? null : u.slice(i + 6, u.lastIndexOf("/") + 1) + "meta.json";
};

// ------------------------------------------------------------------ routes
const median = (xs) => { const a = xs.filter((v) => typeof v === "number" && isFinite(v)).sort((p, q) => p - q);
  if (!a.length) return null; const k = a.length >> 1; return a.length % 2 ? a[k] : (a[k - 1] + a[k]) / 2; };

async function insights(env, ctx) {
  const idx = await library(env, ctx);
  const ms = idx.models || [];
  const tracks = ms.map((m) => m.track).filter(Boolean);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const byRating = {};
  for (const t of tracks) { const r = (byRating[t.rating] ||= { n: 0, hits: 0, rets: [] }); r.n++; r.hits += t.hit ? 1 : 0; r.rets.push(t.ret); }
  const sectors = {};
  for (const m of ms) (sectors[m.sector] ||= []).push(m);
  return {
    updated_at: idx.updated_at,
    totals: { companies: ms.length, generations: ms.reduce((a, m) => a + (m.times_generated || 1), 0),
              sectors: Object.keys(sectors).length },
    track: { scored: tracks.length, hit_rate: tracks.length ? tracks.filter((t) => t.hit).length / tracks.length : null,
             avg_return: avg(tracks.map((t) => t.ret)), avg_excess: avg(tracks.map((t) => t.excess).filter((v) => v != null)),
             avg_days: avg(tracks.map((t) => t.days)),
             by_rating: Object.fromEntries(Object.entries(byRating).map(([k, v]) => [k, { n: v.n, hit_rate: v.hits / v.n, avg_return: avg(v.rets) }])) },
    sectors: Object.entries(sectors).map(([name, xs]) => ({ name, n: xs.length, median_upside: median(xs.map((m) => m.upside)),
      buy_share: xs.filter((m) => m.rating === "Buy").length / xs.length, median_ev_ebitda: median(xs.map((m) => m.ev_ebitda)),
      median_wacc: median(xs.map((m) => m.wacc)), median_growth: median(xs.map((m) => m.growth_next)) }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
  };
}

// ------------------------------------------------------------------ quotes for the practice portfolio (Yahoo Finance)
const YUA = { "User-Agent": "Mozilla/5.0 (ModelBuilder)" };
async function yahooAuth(ctx) {
  return cached(ctx, "yahoo-crumb-v1", 6 * 3600, async () => {
    const r = await fetch("https://fc.yahoo.com", { headers: YUA, redirect: "manual" });
    const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
    const c = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { ...YUA, cookie } });
    const crumb = c.ok ? (await c.text()).trim() : "";
    return { cookie, crumb };
  });
}
async function quoteOne(t, sector, ctx) {
  return cached(ctx, `quote-v2-${t}`, 1800, async () => {
    const out = { ticker: t, sector };
    try {
      const ch = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=1y&interval=1wk&events=div`, { headers: YUA }).then((r) => r.json());
      const res = ch.chart?.result?.[0] || {};
      const ts = res.timestamp || [], cl = res.indicators?.quote?.[0]?.close || [];
      out.closes = ts.map((x, i) => [new Date(x * 1000).toISOString().slice(0, 10), cl[i]]).filter((p) => p[1] != null).map(([d, c]) => [d, Math.round(c * 100) / 100]);
      out.price = res.meta?.regularMarketPrice ?? out.closes.at(-1)?.[1] ?? null;
      out.name = res.meta?.longName || res.meta?.shortName || null;
      const divs = Object.values(res.events?.dividends || {});
      out.div_12m = divs.filter((dv) => dv.date * 1000 > Date.now() - 365 * 864e5).reduce((a, dv) => a + (dv.amount || 0), 0);
    } catch (_) { /* leave blank */ }
    try {
      const { cookie, crumb } = await yahooAuth(ctx);
      const q = await fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(t)}?modules=price,summaryDetail,defaultKeyStatistics&crumb=${encodeURIComponent(crumb)}`,
        { headers: { ...YUA, cookie } }).then((r) => r.json());
      const r0 = q.quoteSummary?.result?.[0] || {}, sd = r0.summaryDetail || {}, ks = r0.defaultKeyStatistics || {}, pr = r0.price || {};
      const raw = (o) => (o && typeof o === "object" ? o.raw ?? null : o ?? null);
      Object.assign(out, { name: pr.longName || pr.shortName || out.name, market_cap: raw(pr.marketCap) ?? raw(sd.marketCap),
        pe: raw(sd.trailingPE), forward_pe: raw(sd.forwardPE), div_yield: raw(sd.dividendYield) ?? raw(sd.trailingAnnualDividendYield) ?? 0,
        beta: raw(sd.beta) ?? raw(ks.beta), high_52w: raw(sd.fiftyTwoWeekHigh), low_52w: raw(sd.fiftyTwoWeekLow) });
      if (!out.price) out.price = raw(pr.regularMarketPrice);
    } catch (_) { /* summary optional */ }
    return out;
  });
}
function weeklyReturns(closes) {
  const m = {};
  for (let i = 1; i < closes.length; i++) if (closes[i - 1][1]) m[closes[i][0]] = closes[i][1] / closes[i - 1][1] - 1;
  return m;
}
function betaOf(r, mkt) {
  const ks = Object.keys(r).filter((k) => k in mkt);
  if (ks.length < 20) return null;
  const a = ks.map((k) => r[k]), b = ks.map((k) => mkt[k]);
  const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
  let cov = 0, vb = 0;
  for (let i = 0; i < a.length; i++) { cov += (a[i] - ma) * (b[i] - mb); vb += (b[i] - mb) ** 2; }
  return vb ? Math.round((cov / vb) * 100) / 100 : null;
}
async function quotes(url, env, ctx) {
  const want = [...new Set(String(url.searchParams.get("t") || "").toUpperCase().split(/[,\s]+/).map((x) => x.replace(/[./]/g, "-")).filter(Boolean))];
  if (!want.length) fail("Add at least one ticker.");
  if (want.length > 12) fail("Up to 12 tickers at a time.");
  const list = await listed(env, ctx);
  const bad = want.filter((t) => !list[t]);
  if (bad.length) fail(`Not NYSE or Nasdaq tickers we know: ${bad.join(", ")}`, 404);
  const [qs, spy, stats] = await Promise.all([Promise.all(want.map((t) => quoteOne(t, list[t].sector, ctx))), quoteOne("SPY", "Index", ctx),
    cached(ctx, "stats-v1", 6 * 3600, async () => (await rawFile(env, "site/universe/stats.json")) || { data: {} })]);
  const spyRet = weeklyReturns(spy.closes || []);
  qs.forEach((q) => {
    q.name = q.name || list[q.ticker].name;
    // Yahoo's summary endpoint often refuses cloud servers: fill the gaps from SEC data and the price history
    const [eps, sharesMm] = (stats.data || {})[q.ticker] || [];
    if (q.pe == null && q.price && eps) { q.pe = eps > 0 ? q.price / eps : null; q.pe_source = "price ÷ latest 10-K diluted EPS"; }
    if (q.market_cap == null && q.price && sharesMm) q.market_cap = q.price * sharesMm * 1e6;
    if ((q.div_yield == null || q.div_yield === 0) && q.price && q.div_12m) q.div_yield = q.div_12m / q.price;
    if (q.beta == null) { q.beta = betaOf(weeklyReturns(q.closes || []), spyRet); if (q.beta != null) q.beta_source = "1y weekly vs S&P 500"; }
  });
  return { as_of: new Date().toISOString(), quotes: qs, spy: spy.closes || [] };
}

// ------------------------------------------------------------------ model updates (upload an existing workbook)
const UPDATE_WORKFLOW = "update-model.yml";
const MAX_UPLOAD = 10 * 1024 * 1024;
const UPLOAD_TTL = 6 * 3600;
const rid = (n = 16) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const isRunner = (req, env) => (req.headers.get("Authorization") || "") === `Bearer ${env.GH_TOKEN}`;

async function updateRoutes(req, url, env, ctx, cors) {
  if (!env.UPLOADS) return json({ error: "Model updates aren't switched on yet (upload storage is not set up)." }, 503, cors);
  const parts = url.pathname.split("/").filter(Boolean); // api, update, [action], [id]
  const [, , action, id] = parts;
  if (!action && req.method === "POST") return json(await startUpdate(req, url, env, ctx), 200, cors);
  if (!id || !/^[0-9a-f]{32}$/.test(id)) return json({ error: "bad id" }, 400, cors);
  const meta = await env.UPLOADS.get(`meta:${id}`, "json");
  if (!meta) return json({ error: "This update has expired. Upload the model again." }, 404, cors);
  // runner side (GitHub Actions, authenticated with the dispatch token)
  if (action === "input" && req.method === "GET") {
    if (!isRunner(req, env)) return json({ error: "forbidden" }, 403, cors);
    const buf = await env.UPLOADS.get(`in:${id}`, "arrayBuffer");
    if (!buf) return json({ error: "gone" }, 404, cors);
    return new Response(buf, { headers: { "Content-Type": "application/octet-stream", "X-Ticker": meta.ticker, "X-Filename": meta.filename } });
  }
  if (action === "result" && req.method === "PUT") {
    if (!isRunner(req, env)) return json({ error: "forbidden" }, 403, cors);
    const part = url.searchParams.get("part");
    if (part === "file") await env.UPLOADS.put(`out:${id}`, await req.arrayBuffer(), { expirationTtl: UPLOAD_TTL });
    else await env.UPLOADS.put(`sum:${id}`, await req.text(), { expirationTtl: UPLOAD_TTL });
    if (part !== "file") await env.UPLOADS.delete(`in:${id}`);
    return json({ ok: true }, 200, cors);
  }
  // visitor side
  if (url.searchParams.get("token") !== meta.token) return json({ error: "forbidden" }, 403, cors);
  if (action === "status") {
    const sum = await env.UPLOADS.get(`sum:${id}`, "json");
    if (sum) return json({ status: sum.status === "failed" ? "failed" : "ready", summary: sum }, 200, cors);
    const runs = await runsFor(env, `Update ${id}`, meta.created, UPDATE_WORKFLOW);
    const w = runs[0];
    if (w && w.status === "completed" && w.conclusion !== "success") return json({ status: "failed", summary: { error: "The update job failed.", run_url: w.html_url } }, 200, cors);
    return json({ status: w ? (w.status === "in_progress" ? "running" : "queued") : "queued" }, 200, cors);
  }
  if (action === "file") {
    const buf = await env.UPLOADS.get(`out:${id}`, "arrayBuffer");
    if (!buf) return json({ error: "Not ready" }, 404, cors);
    const base = String(meta.filename || "model.xlsx").replace(/\.xlsx?$/i, "").replace(/[^A-Za-z0-9 _.-]/g, "_").slice(0, 80);
    return new Response(buf, { headers: { ...cors, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base}_updated.xlsx"`, "Cache-Control": "no-store" } });
  }
  return json({ error: "not found" }, 404, cors);
}

async function startUpdate(req, url, env, ctx) {
  const ticker = String(url.searchParams.get("ticker") || "").toUpperCase().trim().replace(/[./]/g, "-");
  if (!/^[A-Z][A-Z0-9-]{0,6}$/.test(ticker)) fail("Enter the ticker the model is for, e.g. KO");
  const list = await listed(env, ctx);
  if (!list[ticker]) fail(`${ticker} isn't an NYSE- or Nasdaq-listed SEC filer in our universe.`, 404);
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) fail("Choose an .xlsx file to upload.");
  if (buf.byteLength > MAX_UPLOAD) fail("That file is over 10 MB. Remove pasted data or images and try again.", 413);
  const sig = new Uint8Array(buf.slice(0, 4));
  if (!(sig[0] === 0x50 && sig[1] === 0x4b)) fail("That doesn't look like an .xlsx workbook (Excel 2007 or later).", 415);
  await rateLimit(req, ctx);
  const id = rid(), token = rid();
  const filename = String(req.headers.get("X-Filename") || "model.xlsx").slice(0, 120);
  await env.UPLOADS.put(`in:${id}`, buf, { expirationTtl: UPLOAD_TTL });
  await env.UPLOADS.put(`meta:${id}`, JSON.stringify({ ticker, filename, token, created: new Date(Date.now() - 5000).toISOString() }), { expirationTtl: UPLOAD_TTL });
  const d = await gh(env, `/repos/${env.GH_REPO}/actions/workflows/${UPDATE_WORKFLOW}/dispatches`, {
    method: "POST", body: JSON.stringify({ ref: "main", inputs: { id, ticker } }), headers: { "Content-Type": "application/json" } });
  if (d.status !== 204) {
    let msg = ""; try { msg = (await d.json()).message || ""; } catch (_) {}
    fail(`Could not start the update (GitHub ${d.status}${msg ? ": " + msg : ""})`, 502);
  }
  return { status: "queued", id, token, ticker, name: list[ticker].name };
}

async function track(env, ctx) {
  const idx = await library(env, ctx);
  const ms = idx.models || [];
  const summary = (await insights(env, ctx)).track;
  const scored = ms.filter((m) => m.track).map((m) => ({ ticker: m.ticker, name: m.name, sector: m.sector, ...m.track }))
    .sort((a, b) => (b.excess ?? b.ret ?? 0) - (a.excess ?? a.ret ?? 0));
  const plus30 = (d) => new Date(Date.parse(d) + 30 * 864e5).toISOString().slice(0, 10);
  const open = ms.filter((m) => m.price && m.target && m.generated_at)
    .map((m) => ({ ticker: m.ticker, name: m.name, sector: m.sector, rating: m.rating, call_date: m.generated_at.slice(0, 10),
                   call_price: m.price, call_target: m.target, graded_on: plus30(m.generated_at) }))
    .sort((a, b) => b.call_date.localeCompare(a.call_date) || a.ticker.localeCompare(b.ticker));
  // forecast vs actual: the model's rules re-run on data from one and two years earlier
  const bt = ms.flatMap((m) => (m.backtest || []).map((b) => ({ ticker: m.ticker, name: m.name, sector: m.sector, ...b })));
  const abs = bt.map((b) => Math.abs(b.rev_err)).filter((v) => isFinite(v));
  const gms = bt.map((b) => b.gm_err_pts).filter((v) => typeof v === "number" && isFinite(v)).map(Math.abs);
  const forecast = { n: bt.length, companies: new Set(bt.map((b) => b.ticker)).size, median_abs_rev_err: median(abs),
    within_5: abs.length ? abs.filter((v) => v <= 0.05).length / abs.length : null,
    within_10: abs.length ? abs.filter((v) => v <= 0.10).length / abs.length : null,
    too_high: abs.length ? bt.filter((b) => b.rev_err > 0).length / bt.length : null, median_abs_gm_pts: median(gms),
    rows: bt.sort((a, b) => Math.abs(a.rev_err) - Math.abs(b.rev_err)) };
  return { updated_at: idx.updated_at, summary, scored, open: open.slice(0, 48), open_count: open.length,
           first_grade: open.length ? open.map((o) => o.graded_on).sort()[0] : null, forecast };
}

async function modelsFor(url, env, ctx) {
  const want = [...new Set(String(url.searchParams.get("t") || "").toUpperCase().split(/[,\s]+/).map((x) => x.replace(/[./]/g, "-")).filter(Boolean))].slice(0, 40);
  const idx = await library(env, ctx);
  return { models: idx.models.filter((m) => want.includes(m.ticker)).map((m) => ({ ...slim(m), mark: m.mark || null })) };
}

async function latestFiling(url, env, ctx) {
  const t = String(url.searchParams.get("t") || "").toUpperCase().replace(/[./]/g, "-");
  const m = (await library(env, ctx)).models.find((x) => x.ticker === t);
  if (!m || !m.cik) fail("No model for that ticker.", 404);
  return cached(ctx, `filing-v1-${m.cik}`, 6 * 3600, async () => {
    const cik = String(m.cik).padStart(10, "0");
    const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { "User-Agent": env.SEC_USER_AGENT || "Model Builder admin@example.com", Accept: "application/json" } });
    if (!r.ok) return { ticker: t, latest: null, error: `SEC ${r.status}` };
    const rec = (await r.json()).filings?.recent || {};
    for (let i = 0; i < (rec.form || []).length; i++) {
      if (["10-K", "10-K/A", "10-Q", "10-Q/A"].includes(rec.form[i])) {
        return { ticker: t, latest: { form: rec.form[i], filed: rec.filingDate[i], accession: rec.accessionNumber[i], period: rec.reportDate[i],
          url: `https://www.sec.gov/Archives/edgar/data/${Number(m.cik)}/${rec.accessionNumber[i].replace(/-/g, "")}/${rec.primaryDocument[i]}` } };
      }
    }
    return { ticker: t, latest: null };
  });
}

async function sectorModels(url, env, ctx) {
  const name = String(url.searchParams.get("name") || "");
  const ms = (await library(env, ctx)).models.filter((m) => m.sector === name);
  return { sector: name, models: ms.map((m) => ({ ...slim(m), ev_ebitda: m.ev_ebitda, growth_next: m.growth_next })) };
}

async function errorRoutes(req, url, env, ctx, cors) {
  if (!env.UPLOADS) fail("Error log isn't set up yet.", 503);
  if (req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const msg = String(b.msg || "").slice(0, 300);
    if (!msg) fail("msg required");
    const ip = req.headers.get("CF-Connecting-IP") || "anon", hour = new Date().toISOString().slice(0, 13);
    const key = new Request(`https://err.local/${encodeURIComponent(ip)}/${hour}`), cache = caches.default;
    const hit = await cache.match(key), n = hit ? Number(await hit.text()) : 0;
    if (n >= 20) return json({ ok: true, dropped: true }, 200, cors);
    ctx.waitUntil(cache.put(key, new Response(String(n + 1), { headers: { "Cache-Control": "max-age=3600" } })));
    const at = new Date().toISOString();
    await env.UPLOADS.put(`err:${at}:${rid(3)}`, JSON.stringify({ msg, src: String(b.src || "").slice(0, 200), line: Number(b.line) || null,
      stack: String(b.stack || "").slice(0, 1200), route: String(b.route || "").slice(0, 80), ua: String(req.headers.get("User-Agent") || "").slice(0, 160),
      build: String(b.build || "").slice(0, 40), at }), { expirationTtl: 30 * 86400 });
    return json({ ok: true }, 200, cors);
  }
  if (!(await isOwner(req, env))) return json({ error: "Owner only." }, 403, cors);
  if (req.method === "GET") {
    const keys = (await env.UPLOADS.list({ prefix: "err:", limit: 300 })).keys.map((k) => k.name).sort().reverse();
    const items = await Promise.all(keys.map(async (id) => ({ id, ...(JSON.parse((await env.UPLOADS.get(id)) || "{}")) })));
    return json({ items }, 200, cors);
  }
  if (req.method === "DELETE") {
    const ids = (url.searchParams.get("ids") || "").split(",").filter((x) => x.startsWith("err:")).slice(0, 300);
    await Promise.all(ids.map((id) => env.UPLOADS.delete(id)));
    return json({ ok: true, deleted: ids.length }, 200, cors);
  }
  fail("method not allowed", 405);
}

const EARN_WORKFLOW = "earnings.yml";
const EARN_TTL = 10 * 86400, EARN_FRESH_H = 8;
async function earningsRoutes(req, url, env, ctx, cors) {
  if (!env.UPLOADS) fail("Earnings notes aren't set up yet.", 503);
  const t = String(url.searchParams.get("t") || "").toUpperCase().trim().replace(/[./]/g, "-");
  if (!/^[A-Z][A-Z0-9-]{0,6}$/.test(t)) fail("Enter a ticker, e.g. KO");
  if (url.pathname === "/api/earnings/result") {
    if (req.method !== "PUT" || !isRunner(req, env)) return json({ error: "forbidden" }, 403, cors);
    const body = await req.text();
    let d; try { d = JSON.parse(body); } catch { fail("bad json"); }
    if (d.status === "ok") await env.UPLOADS.put(`earn:${t}`, body, { expirationTtl: EARN_TTL });
    else await env.UPLOADS.put(`earnfail:${t}`, body, { expirationTtl: 3600 });
    return json({ ok: true }, 200, cors);
  }
  const notes = await env.UPLOADS.get(`earn:${t}`, "json");
  const ageH = notes ? (Date.now() - Date.parse(notes.built_at)) / 36e5 : Infinity;
  const since = new Date(Date.now() - 10 * 60e3).toISOString();
  if (req.method === "GET") {
    if (notes) return json({ status: "ready", notes, age_hours: ageH }, 200, cors);
    const failed = await env.UPLOADS.get(`earnfail:${t}`, "json");
    const w = (await runsFor(env, `Earnings ${t}`, since, EARN_WORKFLOW))[0];
    if (w && w.status !== "completed") return json({ status: w.status === "in_progress" ? "running" : "queued", step: null }, 200, cors);
    // finished a moment ago: storage can take up to a minute to show the new notes everywhere
    if (w && w.conclusion === "success" && Date.now() - Date.parse(w.updated_at) < 90e3) return json({ status: "finishing" }, 200, cors);
    if (failed) return json({ status: "failed", error: failed.error || "Couldn't read the filings." }, 200, cors);
    return json({ status: "missing" }, 200, cors);
  }
  if (req.method !== "POST") fail("method not allowed", 405);
  const list = await listed(env, ctx);
  if (!list[t]) fail(`${t} isn't an NYSE- or Nasdaq-listed SEC filer in our universe.`, 404);
  if (notes && ageH < EARN_FRESH_H) return json({ status: "ready", notes, age_hours: ageH }, 200, cors);
  const live = (await runsFor(env, `Earnings ${t}`, since, EARN_WORKFLOW)).find((w) => w.status !== "completed");
  if (live) return json({ status: live.status === "in_progress" ? "running" : "queued", stale: notes || null }, 200, cors);
  const ip = req.headers.get("CF-Connecting-IP") || "anon", hour = new Date().toISOString().slice(0, 13);
  const key = new Request(`https://earn.local/${encodeURIComponent(ip)}/${hour}`), cache = caches.default;
  const hit = await cache.match(key), n = hit ? Number(await hit.text()) : 0;
  if (n >= 20) fail("You've looked up 20 new companies this hour. Try again later.", 429);
  ctx.waitUntil(cache.put(key, new Response(String(n + 1), { headers: { "Cache-Control": "max-age=3600" } })));
  await env.UPLOADS.delete(`earnfail:${t}`);
  const d = await gh(env, `/repos/${env.GH_REPO}/actions/workflows/${EARN_WORKFLOW}/dispatches`, {
    method: "POST", body: JSON.stringify({ ref: "main", inputs: { ticker: t } }), headers: { "Content-Type": "application/json" } });
  if (d.status !== 204) { let msg = ""; try { msg = (await d.json()).message || ""; } catch (_) {} fail(`Could not start (GitHub ${d.status}${msg ? ": " + msg : ""})`, 502); }
  return json({ status: "queued", name: list[t].name, stale: notes || null }, 200, cors);
}

const FEEDBACK_KINDS = ["number", "peer", "target", "other"];
async function feedbackRoutes(req, url, env, ctx, cors) {
  if (!env.UPLOADS) fail("Feedback isn't set up yet.", 503);
  if (req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    if (b.website) return json({ ok: true }, 200, cors);           // spam trap: real visitors never fill this hidden field
    const ticker = String(b.ticker || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 8);
    const kind = FEEDBACK_KINDS.includes(b.kind) ? b.kind : "other";
    const text = String(b.text || "").trim().slice(0, 1000);
    if (!ticker) fail("ticker required");
    if (!text && kind === "other") fail("Tell us what looks off.");
    const ip = req.headers.get("CF-Connecting-IP") || "anon", hour = new Date().toISOString().slice(0, 13);
    const key = new Request(`https://fb.local/${encodeURIComponent(ip)}/${hour}`), cache = caches.default;
    const hit = await cache.match(key), n = hit ? Number(await hit.text()) : 0;
    if (n >= 6) fail("Thanks, we've got several reports from you this hour. Try again later.", 429);
    ctx.waitUntil(cache.put(key, new Response(String(n + 1), { headers: { "Cache-Control": "max-age=3600" } })));
    const at = new Date().toISOString();
    await env.UPLOADS.put(`fb:${at}:${ticker}:${rid(3)}`, JSON.stringify({ ticker, kind, text, version: Number(b.version) || null, at }),
                          { expirationTtl: 180 * 86400 });
    return json({ ok: true }, 200, cors);
  }
  if (!(await isOwner(req, env))) return json({ error: "Owner only." }, 403, cors);
  if (req.method === "GET") {
    const keys = (await env.UPLOADS.list({ prefix: "fb:", limit: 200 })).keys.map((k) => k.name).sort().reverse();
    const items = await Promise.all(keys.map(async (id) => ({ id, ...(JSON.parse((await env.UPLOADS.get(id)) || "{}")) })));
    return json({ items }, 200, cors);
  }
  if (req.method === "DELETE") {
    const id = url.searchParams.get("id") || "";
    if (!id.startsWith("fb:")) fail("bad id");
    await env.UPLOADS.delete(id);
    return json({ ok: true }, 200, cors);
  }
  fail("method not allowed", 405);
}

async function recent(env, ctx) {
  const idx = await library(env, ctx);
  const now = Date.now();
  const age = (m) => now - Date.parse(m.generated_at || 0);
  const day = idx.models.filter((m) => age(m) < 24 * 3600e3).map(slim);
  const trending = idx.models.filter((m) => age(m) < 7 * 24 * 3600e3)
    .sort((a, b) => (b.times_generated || 1) - (a.times_generated || 1) || age(a) - age(b)).slice(0, 8).map(slim);
  return { updated_at: idx.updated_at, models: day, trending };
}

async function model(url, env, ctx) {
  const t = String(url.searchParams.get("ticker") || "").toUpperCase().replace(/[./]/g, "-");
  if (!t) fail("ticker required");
  const idx = await library(env, ctx);
  const m = idx.models.find((x) => x.ticker === t);
  if (!m) fail(`No model for ${t} yet. Generate one first.`, 404);
  const p = metaPath(m);
  const meta = p ? await cached(ctx, `meta-${t}-${m.version}`, 3600, () => rawFile(env, p)) : null;
  return meta || m;
}

async function sharePage(url, env, ctx) {
  const t = decodeURIComponent(url.pathname.slice(3)).toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const site = env.SITE_URL || "https://jash-financebro.github.io/equity-coverage/";
  const dest = `${site}#/m/${t}`;
  let m = null;
  try { m = (await library(env, ctx)).models.find((x) => x.ticker === t); } catch (_) { /* fall through */ }
  const e = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const f = (v) => (v == null ? "n/a" : "$" + Number(v).toFixed(2));
  const title = m ? `${m.ticker} · ${f(m.target)} target · ${m.rating}` : `${t} · Model Builder`;
  const desc = m ? `${m.name}: ${m.rating} with a ${f(m.target)} 12-month target (${m.upside >= 0 ? "+" : ""}${(m.upside * 100).toFixed(1)}% vs ${f(m.price)}). Bear / base / bull ${f(m.scenarios?.bear)} / ${f(m.scenarios?.base)} / ${f(m.scenarios?.bull)}. Full Excel model built from SEC 10-K data.`
    : "Full three-statement Excel model, DCF and scenarios for any NYSE or Nasdaq company, built from SEC 10-K data.";
  const img = m?.files?.card || "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:type" content="website"><meta property="og:site_name" content="Model Builder">
<meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(desc)}">
<meta property="og:url" content="${e(url.href)}">${img ? `<meta property="og:image" content="${e(img)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">` : ""}
<meta name="twitter:card" content="${img ? "summary_large_image" : "summary"}"><meta name="twitter:title" content="${e(title)}"><meta name="twitter:description" content="${e(desc)}">${img ? `<meta name="twitter:image" content="${e(img)}">` : ""}
<meta http-equiv="refresh" content="0;url=${e(dest)}"><link rel="canonical" href="${e(dest)}"></head>
<body style="font-family:system-ui;background:#0f1720;color:#e6edf3;padding:40px"><p>Opening <a style="color:#58a6ff" href="${e(dest)}">${e(title)}</a>…</p>
<script>location.replace(${JSON.stringify(dest)})</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}

async function generate(req, env, ctx) {
  const body = await req.json().catch(() => ({}));
  const ticker = String(body.ticker || "").toUpperCase().trim().replace(/[./]/g, "-");
  const force = !!body.force;
  if (!/^[A-Z][A-Z0-9.\-]{0,6}$/.test(ticker)) fail("Enter a ticker symbol, e.g. XOM");
  const list = await listed(env, ctx);
  const co = list[ticker];
  if (!co) fail(`${ticker} isn't an NYSE- or Nasdaq-listed SEC filer in our universe. Funds, trusts and OTC tickers aren't supported.`, 404);

  const idx = await indexFresh(env);
  const have = idx.models.find((m) => m.ticker === ticker);
  if (have && !force && Date.now() - Date.parse(have.generated_at) < FRESH_HOURS * 3600e3) {
    return { status: "ready", cached: true, ticker, model: have };
  }
  const active = (await runsFor(env, ticker)).find((w) => w.status !== "completed");
  if (active) return { status: "running", ticker, since: active.created_at, run_url: active.html_url, name: co.name };

  await rateLimit(req, ctx);
  const today = new Date().toISOString().slice(0, 10);
  const r0 = await gh(env, `/repos/${env.GH_REPO}/actions/workflows/${WORKFLOW}/runs?created=%3E%3D${today}&per_page=1`);
  if (r0.ok && (await r0.json()).total_count >= DAILY_CAP) fail("Daily generation limit reached. Try again tomorrow.", 429);

  const since = new Date(Date.now() - 5000).toISOString();
  const d = await gh(env, `/repos/${env.GH_REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST", body: JSON.stringify({ ref: "main", inputs: { ticker } }), headers: { "Content-Type": "application/json" } });
  if (d.status !== 204) {
    let msg = ""; try { msg = (await d.json()).message || ""; } catch (_) {}
    console.log("dispatch failed", d.status, msg);
    fail(`Could not start the build (GitHub ${d.status}${msg ? ": " + msg : ""})`, 502);
  }
  return { status: "queued", ticker, since, name: co.name, sector: co.sector };
}

async function status(url, env, ctx) {
  const ticker = String(url.searchParams.get("ticker") || "").toUpperCase();
  const since = url.searchParams.get("since") || "";
  if (!ticker) fail("ticker required");
  const idx = await indexFresh(env);
  const m = idx.models.find((x) => x.ticker === ticker);
  if (m && (!since || m.generated_at >= since.slice(0, 19))) return { status: "ready", ticker, model: m };
  const runs = await runsFor(env, ticker, since ? new Date(Date.parse(since) - 60e3).toISOString() : "");
  const w = runs[0];
  if (!w) return { status: "queued", ticker };
  if (w.status !== "completed") {
    let step = null, step_started = null;
    if (w.status === "in_progress") {
      try {
        const j = await gh(env, `/repos/${env.GH_REPO}/actions/runs/${w.id}/jobs`);
        if (j.ok) {
          const st = (((await j.json()).jobs || [])[0]?.steps || []).find((x) => x.status === "in_progress");
          if (st) { step = st.name; step_started = st.started_at; }
        }
      } catch (_) { /* step detail is optional */ }
    }
    return { status: w.status === "in_progress" ? "running" : "queued", ticker, run_url: w.html_url, started: w.run_started_at, step, step_started };
  }
  if (w.conclusion === "success") return { status: "finishing", ticker, run_url: w.html_url };
  return { status: "failed", ticker, run_url: w.html_url, conclusion: w.conclusion };
}
