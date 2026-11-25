"""Earnings notes: a plain-English summary of a company's latest earnings, built from what it filed with the SEC.

Source: the 8-K (Item 2.02 "Results of Operations") the company files on earnings day, and the press release and any
slides, CFO commentary or prepared remarks attached to it as exhibits. Every line we show is quoted word for word from
those documents and linked, so a reader can check it against the original. Most companies don't file call
transcripts with the SEC; when one does, it's picked up the same way.

    python pipeline/earnings.py KO out.json
"""
from __future__ import annotations

import datetime as dt
import html as htmlmod
import json
import re
import sys
from pathlib import Path

import fundamentals
import guidance
import sources

QUARTERS_LISTED = 4
METRIC = re.compile(r"\b(revenue|revenues|net sales|sales|organic|EPS|earnings per (?:diluted )?share|operating (?:income|profit|margin)|"
                    r"gross margin|net income|free cash flow|cash flow from operations|EBITDA|bookings|backlog|"
                    r"same[- ]store|comparable sales|subscribers|deliveries|volume|unit case|ARR|deposits|loans|"
                    r"net interest income|book value)\b", re.I)
PAST = re.compile(r"\b(grew|increased|decreased|declined|rose|fell|was|were|reported|delivered|totaled|reached|"
                  r"compared (?:to|with)|up|down|expanded|contracted|improved)\b", re.I)
NOISE = re.compile(r"forward-looking|safe harbor|risks and uncertainties|reconcil|see (?:the )?(?:table|appendix)|"
                   r"following table|footnote|non-gaap financial measures? (?:is|are) (?:included|provided)|"
                   r"this (?:press )?release contains|\(\d+\)|^\(?in (?:millions|thousands)", re.I)
CAPITAL = re.compile(r"\b(dividend|repurchas\w*|buyback|returned .{0,40}to (?:share|stock)holders)\b", re.I)
QUOTE = re.compile(r"[“\"]([^”\"]{40,420})[”\"]\s*,?\s*(?:said|says|commented|added|stated)\s+([^.]{3,140})", re.I)
QUOTE2 = re.compile(r"(?:said|says)\s+([A-Z][^,“\"]{3,80}),?\s*[“\"]([^”\"]{40,420})[”\"]")
DOC_KIND = (("transcript", "Call transcript"), ("prepared remarks", "Prepared remarks"), ("cfo commentary", "CFO commentary"),
            ("commentary", "Management commentary"), ("presentation", "Slides"), ("slides", "Slides"),
            ("supplement", "Financial supplement"), ("press release", "Press release"), ("earnings release", "Press release"))


def _text(raw: str) -> str:
    return guidance._text(raw)


def _sentences(text: str) -> list[str]:
    text = re.sub(r"\s*[•▪●◦■]\s*", " . ", text)
    text = re.sub(r"(^|[.!?:]\s+)[nlqüØ§v]\s+(?=[A-Z$])", r"\1", text)   # Wingdings bullets render as a lone letter
    out = []
    for s in re.split(r"(?<=[.!?])\s+(?=[A-Z(\"“$])|\s\.\s", text):
        s = re.sub(r"\s+", " ", s).strip(" .")
        s = re.sub(r"^(?:[nlqüØ§v]|\d{1,2})\s+(?=[A-Z$])", "", s)     # Wingdings bullets ("n Revenue ...") and stray footnote marks
        s = re.sub(r"\s+Document$", "", s)
        if s:
            out.append(s + ("" if s.endswith(("!", "?", "”", '"')) else "."))
    return out


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


TABLE_ROW = re.compile(r"\(\d[\d,.]*\)\s*\(?\d|\d[\d,]{3,}\s+\(?\d[\d,]{3,}")


def _ok_sentence(s: str, lo=40, hi=330, words=6) -> bool:
    return (lo <= len(s) <= hi and len(s.split()) >= words and not NOISE.search(s) and not s.rstrip(".").endswith(":")
            and not TABLE_ROW.search(s))


