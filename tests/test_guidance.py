"""Guidance sentences and revenue-growth range from earnings-release text."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import guidance as G  # noqa: E402

html = """<html><body><p>Third quarter revenue rose 9% to $12.1 billion.</p>
<p>2026 Outlook. For full-year 2026, the Company now expects organic revenue growth of 5% to 6% and comparable EPS
growth of 7% to 8%.</p><p>This press release contains forward-looking statements, and the Company expects that
risks and uncertainties of 10% may apply.</p><p>The Company will host a conference call and webcast at 8:30 a.m.</p>
<p>The Company reaffirms its outlook for free cash flow of approximately $9.5 billion.</p></body></html>"""
sents = list(G._sentences(G._text(html)))
assert any("organic revenue growth of 5% to 6%" in s for s in sents), sents
assert not any("forward-looking" in s or "webcast" in s for s in sents), sents
assert G.revenue_growth_range(sents) == (0.05, 0.06), G.revenue_growth_range(sents)
print("OK  guidance:", len(sents), "sentences, revenue growth range", G.revenue_growth_range(sents))
