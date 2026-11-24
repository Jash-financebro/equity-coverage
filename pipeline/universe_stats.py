"""site/universe/stats.json: latest annual diluted EPS and shares outstanding for every company in the universe,
from SEC XBRL 'frames' (one request returns a figure for every filer). Used for P/E and market cap on the
practice portfolio (and any screen), without calling a market-data API per ticker.

    python pipeline/universe_stats.py
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sources  # noqa: E402
import universe  # noqa: E402

OUT = universe.OUT.parent / "stats.json"


def frame(taxonomy: str, concept: str, unit: str, period: str) -> dict[int, float]:
    try:
        d = sources._sec(f"https://data.sec.gov/api/xbrl/frames/{taxonomy}/{concept}/{unit}/{period}.json")
    except Exception as exc:  # noqa: BLE001
        print(f"  · {concept} {period}: {exc}")
        return {}
    return {int(r["cik"]): float(r["val"]) for r in d.get("data", [])}


def main():
    today = dt.date.today()
    eps: dict[int, float] = {}
    for y in (today.year - 1, today.year - 2):  # latest full fiscal year first; older fills gaps
        for concept in ("EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"):
            for cik, v in frame("us-gaap", concept, "USD-per-shares", f"CY{y}").items():
                eps.setdefault(cik, v)
    shares: dict[int, float] = {}
    q = (today.month - 1) // 3  # last completed quarter
    periods = []
    y, qq = today.year, q
    for _ in range(4):
        if qq == 0:
            y, qq = y - 1, 4
        periods.append(f"CY{y}Q{qq}I")
        qq -= 1
    for p in periods:
        for cik, v in frame("dei", "EntityCommonStockSharesOutstanding", "shares", p).items():
            shares.setdefault(cik, v)
    out = {}
    for c in universe.load()["companies"]:
        e, s = eps.get(int(c["cik"])), shares.get(int(c["cik"]))
        if e is None and s is None:
            continue
        row = [round(e, 4) if e is not None else None, round(s / 1e6, 3) if s else None]
        for t in [c["ticker"], *c.get("other_tickers", [])]:
            out[t] = row
    OUT.write_text(json.dumps({"as_of": today.isoformat(), "fields": ["eps_annual", "shares_mm"], "data": out},
                              separators=(",", ":")))
    print(f"stats: {len(out)} tickers ({len(eps)} EPS, {len(shares)} share counts) → {OUT}")


if __name__ == "__main__":
    main()
