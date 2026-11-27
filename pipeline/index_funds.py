"""Index fund data for the "Index funds" tab: returns, risk, costs and holdings for the most popular index ETFs,
the S&P 500's full monthly history (for the "what could monthly investing become" calculator), and a rough read
on market valuation. Written to site/index/data.json.

    python pipeline/index_funds.py
"""
from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path

import requests

import sources

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "site" / "index" / "data.json"
UA = {"User-Agent": "Mozilla/5.0 (ModelBuilder)"}

# expense ratios as published by each issuer (used when Yahoo doesn't return one); checked Nov 2026
FUNDS = [
    {"t": "VOO", "name": "Vanguard S&P 500 ETF", "tracks": "S&P 500: the 500 largest US companies", "kind": "US stocks", "er": 0.0003,
     "url": "https://investor.vanguard.com/investment-products/etfs/profile/voo"},
    {"t": "VTI", "name": "Vanguard Total Stock Market ETF", "tracks": "Nearly every US stock, about 3,500 companies", "kind": "US stocks", "er": 0.0003,
     "url": "https://investor.vanguard.com/investment-products/etfs/profile/vti"},
    {"t": "QQQ", "name": "Invesco QQQ Trust", "tracks": "Nasdaq-100: the 100 largest non-financial Nasdaq stocks, tech-heavy", "kind": "US stocks", "er": 0.0020,
     "url": "https://www.invesco.com/qqq-etf/en/home.html"},
    {"t": "SCHD", "name": "Schwab U.S. Dividend Equity ETF", "tracks": "About 100 US companies with long, well-covered dividends", "kind": "US stocks", "er": 0.0006,
     "url": "https://www.schwabassetmanagement.com/products/schd"},
    {"t": "VXUS", "name": "Vanguard Total International Stock ETF", "tracks": "About 8,500 companies outside the US", "kind": "International stocks", "er": 0.0005,
     "url": "https://investor.vanguard.com/investment-products/etfs/profile/vxus"},
    {"t": "VT", "name": "Vanguard Total World Stock ETF", "tracks": "The whole world's stock market in one fund", "kind": "Global stocks", "er": 0.0006,
     "url": "https://investor.vanguard.com/investment-products/etfs/profile/vt"},
    {"t": "BND", "name": "Vanguard Total Bond Market ETF", "tracks": "US investment-grade bonds: Treasuries, mortgages, corporates", "kind": "Bonds", "er": 0.0003,
     "url": "https://investor.vanguard.com/investment-products/etfs/profile/bnd"},
]


def monthly(sym: str) -> list[list]:
    """[[YYYY-MM, total-return index (dividends reinvested)], ...] from Yahoo's adjusted closes."""
    d = sources._get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=max&interval=1mo&events=div",
                     headers=UA)["chart"]["result"][0]
    adj = d["indicators"]["adjclose"][0]["adjclose"]
    out = []
    for ts, a in zip(d["timestamp"], adj):
        if a:
            ym = dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m")
            if out and out[-1][0] == ym:
                out[-1][1] = a
            else:
                out.append([ym, a])
    meta = d["meta"]
    return out, meta


def ann(series, years: int):
    n = years * 12
    if len(series) <= n:
        return None
    return (series[-1][1] / series[-1 - n][1]) ** (1 / years) - 1


def stats(series) -> dict:
    vals = [v for _, v in series]
    rets = [vals[i] / vals[i - 1] - 1 for i in range(1, len(vals))]
    peak, mdd, mdd_at = vals[0], 0.0, None
    for (ym, v) in series:
        peak = max(peak, v)
        dd = v / peak - 1
        if dd < mdd:
            mdd, mdd_at = dd, ym
    years = {}
    for ym, v in series:
        years.setdefault(ym[:4], []).append(v)
    ys = sorted(years)
    cal = {y: years[y][-1] / years[ys[i - 1]][-1] - 1 for i, y in enumerate(ys) if i and int(y) < dt.date.today().year}
    worst = min(cal.items(), key=lambda kv: kv[1]) if cal else (None, None)
    best = max(cal.items(), key=lambda kv: kv[1]) if cal else (None, None)
    vol = (sum((r - sum(rets) / len(rets)) ** 2 for r in rets) / (len(rets) - 1)) ** 0.5 * math.sqrt(12) if len(rets) > 2 else None
    span = len(series) / 12
    return {"r1": ann(series, 1), "r3": ann(series, 3), "r5": ann(series, 5), "r10": ann(series, 10),
            "since": (vals[-1] / vals[0]) ** (1 / span) - 1 if span >= 1 else None, "start": series[0][0],
            "vol": vol, "max_dd": mdd, "max_dd_at": mdd_at, "worst_year": worst, "best_year": best,
            "down_years": sum(1 for v in cal.values() if v < 0), "years": len(cal)}


