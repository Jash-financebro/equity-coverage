"""Verified data sources.

Fundamentals come only from SEC EDGAR (the XBRL data the company itself files
with its 10-K). Prices come from Yahoo Finance, with Stooq as a fallback.

Set FIXTURES_DIR to a folder of saved JSON responses to run fully offline
(used by the test suite).
"""
from __future__ import annotations

import datetime as dt
import json
import os
import time
from pathlib import Path

import requests

SEC_UA = os.environ.get("SEC_USER_AGENT") or "ModelPulse equity research admin@example.com"
FIXTURES = os.environ.get("FIXTURES_DIR")

_session = requests.Session()


def _fixture(name: str):
    path = Path(FIXTURES) / name
    if not path.exists():
        raise FileNotFoundError(f"missing fixture {path}")
    text = path.read_text()
    return json.loads(text) if name.endswith(".json") else text


def _get(url: str, *, headers: dict | None = None, as_json: bool = True, tries: int = 4):
    last = None
    for attempt in range(tries):
        try:
            r = _session.get(url, headers=headers or {}, timeout=30)
            if r.status_code == 429 or r.status_code >= 500:
                raise requests.HTTPError(f"{r.status_code} for {url}")
            r.raise_for_status()
            return r.json() if as_json else r.text
        except Exception as exc:  # noqa: BLE001 - retry anything transient
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last}")


def _sec(url: str):
    time.sleep(0.15)  # SEC fair-access policy: max 10 requests/second
    return _get(url, headers={"User-Agent": SEC_UA, "Accept-Encoding": "gzip, deflate"})


# ---------------------------------------------------------------- SEC EDGAR
def cik_for(ticker: str) -> tuple[int, str]:
    data = _fixture("company_tickers.json") if FIXTURES else _sec(
        "https://www.sec.gov/files/company_tickers.json")
    t = ticker.upper().replace(".", "-")
    for row in data.values():
        if row["ticker"].upper() == t:
            return int(row["cik_str"]), row["title"]
    raise KeyError(f"{ticker} not found in SEC ticker list")


def company_facts(cik: int) -> dict:
    if FIXTURES:
        return _fixture(f"companyfacts_{cik}.json")
    return _sec(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json")


def submissions(cik: int) -> dict:
    if FIXTURES:
        return _fixture(f"submissions_{cik}.json")
    return _sec(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")


def annual_filings(subs: dict, cik: int, limit: int = 6) -> list[dict]:
    """Latest 10-K (or 20-F/40-F) filings with direct links to the documents."""
    recent = subs.get("filings", {}).get("recent", {})
    out = []
    for i, form in enumerate(recent.get("form", [])):
        if form not in ("10-K", "10-K/A", "20-F", "40-F"):
            continue
        accn = recent["accessionNumber"][i]
        doc = recent["primaryDocument"][i]
        base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accn.replace('-', '')}"
        out.append({
            "form": form,
            "filed": recent["filingDate"][i],
            "period": recent.get("reportDate", [""] * (i + 1))[i],
            "url": f"{base}/{doc}",
            "index": f"{base}/",
        })
        if len(out) >= limit:
            break
    return out


# ------------------------------------------------------------------ prices
def price_history(ticker: str) -> dict:
    """1y of daily closes plus the latest price. Yahoo first, Stooq fallback."""
    sym = ticker.upper().replace(".", "-")
    try:
        if FIXTURES:
            data = _fixture(f"chart_{sym}.json")
        else:
            data = _get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=1y&interval=1d",
                headers={"User-Agent": "Mozilla/5.0 (ModelPulse)"})
        res = data["chart"]["result"][0]
        closes = res["indicators"]["quote"][0]["close"]
        series = [
            [dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%d"), round(c, 4)]
            for ts, c in zip(res["timestamp"], closes) if c is not None
        ]
        meta = res["meta"]
        price = meta.get("regularMarketPrice") or series[-1][1]
        when = dt.datetime.fromtimestamp(meta.get("regularMarketTime", res["timestamp"][-1]), dt.timezone.utc)
        return {"price": float(price), "as_of": when.strftime("%Y-%m-%d"),
                "currency": meta.get("currency", "USD"), "history": series, "source": "Yahoo Finance"}
    except Exception as exc:  # noqa: BLE001
        if FIXTURES:
            raise
        print(f"  ! Yahoo failed for {sym} ({exc}); trying Stooq")
    text = _get(f"https://stooq.com/q/l/?s={sym.lower()}.us&f=sd2t2ohlcv&h&e=csv", as_json=False)
    row = text.strip().splitlines()[1].split(",")
    return {"price": float(row[6]), "as_of": row[1], "currency": "USD",
            "history": [], "source": "Stooq"}
