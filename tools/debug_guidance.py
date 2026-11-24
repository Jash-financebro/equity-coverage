"""Diagnostic: why guidance extraction finds nothing. Prints GitHub notices (readable as annotations)."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import guidance as G  # noqa: E402
import sources  # noqa: E402

for cik, t in ((21344, "KO"), (3570, "LNG"), (1652044, "GOOG")):
    subs = sources.submissions(cik)
    rec = subs["filings"]["recent"]
    hits = [(i, rec["filingDate"][i], rec.get("items", [""] * 9999)[i]) for i, f in enumerate(rec["form"]) if f == "8-K"][:6]
    print(f"::notice::{t} 8-Ks (date, items): {[(d, it) for _, d, it in hits]}")
    i = next((i for i, d, it in hits if "2.02" in (it or "")), None)
    if i is None:
        continue
    accn = rec["accessionNumber"][i]
    base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accn.replace('-', '')}"
    idx = sources._sec(f"{base}/index.json")
    names = [it["name"] for it in idx.get("directory", {}).get("item", [])]
    print(f"::notice::{t} files: {names[:12]}")
    ex = [n for n in names if re.search(r"ex-?99", n, re.I) and n.lower().endswith((".htm", ".html", ".txt"))]
    if not ex:
        continue
    raw = sources._get(f"{base}/{ex[0]}", headers={"User-Agent": sources.SEC_UA}, as_json=False)
    text = G._text(raw)
    print(f"::notice::{t} {ex[0]} raw {len(raw)} chars, text {len(text)} chars")
    for m in list(re.finditer(r"(outlook|guidance|expects?)", text, re.I))[:4]:
        print(f"::notice::{t} ctx: {text[max(0, m.start() - 150): m.start() + 250]!r}"[:900])
    allsent = re.split(r"(?<=[.!?])\s+(?=[A-Z(\"“])", text)
    print(f"::notice::{t} {len(allsent)} sentences; lengths>320: {sum(len(s) > 320 for s in allsent)}; kept: {list(G._sentences(text))[:3]}"[:900])