def rolling(series, years: int) -> dict:
    n = years * 12
    rs = [(series[i + n][1] / series[i][1]) ** (1 / years) - 1 for i in range(len(series) - n)]
    if not rs:
        return {}
    rs.sort()
    return {"n": len(rs), "positive": sum(1 for r in rs if r > 0) / len(rs), "worst": rs[0], "median": rs[len(rs) // 2], "best": rs[-1]}


def fund_profile(sym: str) -> dict:
    try:
        d = sources._get(f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{sym}?modules=fundProfile,summaryDetail,topHoldings"
                         f"&crumb={sources._yahoo_crumb()}", headers=UA, tries=2)["quoteSummary"]["result"][0]
    except Exception as exc:  # noqa: BLE001
        print(f"  · profile unavailable for {sym}: {str(exc)[:80]}")
        return {}
    raw = lambda x: x.get("raw") if isinstance(x, dict) else x  # noqa: E731
    fp, sd, th = d.get("fundProfile", {}), d.get("summaryDetail", {}), d.get("topHoldings", {})
    er = raw((fp.get("feesExpensesInvestment") or {}).get("annualReportExpenseRatio") or {})
    top = [{"t": h.get("symbol"), "name": h.get("holdingName"), "w": raw(h.get("holdingPercent") or {})} for h in th.get("holdings", [])][:10]
    sectors = {}
    for s in th.get("sectorWeightings", []):
        for k, v in s.items():
            if raw(v):
                sectors[k] = raw(v)
    return {"er_yahoo": er, "yield": raw(sd.get("yield") or {}) or raw(sd.get("trailingAnnualDividendYield") or {}),
            "assets": raw(sd.get("totalAssets") or {}), "top": top, "sectors": sectors}


def market_valuation() -> dict:
    """Rough S&P 500 valuation: the 500 largest US companies in our screener data, earnings summed across them."""
    try:
        scr = json.loads((ROOT / "site" / "universe" / "screener.json").read_text())
    except Exception:  # noqa: BLE001
        return {}
    F = scr["fields"]
    rows = [dict(zip(F, r)) for r in scr["rows"]]
    rows = [r for r in rows if r.get("mcap") and (r.get("country") or "United States") == "United States"]
    top = sorted(rows, key=lambda r: -r["mcap"])[:500]
    cap = sum(r["mcap"] for r in top)
    earn = sum(r["mcap"] / r["pe"] for r in top if r.get("pe") and r["pe"] > 0)
    top10 = sum(r["mcap"] for r in top[:10]) / cap if cap else None
    out = {"pe": cap / earn if earn else None, "top10_share": top10, "n": len(top), "top10": [r["ticker"] for r in top[:10]]}
    try:
        d = sources._get("https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?range=5d&interval=1d", headers=UA)["chart"]["result"][0]
        out["t10"] = d["meta"]["regularMarketPrice"] / 100
    except Exception:  # noqa: BLE001
        pass
    return out


def main():
    data = {"built_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d"), "funds": []}
    for f in FUNDS:
        try:
            ser, meta = monthly(f["t"])
            rec = {**f, "price": meta.get("regularMarketPrice"), **stats(ser), **fund_profile(f["t"])}
            if rec.get("er_yahoo") and 0 < rec["er_yahoo"] < 0.02:
                rec["er"] = rec["er_yahoo"]
            data["funds"].append(rec)
            print(f"  {f['t']}: 10y {rec['r10']}, max drop {rec['max_dd']:.0%}, er {rec['er']}")
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {f['t']}: {str(exc)[:100]}")
    try:
        spy, _ = monthly("SPY")
        data["spy"] = {"start": spy[0][0], "end": spy[-1][0], "v": [round(v, 4) for _, v in spy],
                       "rolling": {str(y): rolling(spy, y) for y in (1, 5, 10, 20)}, **{k: v for k, v in stats(spy).items() if k in ("max_dd", "max_dd_at", "worst_year", "best_year", "down_years", "years", "since")}}
    except Exception as exc:  # noqa: BLE001
        print(f"  ! SPY history: {exc}")
    data["market"] = market_valuation()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":"), default=lambda x: None))
    print(f"index funds: {len(data['funds'])} funds, SPY {len((data.get('spy') or {}).get('v', []))} months")


if __name__ == "__main__":
    main()
