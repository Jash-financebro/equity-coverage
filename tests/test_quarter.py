"""Latest quarter vs year ago and trailing-twelve-month math from 10-Q + 10-K XBRL facts (synthetic)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import fundamentals as F  # noqa: E402


def row(start, end, val, form="10-Q", filed="2025-01-01"):
    return {"start": start, "end": end, "val": val * 1e6, "form": form, "filed": filed}


def facts(rows):
    return {"facts": {"us-gaap": {"Revenues": {"units": {"USD": rows}}}}}


fin = {"concepts": {"revenue": "Revenues"}}
# fiscal year ends Jun 30. FY2024 = 1000, FY2025 = 1200. Q1 FY2026 (Sep 2025) = 330 vs Q1 FY2025 = 280
mid = facts([row("2023-07-01", "2024-06-30", 1000, "10-K"), row("2024-07-01", "2025-06-30", 1200, "10-K"),
             row("2024-07-01", "2024-09-30", 280), row("2025-07-01", "2025-09-30", 330)])
q = F.latest_quarter(mid, fin)
assert q and q["is_10q"] and q["as_of"] == "2025-09-30", q
assert q["quarter"]["revenue"]["cur"] == 330 and q["quarter"]["revenue"]["prior"] == 280, q
assert abs(q["quarter"]["revenue"]["chg"] - (330 / 280 - 1)) < 1e-9
assert q["ttm"]["revenue"] == 1200 + 330 - 280, q["ttm"]

# right after a 10-K: Q4 = FY - nine-month YTD; TTM = FY
q4 = facts([row("2023-07-01", "2024-06-30", 1000, "10-K"), row("2024-07-01", "2025-06-30", 1200, "10-K"),
            row("2023-07-01", "2024-03-31", 740), row("2024-07-01", "2025-03-31", 880)])
q = F.latest_quarter(q4, fin)
assert q and not q["is_10q"] and q["quarter"]["revenue"]["cur"] == 320 and q["quarter"]["revenue"]["prior"] == 260, q
assert q["ttm"]["revenue"] == 1200
print("OK  latest quarter + TTM:", q["label"], q["quarter"]["revenue"])
