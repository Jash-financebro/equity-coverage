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
lng = ("CHENIERE ENERGY, INC. NEWS RELEASE . Cheniere Reports Third Quarter 2026 Results . . • Raising full year 2026 "
       "Consolidated Adjusted EBITDA 3 guidance from $7.90 billion - $8.40 billion to $8.75 billion - $9.25 billion and full "
       "year 2026 Distributable Cash Flow 3 guidance from $5.30 billion - $5.80 billion to $6.05 billion - $6.55 billion. . "
       "Capital Allocation . • For the third quarter 2026, the Board declared a quarterly cash dividend of $0.625 per share. "
       "The following table reconciles our actual Consolidated Adjusted EBITDA to net income and forecast amounts for full year 2026 (in billions):")
ls = list(G._sentences(lng))
assert any(s.startswith("Raising full year 2026 Consolidated Adjusted EBITDA") for s in ls), ls
assert not any("following table" in s for s in ls), ls
agilent = ["Fiscal year 2027 revenue is expected in the range of $8.00 billion to $8.15 billion, representing a range of up 6.0% to 8.0% reported and up 5.0% to 7.0% core (1)(5).",
           "First-quarter 2027 revenue is expected in the range of $1.96 billion to $2.00 billion, growth of 8.8% to 11.0% reported."]
assert G.revenue_growth_range(agilent) == (0.06, 0.08), G.revenue_growth_range(agilent)
ko = "Full Year 2026 . Organic revenues (non-GAAP): The company continues to expect to deliver 5% to 6% organic revenue growth."
assert any("5% to 6% organic revenue growth" in s for s in G._sentences(ko)), list(G._sentences(ko))
assert not list(G._sentences("(5) Core or organic constant currency revenue growth outlook is based on forecasted rates of 2%."))
past = ("Comparable currency neutral operating income (non-GAAP) grew 14%, primarily driven by organic revenue (non-GAAP) "
        "growth and lower operating expenses.")
assert not list(G._sentences(past)), list(G._sentences(past))
be = ["Raises full year 2026 revenue guidance to $4.4 billion - $4.6 billion, representing 122% year-over-year growth at the midpoint."]
assert G.revenue_growth_range(list(G._sentences(be[0]))) == (1.22, 1.22), G.revenue_growth_range(be)
assert not list(G._sentences("Projected 2026 Free Cash Flow (In billions): . Projected Free Cash Flow (Non-GAAP) $ 13.0."))
print("OK  guidance:", len(sents), "sentences, revenue growth range", G.revenue_growth_range(sents))
