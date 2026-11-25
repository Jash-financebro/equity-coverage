"""Earnings notes extraction on a synthetic press release (no network)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import earnings as E  # noqa: E402

RAW = """<html><body><p>ACME Corp. Reports Third Quarter 2026 Results</p>
<p>n Revenue of $12.4 billion, up 8% year over year.</p><p>n Diluted EPS was $1.20, up 12% compared with the prior year.</p>
<p>Operating margin expanded to 24.1% from 22.9% a year ago.</p>
<p>“We delivered another quarter of steady growth and our pipeline has never been stronger,” said Jane Doe, Chief Executive Officer of ACME.</p>
<p>The Board declared a quarterly dividend of $0.52 per share, payable December 1, 2026.</p>
<p>Full Year 2026 Outlook</p><p>Net sales growth of 6% to 7%.</p><p>Adjusted EPS of $4.80 to $4.90.</p>
<p>Revenue was $11 billion in the year-ago period for the segment shown.</p>
<p>Conference Call. ACME will host a conference call today at 8:30 a.m. ET. The <a href="https://investors.acme.com/events">webcast</a> will be available.</p>
<p>This press release contains forward-looking statements.</p>
<table><tr><td>Payments for dividends (1,234) (1,100)</td></tr></table></body></html>"""
text = E._text(RAW)
sents = E._sentences(text)
res = E._rank_results(sents)
assert any("Revenue of $12.4 billion" in s for s in res) and any("Diluted EPS" in s for s in res), res
assert not any(s.startswith("n ") for s in sents), sents
assert not any("“" in s for s in res), "quotes belong in their own section"
q = E._quotes(text)
assert q and q[0]["who"].startswith("Jane Doe") and "steady growth" in q[0]["text"], q
out = E._outlook(text, sents)
assert any("6% to 7%" in s for s in out) and any("$4.80" in s for s in out) and not any("year-ago" in s for s in out), out
cap = [s for s in sents if E.CAPITAL.search(s) and E._ok_sentence(s, 40, 300)]
assert cap and "0.52" in cap[0] and not any("(1,234)" in s for s in cap), cap
call = E._call_info(sents, RAW)
assert call.get("url") == "https://investors.acme.com/events" and "8:30" in call.get("sentence", ""), call
assert E._period(text, "2026-10-20") == "Q3 2026"
lines = E.summarize({"numbers": {"label": "Quarter ended Sep 30, 2026", "quarter": {"revenue": {"cur": 12400, "prior": 11480, "chg": 0.08},
                     "eps_diluted": {"cur": 1.2, "prior": 1.07, "chg": 0.12}}}, "events": [{"outlook": out}]})
assert lines[0].startswith("Revenue was $12.40 billion in the quarter ended Sep 30, 2026, up 8%"), lines
print("OK  earnings: results, quotes, outlook section, dividends, call link, period, summary")
