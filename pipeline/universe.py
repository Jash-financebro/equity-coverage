"""Build site/universe/companies.json: every NYSE- and Nasdaq-listed SEC filer with its industry (SIC) and sector.

    python pipeline/universe.py            # live: SEC company_tickers_exchange.json + bulk submissions.zip
    FIXTURES_DIR=tests/fixtures python pipeline/universe.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import sources  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / os.environ.get("SITE_DIR", "site") / "universe" / "companies.json"

# SIC → sector (GICS-style buckets). Ranges are checked in order; first match wins.
SIC_SECTORS = [
    ((2833, 2836), "Health Care"), ((3841, 3851), "Health Care"), ((8000, 8099), "Health Care"), ((5122, 5122), "Health Care"),
    ((6798, 6798), "Real Estate"), ((6500, 6553), "Real Estate"),
    ((6000, 6799), "Financials"),
    ((4900, 4991), "Utilities"),
    ((1300, 1389), "Energy"), ((2900, 2999), "Energy"), ((4610, 4619), "Energy"), ((5171, 5172), "Energy"),
    ((1200, 1299), "Energy"),
    ((3570, 3579), "Information Technology"), ((3660, 3679), "Information Technology"),
    ((3630, 3639), "Consumer Discretionary"), ((3600, 3699), "Industrials"),
    ((7830, 7839), "Communication Services"), ((7200, 7299), "Consumer Discretionary"),
    ((7500, 7699), "Industrials"), ((8300, 8399), "Consumer Discretionary"),
    ((3900, 3999), "Consumer Discretionary"), ((3100, 3199), "Consumer Discretionary"),
    ((2200, 2299), "Consumer Discretionary"), ((3020, 3029), "Consumer Discretionary"),
    ((3810, 3839), "Information Technology"), ((7370, 7379), "Information Technology"),
    ((4800, 4899), "Communication Services"), ((2700, 2799), "Communication Services"),
    ((7810, 7829), "Communication Services"), ((7900, 7999), "Consumer Discretionary"),
    ((2000, 2199), "Consumer Staples"), ((2840, 2844), "Consumer Staples"), ((5400, 5499), "Consumer Staples"),
    ((5140, 5149), "Consumer Staples"), ((5180, 5182), "Consumer Staples"),
    ((3711, 3711), "Consumer Discretionary"), ((3713, 3716), "Consumer Discretionary"),
    ((2300, 2399), "Consumer Discretionary"), ((2500, 2599), "Consumer Discretionary"),
    ((3140, 3149), "Consumer Discretionary"), ((3630, 3639), "Consumer Discretionary"),
    ((5000, 5999), "Consumer Discretionary"), ((7000, 7099), "Consumer Discretionary"),
    ((8200, 8299), "Consumer Discretionary"), ((1500, 1799), "Consumer Discretionary"),
    ((1000, 1199), "Materials"), ((1400, 1499), "Materials"), ((2400, 2499), "Materials"), ((2600, 2699), "Materials"),
    ((2800, 2899), "Materials"), ((3000, 3099), "Materials"), ((3200, 3399), "Materials"),
    ((3400, 3599), "Industrials"), ((3700, 3799), "Industrials"), ((3800, 3899), "Industrials"),
    ((4000, 4799), "Industrials"), ((7300, 7399), "Industrials"), ((8700, 8799), "Industrials"),
    ((100, 999), "Consumer Staples"),
]
EXCHANGES = {"NYSE": "NYSE", "NASDAQ": "Nasdaq"}
MAPPING_VERSION = 3  # bump when SIC_SECTORS changes so the universe rebuilds
SECTORS = sorted({s for _, s in SIC_SECTORS} | {"Other"})


def sector_for(sic) -> str:
    try:
        n = int(sic)
    except (TypeError, ValueError):
        return "Other"
    for (lo, hi), sector in SIC_SECTORS:
        if lo <= n <= hi:
            return sector
    return "Other"


def _submissions_iter(ciks: set[int]):
    """Yield submissions JSON for the given CIKs from SEC's nightly bulk archive."""
    if sources.FIXTURES:
        for cik in ciks:
            p = Path(sources.FIXTURES) / f"submissions_{cik}.json"
            if p.exists():
                yield cik, json.loads(p.read_text())
        return
    import requests
    with tempfile.TemporaryDirectory() as tmp:
        zpath = Path(tmp) / "submissions.zip"
        with requests.get("https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip",
                          headers={"User-Agent": sources.SEC_UA}, stream=True, timeout=600) as r:
            r.raise_for_status()
            with open(zpath, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
        with zipfile.ZipFile(zpath) as z:
            for cik in ciks:
                name = f"CIK{cik:010d}.json"
                try:
                    yield cik, json.loads(z.read(name))
                except KeyError:
                    continue


def build() -> dict:
    data = sources._fixture("company_tickers_exchange.json") if sources.FIXTURES else sources._sec(
        "https://www.sec.gov/files/company_tickers_exchange.json")
    idx = {f: i for i, f in enumerate(data["fields"])}
    nyse = {}  # cik -> [(ticker, name, exchange)]
    for row in data["data"]:
        ex = EXCHANGES.get((row[idx["exchange"]] or "").upper())
        if not ex:
            continue
        cik, ticker = int(row[idx["cik"]]), row[idx["ticker"]]
        nyse.setdefault(cik, []).append((ticker, row[idx["name"]], ex))
    companies = []
    for cik, subs in _submissions_iter(set(nyse)):
        tickers = nyse[cik]
        primary = sorted(tickers, key=lambda t: (len(t[0]), t[0]))[0]
        addr = (subs.get("addresses") or {}).get("business") or {}
        companies.append({
            "ticker": primary[0], "other_tickers": [t for t, *_ in tickers if t != primary[0]],
            "exchange": primary[2],
            "cik": cik, "name": subs.get("name") or primary[1],
            "sic": subs.get("sic"), "industry": (subs.get("sicDescription") or "").title(),
            "sector": sector_for(subs.get("sic")),
            "state": addr.get("stateOrCountry"), "city": (addr.get("city") or "").title(),
            "fye": subs.get("fiscalYearEnd"), "category": subs.get("category"),
            "website": subs.get("website") or "",
        })
    companies.sort(key=lambda c: c["ticker"])
    import datetime as dt
    return {"generated_from": "SEC EDGAR company_tickers_exchange.json (NYSE + Nasdaq) + bulk submissions", "count": len(companies),
            "built_at": dt.date.today().isoformat(), "mapping_version": MAPPING_VERSION,
            "sectors": SECTORS, "companies": companies}


def load() -> dict:
    return json.loads(OUT.read_text())


def stale(days: int) -> bool:
    import datetime as dt
    try:
        if load().get("mapping_version") != MAPPING_VERSION:
            return True
        built = dt.date.fromisoformat(load().get("built_at", "2000-01-01"))
    except Exception:  # noqa: BLE001
        return True
    return (dt.date.today() - built).days >= days


if __name__ == "__main__":
    if "--if-stale" in sys.argv and not stale(int(sys.argv[sys.argv.index("--if-stale") + 1])):
        print("NYSE + Nasdaq universe is fresh; skipping")
        sys.exit(0)
    u = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(u, separators=(",", ":")))
    # compact search index for the browser: ticker, name, sector
    # funds / trusts without an SIC code have no operating financials to model: keep them out of search
    # every listed ticker (share classes too: BRK-B, BF-B) points at its company: [ticker, name, sector, exchange]
    rows = []
    for c in u["companies"]:
        if not c.get("sic") or c["sic"] == "0000":
            continue
        for t in [c["ticker"], *c.get("other_tickers", [])]:
            rows.append([t, c["name"], c["sector"], c.get("exchange", "NYSE")])
    rows.sort(key=lambda r: r[0])
    (OUT.parent / "search.json").write_text(json.dumps(rows, separators=(",", ":")))
    old = OUT.parent / "nyse.json"
    if old.exists():
        old.unlink()
    print(f"NYSE + Nasdaq universe: {u['count']} companies, {len(rows)} searchable tickers → {OUT}")
