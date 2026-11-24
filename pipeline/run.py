"""Refresh every model in /models and publish JSON, Excel, PDF files for the website.

    python pipeline/run.py                                 # live data
    FIXTURES_DIR=tests/fixtures python pipeline/run.py     # offline test run
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import traceback
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent))
import analytics  # noqa: E402
import fundamentals  # noqa: E402
import ratios  # noqa: E402
import sources  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"
REPORTS = ROOT / "reports"
SITE = ROOT / os.environ.get("SITE_DIR", "site")
DATA, DL = SITE / "data", SITE / "downloads"
SETTINGS = yaml.safe_load((ROOT / "config.yml").read_text()) if (ROOT / "config.yml").exists() else {}
STATE = DATA / "filing_state.json"


def ticker_of(stem: str) -> str:
    return re.split(r"[_\-\s.]", stem)[0].upper()


def _ver(p: Path) -> int:
    m = re.search(r"_v(\d+)$", p.stem)
    return int(m.group(1)) if m else 0


def discover() -> list[tuple[Path | None, dict]]:
    """Each model .xlsx (+ optional TICKER.yml). A .yml with `build: true` and no workbook
    asks the pipeline to build a 3-statement model for that ticker."""
    out, seen = [], set()
    for f in sorted(MODELS.glob("*.xls[xm]")):
        if f.name.startswith(("_", "~$", ".")):
            continue
        t = ticker_of(f.stem)
        if t in seen:
            continue
        versions = sorted(MODELS.glob(f"{t}_v*.xls[xm]"), key=_ver, reverse=True)
        f = versions[0] if versions else f  # several versions: newest wins
        seen.add(t)
        cfg_path = MODELS / f"{t}.yml"
        cfg = (yaml.safe_load(cfg_path.read_text()) if cfg_path.exists() else {}) or {}
        cfg.setdefault("ticker", t)
        out.append((f, cfg))
    for y in sorted(MODELS.glob("*.yml")):
        cfg = yaml.safe_load(y.read_text()) or {}
        t = (cfg.get("ticker") or y.stem).upper()
        if t not in seen and cfg.get("build"):
            cfg["ticker"] = t
            out.append((None, cfg))
            seen.add(t)
    return out


def rating_for(upside, cfg):
    if cfg.get("rating"):
        return cfg["rating"]
    if upside is None:
        return "Not rated"
    t = SETTINGS.get("ratings", {})
    if upside >= t.get("buy_above", 0.15):
        return "Buy"
    if upside <= t.get("sell_below", -0.10):
        return "Sell"
    return "Hold"


def cached_target(path: Path, ref: str | None):
    """Last value Excel saved in the cell — used if LibreOffice can't recalc a formula."""
    if not ref or "!" not in ref:
        return None
    try:
        import openpyxl
        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
        s, c = ref.rsplit("!", 1)
        v = wb[s.strip("'")][c.replace("$", "")].value
        return float(v) if isinstance(v, (int, float)) else None
    except Exception:  # noqa: BLE001
        return None


def model_date(path: Path) -> str:
    """Date the model was last changed in git (falls back to file mtime)."""
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%cs", "--", str(path)], cwd=ROOT,
                             capture_output=True, text=True, timeout=20).stdout.strip()
        if out:
            return out
    except Exception:  # noqa: BLE001
        pass
    return dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc).strftime("%Y-%m-%d")


def update_history(ticker, date, price, target, rating, spy):
    path = DATA / "history" / f"{ticker}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    hist = json.loads(path.read_text()) if path.exists() else []
    hist = [h for h in hist if h["date"] != date]
    hist.append({"date": date, "price": round(price, 2), "target": None if target is None else round(target, 2),
                 "rating": rating, "spy": None if spy is None else round(spy, 2)})
    hist.sort(key=lambda h: h["date"])
    path.write_text(json.dumps(hist[-1500:], indent=0))
    return hist


def find_report(ticker: str) -> dict | None:
    if not REPORTS.exists():
        return None
    out = {}
    for ext in ("pdf", "docx"):
        files = sorted(REPORTS.glob(f"{ticker}_*.{ext}")) + sorted(REPORTS.glob(f"{ticker}.{ext}"))
        if files:
            shutil.copy2(files[-1], DL / files[-1].name)
            out[ext] = f"downloads/{files[-1].name}"
    meta = REPORTS / f"{ticker}.yml"
    if out and meta.exists():
        out.update(yaml.safe_load(meta.read_text()) or {})
    return out or None


