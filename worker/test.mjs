// Local test: mock GitHub API + Cache API, exercise every route.
import worker from "./src/index.js";
const store = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => store.set(r.url, res) } };
let dispatched = [], runs = [], index = { models: [], sectors: {}, count: 0 };
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://fc.yahoo.com")) return new Response("", { headers: { "set-cookie": "A3=abc; Path=/" } });
  if (url.includes("/getcrumb")) return new Response("CRUMB");
  if (url.includes("/v8/finance/chart/")) { const t0 = Date.parse("2025-11-24") / 1000; return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 110, longName: "X" }, timestamp: [t0, t0 + 604800], indicators: { quote: [{ close: [100, 110] }] } }] } })); }
  if (url.includes("/contents/site/universe/stats.json")) return new Response(JSON.stringify({ data: { XOM: [8.0, 4200] } }));
  if (url.includes("/quoteSummary/XOM")) return new Response("{}", { status: 401 });
  if (url.includes("/quoteSummary/")) { if (!url.includes("crumb=CRUMB")) return new Response("{}", { status: 401 });
    return new Response(JSON.stringify({ quoteSummary: { result: [{ price: { longName: "Coca-Cola", marketCap: { raw: 4.2e11 } }, summaryDetail: { trailingPE: { raw: 24.5 }, dividendYield: { raw: 0.03 }, beta: { raw: 0.45 } } }] } })); }
  if (url.includes("/contents/site/universe/search.json")) return new Response(JSON.stringify([["XOM", "Exxon Mobil Corp", "Energy"], ["KO", "Coca-Cola Co", "Consumer Staples"]]));
  if (url.includes("/contents/library/index.json")) return new Response(JSON.stringify(index));
  if (url.includes("/contents/library/energy/XOM/meta.json")) return new Response(JSON.stringify({ ticker: "XOM", detail: { ok: 1 } }));
  if (url.includes("/dispatches")) { dispatched.push(JSON.parse(init.body)); runs.unshift({ display_title: `${url.includes("earnings.yml") ? "Earnings" : "Generate"} ${JSON.parse(init.body).inputs.ticker}`, status: "queued", created_at: new Date().toISOString(), html_url: "https://gh/run/1" }); return new Response(null, { status: 204 }); }
  if (url.includes("/runs?created")) return new Response(JSON.stringify({ total_count: 3 }));
  if (url.includes("/runs?")) return new Response(JSON.stringify({ workflow_runs: runs }));
  return new Response("nope", { status: 404 });
};
import { createHash } from "node:crypto";
const kv = new Map();
const UPLOADS = { list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }), get: async (k, t) => { const v = kv.get(k); if (v == null) return null; return t === "json" ? JSON.parse(v) : t === "arrayBuffer" ? v : v; },
                  put: async (k, v) => kv.set(k, v), delete: async (k) => kv.delete(k) };
const env = { UPLOADS, GH_TOKEN: "x", GH_REPO: "o/r", ALLOWED_ORIGINS: "https://jash-financebro.github.io",
              OWNER_KEY_SHA256: createHash("sha256").update("secret-key").digest("hex"), SITE_URL: "https://site/" };
