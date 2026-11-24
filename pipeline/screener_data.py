"""site/universe/screener.json: one compact row per NYSE / Nasdaq company for the guided screener.

Fundamentals come from SEC XBRL frames (each request returns one figure for every filer); prices, 1-year change
and beta from Yahoo Finance's multi-symbol spark feed (20 tickers per request).

    python pipeline/screener_data.py
"""
from __future__ import annotations

import datetime as dt
import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sources  # noqa: E402
import universe  # noqa: E402

OUT = universe.OUT.parent / "screener.json"
FIELDS = ["ticker", "name", "sector", "exchange", "price", "chg_1y", "beta", "mcap", "pe", "ev_ebitda", "rev_growth",
          "gross_m", "op_m", "net_m", "div_yield", "payout", "de", "fcf", "fcf_m", "fin", "fy"]
REVENUE = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
           "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet"]


def frame(taxonomy, concept, unit, period) -> dict[int, float]:
    try:
        d = sources._sec(f"https://data.sec.gov/api/xbrl/frames/{taxonomy}/{concept}/{unit}/{period}.json")
        return {int(r["cik"]): float(r["val"]) for r in d.get("data", [])}
    except Exception as exc:  # noqa: BLE001
        print(f"  · {concept} {period}: {str(exc)[:80]}")
        return {}


def first_of(concepts, period, unit="USD") -> dict[int, float]:
    out: dict[int, float] = {}
    for c in concepts:
        for k, v in frame("us-gaap", c, unit, period).items():
            out.setdefault(k, v)
    return out


def instants(concepts, quarters) -> dict[int, float]:
    out: dict[int, float] = {}
    for q in quarters:
        for k, v in first_of(concepts, q).items():
            out.setdefault(k, v)
    return out


def spark(symbols: list[str]) -> dict[str, list[float]]:
    """Two years of weekly closes for up to 20 symbols per request (beta on ~104 weeks is far less noisy)."""
    out = {}
    try:
        d = sources._get("https://query1.finance.yahoo.com/v7/finance/spark?symbols=" + ",".join(symbols)
                         + "&range=2y&interval=1wk", headers={"User-Agent": "Mozilla/5.0 (ModelBuilder)"}, tries=2)
        for r in d.get("spark", {}).get("result", []) or []:
            resp = (r.get("response") or [{}])[0]
            cl = [c for c in ((resp.get("indicators") or {}).get("quote") or [{}])[0].get("close") or [] if c]
            if cl:
                out[r["symbol"]] = cl
    except Exception as exc:  # noqa: BLE001
        print(f"  · spark {symbols[0]}…: {str(exc)[:80]}")
    return out


def beta(stock: list[float], mkt: list[float]):
    n = min(len(stock), len(mkt))
    if n < 30:
        return None
    a = [stock[-n:][i] / stock[-n:][i - 1] - 1 for i in range(1, n)]
    b = [mkt[-n:][i] / mkt[-n:][i - 1] - 1 for i in range(1, n)]
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    var = sum((y - mb) ** 2 for y in b)
    return round(sum((x - ma) * (y - mb) for x, y in zip(a, b)) / var, 2) if var else None