def _rank_results(sents: list[str]) -> list[str]:
    scored = []
    for i, s in enumerate(sents):
        if not _ok_sentence(s, 30) or not METRIC.search(s) or not re.search(r"\d", s) or not PAST.search(s) or re.search(r"[“”\"]", s):
            continue
        if guidance.KEYWORDS.search(s) and not PAST.search(s[:40]):
            continue  # outlook, shown separately
        sc = 3 * bool(re.search(r"\b(revenue|net sales|sales)\b", s, re.I)) + 3 * bool(re.search(r"\bEPS\b|per (?:diluted )?share", s, re.I)) \
            + 2 * bool(re.search(r"operating (?:income|margin)|free cash flow|gross margin", s, re.I)) \
            + bool(re.search(r"quarter|year[- ]over[- ]year|compared", s, re.I)) - i / 60
        scored.append((sc, i, s))
    pick = sorted(scored, reverse=True)[:7]
    return [s for _, _, s in sorted(pick, key=lambda x: x[1])]


def _dedupe(xs: list[str], n: int) -> list[str]:
    out, seen = [], set()
    for x in xs:
        k = re.sub(r"\W+", "", x.lower())[:70]
        if k not in seen:
            seen.add(k)
            out.append(x)
        if len(out) >= n:
            break
    return out


def _quotes(text: str) -> list[dict]:
    out = []
    for m in QUOTE.finditer(text):
        q, who = _clean(m.group(1)), _clean(m.group(2)).rstrip(".")
        who = re.split(r"\s+(?:in|on|at)\s+(?:a|the)\s+|\.\s", who)[0][:120]
        out.append({"text": q, "who": who})
    for m in QUOTE2.finditer(text):
        out.append({"text": _clean(m.group(2)), "who": _clean(m.group(1))[:120]})
    keep, seen = [], set()
    for q in out:
        k = q["text"][:50].lower()
        if k in seen or NOISE.search(q["text"]) or len(q["text"].split()) < 8:
            continue
        seen.add(k)
        keep.append(q)
    return keep[:3]


def _outlook(text: str, sents: list[str]) -> list[str]:
    """Guidance sentences, plus the lines under an "Outlook" / "Guidance" heading (often bullets with no verb)."""
    found = list(guidance._sentences(text))
    for m in re.finditer(r"\.\s+((?:[A-Z][\w&/-]* ){0,5}(?:Outlook|Guidance|OUTLOOK|GUIDANCE))(?=\s*[.:])", text):
        if m.start() < 300:
            continue
        chunk = text[m.end(): m.end() + 2200]
        for s in _sentences(chunk)[:10]:
            if re.search(r"forward-looking|conference call|webcast|non-gaap financial measures", s, re.I):
                break
            if guidance.PAST_ONLY.search(s) and not guidance.KEYWORDS.search(s):
                continue   # a result, not a forecast
            if 20 <= len(s) <= 300 and METRIC.search(s) and re.search(r"\d", s) and not TABLE_ROW.search(s) and not NOISE.search(s):
                found.append(s)
        if len(found) >= 3:
            break
    return _dedupe(found, 6)


def _call_info(sents: list[str], raw: str) -> dict:
    info = {}
    for s in sents:
        if re.search(r"\b(conference call|webcast|earnings call|call to discuss)\b", s, re.I) and 40 <= len(s) <= 400 and re.search(r"\d|will|available|today", s):
            info["sentence"] = s
            break
    for m in re.finditer(r'href="(https?://[^"]+)"[^>]*>([^<]{0,120})', raw, re.I):
        url, label = m.group(1), m.group(2)
        ctx = raw[max(0, m.start() - 300): m.end() + 100].lower()
        if any(k in ctx for k in ("webcast", "conference call", "earnings call", "investor")) and "sec.gov" not in url:
            info["url"] = url
            break
    if "url" not in info:
        m = re.search(r"(https?://[^\s<>\"]*(?:investor|ir\.|webcast|events)[^\s<>\")]*)", _text(raw), re.I)
        if m:
            info["url"] = m.group(1).rstrip(".,;)")
    return info