def build_model(cfg: dict, ctx: dict) -> Path:
    import builder
    t = cfg["ticker"]
    existing = sorted(list(MODELS.glob(f"{t}_v*.xlsx")) + list((MODELS / "archive").glob(f"{t}_v*.xlsx")), key=_ver)
    n = (_ver(existing[-1]) + 1) if existing else 1
    dest = MODELS / f"{t}_v{n}.xlsx"
    builder.build(t, dest, ctx, stance=cfg.get("stance", "Balanced"))
    print(f"  built {dest.name} ({cfg.get('stance', 'Balanced')} stance)")
    return dest


def needs_rebuild(path: Path, fin: dict) -> bool:
    """Builder models roll to a new version when a newer 10-K lands."""
    try:
        import openpyxl
        wb = openpyxl.load_workbook(path, read_only=True)
        if "Live_Data" not in wb.sheetnames:
            return False
        have = wb["Live_Data"]["F15"].value
        return bool(have) and str(have) < fin["labels"][-1]
    except Exception:  # noqa: BLE001
        return False


def process(calc, path: Path | None, cfg: dict, now: str, ctx: dict) -> dict:
    import excel

    ticker = cfg["ticker"]
    print(f"→ {ticker}  ({path.name if path else 'build new model'})")
    cik, sec_name = sources.cik_for(ticker)
    facts = sources.company_facts(cik)
    subs = sources.submissions(cik)
    fin = fundamentals.build(facts)
    shares = fundamentals.shares_outstanding(facts) or fin["items"]["shares_diluted"][-1]
    mkt = sources.price_history(ticker)
    qs = sources.quote_summary(ticker)
    filings = sources.annual_filings(subs, cik)
    recent = sources.recent_filings(subs, cik)
    price = mkt["price"]
    rt = ratios.compute(fin, price, shares)
    beta, beta_src = qs.get("beta"), "Yahoo Finance"
    if not beta or not 0.2 < beta < 3.5:
        beta = analytics.regression_beta(mkt["history"], (ctx.get("spy") or {}).get("history"))
        beta_src = "1Y daily regression vs SPY"
    wacc = analytics.market_wacc(fin, rt["snapshot"], beta, ctx["rates"]["rf_10y"],
                                 SETTINGS.get("equity_risk_premium", 0.055))
    wacc["beta_source"] = beta_src

    sec_title = subs.get("name") or sec_name
    if sec_title.isupper():
        sec_title = " ".join(w if "&" in w else w.title() for w in sec_title.split())
    items = fin["items"]
    debt = (items["short_term_debt"][-1] or 0) + (items["long_term_debt"][-1] or 0)
    live = {
        "ticker": ticker, "company": cfg.get("name") or sec_title,
        "price": price, "price_date": mkt["as_of"], "shares": shares,
        "market_cap": price * shares if shares else None, "net_debt": debt - (items["cash"][-1] or 0),
        "tenk_filed": filings[0]["filed"] if filings else "", "tenk_url": filings[0]["url"] if filings else "",
        "sources": f"SEC EDGAR XBRL (CIK {cik}); prices & consensus: {mkt['source']}",
        "refreshed_at": now, "financials": fin,
        "market": {**wacc, "street_mean": qs.get("target_mean"), "street_median": qs.get("target_median"),
                   "street_high": qs.get("target_high"), "street_low": qs.get("target_low"),
                   "analysts": qs.get("analysts")},
    }

    built = False
    if path is None or (cfg.get("build") and cfg.get("auto_rebuild", True) and needs_rebuild(path, fin)):
        if path is not None:
            (MODELS / "archive").mkdir(exist_ok=True)
            shutil.move(str(path), MODELS / "archive" / path.name)
        path = build_model(cfg, {"live": live, "fin": fin, "consensus": qs})
        built = True
    live["model_label"] = path.stem

    out_xlsx = DL / f"{ticker}_model_live.xlsx"
    pin = cfg.get("peer_inputs") or {}
    cfg_x = dict(cfg)
    cfg_x["outputs"] = {**(cfg.get("outputs") or {}),
                        **{f"__peer_{k}": v for k, v in pin.items() if isinstance(v, str) and "!" in v}}
    res = excel.refresh(calc, path, out_xlsx, live, cfg_x)
    peer_adj = {k[7:]: res["outputs"].pop(k) for k in list(res["outputs"]) if k.startswith("__peer_")}
    if pin.get("skip_pe"):
        peer_adj["skip_pe"] = True
    target, stale = res["target"], False
    if target is None:
        target = cached_target(path, res["target_cell"] or cfg.get("target_price"))
        stale = target is not None
    if built:  # keep the generated model in the repo with its Live_Data filled in
        shutil.copy2(out_xlsx, path)
    shutil.copy2(path, DL / f"{ticker}_model_original{path.suffix}")

    upside = (target / price - 1) if target else None
    rating = rating_for(upside, cfg)
    spy_now = ctx["spy"]["price"] if ctx.get("spy") else None
    hist = update_history(ticker, mkt["as_of"], price, target, rating, spy_now)

    self_row = {"ticker": ticker, "name": live["company"], "price": round(price, 2), "self": True,
                "market_cap": rt["snapshot"]["market_cap"],
                **{k: analytics._ratio(rt["groups"], n) for k, n in (
                    ("pe", "P/E"), ("ev_ebitda", "EV / EBITDA"), ("ev_sales", "EV / Sales"),
                    ("op_margin", "Operating margin"), ("rev_growth", "Revenue growth (YoY)"), ("roe", "ROE"),
                    ("net_debt_ebitda", "Net debt / EBITDA"))},
                "street_mean": qs.get("target_mean"), "street_median": qs.get("target_median"),
                "street_upside": (qs["target_median"] / price - 1) if qs.get("target_median") else None,
                "model_target": target}
    peers = analytics.peer_analysis(self_row, cfg.get("peers") or [], rt["snapshot"], price, peer_adj)
    scen = res.get("scenarios") or {}
    ff = analytics.football(mkt["history"], qs, peers, scen, target, price)

    mdate = model_date(path)
    new_filings = [f for f in recent if f["filed"] > mdate]
    state = ctx["filing_state"]
    seen = set(state.get(ticker, []))
    fresh = [f for f in recent[:3] if f["accession"] not in seen] if seen else []
    state[ticker] = [f["accession"] for f in recent]
    for f in fresh:
        ctx["alerts"].append({"ticker": ticker, **f, "model_date": mdate})

    record = {
        "ticker": ticker, "name": live["company"], "cik": cik, "website": qs.get("website"),
        "sector": cfg.get("sector") or qs.get("sector") or "", "industry": qs.get("industry"),
        "analyst": cfg.get("analyst", SETTINGS.get("owner", "")),
        "thesis": cfg.get("thesis", ""), "catalysts": cfg.get("catalysts", []), "risks": cfg.get("risks", []),
        "price": round(price, 2), "price_date": mkt["as_of"], "price_source": mkt["source"],
        "currency": mkt["currency"],
        "target": None if target is None else round(target, 2), "target_cell": res["target_cell"],
        "target_stale": stale, "upside": None if upside is None else round(upside, 4), "rating": rating,
        "published_target": cfg.get("published_target"),
        "scenarios": {k: (None if v is None else round(v, 2)) for k, v in scen.items()},
        "consensus": qs, "wacc": wacc, "peers": peers, "football": ff,
        "ratios": rt["groups"], "snapshot": rt["snapshot"],
        "financials": {"labels": fin["labels"], "periods": fin["periods"], "items": fin["items"],
                       "meta": fin["meta"], "concepts": fin["concepts"]},
        "filings": filings, "recent_filings": recent, "needs_review": bool(new_filings), "new_filings": new_filings,
        "price_history": mkt["history"], "target_history": hist, "track_record": analytics.track_record(hist),
        "model_outputs": res["outputs"], "linked_inputs": res["links"],
        "downloads": {"live": f"downloads/{out_xlsx.name}",
                      "original": f"downloads/{ticker}_model_original{path.suffix}",
                      "tearsheet": f"downloads/{ticker}_tearsheet.pdf"},
        "report": find_report(ticker),
        "model_file": path.name, "model_built": bool(cfg.get("build")), "model_updated": mdate,
        "refreshed_at": now, "status": "ok",
    }
    try:
        import tearsheet
        tearsheet.make(record, DL / f"{ticker}_tearsheet.pdf", SETTINGS.get("owner", ""))
    except Exception as exc:  # noqa: BLE001
        print(f"  ! tear sheet failed: {exc}")
        record["downloads"].pop("tearsheet", None)
    (DATA / f"{ticker}.json").write_text(json.dumps(record, indent=1, default=str))
    tp = f"${target:,.2f}" if target else "n/a"
    print(f"  price ${price:,.2f} | target {tp} ({res['target_cell']}) | {rating} | scenarios {record['scenarios']}")
    return record