def main():
    today = dt.date.today()
    y1, y0 = today.year - 1, today.year - 2
    q = (today.month - 1) // 3
    quarters, yy, qq = [], today.year, q
    for _ in range(4):
        if qq == 0:
            yy, qq = yy - 1, 4
        quarters.append(f"CY{yy}Q{qq}I")
        qq -= 1
    print("SEC frames…")
    rev1, rev0 = first_of(REVENUE, f"CY{y1}"), first_of(REVENUE, f"CY{y0}")
    gp = first_of(["GrossProfit"], f"CY{y1}")
    op = first_of(["OperatingIncomeLoss"], f"CY{y1}")
    ni = first_of(["NetIncomeLoss", "ProfitLoss"], f"CY{y1}")
    da = first_of(["DepreciationDepletionAndAmortization", "DepreciationAndAmortization",
                   "DepreciationAmortizationAndAccretionNet"], f"CY{y1}")
    cfo = first_of(["NetCashProvidedByUsedInOperatingActivities"], f"CY{y1}")
    capex = first_of(["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"], f"CY{y1}")
    divs = first_of(["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"], f"CY{y1}")
    ltd = instants(["LongTermDebtNoncurrent", "LongTermDebt"], quarters)
    std = instants(["LongTermDebtCurrent", "DebtCurrent"], quarters)
    stb = instants(["ShortTermBorrowings", "CommercialPaper"], quarters)
    eq = instants(["StockholdersEquity"], quarters)
    cash = instants(["CashAndCashEquivalentsAtCarryingValue"], quarters)
    shares: dict[int, float] = {}
    for p in quarters:
        for k, v in frame("dei", "EntityCommonStockSharesOutstanding", "shares", p).items():
            shares.setdefault(k, v)

    comps = [c for c in universe.load()["companies"] if c.get("sic") and c["sic"] != "0000"]
    syms = [c["ticker"] for c in comps]
    print(f"prices for {len(syms)} tickers…")
    closes: dict[str, list[float]] = {}
    batches = [syms[i:i + 20] for i in range(0, len(syms), 20)] + [["SPY"]]
    with ThreadPoolExecutor(max_workers=6) as ex:
        for part in ex.map(spark, batches):
            closes.update(part)
    spy = closes.get("SPY") or []
    print(f"  {len(closes)} priced")

    rows = []
    for c in comps:
        cik, t = int(c["cik"]), c["ticker"]
        cl = closes.get(t)
        px = cl[-1] if cl else None
        sh = shares.get(cik)
        mcap = px * sh / 1e6 if px and sh else None
        r1, r0, n_ = rev1.get(cik), rev0.get(cik), ni.get(cik)
        m = lambda v: v / 1e6 if v is not None else None  # noqa: E731
        debt = sum(v for v in (ltd.get(cik), std.get(cik), stb.get(cik)) if v)
        ebitda = (op[cik] + (da.get(cik) or 0)) if cik in op else None
        ev = mcap + m(debt) - (m(cash.get(cik)) or 0) if mcap is not None else None
        fcf = (cfo[cik] - (capex.get(cik) or 0)) if cik in cfo else None
        sic = int(c["sic"])
        fin = 1 if (6000 <= sic <= 6411 or sic == 6798) else 0
        rnd = lambda v, d=4: (round(v, d) if v is not None and math.isfinite(v) else None)  # noqa: E731
        row = {
            "ticker": t, "name": c["name"], "sector": c["sector"], "exchange": c.get("exchange", "NYSE"),
            "price": rnd(px, 2), "chg_1y": rnd(cl[-1] / cl[-53] - 1) if cl and len(cl) >= 53 and cl[-53] else None,
            "beta": beta(cl, spy) if cl and spy else None, "mcap": rnd(mcap, 1),
            "pe": rnd(mcap / m(n_), 1) if mcap and n_ and n_ > 0 else None,
            "ev_ebitda": rnd(ev / m(ebitda), 1) if ev and ebitda and ebitda > 0 and not fin else None,
            "rev_growth": rnd(r1 / r0 - 1) if r1 and r0 and r0 > 0 else None,
            "gross_m": rnd(gp[cik] / r1) if r1 and cik in gp and r1 > 0 else None,
            "op_m": rnd(op[cik] / r1) if r1 and cik in op and r1 > 0 else None,
            "net_m": rnd(n_ / r1) if r1 and n_ is not None and r1 > 0 else None,
            "div_yield": rnd((divs.get(cik) or 0) / 1e6 / mcap) if mcap else None,
            "payout": rnd(divs[cik] / n_) if cik in divs and n_ and n_ > 0 else None,
            "de": rnd(debt / eq[cik], 2) if cik in eq and eq[cik] > 0 else None,
            "fcf": rnd(m(fcf), 1), "fcf_m": rnd(fcf / r1) if fcf is not None and r1 and r1 > 0 else None,
            "fin": fin, "fy": y1 if (r1 or n_) else None,
        }
        # sanity: drop absurd values from tagging errors
        for k, lo, hi in (("pe", 0, 2000), ("ev_ebitda", 0, 500), ("rev_growth", -0.95, 20), ("div_yield", 0, 0.5),
                          ("gross_m", -5, 1.01), ("op_m", -50, 1), ("net_m", -50, 5), ("de", 0, 100), ("payout", 0, 10)):
            if row[k] is not None and not (lo <= row[k] <= hi):
                row[k] = None
        if row["price"] is None and row["fy"] is None:
            continue
        rows.append([row[f] for f in FIELDS])
    OUT.write_text(json.dumps({"as_of": today.isoformat(), "fiscal_year": y1, "fields": FIELDS, "rows": rows},
                              separators=(",", ":")))
    print(f"screener: {len(rows)} companies → {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
