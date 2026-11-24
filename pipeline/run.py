"""Refresh every model in /models and publish JSON + Excel files for the website.

    python pipeline/run.py            # live data (SEC EDGAR + Yahoo Finance)
    FIXTURES_DIR=tests/fixtures python pipeline/run.py   # offline test run
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import shutil
import sys
import traceback
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent))
import fundamentals  # noqa: E402
import ratios  # noqa: E402
import sources  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"
SITE = ROOT / os.environ.get("SITE_DIR", "site")
DATA, DL = SITE / "data", SITE / "downloads"
SETTINGS = yaml.safe_load((ROOT / "config.yml").read_text()) if (ROOT / "config.yml").exists() else {}


def discover() -> list[tuple[Path, dict]]:
    out = []
    for f in sorted(MODELS.glob("*.xls[xm]")):
        if f.name.startswith(("_", "~$", ".")):
            continue
        cfg_path = f.with_suffix(".yml")
        cfg = yaml.safe_load(cfg_path.read_text()) if cfg_path.exists() else {}
        cfg = cfg or {}
        cfg.setdefault("ticker", re.split(r"[_\-\s.]", f.stem)[0].upper())
        out.append((f, cfg))
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


def update_history(ticker: str, date: str, price: float, target):
    path = DATA / "history" / f"{ticker}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    hist = json.loads(path.read_text()) if path.exists() else []
    hist = [h for h in hist if h["date"] != date]
    hist.append({"date": date, "price": round(price, 2), "target": None if target is None else round(target, 2)})
    hist.sort(key=lambda h: h["date"])
    path.write_text(json.dumps(hist[-1000:], indent=0))
    return hist


def process(calc, path: Path, cfg: dict, now: str) -> dict:
    import excel  # imported lazily: needs LibreOffice's python3-uno

    ticker = cfg["ticker"]
    print(f"→ {ticker}  ({path.name})")
    cik, sec_name = sources.cik_for(ticker)
    facts = sources.company_facts(cik)
    subs = sources.submissions(cik)
    fin = fundamentals.build(facts)
    shares = fundamentals.shares_outstanding(facts) or fin["items"]["shares_diluted"][-1]
    mkt = sources.price_history(ticker)
    filings = sources.annual_filings(subs, cik)
    price = mkt["price"]

    items = fin["items"]
    sec_title = subs.get("name") or sec_name
    if sec_title.isupper():  # SEC stores names in capitals
        sec_title = " ".join(w if len(w) <= 3 and w not in ("INC", "CO", "LTD", "CORP") and "&" in w else w.title()
                             for w in sec_title.split())
    debt = (items["short_term_debt"][-1] or 0) + (items["long_term_debt"][-1] or 0)
    live = {
        "ticker": ticker, "company": cfg.get("name") or sec_title,
        "price": price, "price_date": mkt["as_of"], "shares": shares,
        "market_cap": price * shares if shares else None,
        "net_debt": debt - (items["cash"][-1] or 0),
        "tenk_filed": filings[0]["filed"] if filings else "",
        "tenk_url": filings[0]["url"] if filings else "",
        "sources": f"SEC EDGAR XBRL (CIK {cik}); prices: {mkt['source']}",
        "refreshed_at": now, "financials": fin,
    }

    out_xlsx = DL / f"{ticker}_model_live.xlsx"
    res = excel.refresh(calc, path, out_xlsx, live, cfg)
    target, stale = res["target"], False
    if target is None:
        target = cached_target(path, res["target_cell"] or cfg.get("target_price"))
        stale = target is not None
    shutil.copy2(path, DL / f"{ticker}_model_original{path.suffix}")

    upside = (target / price - 1) if target else None
    rt = ratios.compute(fin, price, shares)
    hist = update_history(ticker, mkt["as_of"], price, target)

    record = {
        "ticker": ticker, "name": live["company"], "cik": cik,
        "sector": cfg.get("sector", ""), "analyst": cfg.get("analyst", SETTINGS.get("owner", "")),
        "thesis": cfg.get("thesis", ""), "catalysts": cfg.get("catalysts", []), "risks": cfg.get("risks", []),
        "price": round(price, 2), "price_date": mkt["as_of"], "price_source": mkt["source"],
        "currency": mkt["currency"],
        "target": None if target is None else round(target, 2), "target_cell": res["target_cell"],
        "target_stale": stale, "upside": None if upside is None else round(upside, 4),
        "rating": rating_for(upside, cfg),
        "ratios": rt["groups"], "snapshot": rt["snapshot"],
        "financials": {"labels": fin["labels"], "periods": fin["periods"], "items": fin["items"],
                       "meta": fin["meta"], "concepts": fin["concepts"]},
        "filings": filings, "price_history": mkt["history"], "target_history": hist,
        "model_outputs": res["outputs"], "linked_inputs": res["links"],
        "downloads": {"live": f"downloads/{out_xlsx.name}",
                      "original": f"downloads/{ticker}_model_original{path.suffix}"},
        "model_file": path.name, "model_updated": dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc).strftime("%Y-%m-%d"),
        "refreshed_at": now, "status": "ok",
    }
    (DATA / f"{ticker}.json").write_text(json.dumps(record, indent=1, default=str))
    tp = f"${target:,.2f}" if target else "n/a"
    print(f"  price ${price:,.2f} | target {tp} ({res['target_cell']}) | {record['rating']}")
    return record


def summary(r: dict) -> dict:
    get = lambda g, l: next((i["value"] for grp in r.get("ratios", []) if grp["name"] == g  # noqa: E731
                             for i in grp["items"] if i["label"] == l), None)
    return {k: r.get(k) for k in ("ticker", "name", "sector", "price", "target", "upside", "rating",
                                  "refreshed_at", "status", "target_stale", "error")} | {
        "pe": get("Valuation", "P/E"), "ev_ebitda": get("Valuation", "EV / EBITDA"),
        "op_margin": get("Profitability", "Operating margin"),
        "market_cap": (r.get("snapshot") or {}).get("market_cap"),
        "spark": [p[1] for p in (r.get("price_history") or [])][-60:],
    }


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    DL.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    models = discover()
    if not models:
        print("No models in /models yet.")
    rows = []
    calc = None
    if models:
        import excel
        calc = excel.Calc()
    try:
        for path, cfg in models:
            try:
                rows.append(summary(process(calc, path, cfg, now)))
            except Exception as exc:  # noqa: BLE001 - one bad model must not stop the rest
                traceback.print_exc()
                prev = DATA / f"{cfg['ticker']}.json"
                old = json.loads(prev.read_text()) if prev.exists() else {"ticker": cfg["ticker"], "name": path.stem}
                old.update(status="error", error=str(exc)[:300])
                prev.write_text(json.dumps(old, indent=1, default=str))
                rows.append(summary(old))
    finally:
        if calc:
            calc.close()

    tpl = ROOT / "templates" / "DCF_Template.xlsx"
    if tpl.exists():
        shutil.copy2(tpl, DL / tpl.name)
    live = {r["ticker"] for r in rows}
    for f in DL.glob("*_model_*"):  # drop downloads whose model was removed
        if f.name.split("_model_")[0] not in live:
            f.unlink()
    for f in DATA.glob("*.json"):  # drop tickers whose model was removed
        if f.stem not in live and f.name not in ("index.json",):
            f.unlink()
    index = {"generated_at": now, "site": SETTINGS.get("site", {}), "owner": SETTINGS.get("owner", ""),
             "ratings": SETTINGS.get("ratings", {}), "coverage": rows}
    (DATA / "index.json").write_text(json.dumps(index, indent=1, default=str))
    print(f"Done: {len(rows)} model(s).")
    os._exit(1 if rows and all(r.get("status") == "error" for r in rows) else 0)


if __name__ == "__main__":
    main()