def summary(r: dict) -> dict:
    get = lambda g, l: next((i["value"] for grp in r.get("ratios", []) if grp["name"] == g  # noqa: E731
                             for i in grp["items"] if i["label"] == l), None)
    cons = r.get("consensus") or {}
    return {k: r.get(k) for k in ("ticker", "name", "sector", "price", "target", "upside", "rating",
                                  "refreshed_at", "status", "target_stale", "error", "needs_review")} | {
        "pe": get("Valuation", "P/E"), "ev_ebitda": get("Valuation", "EV / EBITDA"),
        "op_margin": get("Profitability", "Operating margin"),
        "market_cap": (r.get("snapshot") or {}).get("market_cap"),
        "street_median": cons.get("target_median"), "street_mean": cons.get("target_mean"),
        "spark": [p[1] for p in (r.get("price_history") or [])][-60:],
        "has_report": bool(r.get("report")),
    }


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    DL.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    models = discover()
    if not models:
        print("No models in /models yet.")
    ctx = {"rates": sources.rates(), "alerts": [],
           "filing_state": json.loads(STATE.read_text()) if STATE.exists() else {}}
    try:
        ctx["spy"] = sources.price_history("SPY")
    except Exception as exc:  # noqa: BLE001
        print(f"  ! SPY unavailable: {exc}")
        ctx["spy"] = None

    rows, records = [], []
    calc = None
    if models:
        import excel
        calc = excel.Calc()
    try:
        for path, cfg in models:
            try:
                rec = process(calc, path, cfg, now, ctx)
                records.append(rec)
                rows.append(summary(rec))
            except Exception as exc:  # noqa: BLE001 - one bad model must not stop the rest
                traceback.print_exc()
                prev = DATA / f"{cfg['ticker']}.json"
                old = json.loads(prev.read_text()) if prev.exists() else {"ticker": cfg["ticker"], "name": cfg["ticker"]}
                old.update(status="error", error=str(exc)[:300])
                prev.write_text(json.dumps(old, indent=1, default=str))
                rows.append(summary(old))
    finally:
        if calc:
            calc.close()

    # fund dashboard
    pcfg = SETTINGS.get("portfolio") or {}
    holdings = pcfg.get("holdings") or [{"ticker": r["ticker"], "weight": 1} for r in records]
    sectors = {r["ticker"]: r.get("sector") for r in records}
    for h in holdings:
        sectors.setdefault(h["ticker"], h.get("sector"))
        if h.get("sector"):
            sectors[h["ticker"]] = h["sector"]
    fund = None
    if ctx.get("spy") and holdings:
        try:
            fund = analytics.portfolio(holdings, ctx["spy"]["history"], ctx["rates"]["tbill_3m"], sectors)
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            print(f"  ! portfolio analytics failed: {exc}")
    if fund:
        fund["name"] = pcfg.get("name") or "Model portfolio (equal-weight coverage)"
        fund["custom"] = bool(pcfg.get("holdings"))
        fund["coverage_targets"] = [{"ticker": r["ticker"], "upside": r.get("upside"), "rating": r.get("rating")}
                                    for r in records]
        (DATA / "fund.json").write_text(json.dumps(fund, indent=0, default=str))

    STATE.write_text(json.dumps(ctx["filing_state"], indent=0))
    (DATA / "alerts.json").write_text(json.dumps(ctx["alerts"], indent=1))

    tpl = ROOT / "templates" / "DCF_Template.xlsx"
    if tpl.exists():
        shutil.copy2(tpl, DL / tpl.name)
    live = {r["ticker"] for r in rows}
    for f in DL.glob("*"):  # drop downloads whose model was removed
        if f.name != tpl.name and ticker_of(f.stem) not in live:
            f.unlink()
    keep = ("index.json", "fund.json", "alerts.json", "filing_state.json")
    for f in DATA.glob("*.json"):
        if f.stem.upper() not in live and f.name not in keep:
            f.unlink()
    index = {"generated_at": now, "site": SETTINGS.get("site", {}), "owner": SETTINGS.get("owner", ""),
             "ratings": SETTINGS.get("ratings", {}), "rates": ctx["rates"], "coverage": rows,
             "has_fund": bool(fund)}
    (DATA / "index.json").write_text(json.dumps(index, indent=1, default=str))
    print(f"Done: {len(rows)} model(s); {len(ctx['alerts'])} new filing alert(s).")
    os._exit(1 if rows and all(r.get("status") == "error" for r in rows) else 0)


if __name__ == "__main__":
    main()
