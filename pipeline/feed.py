"""RSS feed of what's new on the site: models built, calls graded and fund filings. Written to site/feed.xml.

    python pipeline/feed.py
"""
from __future__ import annotations

import datetime as dt
import email.utils
import json
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://jash-financebro.github.io/equity-coverage/"
WINDOW_DAYS = 21
MAX_ITEMS = 50


def _when(s: str) -> dt.datetime:
    s = (s or "").replace("Z", "")
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s[:19] if "T" in s else s[:10], fmt).replace(tzinfo=dt.timezone.utc)
        except ValueError:
            continue
    return dt.datetime.now(dt.timezone.utc)


def _pct(x) -> str:
    return "n/a" if x is None else f"{x * 100:+.1f}%"


def items(now: dt.datetime | None = None) -> list[dict]:
    now = now or dt.datetime.now(dt.timezone.utc)
    cutoff = now - dt.timedelta(days=WINDOW_DAYS)
    out = []
    try:
        api = json.loads((ROOT / "site" / "api.json").read_text())["api"].rstrip("/")
    except Exception:  # noqa: BLE001
        api = ""
    lib = ROOT / "library" / "index.json"
    models = json.loads(lib.read_text()).get("models", []) if lib.exists() else []
    for m in models:
        T = m["ticker"]
        link = f"{api}/m/{T}" if api else f"{SITE}#/m/{T}"
        when = _when(m.get("generated_at"))
        if when >= cutoff and m.get("target"):
            out.append({"title": f"{T}: {m.get('rating')} with a ${m['target']:,.2f} target ({_pct(m.get('upside'))})",
                        "link": link, "guid": f"model-{T}-v{m.get('version')}", "when": when,
                        "desc": f"{m.get('name')} ({m.get('sector')}). Price ${m.get('price', 0):,.2f} on {m.get('price_date')}. "
                                f"Bear / base / bull: " + " / ".join(f"${(m.get('scenarios') or {}).get(k, 0):,.0f}" for k in ("bear", "base", "bull"))
                                + ". Full Excel model, PDF report and model page."})
        t = m.get("track")
        if t and _when(t.get("mark_date")) >= cutoff:
            out.append({"title": f"{T} call graded: {'worked' if t.get('hit') else 'missed'} ({_pct(t.get('ret'))} vs S&P 500 {_pct(t.get('spy_ret'))})",
                        "link": f"{SITE}#/track", "guid": f"grade-{T}-{t.get('call_date')}", "when": _when(t.get("mark_date")),
                        "desc": f"{t.get('rating')} call made {t.get('call_date')} at ${t.get('call_price', 0):,.2f} with a "
                                f"${t.get('call_target', 0):,.2f} target, graded after {t.get('days')} days."})
    fi = ROOT / "site" / "funds" / "index.json"
    funds = json.loads(fi.read_text()).get("funds", []) if fi.exists() else []
    for f in funds:
        when = _when(f.get("filed"))
        if when >= cutoff:
            top = ", ".join((t or n or "").title() if not t else t for t, n, *_ in (f.get("top") or [])[:3])
            out.append({"title": f"{f['name']} filed its 13F for the quarter ended {f.get('period')}",
                        "link": f"{SITE}#/funds/{f['slug']}", "guid": f"13f-{f['slug']}-{f.get('period')}", "when": when,
                        "desc": f"{f.get('positions')} positions. {f.get('new', 0)} new, {f.get('adds', 0)} added to, "
                                f"{f.get('trims', 0)} trimmed, {f.get('exits', 0)} sold out. Largest: {top}."})
    out.sort(key=lambda x: x["when"], reverse=True)
    return out[:MAX_ITEMS]


def render(rows: list[dict], now: dt.datetime | None = None) -> str:
    now = now or dt.datetime.now(dt.timezone.utc)
    body = "".join(
        f"<item><title>{escape(r['title'])}</title><link>{escape(r['link'])}</link>"
        f"<guid isPermaLink=\"false\">{escape(r['guid'])}</guid><pubDate>{email.utils.format_datetime(r['when'])}</pubDate>"
        f"<description>{escape(r['desc'])}</description></item>\n" for r in rows)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>\n'
            f"<title>Model Builder</title><link>{SITE}</link>"
            f'<atom:link href="{SITE}feed.xml" rel="self" type="application/rss+xml"/>'
            "<description>New company models, graded calls and fund 13F filings from Model Builder.</description>"
            f"<language>en-us</language><lastBuildDate>{email.utils.format_datetime(now)}</lastBuildDate>\n"
            f"{body}</channel></rss>\n")


def main():
    rows = items()
    (ROOT / "site" / "feed.xml").write_text(render(rows))
    print(f"feed: {len(rows)} items")


if __name__ == "__main__":
    main()