def _period(text: str, filed: str) -> str:
    m = re.search(r"\b(first|second|third|fourth)[- ]quarter(?: of)?(?: fiscal(?: year)?)? (20\d\d)", text, re.I) or \
        re.search(r"\b(Q[1-4])\s*(?:FY|fiscal )?'?(20\d\d|\d\d)\b", text)
    if m:
        q = {"first": "Q1", "second": "Q2", "third": "Q3", "fourth": "Q4"}.get(m.group(1).lower(), m.group(1).upper())
        y = m.group(2) if len(m.group(2)) == 4 else "20" + m.group(2)
        return f"{q} {'fiscal ' if 'fiscal' in m.group(0).lower() else ''}{y}"
    if re.search(r"full[- ]year|fourth quarter and (?:full|fiscal)", text[:2000], re.I):
        return "Full year"
    return f"Filed {filed}"


def _exhibits(base: str, accn: str) -> list[dict]:
    """Exhibits listed on the filing index page: type, description, url."""
    try:
        page = sources._get(f"{base}/{accn}-index.htm", headers={"User-Agent": sources.SEC_UA}, as_json=False)
    except Exception:  # noqa: BLE001
        page = ""
    docs = []
    for row in re.findall(r"(?is)<tr[^>]*>(.*?)</tr>", page or ""):
        cells = [_clean(htmlmod.unescape(re.sub(r"<[^>]+>", " ", c))) for c in re.findall(r"(?is)<td[^>]*>(.*?)</td>", row)]
        href = re.search(r'href="([^"]+)"', row)
        if len(cells) >= 4 and href:
            desc, typ = cells[1], cells[3]
            url = href.group(1)
            url = ("https://www.sec.gov" + url) if url.startswith("/") else url
            url = re.sub(r"/ix\?doc=", "", url)
            docs.append({"type": typ, "desc": desc, "url": url})
    if not docs:   # fall back to the JSON directory listing
        try:
            idx = sources._sec(f"{base}/index.json")
            for it in idx.get("directory", {}).get("item", []):
                n = it["name"]
                if n.lower().endswith((".htm", ".html")) and "index" not in n.lower():
                    docs.append({"type": "EX-99" if re.search(r"ex-?99|99", n, re.I) else "", "desc": n, "url": f"{base}/{n}"})
        except Exception:  # noqa: BLE001
            pass
    return docs


def _label(d: dict) -> str:
    s = f"{d['desc']} {d['type']}".lower()
    for k, lab in DOC_KIND:
        if k in s:
            return lab
    return "Exhibit " + d["type"].replace("EX-", "") if d["type"].startswith("EX-") else (d["desc"] or "Document")


