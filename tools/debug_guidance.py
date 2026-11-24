"""Diagnostic: guidance extraction on live filings (prints GitHub notices)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import guidance as G  # noqa: E402
import sources  # noqa: E402

for cik, t in ((21344, "KO"), (3570, "LNG"), (1652044, "GOOG"), (1957132, "SN"), (1090872, "A")):
    g = G.latest(sources.submissions(cik), cik, 0.05)
    print(f"::notice::{t}: " + ("none" if not g else f"{g['url'].split('/')[-1]} range={g['revenue_growth_range']} | "
                                + " || ".join(s[:170] for s in g['sentences'])))
