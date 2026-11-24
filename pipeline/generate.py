"""Generate a full model + report for one NYSE ticker and add it to the shared library.

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


def pick_peers(me: dict, uni: list[dict], my_rev: float | None, n: int = 5) -> list[dict]:
    """Same SIC code first, then same 2-digit SIC; nearest by revenue."""
    same = [c for c in uni if c["sic"] == me["sic"] and c["ticker"] != me["ticker"]]
    if len(same) < 3 and me.get("sic"):
        same += [c for c in uni if str(c["sic"])[:2] == str(me["sic"])[:2] and c["ticker"] != me["ticker"]
                 and c not in same]
    cands = same[:24]
    out = []
    for c in cands:
        try:
            facts = sources.company_facts(c["cik"])
            fin = fundamentals.build(facts, years=3)
            it = fin["items"]
            rev = it["revenue"][-1]
            if not rev or rev <= 0:
                continue
            out.append({"c": c, "fin": fin, "facts": facts, "rev": rev})
        except Exception as exc:  # noqa: BLE001
            print(f"  · peer {c['ticker']} skipped: {exc}")
    if my_rev and my_rev > 0:
        out.sort(key=lambda p: abs(math.log(p["rev"] / my_rev)))
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
        peers.append({"ticker": p["c"]["ticker"], "name": clean_name(p["c"]["name"]), "price": px, "shares": shares,
                      "net_debt": last("short_term_debt") + last("long_term_debt") - last("cash"),
                      "ebitda": last("operating_income") + last("d_and_a"), "eps": last("eps_diluted"),
                      "revenue": p["rev"]})
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
    vs = lambda r, c="D": g("Valuation Summary", f"{c}{r}")  # noqa: E731
    m["val"] = {"dcf": vs(5), "comps": vs(6), "w_dcf": vs(8), "w_comps": vs(9), "target": vs(13), "price": vs(14),
                "upside": vs(15), "cases": {n: {"g1": vs(19, c), "g5": vs(20, c), "cogs": vs(21, c), "tg": vs(22, c),
                                                "target": vs(23, c), "upside": vs(24, c)}
                                            for n, c in (("bear", "D"), ("base", "E"), ("bull", "F"))}}
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


def update_index():
    entries = []
    for meta in LIB.glob("*/*/meta.json"):
        try:
            entries.append(json.loads(meta.read_text()))
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

    T = ticker.upper().strip()
    uni = universe.load()["companies"]
    me = next((c for c in uni if c["ticker"] == T or T in c.get("other_tickers", [])), None)
    if me is None:
        if not allow_any:
            raise SystemExit(f"{T} is not an NYSE-listed SEC filer")
        cik, name = sources.cik_for(T)
        me = {"ticker": T, "cik": cik, "name": name, "sic": None, "industry": "", "sector": "Other"}
    now = dt.datetime.now(dt.timezone.utc)
    print(f"→ {T}  {me['name']}  [{me['sector']} · {me['industry']}]")

    facts = sources.company_facts(me["cik"])
    subs = sources.submissions(me["cik"])
    fin = fundamentals.build(facts)
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

    folder = LIB / slug(me["sector"]) / T
    folder.mkdir(parents=True, exist_ok=True)
    n = max([int(m.group(1)) for f in folder.glob(f"{T}_v*.xlsx") if (m := re.search(r"_v(\d+)$", f.stem))] or [0]) + 1
    label = f"{T}_v{n}"
    work = Path(tempfile.mkdtemp())
    built = work / f"{label}.xlsx"
    builder.build(T, built, {"live": live, "fin": fin, "peers": peers}, stance="Balanced")
    live["model_label"] = label
    vs = f"'{T} Valuation Summary'"
    calc = excel.Calc(port=int(os.environ.get("LO_PORT", "2002")))
    try:
        res = excel.refresh(calc, built, folder / f"{label}.xlsx", live,
                            {"scenario_cells": {"bear": f"{vs}!D23", "base": f"{vs}!E23", "bull": f"{vs}!F23"}})
    finally:
        calc.close()
    model = read_model(folder / f"{label}.xlsx", T)
    target = res["target"]
    upside = target / price - 1 if target else None
    rec = {
        "ticker": T, "name": name, "cik": me["cik"], "sector": me["sector"], "industry": me["industry"],
        "sic": me["sic"], "city": me.get("city"), "state": me.get("state"), "website": me.get("website") or qs.get("website"),
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "version": n, "price": round(price, 2),
        "price_date": mkt["as_of"], "target": round(target, 2) if target else None,
        "upside": round(upside, 4) if upside is not None else None, "rating": rating_for(upside),
        "scenarios": {k: round(v, 2) for k, v in res["scenarios"].items() if v},
        "dcf_value": model["val"]["dcf"], "comps_value": model["val"]["comps"],
        "wacc": round(model["wacc"]["wacc"], 4), "peers": [p["ticker"] for p in peers],
        "consensus": {k: qs.get(k) for k in ("target_mean", "target_median", "analysts")},
        "beta_source": beta_src, "fiscal_year": fin["labels"][-1],
    }
    pdf = folder / f"{T}_report_v{n}.pdf"
    report.make(pdf, rec, model, fin, rt, mkt, filings, sources.recent_filings(subs, me["cik"]), qs, peers, subs)
    rec["files"] = {"xlsx": f"{REPO_RAW}/library/{slug(me['sector'])}/{T}/{label}.xlsx",
                    "pdf": f"{REPO_RAW}/library/{slug(me['sector'])}/{T}/{pdf.name}"}
    prev = json.loads((folder / "meta.json").read_text()) if (folder / "meta.json").exists() else {}
    rec["times_generated"] = (prev.get("times_generated") or 0) + 1
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
