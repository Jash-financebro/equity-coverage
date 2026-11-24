// Local test: mock GitHub API + Cache API, exercise every route.
import worker from "./src/index.js";
const store = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => store.set(r.url, res) } };
let dispatched = [], runs = [], index = { models: [], sectors: {}, count: 0 };
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes("/contents/site/universe/search.json")) return new Response(JSON.stringify([["XOM", "Exxon Mobil Corp", "Energy"], ["KO", "Coca-Cola Co", "Consumer Staples"]]));
  if (url.includes("/contents/library/index.json")) return new Response(JSON.stringify(index));
  if (url.includes("/dispatches")) { dispatched.push(JSON.parse(init.body)); runs.unshift({ display_title: `Generate ${JSON.parse(init.body).inputs.ticker}`, status: "queued", created_at: new Date().toISOString(), html_url: "https://gh/run/1" }); return new Response(null, { status: 204 }); }
  if (url.includes("/runs?created")) return new Response(JSON.stringify({ total_count: 3 }));
  if (url.includes("/runs?")) return new Response(JSON.stringify({ workflow_runs: runs }));
  return new Response("nope", { status: 404 });
};
const env = { GH_TOKEN: "x", GH_REPO: "o/r", ALLOWED_ORIGINS: "https://jash-financebro.github.io" };
const ctx = { waitUntil: (p) => p };
const call = async (path, body) => { const r = await worker.fetch(new Request("https://w.dev" + path, body ? { method: "POST", body: JSON.stringify(body), headers: { Origin: "https://jash-financebro.github.io", "CF-Connecting-IP": "1.2.3.4" } } : { headers: { Origin: "https://jash-financebro.github.io" } }), env, ctx); return [r.status, await r.json(), r.headers.get("access-control-allow-origin")]; };
const ok = (c, m) => { if (!c) { console.error("FAIL", m); process.exit(1); } };
let [s, b, o] = await call("/api/generate", { ticker: "msft" }); ok(s === 404 && /NYSE/.test(b.error), "non-NYSE rejected " + JSON.stringify(b)); ok(o === "https://jash-financebro.github.io", "cors");
[s, b] = await call("/api/generate", { ticker: "xom" }); ok(s === 200 && b.status === "queued" && dispatched.length === 1, "queued " + JSON.stringify(b));
[s, b] = await call("/api/generate", { ticker: "XOM" }); ok(b.status === "running" && dispatched.length === 1, "dedupe in-flight " + JSON.stringify(b));
[s, b] = await call(`/api/status?ticker=XOM&since=${encodeURIComponent(new Date(Date.now() - 1e4).toISOString())}`); ok(b.status === "queued", "status queued " + JSON.stringify(b));
runs[0].status = "completed"; runs[0].conclusion = "success";
index = { models: [{ ticker: "XOM", sector: "Energy", generated_at: new Date().toISOString().slice(0, 19) + "Z", target: 120 }], sectors: { Energy: ["XOM"] }, count: 1 };
[s, b] = await call(`/api/status?ticker=XOM&since=${encodeURIComponent(new Date(Date.now() - 6e4).toISOString())}`); ok(b.status === "ready" && b.model.target === 120, "ready " + JSON.stringify(b));
[s, b] = await call("/api/generate", { ticker: "XOM" }); ok(b.status === "ready" && b.cached, "fresh cache reused");
[s, b] = await call("/api/library"); ok(b.count === 1, "library");
for (let i = 0; i < 9; i++) { runs = []; [s, b] = await call("/api/generate", { ticker: "KO", force: true }); }
ok(s === 429, "rate limit " + s + JSON.stringify(b));
console.log("OK  worker: NYSE validation, dispatch, in-flight dedupe, status, fresh-cache reuse, library, rate limit, CORS");
