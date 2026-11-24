// Equity Coverage API - Cloudflare Worker.
// POST /api/generate {ticker}      validate NYSE ticker, dedupe, rate-limit, dispatch the GitHub build
// GET  /api/status?ticker=T&since= queued / running / ready / failed (+ model when ready)
// GET  /api/library                shared library index (every model anyone generated, by sector)
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
      if (url.pathname === "/api/library" && req.method === "GET") return json(await library(env, ctx), 200, cors, 30);
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
  return { "Access-Control-Allow-Origin": ok ? origin || "*" : allowed[0], "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
           "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" };
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

const nyse = (env, ctx) => cached(ctx, "nyse-v1", 6 * 3600, async () => {
  const list = (await rawFile(env, "site/universe/search.json")) || [];
  return Object.fromEntries(list.map(([t, n, s]) => [t, { name: n, sector: s }]));
});
const indexFresh = (env) => rawFile(env, "library/index.json").then((x) => x || { models: [], sectors: {}, count: 0 });
const library = (env, ctx) => cached(ctx, "library-v1", 20, () => indexFresh(env));

async function runsFor(env, ticker, sinceIso) {
  const r = await gh(env, `/repos/${env.GH_REPO}/actions/workflows/${WORKFLOW}/runs?per_page=30&event=workflow_dispatch`);
  if (!r.ok) fail(`GitHub ${r.status} listing runs`, 502);
  const { workflow_runs = [] } = await r.json();
  return workflow_runs.filter((w) => w.display_title === `Generate ${ticker}` && (!sinceIso || w.created_at >= sinceIso));
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

// ------------------------------------------------------------------ routes
async function generate(req, env, ctx) {
  const body = await req.json().catch(() => ({}));
  const ticker = String(body.ticker || "").toUpperCase().trim();
  const force = !!body.force;
  if (!/^[A-Z][A-Z0-9.\-]{0,6}$/.test(ticker)) fail("Enter a ticker symbol, e.g. XOM");
  const list = await nyse(env, ctx);
  const co = list[ticker];
  if (!co) fail(`${ticker} isn't an NYSE-listed SEC filer in our universe. Only NYSE tickers are supported.`, 404);

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
  if (d.status !== 204) fail(`Could not start the build (GitHub ${d.status})`, 502);
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
  if (w.status !== "completed") return { status: w.status === "in_progress" ? "running" : "queued", ticker, run_url: w.html_url,
                                          started: w.run_started_at };
  if (w.conclusion === "success") return { status: "finishing", ticker, run_url: w.html_url };
  return { status: "failed", ticker, run_url: w.html_url, conclusion: w.conclusion };
}
