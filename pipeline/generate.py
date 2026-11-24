"""Generate a full model + report for one NYSE or Nasdaq ticker and add it to the shared library.

    python pipeline/generate.py XOM                  # live data
    FIXTURES_DIR=tests/fixtures python pipeline/generate.py MSFT

Writes library/<sector>/<TICKER>/<TICKER>_v<N>.xlsx and <TICKER>_report_v<N>.pdf,
plus library/<sector>/<TICKER>/meta.json and the combined library/index.json.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import analytics  # noqa: E402
import fundamentals  # noqa: E402
import ratios  # noqa: E402
import sources  # noqa: E402
import universe  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / os.environ.get("LIBRARY_DIR", "library")
REPO_RAW = os.environ.get("REPO_RAW", "https://raw.githubusercontent.com/Jash-financebro/equity-coverage/main")


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def clean_name(n: str) -> str:
    n = re.sub(r"\s*/[A-Za-z]{2,}/?\s*$", "", n or "")
    return " ".join(w if "&" in w or (len(w) <= 4 and w.isupper() and w not in ("INC", "CORP", "CO", "LTD", "PLC", "LLC"))
                    else w.title() for w in n.split()) if n.isupper() else n


def rating_for(up):
    if up is None:
        return "Not rated"
    return "Buy" if up >= 0.15 else "Sell" if up <= -0.10 else "Hold"


GENERIC_WORDS = {"the", "inc", "corp", "corporation", "co", "company", "ltd", "plc", "llc", "lp", "holdings", "holding",
                 "group", "american", "united", "national", "first", "general", "international", "global", "new", "us",
                 "trust", "partners", "energy", "financial", "bancorp", "technologies", "industries", "brands"}


def _name_key(name: str) -> str | None:
    """First distinctive word of a company name, to spot affiliates (Cheniere Energy vs Cheniere Energy Partners)."""
    for w in re.findall(r"[a-z0-9]+", (name or "").lower()):
        if w not in GENERIC_WORDS and len(w) > 2:
            return w
    return None


def pick_peers(me: dict, uni: list[dict], my_rev: float | None, n: int = 5) -> list[dict]:
    """Peers in tiers, best first:
      1. same Yahoo Finance industry (the only way a company outside our 3-digit SIC group can qualify)
      2. same 4-digit SIC and same Yahoo sector
      3. same 4-digit SIC
      4. same 3-digit SIC and same Yahoo sector
    Candidates come from the SIC hierarchy plus Yahoo's 'similar companies'. Affiliates, blank-check shells and the
    company's own share classes are excluded. Within a tier, the closest in revenue wins
    (0.1x-10x for same-industry matches, 0.2x-5x otherwise)."""
    sic = str(me.get("sic") or "")
    mine = sources.quote_summary(me["ticker"])
    my_ind, my_sec = (mine.get("industry") or "").lower(), (mine.get("sector") or "").lower()
    my_key = _name_key(me.get("name"))
    by_ticker = {c["ticker"]: c for c in uni}

    def eligible(c):
        return (c["cik"] != me["cik"] and c.get("sic") and str(c["sic"]) not in ("6770", "0000")
                and (not my_key or _name_key(c.get("name")) != my_key))

    others = [c for c in uni if eligible(c)]
    s4 = [c for c in others if sic and str(c["sic"]) == sic]
    s3 = [c for c in others if sic and str(c["sic"])[:3] == sic[:3] and str(c["sic"]) != sic]
    yahoo = [by_ticker[t] for t in sources.similar_symbols(me["ticker"]) if t in by_ticker and eligible(by_ticker[t])]
    # wider SIC group only as a screening pool for Yahoo-industry matches, nearest codes first
    s2 = []
    if my_ind and len(s4) + len(s3) < 15 and sic:
        s2 = sorted([c for c in others if str(c["sic"])[:2] == sic[:2] and str(c["sic"])[:3] != sic[:3]],
                    key=lambda c: abs(int(c["sic"]) - int(sic)))[:60]
    pool, seen = [], set()
    for c in yahoo + s4 + s3 + s2:
        if c["cik"] not in seen:
            seen.add(c["cik"])
            pool.append(c)
    pool = pool[:220]

    def tier(c, q):
        ind, sec = (q.get("industry") or "").lower(), (q.get("sector") or "").lower()
        same4 = str(c["sic"]) == sic
        same3 = str(c["sic"])[:3] == sic[:3]
        if my_ind and ind == my_ind:
            return 1, "Same industry (Yahoo Finance)"
        if same4 and my_sec and sec == my_sec:
            return 2, "Same SEC industry code and sector"
        if same4:
            return 3, "Same SEC industry code"
        if same3 and my_sec and sec == my_sec:
            return 4, "Related SEC industry code, same sector"
        if same3 and not my_sec:
            return 4, "Related SEC industry code"
        return None, None

    # screen the whole pool on Yahoo profile + TTM revenue (parallel), before any SEC downloads
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=8) as ex:
        profiles = list(ex.map(lambda c: sources.quote_summary(c["ticker"]) if (my_ind or my_sec) else {}, pool))
    in_band = lambda t, r: bool(r and my_rev and my_rev > 0 and (  # noqa: E731
        (0.1 <= r / my_rev <= 10) if t == 1 else (0.2 <= r / my_rev <= 5)))
    dist = lambda r: abs(math.log(r / my_rev)) if r and my_rev and r > 0 and my_rev > 0 else 99  # noqa: E731
    order = lambda t, r: (not in_band(t, r), t if in_band(t, r) else (0 if t <= 2 else 1), dist(r))  # noqa: E731
    ranked = []
    for c, q in zip(pool, profiles):
        t, why = tier(c, q)
        if t is not None:
            ranked.append((t, why, c, q.get("revenue")))
    ranked.sort(key=lambda x: order(x[0], x[3]))
    print(f"  peers: {len(pool)} candidates screened, {len(ranked)} qualify "
          f"({sum(1 for r in ranked if r[0] == 1)} same Yahoo industry: {my_ind or 'n/a'})")

    out = []
    for t, why, c, _yr in ranked[:15]:
        try:
            facts = sources.company_facts(c["cik"])
            fin = fundamentals.build(facts, years=3)
            rev = fin["items"]["revenue"][-1]
            if not rev or rev <= 0:
                continue
            out.append({"c": c, "fin": fin, "facts": facts, "rev": rev, "tier": t, "why": why})
        except Exception as exc:  # noqa: BLE001
            print(f"  · peer {c['ticker']} skipped: {exc}")
    # final order on the audited 10-K revenue; only reach outside the size band if fewer than 3 fit
    out.sort(key=lambda p: order(p["tier"], p["rev"]))
    if sum(1 for p in out if in_band(p["tier"], p["rev"])) >= 3:
        out = [p for p in out if in_band(p["tier"], p["rev"])]
    else:  # never fill with companies 100x smaller or larger: a short list beats a meaningless one
        out = [p for p in out if in_band(p["tier"], p["rev"]) or dist(p["rev"]) <= math.log(100)]
    peers = []
    for p in out:
        if len(peers) >= n:
            break
        try:
            px = sources.price_history(p["c"]["ticker"])["price"]
        except Exception:  # noqa: BLE001
            continue
        it = p["fin"]["items"]
        last = lambda k: (it.get(k) or [None])[-1] or 0  # noqa: E731
        shares = fundamentals.shares_outstanding(p["facts"]) or last("shares_diluted")
        if not shares:
            continue
        q = sources.quote_summary(p["c"]["ticker"])
        peers.append({"ticker": p["c"]["ticker"], "name": clean_name(p["c"]["name"]), "price": px, "shares": shares,
                      "street_median": q.get("target_median"), "street_mean": q.get("target_mean"),
                      "net_debt": last("short_term_debt") + last("long_term_debt") - last("cash"),
                      "ebitda": last("operating_income") + last("d_and_a"), "eps": last("eps_diluted"),
                      "revenue": p["rev"], "equity": last("equity"), "ni": last("net_income"),
                      "match": p.get("why"),
                      "da": last("d_and_a")})
    return peers


def read_model(path: Path, T: str) -> dict:
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    g = lambda sh, ref: wb[f"{T} {sh}"][ref].value  # noqa: E731
    cols = "DEFGHIJK"
    row = lambda sh, r: [g(sh, f"{c}{r}") for c in cols]  # noqa: E731
    years = [g("Income Statement", f"{c}3") for c in cols]
    m = {"years": years,
         "is": {k: row("Income Statement", r) for k, r in (("revenue", 5), ("growth", 6), ("cogs", 7), ("gross", 8),
                ("gm", 9), ("opex", 10), ("ebit", 11), ("ebit_m", 12), ("da", 13), ("ebitda", 14), ("ebitda_m", 15),
                ("interest", 16), ("other", 17), ("pretax", 18), ("tax", 19), ("ni_cons", 21), ("nci", 22),
                ("ni", 23), ("shares", 24), ("eps", 25))},
         "bs": {k: row("Balance Sheet", r) for k, r in (("cash", 5), ("oca", 6), ("tca", 7), ("ppe", 8), ("onca", 9),
                ("ta", 10), ("cl", 12), ("revolver", 13), ("debt", 14), ("oncl", 15), ("tl", 16), ("equity", 18),
                ("tle", 19), ("check", 21))},
         "cf": {k: row("Cash Flow Statement", r) for k, r in (("ni", 5), ("da", 6), ("cfo", 10), ("capex", 12),
                ("cfi", 14), ("div", 19), ("buyback", 20), ("cff", 23), ("net", 25), ("end", 27))},
         "dcf": {k: [g("DCF", f"{c}{r}") for c in "GHIJK"] for k, r in (("ebit", 5), ("nopat", 7), ("da", 8),
                 ("capex", 9), ("nwc", 10), ("ufcf", 11), ("df", 15), ("pv", 16))},
         "wacc": {k: g("WACC", f"D{r}") for k, r in (("rf", 5), ("beta", 6), ("erp", 7), ("ke", 9), ("kd", 11),
                  ("tax", 12), ("kd_at", 13), ("we", 18), ("wd", 19), ("wacc", 23))}}
    m["dcf"].update({k: g("DCF", f"D{r}") for k, r in (("sum_pv", 18), ("g", 19), ("tv", 20), ("pv_tv", 21), ("ev", 22),
                     ("debt", 23), ("cash", 24), ("eq", 25), ("nci", 26), ("eq_common", 27), ("shares", 28),
                     ("value", 29), ("tv_pct", 32), ("exit_mult", 33))})
    m["sens"] = {"g": [g("DCF", f"{c}36") for c in "DEFGH"], "wacc": [g("DCF", f"C{r}") for r in range(37, 42)],
                 "grid": [[g("DCF", f"{c}{r}") for c in "DEFGH"] for r in range(37, 42)]}
    vs = lambda r, c="D": g("Target Price", f"{c}{r}")  # noqa: E731
    m["dcf"].update({"ev_ebitda_now": g("DCF", "D45"), "exit_mult_used": g("DCF", "D46"), "tv_exit": g("DCF", "D48"),
                     "ev_exit": g("DCF", "D50"), "value_exit": g("DCF", "D52"), "implied_g": g("DCF", "D53")})
    m["val"] = {"dcf": vs(5), "comps": vs(6), "exit": vs(7), "w_dcf": vs(8), "w_comps": vs(9), "w_exit": vs(10),
                "model_value": vs(13), "target": vs(43), "price": vs(14),
                "anchor": {"street": vs(30), "peer_up": vs(31), "peer_value": vs(32), "w_model": vs(33), "w_street": vs(34),
                           "w_peer": vs(35), "anchored": vs(39), "band": vs(40), "lo": vs(41), "hi": vs(42),
                           "upside": vs(44)},
                "upside": vs(15), "cases": {n: {"g1": vs(19, c), "g5": vs(20, c), "cogs": vs(21, c), "tg": vs(22, c),
                                                "model": vs(23, c), "target": vs(24, c), "upside": vs(25, c)}
                                            for n, c in (("bear", "D"), ("base", "E"), ("bull", "F"))}}
    m["dcf"]["tax_rate"] = [g("DCF", f"{c}6") for c in "GHIJK"]
    m["val"]["anchored_base"], m["val"]["base_model"] = vs(45), vs(29)
    rbx = wb[f"{T} Revenue Build"]
    m["rb_cases"] = {
        "growth": {n: [rbx[f"{c}{r}"].value for c in "GHIJK"] for n, r in (("bull", 9), ("base", 10), ("bear", 11))},
        "cogs": {n: rbx[f"G{r}"].value for n, r in (("bull", 19), ("base", 20), ("bear", 21))},
        "tg": {n: rbx[f"D{r}"].value for n, r in (("bull", 40), ("base", 41), ("bear", 42))},
        "exit_factor": {n: rbx[f"{c}44"].value for n, c in (("bull", "D"), ("base", "E"), ("bear", "F"))},
    }
    m["tenk_filed"] = wb["Live_Data"]["B11"].value
    rb = wb[f"{T} Revenue Build"]
    m["assumptions"] = {"stance": rb["D6"].value, "opex": rb["G23"].value, "capex": rb["G25"].value,
                        "tax": rb["G28"].value, "base_growth": [rb[f"{c}10"].value for c in "GHIJK"]}
    co = wb[f"{T} Comps"]
    rows = []
    for r in range(5, 60):
        b = co[f"B{r}"].value
        if b == "Peer median":
            m["comps_median"] = {"ev_ebitda": co[f"K{r}"].value, "pe": co[f"L{r}"].value}
            m["comps_self"] = {"ev_ebitda": co[f"K{r + 1}"].value, "pe": co[f"L{r + 1}"].value}
            break
        if b and co[f"C{r}"].value:
            rows.append({"name": b, "ticker": co[f"C{r}"].value, "price": co[f"D{r}"].value, "mcap": co[f"F{r}"].value,
                         "ev": co[f"H{r}"].value, "ebitda": co[f"I{r}"].value, "ev_ebitda": co[f"K{r}"].value,
                         "pe": co[f"L{r}"].value})
    m["comps"] = rows
    return m


SEC_ARCHIVE = "https://www.sec.gov/Archives/edgar/data"


def sector_kind(sic) -> str | None:
    """Businesses where EV/EBITDA and free cash flow don't describe value well."""
    try:
        n = int(sic)
    except (TypeError, ValueError):
        return None
    if 6020 <= n <= 6036:
        return "bank"
    if 6311 <= n <= 6411:
        return "insurer"
    if n == 6798:
        return "reit"
    if 6100 <= n <= 6299:
        return "financial"
    return None