const ctx = { waitUntil: (p) => p };
const call = async (path, body) => { const r = await worker.fetch(new Request("https://w.dev" + path, body ? { method: "POST", body: JSON.stringify(body), headers: { Origin: "https://jash-financebro.github.io", "CF-Connecting-IP": "1.2.3.4" } } : { headers: { Origin: "https://jash-financebro.github.io" } }), env, ctx); return [r.status, await r.json(), r.headers.get("access-control-allow-origin")]; };
const ok = (c, m) => { if (!c) { console.error("FAIL", m); process.exit(1); } };
let [s, b, o] = await call("/api/generate", { ticker: "msft" }); ok(s === 404 && /NYSE/.test(b.error), "non-NYSE rejected " + JSON.stringify(b)); ok(o === "https://jash-financebro.github.io", "cors");
[s, b] = await call("/api/generate", { ticker: "xom" }); ok(s === 200 && b.status === "queued" && dispatched.length === 1, "queued " + JSON.stringify(b));
[s, b] = await call("/api/generate", { ticker: "XOM" }); ok(b.status === "running" && dispatched.length === 1, "dedupe in-flight " + JSON.stringify(b));
[s, b] = await call(`/api/status?ticker=XOM&since=${encodeURIComponent(new Date(Date.now() - 1e4).toISOString())}`); ok(b.status === "queued", "status queued " + JSON.stringify(b));
runs[0].status = "completed"; runs[0].conclusion = "success";
index = { models: [{ ticker: "XOM", name: "Exxon", sector: "Energy", generated_at: new Date().toISOString().slice(0, 19) + "Z", target: 120, price: 100, upside: 0.2, rating: "Buy", version: 1, times_generated: 2,
  scenarios: { bear: 90, base: 120, bull: 150 }, files: { xlsx: "https://raw.githubusercontent.com/o/r/main/library/energy/XOM/XOM_v1.xlsx", card: "https://raw/card.png" } },
  { ticker: "OLD", sector: "Energy", generated_at: "2020-01-01T00:00:00Z", target: 1, files: {} }], sectors: { Energy: ["OLD", "XOM"] }, count: 2 };
[s, b] = await call(`/api/status?ticker=XOM&since=${encodeURIComponent(new Date(Date.now() - 6e4).toISOString())}`); ok(b.status === "ready" && b.model.target === 120, "ready " + JSON.stringify(b));
[s, b] = await call("/api/generate", { ticker: "XOM" }); ok(b.status === "ready" && b.cached, "fresh cache reused");
[s, b] = await call("/api/library"); ok(s === 403, "library is private without the owner key " + s);
{ const r = await worker.fetch(new Request("https://w.dev/api/library", { headers: { Origin: "https://jash-financebro.github.io", "X-Owner-Key": "secret-key" } }), env, ctx);
  ok(r.status === 200 && (await r.json()).count === 2, "owner sees the library"); }
[s, b] = await call("/api/recent"); ok(s === 200 && b.models.length === 1 && b.models[0].ticker === "XOM" && b.trending.length === 1, "recent = past 24h " + JSON.stringify(b));
[s, b] = await call("/api/model?ticker=xom"); ok(s === 200 && b.detail.ok === 1, "model meta " + JSON.stringify(b));
{ const r = await worker.fetch(new Request("https://w.dev/m/XOM"), env, ctx); const h = await r.text();
  ok(r.status === 200 && h.includes('og:title" content="XOM · $120.00 target · Buy') && h.includes("og:image") && h.includes("https://site/#/m/XOM"), "share page"); }
