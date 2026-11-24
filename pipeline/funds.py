"""13F holdings for closely followed funds → site/funds/*.json

For each fund: the latest two 13F-HR filings from SEC EDGAR, holdings mapped from CUSIP to ticker with OpenFIGI
(cached in data/cusip_map.json, falling back to a name match), and quarter-over-quarter changes. Also writes
which tracked funds own each ticker (owners.json) and the cross-fund "most owned / most bought" lists.

    python pipeline/funds.py [--if-stale DAYS]
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sources  # noqa: E402
import universe  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = universe.OUT.parent.parent / "funds"
CUSIP_CACHE = ROOT / "data" / "cusip_map.json"
WANT = 15
LOG: list[str] = []


def log(msg: str):
    print(msg)
    LOG.append(msg.strip())
# slug, display name, best-known person, CIK, a word that must appear in SEC's filer name
CANDIDATES = [
    ("berkshire-hathaway", "Berkshire Hathaway", "Warren Buffett", 1067983, "BERKSHIRE"),
    ("pershing-square", "Pershing Square Capital Management", "Bill Ackman", 1336528, "PERSHING"),
    ("appaloosa", "Appaloosa LP", "David Tepper", 1656456, "APPALOOSA"),
    ("duquesne", "Duquesne Family Office", "Stanley Druckenmiller", 1536411, "DUQUESNE"),
    ("baupost", "Baupost Group", "Seth Klarman", 1061768, "BAUPOST"),
    ("third-point", "Third Point", "Dan Loeb", 1040273, "THIRD POINT"),
    ("greenlight", "Greenlight Capital", "David Einhorn", 1079114, "GREENLIGHT"),
    ("himalaya", "Himalaya Capital Management", "Li Lu", 1709323, "HIMALAYA"),
    ("tiger-global", "Tiger Global Management", "Chase Coleman", 1167483, "TIGER GLOBAL"),
    ("coatue", "Coatue Management", "Philippe Laffont", 1135730, "COATUE"),
    ("lone-pine", "Lone Pine Capital", "Stephen Mandel", 1061165, "LONE PINE"),
    ("viking", "Viking Global Investors", "Andreas Halvorsen", 1103804, "VIKING"),
    ("akre", "Akre Capital Management", "Chuck Akre", 1112520, "AKRE"),
    ("icahn", "Icahn Capital", "Carl Icahn", 921669, "ICAHN"),
    ("trian", "Trian Fund Management", "Nelson Peltz", 1345471, "TRIAN"),
    ("scion", "Scion Asset Management", "Michael Burry", 1649339, "SCION"),
    ("fairholme", "Fairholme Capital Management", "Bruce Berkowitz", 1056831, "FAIRHOLME"),
    ("pabrai", "Dalal Street (Pabrai)", "Mohnish Pabrai", 1549575, "DALAL STREET"),
    ("elliott", "Elliott Investment Management", "Paul Singer", 1791786, "ELLIOTT"),
    ("bridgewater", "Bridgewater Associates", "Ray Dalio (founder)", 1350694, "BRIDGEWATER"),
]


def find_cik(word: str) -> int | None:
    """Fallback: look the filer up by name on EDGAR."""
    try:
        q = requests.utils.quote(word)
        txt = sources._get(f"https://www.sec.gov/cgi-bin/browse-edgar?company={q}&type=13F-HR&dateb=&owner=include"
                           f"&count=10&action=getcompany&output=atom", headers={"User-Agent": sources.SEC_UA}, as_json=False)
        m = re.search(r"<cik>(\d+)</cik>", txt) or re.search(r"CIK=(\d{6,10})", txt)
        return int(m.group(1)) if m else None
    except Exception:  # noqa: BLE001
        return None


def filings_13f(subs: dict) -> list[dict]:
    rec = subs.get("filings", {}).get("recent", {})
    out, seen = [], set()
    for i, f in enumerate(rec.get("form", [])):
        if f != "13F-HR":
            continue
        rd = rec["reportDate"][i]
        if rd in seen:
            continue
        seen.add(rd)
        out.append({"accn": rec["accessionNumber"][i], "filed": rec["filingDate"][i], "period": rd})
    return out


def parse_infotable(xml: str) -> list[dict]:
    """Rows from a 13F information table (namespace-agnostic)."""
    xml = re.sub(r'\sxmlns(:\w+)?="[^"]+"', "", xml)
    xml = re.sub(r"<(/?)\w+:", r"<\1", xml)
    root = ET.fromstring(xml)
    rows = []
    for it in root.iter("infoTable"):
        g = lambda tag: (it.findtext(tag) or "").strip()  # noqa: E731
        rows.append({"name": g("nameOfIssuer"), "cusip": g("cusip").upper(), "title": g("titleOfClass"),
                     "value": float(g("value") or 0), "shares": float(it.findtext("shrsOrPrnAmt/sshPrnamt") or 0),
                     "kind": (it.findtext("shrsOrPrnAmt/sshPrnamtType") or "SH").strip(), "putcall": g("putCall")})
    return rows


def holdings_for(cik: int, f: dict) -> list[dict]:
    base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{f['accn'].replace('-', '')}"
    idx = sources._sec(f"{base}/index.json")
    names = [x["name"] for x in idx.get("directory", {}).get("item", [])]
    xmls = [n for n in names if n.lower().endswith(".xml") and "primary_doc" not in n.lower()]
    for n in sorted(xmls, key=lambda n: ("info" not in n.lower(), n)):
        raw = sources._get(f"{base}/{n}", headers={"User-Agent": sources.SEC_UA}, as_json=False)
        raw = raw if isinstance(raw, str) else raw.decode("utf-8", "ignore")
        if "infoTable" in raw:
            return parse_infotable(raw)
    raise RuntimeError("no information table in filing")


def combine(rows: list[dict]) -> tuple[dict, list[dict]]:
    """Stock positions by CUSIP (summing sub-managers) and option positions kept apart.
    Values are in dollars since 2023; a filer still reporting in thousands shows sub-$1 'prices', so scale it."""
    px = sorted(r["value"] / r["shares"] for r in rows if r["shares"] and not r["putcall"] and r["kind"] == "SH")
    if px and px[len(px) // 2] < 1.0:
        for r in rows:
            r["value"] *= 1000
    pos, opts = {}, []
    for r in rows:
        if r["putcall"]:
            opts.append(r)
            continue
        p = pos.setdefault(r["cusip"], {"cusip": r["cusip"], "name": r["name"], "title": r["title"], "value": 0.0, "shares": 0.0})
        p["value"] += r["value"]
        p["shares"] += r["shares"]
    return pos, opts


def map_cusips(cusips: set[str], uni: list[dict]) -> dict[str, str | None]:
    cache = json.loads(CUSIP_CACHE.read_text()) if CUSIP_CACHE.exists() else {}
    todo = [c for c in cusips if c not in cache]
    print(f"  CUSIPs: {len(cusips)} ({len(todo)} new)")
    for i in range(0, len(todo), 10):
        chunk = todo[i:i + 10]
        try:
            r = requests.post("https://api.openfigi.com/v3/mapping", json=[{"idType": "ID_CUSIP", "idValue": c} for c in chunk],
                              timeout=30)
            if r.status_code == 429:
                time.sleep(30)
                r = requests.post("https://api.openfigi.com/v3/mapping",
                                  json=[{"idType": "ID_CUSIP", "idValue": c} for c in chunk], timeout=30)
            res = r.json() if r.ok else []
        except Exception as exc:  # noqa: BLE001
            print("  · OpenFIGI:", exc)
            res = []
        for c, item in zip(chunk, res):
            data = item.get("data") or []
            us = [d for d in data if d.get("exchCode") == "US"] or data
            cache[c] = us[0]["ticker"].replace("/", "-").replace(".", "-") if us and us[0].get("ticker") else None
        time.sleep(2.6)  # 25 requests a minute without an API key
    CUSIP_CACHE.parent.mkdir(parents=True, exist_ok=True)
    CUSIP_CACHE.write_text(json.dumps(cache, indent=0, sort_keys=True))
    return cache


def norm(name: str) -> str:
    name = re.sub(r"[^a-z0-9 ]", " ", (name or "").lower())
    name = re.sub(r"\b(inc|corp|corporation|co|company|ltd|plc|holdings?|group|class [a-z]|com|new|del|the|sa|nv|ag|lp)\b", " ", name)
    return re.sub(r"\s+", " ", name).strip()


def stale(days: float) -> bool:
    f = OUT / "index.json"
    if not f.exists():
        return True
    d = json.loads(f.read_text())
    if len(d.get("funds", [])) < WANT:
        return True
    age = dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(d["as_of"])
    return age.total_seconds() > days * 86400


def main():
    if "--if-stale" in sys.argv:
        days = float(sys.argv[sys.argv.index("--if-stale") + 1])
        if not stale(days):
            print("funds are fresh; skipping")
            return
    uni = universe.load()["companies"]
    by_ticker = {}
    for c in uni:
        for t in [c["ticker"], *c.get("other_tickers", [])]:
            by_ticker[t] = c
    by_name = {norm(c["name"]): c["ticker"] for c in uni}
    cutoff = (dt.date.today() - dt.timedelta(days=270)).isoformat()
    loaded = []
    for slug, name, person, cik, word in CANDIDATES:
        if len(loaded) >= WANT:
            break
        try:
            subs = sources.submissions(cik)
            if word not in (subs.get("name") or "").upper():
                alt = find_cik(word)
                if not alt:
                    log(f"  ✗ {name}: CIK {cik} is '{subs.get('name')}', no match found")
                    continue
                cik, subs = alt, sources.submissions(alt)
            fl = filings_13f(subs)
            if not fl or fl[0]["filed"] < cutoff:
                log(f"  ✗ {name}: no 13F since {cutoff} (latest: {fl[0]['filed'] if fl else 'none'}, CIK {cik})")
                continue
            cur, cur_opts = combine(holdings_for(cik, fl[0]))
            prev, _ = combine(holdings_for(cik, fl[1])) if len(fl) > 1 else ({}, [])
            loaded.append({"slug": slug, "name": name, "person": person, "cik": cik, "filer": subs.get("name"),
                           "filing": fl[0], "prev_filing": fl[1] if len(fl) > 1 else None,
                           "cur": cur, "prev": prev, "opts": cur_opts})
            log(f"  ✓ {name}: {len(cur)} positions, period {fl[0]['period']}, filed {fl[0]['filed']}, CIK {cik}")
        except Exception as exc:  # noqa: BLE001
            log(f"  ✗ {name}: {type(exc).__name__}: {str(exc)[:160]} (CIK {cik})")

    cmap = map_cusips({c for f in loaded for c in [*f["cur"], *f["prev"]]}, uni)
    tick = lambda p: cmap.get(p["cusip"]) or by_name.get(norm(p["name"]))  # noqa: E731
    OUT.mkdir(parents=True, exist_ok=True)
    owners: dict[str, list] = {}
    summary, agg = [], {}
    for f in loaded:
        total = sum(p["value"] for p in f["cur"].values()) or 1
        ptotal = sum(p["value"] for p in f["prev"].values()) or 1
        hold, exits = [], []
        for c, p in sorted(f["cur"].items(), key=lambda kv: -kv[1]["value"]):
            pv = f["prev"].get(c)
            chg = None if not f["prev_filing"] else ("new" if not pv else
                                                    "add" if p["shares"] > pv["shares"] * 1.02 else
                                                    "trim" if p["shares"] < pv["shares"] * 0.98 else "same")
            t = tick(p)
            row = {"ticker": t, "name": p["name"], "cusip": c, "value": round(p["value"]), "weight": round(p["value"] / total, 5),
                   "shares": round(p["shares"]), "change": chg,
                   "chg_shares": round(p["shares"] / pv["shares"] - 1, 4) if pv and pv["shares"] else None,
                   "prev_weight": round(pv["value"] / ptotal, 5) if pv else None,
                   "sector": (by_ticker.get(t) or {}).get("sector") if t else None,
                   "listed": bool(t and t in by_ticker)}
            hold.append(row)
            if t:
                owners.setdefault(t, []).append([f["slug"], row["weight"], chg])
                key = (by_ticker.get(t) or {}).get("ticker", t)  # one entry per company (GOOG + GOOGL)
                a = agg.setdefault(key, {"ticker": key, "name": p["name"], "funds": set(), "value": 0.0, "bought": set(), "sold": set()})
                a["funds"].add(f["slug"])
                a["value"] += p["value"]
                if chg in ("new", "add"):
                    a["bought"].add(f["slug"])
        for c, pv in f["prev"].items():
            if c not in f["cur"]:
                t = tick(pv)
                exits.append({"ticker": t, "name": pv["name"], "prev_value": round(pv["value"]),
                              "prev_weight": round(pv["value"] / ptotal, 5)})
                if t:
                    key = (by_ticker.get(t) or {}).get("ticker", t)
                    a = agg.setdefault(key, {"ticker": key, "name": pv["name"], "funds": set(), "value": 0.0, "bought": set(), "sold": set()})
                    a["sold"].add(f["slug"])
        for h in hold:
            if h["change"] == "trim" and h["ticker"]:
                agg[(by_ticker.get(h["ticker"]) or {}).get("ticker", h["ticker"])]["sold"].add(f["slug"])
        exits.sort(key=lambda e: -e["prev_value"])
        sectors = {}
        for h in hold:
            sectors[h["sector"] or "Other / not listed"] = sectors.get(h["sector"] or "Other / not listed", 0) + h["weight"]
        top10 = sum(h["weight"] for h in hold[:10])
        meta = {"slug": f["slug"], "name": f["name"], "person": f["person"], "cik": f["cik"], "filer": f["filer"],
                "period": f["filing"]["period"], "filed": f["filing"]["filed"],
                "prev_period": (f["prev_filing"] or {}).get("period"),
                "url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={f['cik']}&type=13F-HR",
                "value": round(total), "positions": len(hold), "top10_share": round(top10, 4),
                "new": sum(h["change"] == "new" for h in hold), "adds": sum(h["change"] == "add" for h in hold),
                "trims": sum(h["change"] == "trim" for h in hold), "exits": len(exits), "options": len(f["opts"]),
                "top": [[h["ticker"], h["name"], h["weight"]] for h in hold[:5]]}
        summary.append(meta)
        (OUT / f"{f['slug']}.json").write_text(json.dumps({**meta, "holdings": hold, "exits": exits,
                                                          "sectors": sorted(sectors.items(), key=lambda kv: -kv[1]),
                                                          "option_rows": [{"name": o["name"], "putcall": o["putcall"],
                                                                           "value": round(o["value"])} for o in f["opts"][:50]]},
                                                         separators=(",", ":")))
    rows = list(agg.values())
    for a in rows:
        a["fund_list"] = sorted(a["funds"])
        a["funds"], a["bought"], a["sold"] = len(a["funds"]), len(a["bought"]), len(a["sold"])
    out = {"as_of": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "funds": summary,
           "most_owned": sorted(rows, key=lambda a: (-a["funds"], -a["value"]))[:20],
           "most_bought": sorted([a for a in rows if a["bought"]], key=lambda a: (-a["bought"], -a["value"]))[:15],
           "most_sold": sorted([a for a in rows if a["sold"]], key=lambda a: (-a["sold"], -a["value"]))[:15],
           "log": LOG}
    for a in rows:
        a["value"] = round(a["value"])
    (OUT / "index.json").write_text(json.dumps(out, separators=(",", ":")))
    (OUT / "owners.json").write_text(json.dumps(owners, separators=(",", ":")))
    print(f"funds: {len(summary)} loaded → {OUT}")


if __name__ == "__main__":
    main()