def _med(xs):
    xs = sorted(x for x in xs if x is not None and x > 0)
    if not xs:
        return None
    k = len(xs) // 2
    return xs[k] if len(xs) % 2 else (xs[k - 1] + xs[k]) / 2


def sector_check(me, fin, facts, price, shares, peers) -> dict | None:
    kind = sector_kind(me.get("sic"))
    if not kind or not shares:
        return None
    it = fin["items"]
    last = lambda k, i=-1: (it.get(k) or [None])[i] if len(it.get(k) or []) >= -i else None  # noqa: E731
    eq, ni = last("equity"), last("net_income")
    out = {"kind": kind}
    if kind in ("bank", "insurer", "financial"):
        gw = fundamentals.latest_annual(facts, ["Goodwill"]) or 0
        intang = fundamentals.latest_annual(facts, ["IntangibleAssetsNetExcludingGoodwill",
                                                    "FiniteLivedIntangibleAssetsNet"]) or 0
        bvps = eq / shares if eq else None
        tbvps = (eq - gw - intang) / shares if eq else None
        eq_prev = last("equity", -2)
        roe = ni / ((eq + eq_prev) / 2) if ni and eq and eq_prev else None
        peer_pb = _med([p["price"] * p["shares"] / p["equity"] for p in peers if p.get("equity")])
        out.update({"metric": "P/B", "bvps": bvps, "tbvps": tbvps, "pb": price / bvps if bvps else None,
                    "ptbv": price / tbvps if tbvps and tbvps > 0 else None, "roe": roe, "peer_multiple": peer_pb,
                    "implied_value": peer_pb * bvps if peer_pb and bvps else None,
                    "note": ("Banks, insurers and other financials are valued on book value and returns on equity: "
                             "debt is their raw material, so EV/EBITDA and unlevered free cash flow don't apply. "
                             "Read the DCF here as a rough cross-check and lean on P/B, P/TBV and ROE.")})
    else:
        da = last("d_and_a") or 0
        ffo = (ni or 0) + da
        peer_pffo = _med([p["price"] * p["shares"] / (p["ni"] + p["da"]) for p in peers
                          if p.get("ni") is not None and p.get("da") is not None and (p["ni"] + p["da"]) > 0])
        ffops = ffo / shares
        out.update({"metric": "P/FFO", "ffo": ffo, "ffo_ps": ffops, "pffo": price / ffops if ffops > 0 else None,
                    "peer_multiple": peer_pffo, "implied_value": peer_pffo * ffops if peer_pffo and ffops > 0 else None,
                    "note": ("REITs are valued on funds from operations (net income plus real-estate depreciation, "
                             "approximated here without gains on sales). Depreciation understates what the "
                             "buildings are worth, so lean on P/FFO against peers.")})
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in out.items()}