for (let i = 0; i < 9; i++) { runs = []; [s, b] = await call("/api/generate", { ticker: "KO", force: true }); }
ok(s === 429, "rate limit " + s + JSON.stringify(b));
[s, b] = await call("/api/insights"); ok(s === 200 && b.totals.companies === 2 && b.sectors[0].name === "Energy" && !JSON.stringify(b).includes("XOM"), "insights without tickers " + JSON.stringify(b));
// model updates: upload -> runner fetch -> runner result -> visitor status + file
{ const xlsx = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9]);
  let r = await worker.fetch(new Request("https://w.dev/api/update?ticker=ko", { method: "POST", body: xlsx, headers: { Origin: "https://jash-financebro.github.io", "X-Filename": "My KO model.xlsx", "CF-Connecting-IP": "9.9.9.9" } }), env, ctx);
  const up = await r.json(); ok(r.status === 200 && up.id && up.token && dispatched.at(-1).inputs.id === up.id, "update queued " + JSON.stringify(up));
  r = await worker.fetch(new Request(`https://w.dev/api/update/input/${up.id}`), env, ctx); ok(r.status === 403, "runner auth required");
  r = await worker.fetch(new Request(`https://w.dev/api/update/input/${up.id}`, { headers: { Authorization: "Bearer x" } }), env, ctx);
  ok(r.status === 200 && r.headers.get("X-Ticker") === "KO" && (await r.arrayBuffer()).byteLength === 6, "runner gets the upload");
  r = await worker.fetch(new Request(`https://w.dev/api/update/status/${up.id}?token=nope`), env, ctx); ok(r.status === 403, "status needs token");
  await worker.fetch(new Request(`https://w.dev/api/update/result/${up.id}?part=file`, { method: "PUT", body: new Uint8Array([1, 2, 3]), headers: { Authorization: "Bearer x" } }), env, ctx);
  await worker.fetch(new Request(`https://w.dev/api/update/result/${up.id}?part=summary`, { method: "PUT", body: JSON.stringify({ status: "ok", new_target: 99 }), headers: { Authorization: "Bearer x" } }), env, ctx);
  r = await worker.fetch(new Request(`https://w.dev/api/update/status/${up.id}?token=${up.token}`), env, ctx); const st = await r.json();
  ok(st.status === "ready" && st.summary.new_target === 99 && !kv.has(`in:${up.id}`), "update ready, upload deleted " + JSON.stringify(st));
  r = await worker.fetch(new Request(`https://w.dev/api/update/file/${up.id}?token=${up.token}`), env, ctx);
  ok(r.status === 200 && /My KO model_updated\.xlsx/.test(r.headers.get("Content-Disposition")), "download name");
  r = await worker.fetch(new Request("https://w.dev/api/update?ticker=KO", { method: "POST", body: new Uint8Array([1, 2, 3]), headers: { "CF-Connecting-IP": "8.8.8.8" } }), env, ctx);
  ok(r.status === 415, "non-xlsx rejected " + r.status); }
[s, b] = await call("/api/quotes?t=ko,xom"); ok(s === 200 && b.quotes.length === 2 && b.quotes[0].pe === 24.5 && b.quotes[0].closes.length === 2 && b.quotes[0].sector === "Consumer Staples" && b.spy.length === 2, "quotes " + JSON.stringify(b).slice(0, 300));
ok(Math.abs(b.quotes[1].pe - 110 / 8) < 1e-9 && b.quotes[1].market_cap === 110 * 4200e6 && b.quotes[1].pe_source, "SEC fallback for P/E and market cap " + JSON.stringify(b.quotes[1]).slice(0, 300));
[s, b] = await call("/api/quotes?t=ZZZZ"); ok(s === 404, "unknown ticker rejected");
// feedback: public POST, owner-only read/delete, spam trap
{ const fb = (method, path, body, key) => worker.fetch(new Request("https://w.dev" + path, { method, body: body ? JSON.stringify(body) : undefined,
    headers: { "CF-Connecting-IP": "5.5.5.5", ...(key ? { "X-Owner-Key": key } : {}) } }), env, ctx);
  let r = await fb("POST", "/api/feedback", { ticker: "ko", kind: "peer", text: "PEP fits better than SN" }); ok(r.status === 200, "feedback saved");
  r = await fb("POST", "/api/feedback", { ticker: "KO", text: "", kind: "other" }); ok(r.status === 400, "empty 'other' rejected");
  const before = [...kv.keys()].filter((k) => k.startsWith("fb:")).length;
  await fb("POST", "/api/feedback", { ticker: "KO", kind: "number", website: "spam.biz" }); ok([...kv.keys()].filter((k) => k.startsWith("fb:")).length === before, "spam trap");
  r = await fb("GET", "/api/feedback"); ok(r.status === 403, "feedback list is owner only");
  r = await fb("GET", "/api/feedback", null, "secret-key"); const items = (await r.json()).items;
  ok(items.length === 1 && items[0].ticker === "KO" && items[0].kind === "peer", "owner reads feedback " + JSON.stringify(items));
  r = await fb("DELETE", "/api/feedback?id=" + encodeURIComponent(items[0].id), null, "secret-key"); ok(r.status === 200 && ![...kv.keys()].some((k) => k.startsWith("fb:")), "owner clears feedback"); }
