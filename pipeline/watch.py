"""Daily library upkeep: mark every model to market, score calls that are 30+ days old, and rebuild a model
automatically when its company files a new 10-K or 10-Q.

    python pipeline/watch.py            # all models
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate  # noqa: E402
import sources  # noqa: E402

LIB = generate.LIB
MIN_AGE_DAYS = 30


def _close_on(series, day: str):
    """Last close on or before `day` from [[date, close], ...]."""
    best = None
    for d, c in series:
        if d <= day:
            best = c
        else:
            break
    return best


def score(meta: dict, mark: float, mark_date: str, spy: list) -> dict | None:
    """Grade the most recent call that is at least 30 days old."""
    today = dt.date.fromisoformat(mark_date)
    calls = [h for h in (meta.get("history") or []) if h.get("price") and h.get("target") and h.get("date")
             and (today - dt.date.fromisoformat(h["date"])).days >= MIN_AGE_DAYS]
    if not calls:
        return None
    c = calls[-1]
    ret = mark / c["price"] - 1
    s0, s1 = _close_on(spy, c["date"]), _close_on(spy, mark_date)
    spy_ret = (s1 / s0 - 1) if s0 and s1 else None
    rating = c.get("rating")
    hit = (ret > 0) if rating == "Buy" else (ret < 0) if rating == "Sell" else (abs(ret) < 0.10)
    return {"call_date": c["date"], "call_price": c["price"], "call_target": c["target"], "rating": rating,
            "version": c.get("version"), "mark": round(mark, 2), "mark_date": mark_date, "ret": round(ret, 4),
            "spy_ret": round(spy_ret, 4) if spy_ret is not None else None,
            "excess": round(ret - spy_ret, 4) if spy_ret is not None else None,
            "days": (today - dt.date.fromisoformat(c["date"])).days, "hit": bool(hit)}


def main():
    try:
        spy = sources.price_history("SPY")["history"]
    except Exception:  # noqa: BLE001
        spy = []
    rebuild = []
    for path in sorted(LIB.glob("*/*/meta.json")):
        meta = json.loads(path.read_text())
        T = meta["ticker"]
        try:
            px = sources.price_history(T)
            meta["mark"] = {"price": round(px["price"], 2), "date": px["as_of"]}
            meta["track"] = score(meta, px["price"], px["as_of"], spy)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {T}: no price ({exc})")
        try:
            subs = sources.submissions(meta["cik"])
            latest = sources.recent_filings(subs, meta["cik"], forms=("10-K", "10-K/A", "10-Q", "10-Q/A"), limit=1)
            if latest:
                meta["latest_filing_seen"] = latest[0]
            have = (meta.get("last_filing") or {}).get("accession")
            if latest and have and latest[0]["accession"] != have and latest[0]["filed"] >= meta["generated_at"][:10]:
                rebuild.append((T, f"Rebuilt automatically after a new {latest[0]['form']} filed {latest[0]['filed']}."))
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {T}: filing check failed ({exc})")
        path.write_text(json.dumps(meta, indent=1, default=str))
        t = meta.get("track") or {}
        print(f"  {T:6} mark {meta.get('mark', {}).get('price')}  call {t.get('rating', '-')} {t.get('ret', '')}")
    for T, why in rebuild:
        print(f"→ {why} ({T})")
        try:
            generate.generate(T, rebuild=True, reason=why)
        except SystemExit as e:
            print(f"  ! {T}: {e}")
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {T}: rebuild failed ({exc})")
    generate.update_index()
    print(f"watch: {len(rebuild)} rebuilt")


if __name__ == "__main__":
    main()
    import os
    os._exit(0)