def detail_block(model, fin, me, mkt, rec) -> dict:
    """Everything the model page and the in-browser sliders need, read from the finished workbook."""
    m, years = model, model["years"]
    hist_n = 3
    pick = lambda d, ks: {k: d.get(k) for k in ks}  # noqa: E731
    rbc = m["rb_cases"]
    base_g = rbc["growth"]["base"]
    cases = {}
    for k in ("bull", "base", "bear"):
        c = m["val"]["cases"][k]
        cases[k] = {"growth": rbc["growth"][k], "growth_delta": [a - b for a, b in zip(rbc["growth"][k], base_g)],
                    "cogs": rbc["cogs"][k], "margin_delta": -(rbc["cogs"][k] - rbc["cogs"]["base"]),
                    "tg": rbc["tg"][k], "exit_factor": rbc["exit_factor"][k],
                    "model": c["model"], "target": c["target"], "upside": c["upside"]}
    d = m["dcf"]
    dcf_inputs = {
        "rev0": m["is"]["revenue"][hist_n - 1], "rev": m["is"]["revenue"][hist_n:], "ebit": d["ebit"], "da": d["da"],
        "capex": d["capex"], "nwc": d["nwc"], "tax": d["tax_rate"], "wacc": m["wacc"]["wacc"], "g": d["g"],
        "ev_ebitda_now": d["ev_ebitda_now"], "debt": d["debt"], "cash": d["cash"],
        "nci_ratio": (d["nci"] / d["eq"]) if d.get("eq") else 0, "shares": d["shares"],
        "comps_value": m["val"]["comps"], "w_dcf": m["val"]["w_dcf"], "w_exit": m["val"]["w_exit"],
        "w_comps": m["val"]["w_comps"], "anchored_base": m["val"]["anchored_base"],
        "base_model": m["val"]["base_model"], "price": rec["price"],
        "check": {"dcf": m["val"]["dcf"], "exit": m["val"]["exit"], "model": m["val"]["model_value"],
                  "target": m["val"]["target"]},
    }
    src = []
    labels = fin["labels"][-hist_n:]
    for key, label, _kind, _c in fundamentals.LINE_ITEMS:
        vals = (fin["items"].get(key) or [])[-hist_n:]
        refs = (fin.get("sources", {}).get(key) or [])[-hist_n:]
        if not any(v not in (None, 0) for v in vals):
            continue
        links = []
        for r in refs:
            if r and r[1]:
                links.append({"form": r[3] or "10-K", "filed": r[2], "accn": r[1],
                              "url": f"{SEC_ARCHIVE}/{me['cik']}/{r[1].replace('-', '')}/"})
            else:
                links.append(None)
        concept = next((r[0] for r in refs if r), fin["concepts"].get(key))
        src.append({"key": key, "label": label, "concept": concept, "values": vals, "filings": links,
                    "concept_url": (f"https://data.sec.gov/api/xbrl/companyconcept/CIK{int(me['cik']):010d}/us-gaap/"
                                    f"{concept}.json") if concept and " " not in concept else None})
    hist = mkt.get("history") or []
    return {
        "years": years, "hist_n": hist_n,
        "is": pick(m["is"], ("revenue", "growth", "gm", "ebit", "ebit_m", "ebitda", "ebitda_m", "ni", "eps")),
        "fcf": d["ufcf"], "cases": cases, "dcf_inputs": dcf_inputs,
        "valuation": {"dcf": m["val"]["dcf"], "exit": m["val"]["exit"], "comps": m["val"]["comps"],
                      "w_dcf": m["val"]["w_dcf"], "w_exit": m["val"]["w_exit"], "w_comps": m["val"]["w_comps"],
                      "model_value": m["val"]["model_value"], "anchor": m["val"]["anchor"], "target": m["val"]["target"]},
        "comps": m["comps"], "comps_median": m.get("comps_median"), "comps_self": m.get("comps_self"),
        "wacc": pick(m["wacc"], ("rf", "beta", "erp", "ke", "kd_at", "we", "wd", "wacc")),
        "sens": m["sens"], "sources": src, "sources_years": labels,
        "price_history": hist[::5] + ([hist[-1]] if hist and (len(hist) - 1) % 5 else []),
        "dates": {"tenk_filed": m.get("tenk_filed"), "price_date": rec["price_date"],
                  "generated_at": rec["generated_at"]},
        "filings_index": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={me['cik']}&type=10-K",
    }