def notes(ticker: str) -> dict:
    T = ticker.upper().replace(".", "-")
    cik, title = sources.cik_for(T)
    subs = sources.submissions(cik)
    name = subs.get("name") or title
    rec = subs.get("filings", {}).get("recent", {})
    events = []
    for i, form in enumerate(rec.get("form", [])):
        if form in ("8-K", "8-K/A") and "2.02" in (rec.get("items", [""] * (i + 1))[i] or ""):
            events.append(i)
        if len(events) >= QUARTERS_LISTED:
            break
    out = {"ticker": T, "name": name, "cik": cik, "built_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "ir_site": subs.get("website") or "", "events": [], "edgar": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=8-K"}
    if not events:
        out["note"] = "No earnings release (8-K, Item 2.02) found in the company's recent SEC filings."
        return out
    for n, i in enumerate(events):
        accn, filed = rec["accessionNumber"][i], rec["filingDate"][i]
        base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accn.replace('-', '')}"
        ev = {"filed": filed, "accession": accn, "filing_url": f"{base}/{accn}-index.htm", "docs": []}
        exs = [d for d in _exhibits(base, accn) if d["type"].upper().startswith("EX-99") or re.search(r"ex-?99", d["url"], re.I)]
        ev["docs"] = [{"label": _label(d), "url": d["url"], "type": d["type"]} for d in exs][:6]
        if n == 0 and exs:
            main = next((d for d in exs if _label(d) == "Press release"), exs[0])
            raw = sources._get(main["url"], headers={"User-Agent": sources.SEC_UA}, as_json=False)
            raw = raw if isinstance(raw, str) else raw.decode("utf-8", "ignore")
            text = _text(raw)
            sents = _sentences(text)
            head = next((s for s in sents[:12] if re.search(r"\b(reports?|announces?|results|delivers)\b", s, re.I) and len(s) <= 220), None)
            ev.update({"period": _period(text[:4000], filed), "source_url": main["url"], "source_label": _label(main),
                       "headline": head, "results": _dedupe(_rank_results(sents), 6),
                       "outlook": _outlook(text, sents),
                       "quotes": _quotes(text),
                       "capital": _dedupe([s for s in sents if CAPITAL.search(s) and re.search(r"\d", s) and _ok_sentence(s, 40, 300) and not re.search(r"[“”\"]", s)], 3),
                       "call": _call_info(sents, raw)})
            # remarks or a transcript filed as a separate exhibit: take management quotes from it too
            extra = next((d for d in exs if _label(d) in ("Call transcript", "Prepared remarks", "CFO commentary", "Management commentary") and d is not main), None)
            if extra and len(ev["quotes"]) < 3:
                try:
                    r2 = sources._get(extra["url"], headers={"User-Agent": sources.SEC_UA}, as_json=False)
                    t2 = _sentences(_text(r2 if isinstance(r2, str) else r2.decode("utf-8", "ignore")))
                    picks = [s for s in t2 if _ok_sentence(s, 60, 300) and (METRIC.search(s) or guidance.KEYWORDS.search(s)) and re.search(r"\b(we|our)\b", s, re.I)]
                    for s in _dedupe(picks, 3 - len(ev["quotes"])):
                        ev["quotes"].append({"text": s, "who": _label(extra), "url": extra["url"]})
                except Exception:  # noqa: BLE001
                    pass
        else:
            ev["period"] = None
        out["events"].append(ev)
    # the reported numbers from XBRL (10-Q / 10-K), labelled with the period they cover
    try:
        facts = sources.company_facts(cik)
        fin = fundamentals.build(facts)
        lq = fundamentals.latest_quarter(facts, fin)
        if lq:
            out["numbers"] = {"label": lq.get("label"), "as_of": lq.get("as_of"), "quarter": lq.get("quarter"), "ttm": lq.get("ttm"),
                              "form": "10-Q" if lq.get("is_10q") else "10-K"}
    except Exception as exc:  # noqa: BLE001
        print(f"  · numbers unavailable: {str(exc)[:80]}")
    out["summary"] = summarize(out)
    return out


def _chg(x):
    return f"{'up' if x >= 0 else 'down'} {abs(x) * 100:.0f}%" if x is not None else None


