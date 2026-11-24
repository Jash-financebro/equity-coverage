"""Management guidance from the latest earnings release (8-K, Item 2.02, Exhibit 99).

Pulls the outlook / guidance sentences verbatim (short, with a link) and, when the release gives a revenue
growth range, compares it with the model's next-year revenue growth."""
from __future__ import annotations

import html
import re

import sources

# forward-looking language only: a line about last quarter's results ("grew 7%") is not guidance
KEYWORDS = re.compile(r"\b(guidance|outlook|expects?|expected|expecting|anticipates?|anticipated|forecasts?|forecasted|"
                      r"reaffirm\w*|projects?|projected|will (?:be|deliver|grow|generate))\b", re.I)
PAST_ONLY = re.compile(r"\b(grew|increased|decreased|declined|rose|fell|was|were|reported|delivered)\b", re.I)
METRICS = re.compile(r"\b(revenue|revenues|net sales|sales|organic|EPS|earnings per share|operating income|"
                     r"operating margin|free cash flow|EBITDA)\b", re.I)
NUMBER = re.compile(r"\d")
NOISE = re.compile(r"^\(\d+\)|forward-looking|safe harbor|risks and uncertainties|reconcil|conference call|"
                   r"webcast|press release|investor relations|following table|see table|footnote", re.I)


def _text(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)
    raw = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>|</li>", ". ", raw)
    raw = re.sub(r"<[^>]+>", " ", raw)
    raw = html.unescape(raw).replace("\xa0", " ")
    return re.sub(r"\s+", " ", raw)


def _sentences(text: str):
    # bullets and paragraph breaks end a statement even without a full stop
    text = re.sub(r"\s*[•▪●◦]\s*", " . ", text)
    for s in re.split(r"(?<=[.!?])\s+(?=[A-Z(\"“$])|\s\.\s", text):
        s = re.sub(r"\s+", " ", s).strip(" .")
        k = KEYWORDS.search(s)
        if k and PAST_ONLY.search(s[:k.start()]) and not re.search(r"guidance|outlook", s, re.I):
            continue  # "Revenue grew 7%, ... expected ..." - results first; only keep explicit guidance lines
        if len(s.split()) < 9 or s.rstrip().endswith(":") or re.search(r"\((?:in|\$ in) (?:millions|billions)\)", s, re.I):
            continue  # table rows and captions, not sentences
        if 40 <= len(s) <= 320 and k and METRICS.search(s) and NUMBER.search(s) and not NOISE.search(s):
            yield s + "."


def revenue_growth_range(sentences: list[str]):
    """(low, high) full-year revenue growth guidance as decimals, if stated. Full-year ranges beat quarterly ones."""
    best = None
    for s in sentences:
        if not re.search(r"revenue|net sales|sales", s, re.I) or not re.search(r"grow|growth|increase|\bup\b", s, re.I):
            continue
        rng = None
        m = re.search(r"(-?\d+(?:\.\d+)?)\s*%?\s*(?:to|-|–|and)\s*(-?\d+(?:\.\d+)?)\s*%", s)
        if m:
            lo, hi = sorted((float(m.group(1)) / 100, float(m.group(2)) / 100))
            if -0.5 < lo < 3 and -0.5 < hi < 3:
                rng = (lo, hi)
        else:
            m = re.search(r"(-?\d+(?:\.\d+)?)\s*%", s)
            if m and -50 < float(m.group(1)) < 300:
                rng = (float(m.group(1)) / 100,) * 2
        if not rng:
            continue
        score = (2 if re.search(r"full[- ]year|fiscal (?:year )?20\d\d|annual|for the year|20\d\d (?:revenue|net sales)", s, re.I) else 0) \
            - (2 if re.search(r"quarter|q[1-4]\b", s, re.I) else 0)
        if best is None or score > best[0]:
            best = (score, rng)
    return best[1] if best else None


def latest(subs: dict, cik: int, model_growth: float | None = None) -> dict | None:
    """Guidance block for the model page, or None when no recent earnings release has outlook language."""
    recent = subs.get("filings", {}).get("recent", {})
    for i, form in enumerate(recent.get("form", [])):
        if form != "8-K" or "2.02" not in (recent.get("items", [""] * (i + 1))[i] or ""):
            continue
        accn = recent["accessionNumber"][i]
        base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accn.replace('-', '')}"
        try:
            idx = sources._sec(f"{base}/index.json")
            names = [it["name"] for it in idx.get("directory", {}).get("item", [])]
            primary = (recent.get("primaryDocument") or [""] * (i + 1))[i]
            docs = [n for n in names if n.lower().endswith((".htm", ".html")) and n != primary and "index" not in n.lower()]
            ex = sorted(docs, key=lambda n: (not re.search(r"ex-?9|99|release|press|earn", n, re.I), n))
            if not ex:
                return None
            raw = sources._get(f"{base}/{ex[0]}", headers={"User-Agent": sources.SEC_UA}, as_json=False)
            text = _text(raw if isinstance(raw, str) else raw.decode("utf-8", "ignore"))
        except Exception as exc:  # noqa: BLE001
            print(f"  ! guidance unavailable: {exc}")
            return None
        found, seen = [], set()
        for s in _sentences(text):
            k = s[:60].lower()
            if k not in seen:
                seen.add(k)
                found.append(s)
            if len(found) >= 4:
                break
        if not found:
            return None
        rng = revenue_growth_range(found)
        out = {"filed": recent["filingDate"][i], "url": f"{base}/{ex[0]}", "sentences": found,
               "revenue_growth_range": rng}
        if rng and model_growth is not None:
            lo, hi = rng
            gap = model_growth - hi if model_growth > hi else (model_growth - lo if model_growth < lo else 0.0)
            out["model_growth"] = model_growth
            out["gap"] = gap
            out["flag"] = abs(gap) > 0.02
        return out
    return None