def share_card(path: Path, rec: dict):
    """1200x630 PNG used as the link-preview image when a model page is shared."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig = plt.figure(figsize=(12, 6.3), dpi=100)
    fig.patch.set_facecolor("#0f1720")
    ax = fig.add_axes([0, 0, 1, 1]); ax.axis("off")
    W = "#e6edf3"; MUTED = "#8b98a5"
    col = {"Buy": "#3fb950", "Sell": "#f85149"}.get(rec.get("rating"), "#d29922")
    ax.text(0.06, 0.86, "MODEL BUILDER", color=MUTED, fontsize=20, family="DejaVu Sans", weight="bold")
    ax.text(0.06, 0.70, f"{rec['ticker']}  ·  {rec['name'][:38]}", color=W, fontsize=34, weight="bold")
    ax.text(0.06, 0.62, f"{rec.get('exchange', 'NYSE')}  ·  {rec['sector']}", color=MUTED, fontsize=20)
    ax.text(0.06, 0.40, f"${rec['target']:,.2f}" if rec.get("target") else "n/a", color=W, fontsize=72, weight="bold")
    ax.text(0.06, 0.31, "12-month price target", color=MUTED, fontsize=20)
    up = rec.get("upside")
    ax.text(0.58, 0.44, (rec.get("rating") or "").upper(), color=col, fontsize=54, weight="bold")
    ax.text(0.58, 0.33, f"{up:+.1%} vs ${rec['price']:,.2f}" if up is not None else "", color=W, fontsize=24)
    sc = rec.get("scenarios") or {}
    if sc:
        ax.text(0.06, 0.14, "Bear / Base / Bull  " + "  /  ".join(f"${sc[k]:,.0f}" for k in ("bear", "base", "bull") if k in sc),
                color=MUTED, fontsize=20)
    ax.text(0.94, 0.06, f"Generated {rec['generated_at'][:10]} from SEC 10-K data", color=MUTED, fontsize=14, ha="right")
    fig.savefig(path, facecolor=fig.get_facecolor())
    plt.close(fig)


def update_index():
    entries = []
    for meta in LIB.glob("*/*/meta.json"):
        try:
            e = json.loads(meta.read_text())
            for k in ("detail", "history"):
                e.pop(k, None)
            entries.append(e)
        except Exception:  # noqa: BLE001
            continue
    entries.sort(key=lambda e: e.get("generated_at", ""), reverse=True)
    by_sector = {}
    for e in entries:
        by_sector.setdefault(e["sector"], []).append(e["ticker"])
    (LIB / "index.json").write_text(json.dumps(
        {"updated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "count": len(entries),
         "sectors": {k: sorted(v) for k, v in sorted(by_sector.items())}, "models": entries}, indent=1))


def generate(ticker: str, allow_any: bool = False) -> dict:
    import builder
    import excel
    import report

    T = ticker.upper().strip().replace(".", "-").replace("/", "-")
    uni = universe.load()["companies"]
    me = next((c for c in uni if c["ticker"] == T or T in c.get("other_tickers", [])), None)
    if me is None:
        if not allow_any:
            raise SystemExit(f"{T} is not an NYSE- or Nasdaq-listed SEC filer")
        cik, name = sources.cik_for(T)
        me = {"ticker": T, "cik": cik, "name": name, "sic": None, "industry": "", "sector": "Other"}
    now = dt.datetime.now(dt.timezone.utc)
    print(f"→ {T}  {me['name']}  [{me['sector']} · {me['industry']}]")

    facts = sources.company_facts(me["cik"])
    subs = sources.submissions(me["cik"])
    try:
        fin = fundamentals.build(facts)
    except fundamentals.NonUSD as e:
        raise SystemExit(f"{T}: files its financials with the SEC in {e} (IFRS / 20-F filer). Models are built in "
                         "US dollars from US-GAAP 10-K data, so this company can't be modeled yet")
    except ValueError:
        raise SystemExit(f"{T}: no annual 10-K XBRL financials on file with the SEC yet - nothing to model")
    if len(fin["labels"]) < 2:
        raise SystemExit(f"{T}: fewer than two years of annual XBRL financials - nothing to model")
    shares = fundamentals.shares_outstanding(facts) or fin["items"]["shares_diluted"][-1]
    mkt = sources.price_history(T)
    qs = sources.quote_summary(T)
    rates = sources.rates()
    try:
        spy = sources.price_history("SPY")["history"]
    except Exception:  # noqa: BLE001
        spy = []
    price = mkt["price"]
    rt = ratios.compute(fin, price, shares)
    beta, beta_src = qs.get("beta"), "Yahoo Finance"
    if not beta or not 0.2 < beta < 3.5:
        reg = analytics.regression_beta(mkt["history"], spy)
        beta, beta_src = (reg, "1Y daily regression vs SPY") if reg and 0.2 < reg < 3.5 else (1.0, "default 1.0")
    wacc = analytics.market_wacc(fin, rt["snapshot"], beta, rates["rf_10y"], 0.055)
    items = fin["items"]
    debt = (items["short_term_debt"][-1] or 0) + (items["long_term_debt"][-1] or 0)
    filings = sources.annual_filings(subs, me["cik"])
    name = clean_name(subs.get("name") or me["name"])
    live = {
        "ticker": T, "company": name, "price": price, "price_date": mkt["as_of"], "shares": shares,
        "market_cap": price * shares if shares else None, "net_debt": debt - (items["cash"][-1] or 0),
        "tenk_filed": filings[0]["filed"] if filings else "", "tenk_url": filings[0]["url"] if filings else "",
        "sources": f"SEC EDGAR XBRL (CIK {me['cik']}); prices & consensus: {mkt['source']}",
        "refreshed_at": now.strftime("%Y-%m-%d %H:%M UTC"), "financials": fin,
        "market": {**wacc, "street_mean": qs.get("target_mean"), "street_median": qs.get("target_median"),
                   "street_high": qs.get("target_high"), "street_low": qs.get("target_low"),
                   "analysts": qs.get("analysts")},
    }
    print("  peers…")
    peers = pick_peers(me, uni, items["revenue"][-1])
    print(f"  peers: {', '.join(p['ticker'] for p in peers) or 'none'}")

    ups = [(p["ticker"], p["street_median"] / p["price"] - 1) for p in peers if p.get("street_median") and p.get("price")]
    ups = [(t, u) for t, u in ups if -0.6 < u < 1.5]  # drop stale / broken consensus
    anchor = {"street_median": qs.get("target_median"), "analysts": qs.get("analysts"),
              "peer_avg_upside": (sum(u for _, u in ups) / len(ups)) if ups else None,
              "peer_count": len(ups), "peers_used": [t for t, _ in ups]}
    print(f"  anchor: street median {anchor['street_median']} | peer avg upside {anchor['peer_avg_upside']}")

    folder = LIB / slug(me["sector"]) / T
    folder.mkdir(parents=True, exist_ok=True)
    n = max([int(m.group(1)) for f in folder.glob(f"{T}_v*.xlsx") if (m := re.search(r"_v(\d+)$", f.stem))] or [0]) + 1
    label = f"{T}_v{n}"
    work = Path(tempfile.mkdtemp())
    built = work / f"{label}.xlsx"
    builder.build(T, built, {"live": live, "fin": fin, "peers": peers, "anchor": anchor,
                                  "sector": me.get("sector"),
                                  "exchange": me.get("exchange", "NYSE"),
                                  "sector_kind": sector_kind(me.get("sic"))}, stance="Balanced")
    live["model_label"] = label
    vs = f"'{T} Target Price'"
    calc = excel.Calc(port=int(os.environ.get("LO_PORT", "2002")))
    try:
        res = excel.refresh(calc, built, folder / f"{label}.xlsx", live,
                            {"scenario_cells": {"bear": f"{vs}!D23", "base": f"{vs}!E23", "bull": f"{vs}!F23"},
                             "scenario_value_ref": f"{vs}!D13"})
    finally:
        calc.close()
    model = read_model(folder / f"{label}.xlsx", T)
    target = res["target"]
    upside = target / price - 1 if target else None
    rec = {
        "ticker": T, "name": name, "cik": me["cik"], "sector": me["sector"], "industry": me["industry"],
        "exchange": me.get("exchange", "NYSE"),
        "sic": me["sic"], "city": me.get("city"), "state": me.get("state"), "website": me.get("website") or qs.get("website"),
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "version": n, "price": round(price, 2),
        "price_date": mkt["as_of"], "target": round(target, 2) if target else None,
        "upside": round(upside, 4) if upside is not None else None, "rating": rating_for(upside),
        "scenarios": {k: round(model["val"]["cases"][k]["target"], 2) for k in ("bear", "base", "bull")
                      if model["val"]["cases"][k]["target"]},
        "model_scenarios": {k: round(v, 2) for k, v in res["scenarios"].items() if v},
        "dcf_value": model["val"]["dcf"], "comps_value": model["val"]["comps"], "exit_value": model["val"]["exit"],
        "model_value": model["val"]["model_value"], "peer_avg_upside": anchor["peer_avg_upside"],
        "anchor_peers": anchor["peers_used"],
        "wacc": round(model["wacc"]["wacc"], 4), "peers": [p["ticker"] for p in peers],
        "peer_matches": {p["ticker"]: p.get("match") for p in peers},
        "consensus": {k: qs.get(k) for k in ("target_mean", "target_median", "analysts")},
        "beta_source": beta_src, "fiscal_year": fin["labels"][-1],
    }
    rec["sector_check"] = sector_check(me, fin, facts, price, shares, peers)
    rec["detail"] = detail_block(model, fin, me, mkt, rec)
    prev_meta = json.loads((folder / "meta.json").read_text()) if (folder / "meta.json").exists() else {}
    rec["history"] = ((prev_meta.get("history") or [])
                      + [{"date": rec["generated_at"][:10], "version": n, "price": rec["price"], "target": rec["target"],
                          "rating": rec["rating"]}])[-40:]
    pdf = folder / f"{T}_report_v{n}.pdf"
    report.make(pdf, rec, model, fin, rt, mkt, filings, sources.recent_filings(subs, me["cik"]), qs, peers, subs)
    try:
        share_card(folder / "card.png", rec)
    except Exception as e:  # noqa: BLE001
        print("  share card skipped:", e)
    rec["files"] = {"card": f"{REPO_RAW}/library/{slug(me['sector'])}/{T}/card.png",
                    "xlsx": f"{REPO_RAW}/library/{slug(me['sector'])}/{T}/{label}.xlsx",
                    "pdf": f"{REPO_RAW}/library/{slug(me['sector'])}/{T}/{pdf.name}"}
    prev = json.loads((folder / "meta.json").read_text()) if (folder / "meta.json").exists() else {}
    # a maintenance rebuild (--rebuild) refreshes the model without counting as a visitor generation
    rec["times_generated"] = (prev.get("times_generated") or 0) + (0 if "--rebuild" in sys.argv else 1) or 1
    rec["first_generated_at"] = prev.get("first_generated_at") or rec["generated_at"]
    (folder / "meta.json").write_text(json.dumps(rec, indent=1, default=str))
    # keep only the 3 newest versions per ticker to keep the repo light
    for old in sorted(folder.glob(f"{T}_v*.xlsx"), key=lambda f: int(re.search(r"_v(\d+)$", f.stem).group(1)))[:-3]:
        old.unlink()
        (folder / old.name.replace(f"{T}_v", f"{T}_report_v").replace(".xlsx", ".pdf")).unlink(missing_ok=True)
    update_index()
    shutil.rmtree(work, ignore_errors=True)
    print(f"  {label}: target ${target:,.2f} vs ${price:,.2f} ({rec['rating']}) | scenarios {rec['scenarios']}")
    return rec


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    r = generate(args[0], allow_any="--allow-any" in sys.argv)
    Path(os.environ.get("RESULT_FILE", "/tmp/generate_result.json")).write_text(json.dumps(r, default=str))
    os._exit(0)
