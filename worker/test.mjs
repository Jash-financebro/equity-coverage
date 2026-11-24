// Local test: mock GitHub API + Cache API, exercise every route.
import worker from "./src/index.js";
const store = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => store.set(r.url, res) } };
let dispatched = [], runs = [], index = { models: [], sectors: {}, count: 0 };
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes("/contents/site/universe/search.json")) return new Response(JSON.stringify([["XOM", "Exxon Mobil Corp", "Energy"], ["KO", "Coca-Cola Co", "Consumer Staples"]]));
  if (url.includes("/contents/library/index.json")) return new Response(JSON.stringify(index));
  if (url.includes("/contents/library/energy/XOM/meta.json")) return new Response(JSON.stringify({ ticker: "XOM", detail: { ok: 1 } }));
  if (url.includes("/dispatches")) { dispatched.push(JSON.parse(init.body)); runs.unshift({ display_title: `Generate ${JSON.parse(init.body).inputs.ticker}`, status: "queued", created_at: new Date().toISOString(), html_url: "https://gh/run/1" }); return new Response(null, { status: 204 }); }
  if (url.includes("/runs?created")) return new Response(JSON.stringify({ total_count: 3 }));
  if (url.includes("/runs?")) return new Response(JSON.stringify({ workflow_runs: runs }));
  return new Response("nope", { status: 404 });
};
import { createHash } from "node:crypto";
const env = { GH_TOKEN: "x", GH_REPO: "o/r", ALLOWED_ORIGINS: "https://jash-financebro.github.io",
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
console.log("OK  worker: private library, recent, model, share page, NYSE validation, dispatch, in-flight dedupe, status, fresh-cache reuse, library, rate limit, CORS");