def summarize(o: dict) -> list[str]:
    """Three to five plain-English lines, written from the numbers (not quoted)."""
    lines = []
    q = (o.get("numbers") or {}).get("quarter") or {}
    lab = (o.get("numbers") or {}).get("label") or "the latest quarter"
    rv, ni, eps, oi = q.get("revenue"), q.get("net_income"), q.get("eps_diluted"), q.get("operating_income")
    if rv and rv.get("cur"):
        lines.append(f"Revenue was ${rv['cur'] / 1000:,.2f} billion in {lab.replace('Quarter ended', 'the quarter ended').replace('Year ended', 'the year ended')}"
                     + (f", {_chg(rv.get('chg'))} from a year earlier." if rv.get("chg") is not None else "."))
    if eps and eps.get("cur") is not None:
        lines.append(f"Diluted earnings per share were ${eps['cur']:,.2f}" + (f", {_chg(eps.get('chg'))} on the year." if eps.get("chg") is not None else "."))
    if oi and rv and oi.get("cur") and rv.get("cur"):
        m_now = oi["cur"] / rv["cur"]
        m_then = (oi["prior"] / rv["prior"]) if oi.get("prior") and rv.get("prior") else None
        lines.append(f"Operating margin was {m_now * 100:.1f}%" + (f", {'wider' if m_now >= m_then else 'narrower'} than {m_then * 100:.1f}% a year ago." if m_then else "."))
    ev = (o.get("events") or [{}])[0]
    if ev.get("outlook"):
        lines.append("Management gave an outlook: see “What they expect next” below.")
    if ev.get("capital"):
        lines.append("The release also covers dividends or share buybacks.")
    return lines


def prewarm(top_n: int = 30):
    """Nightly: keep notes ready for library models and the largest companies. Rebuilds only when a new earnings
    8-K has been filed or the stored notes are a week old. Stores them through the Worker (needs TOKEN)."""
    import os
    import requests
    root = Path(__file__).resolve().parents[1]
    api = json.loads((root / "site" / "api.json").read_text())["api"].rstrip("/")
    token = os.environ.get("TOKEN", "")
    lib = root / "library" / "index.json"
    tickers = [m["ticker"] for m in json.loads(lib.read_text()).get("models", [])] if lib.exists() else []
    scr = json.loads((root / "site" / "universe" / "screener.json").read_text())
    F = scr["fields"]
    rows = [dict(zip(F, r)) for r in scr["rows"]]
    rows = [r for r in rows if r.get("mcap") and (r.get("country") or "United States") == "United States"]
    tickers += [r["ticker"] for r in sorted(rows, key=lambda r: -r["mcap"])[:top_n]]
    done = 0
    for T in dict.fromkeys(tickers):
        try:
            have = requests.get(f"{api}/api/earnings", params={"t": T}, timeout=20).json()
            if have.get("status") == "ready" and have.get("age_hours", 999) < 7 * 24:
                cik, _ = sources.cik_for(T)
                rec = sources.submissions(cik).get("filings", {}).get("recent", {})
                latest = next((rec["accessionNumber"][i] for i, f in enumerate(rec.get("form", []))
                               if f in ("8-K", "8-K/A") and "2.02" in (rec.get("items", [""] * (i + 1))[i] or "")), None)
                if latest and latest == ((have["notes"].get("events") or [{}])[0]).get("accession"):
                    continue
            data = notes(T)
            data["status"] = "ok"
            r = requests.put(f"{api}/api/earnings/result", params={"t": T}, data=json.dumps(data),
                             headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, timeout=30)
            done += r.ok
            print(f"  {T}: {'stored' if r.ok else r.status_code}")
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {T}: {str(exc)[:100]}")
    print(f"earnings prewarm: {done} updated")


def main():
    if sys.argv[1:2] == ["--prewarm"]:
        prewarm()
        return
    T, dest = sys.argv[1], Path(sys.argv[2])
    try:
        data = notes(T)
        data["status"] = "ok"
    except KeyError:
        data = {"status": "failed", "ticker": T.upper(), "error": f"{T.upper()} isn't in the SEC's list of companies."}
    except Exception as exc:  # noqa: BLE001
        data = {"status": "failed", "ticker": T.upper(), "error": f"Couldn't read the filings: {str(exc)[:160]}"}
    dest.write_text(json.dumps(data, indent=1))
    print(json.dumps({k: data.get(k) for k in ("status", "ticker", "name")}), len(data.get("events", [])), "events")


if __name__ == "__main__":
    main()
