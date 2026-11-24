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


def recent_filings(subs: dict, cik: int, forms=("10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "40-F"), limit=8):
    recent = subs.get("filings", {}).get("recent", {})
    out = []
    for i, form in enumerate(recent.get("form", [])):
        if form in forms:
            accn = recent["accessionNumber"][i]
            base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accn.replace('-', '')}"
            out.append({"form": form, "filed": recent["filingDate"][i], "accession": accn,
                        "period": recent.get("reportDate", [""] * (i + 1))[i],
                        "url": f"{base}/{recent['primaryDocument'][i]}"})
            if len(out) >= limit:
                break
    return out


# ------------------------------------------------------------------ prices
def price_history(ticker: str) -> dict:
    """1y of daily closes plus the latest price. Yahoo first, Stooq fallback."""
    sym = ticker.upper().replace(".", "-")
    try:
        if FIXTURES:
            data = _fixture(f"chart_{_fname(sym)}.json")
        else:
            data = _get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(sym)}?range=1y&interval=1d",
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


# --------------------------------------------------- Yahoo quote summary
_crumb = None


def _fname(sym: str) -> str:
    return sym.replace("^", "_")


def _yahoo_crumb():
    global _crumb
    if _crumb is None:
        h = {"User-Agent": "Mozilla/5.0 (ModelPulse)"}
        try:
            _session.get("https://fc.yahoo.com", headers=h, timeout=20)
        except Exception:  # noqa: BLE001 - it 404s but still sets the cookie
            pass
        _crumb = _get("https://query2.finance.yahoo.com/v1/test/getcrumb", headers=h, as_json=False, tries=2)
    return _crumb


_QS_CACHE: dict[str, dict] = {}


def quote_summary(ticker: str) -> dict:
    """Street consensus targets, beta, sector. Returns {} if Yahoo refuses. Cached per run."""
    key = ticker.upper().replace(".", "-")
    if key not in _QS_CACHE:
        _QS_CACHE[key] = _quote_summary(key)
    return dict(_QS_CACHE[key])


def _quote_summary(ticker: str) -> dict:
    sym = ticker.upper().replace(".", "-")
    try:
        if FIXTURES:
            data = _fixture(f"quoteSummary_{_fname(sym)}.json")
        else:
            data = _get(
                f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{sym}"
                f"?modules=financialData,defaultKeyStatistics,summaryProfile&crumb={_yahoo_crumb()}",
                headers={"User-Agent": "Mozilla/5.0 (ModelPulse)"}, tries=2)
        res = data["quoteSummary"]["result"][0]
    except Exception as exc:  # noqa: BLE001
        if not FIXTURES:
            print(f"  ! consensus unavailable for {sym}: {exc}")
        return {}
    fd, ks, sp = res.get("financialData", {}), res.get("defaultKeyStatistics", {}), res.get("summaryProfile", {})
    raw = lambda d, k: (d.get(k) or {}).get("raw") if isinstance(d.get(k), dict) else d.get(k)  # noqa: E731
    return {
        "target_mean": raw(fd, "targetMeanPrice"), "target_median": raw(fd, "targetMedianPrice"),
        "target_high": raw(fd, "targetHighPrice"), "target_low": raw(fd, "targetLowPrice"),
        "analysts": raw(fd, "numberOfAnalystOpinions"), "recommendation": fd.get("recommendationKey"),
        "beta": raw(ks, "beta"), "sector": sp.get("sector"), "industry": sp.get("industry"),
        "revenue": (raw(fd, "totalRevenue") / 1e6) if raw(fd, "totalRevenue") else None,
        "website": sp.get("website"), "source": "Yahoo Finance",
    }


def similar_symbols(ticker: str) -> list[str]:
    """Yahoo Finance's 'similar companies' list for a ticker ([] if unavailable)."""
    if FIXTURES:
        return []
    sym = ticker.upper().replace(".", "-")
    try:
        data = _get(f"https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/{sym}",
                    headers={"User-Agent": "Mozilla/5.0 (ModelPulse)"}, tries=2)
        res = (data.get("finance", {}).get("result") or [{}])[0]
        return [r["symbol"] for r in res.get("recommendedSymbols", []) if r.get("symbol")]
    except Exception as exc:  # noqa: BLE001
        print(f"  ! similar companies unavailable for {sym}: {exc}")
        return []


def rates() -> dict:
    """10-year Treasury yield and 13-week T-bill yield (decimals)."""
    out = {}
    for key, sym in (("rf_10y", "^TNX"), ("tbill_3m", "^IRX")):
        try:
            p = price_history(sym)["price"]
            out[key] = round((p / 10 if p > 20 else p) / 100, 5)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {sym} unavailable: {exc}")
    out.setdefault("rf_10y", 0.042)
    out.setdefault("tbill_3m", out["rf_10y"])
    return out