[s, b] = await call("/api/track"); ok(s === 200 && Array.isArray(b.open) && Array.isArray(b.scored) && "summary" in b, "track " + JSON.stringify(b).slice(0, 200));
[s, b] = await call("/api/models?t=xom,zzz"); ok(s === 200 && Array.isArray(b.models), "watchlist models " + JSON.stringify(b).slice(0, 200));
{ const r0 = await worker.fetch(new Request("https://w.dev/api/error", { method: "POST", body: JSON.stringify({ msg: "TypeError: x is undefined", route: "m/KO", line: 12 }), headers: { "CF-Connecting-IP": "7.7.7.7" } }), env, ctx);
  ok(r0.status === 200 && [...kv.keys()].some((k) => k.startsWith("err:")), "error logged");
  let r = await worker.fetch(new Request("https://w.dev/api/error"), env, ctx); ok(r.status === 403, "error log owner only");
  r = await worker.fetch(new Request("https://w.dev/api/error", { headers: { "X-Owner-Key": "secret-key" } }), env, ctx); const it = (await r.json()).items;
  ok(it.length === 1 && it[0].route === "m/KO", "owner reads errors");
  r = await worker.fetch(new Request("https://w.dev/api/error?ids=" + encodeURIComponent(it[0].id), { method: "DELETE", headers: { "X-Owner-Key": "secret-key" } }), env, ctx);
  ok(!(([...kv.keys()]).some((k) => k.startsWith("err:"))), "owner clears errors"); }
[s, b] = await call("/api/sector?name=Energy"); ok(s === 200 && Array.isArray(b.models), "sector models");
[s, b] = await call("/api/track"); ok(b.forecast && "median_abs_rev_err" in b.forecast, "forecast accuracy block");
{ const E = (method, t, body, auth) => worker.fetch(new Request(`https://w.dev/api/earnings${method === "PUT" ? "/result" : ""}?t=${t}`, { method, body,
    headers: { "CF-Connecting-IP": "9.9.9.9", ...(auth ? { Authorization: "Bearer x" } : {}) } }), env, ctx).then(async (r) => [r.status, await r.json()]);
  let [st, b] = await E("GET", "KO"); ok(st === 200 && b.status === "missing", "earnings: nothing yet " + JSON.stringify(b));
  [st, b] = await E("POST", "ZZZZ"); ok(st === 404, "earnings: unknown ticker rejected");
  const before = dispatched.length;
  [st, b] = await E("POST", "KO"); ok(st === 200 && b.status === "queued" && dispatched.length === before + 1, "earnings: build dispatched " + JSON.stringify(b));
  [st, b] = await E("POST", "KO"); ok(b.status === "queued" && dispatched.length === before + 1, "earnings: in-flight build not repeated");
  [st, b] = await E("PUT", "KO", JSON.stringify({ status: "ok", ticker: "KO", built_at: new Date().toISOString(), events: [] })); ok(st === 403, "earnings: only the runner can store notes");
  [st, b] = await E("PUT", "KO", JSON.stringify({ status: "ok", ticker: "KO", built_at: new Date().toISOString(), events: [{ filed: "2026-10-21" }] }), true); ok(st === 200, "earnings: runner stores notes");
  [st, b] = await E("GET", "KO"); ok(b.status === "ready" && b.notes.events[0].filed === "2026-10-21", "earnings: notes served");
  [st, b] = await E("POST", "KO"); ok(b.status === "ready" && dispatched.length === before + 1, "earnings: fresh notes not rebuilt"); }
console.log("OK  worker: earnings, errors, sector, feedback, track, watchlist models, quotes, insights, model updates, private library, recent, model, share page, NYSE validation, dispatch, in-flight dedupe, status, fresh-cache reuse, library, rate limit, CORS");
