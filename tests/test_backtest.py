"""Forecast vs actual: backtest on synthetic financials, and grading a stored forecast."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import backtest  # noqa: E402
import builder  # noqa: E402

keys = ["revenue", "cogs", "operating_income", "d_and_a", "ppe_net", "short_term_debt", "long_term_debt", "debt_repaid",
        "debt_issued", "pretax_income", "income_tax", "net_income", "shares_diluted", "capex", "current_assets", "cash",
        "current_liabilities", "dividends", "buybacks", "interest_expense"]
rev = [100, 110, 121, 133.1, 140]
items = {k: [10.0] * 5 for k in keys}
items["revenue"] = rev
items["cogs"] = [r * 0.6 for r in rev]
items["operating_income"] = [r * 0.2 for r in rev]
items["pretax_income"] = [r * 0.18 for r in rev]
items["shares_diluted"] = [100.0] * 5
fin = {"labels": [f"FY{y}" for y in range(2021, 2026)], "periods": [], "items": items}

bt = backtest.backtest(fin)
assert [b["year"] for b in bt] == ["FY2024", "FY2025"], bt
b24 = bt[0]
d = builder._drivers(backtest._trim(fin, 2), "Balanced")
assert abs(b24["growth_fc"] - round(d["base_growth"], 4)) < 1e-9 and abs(b24["growth_fc"] - 0.10) < 1e-3, b24
assert abs(b24["rev_err"]) < 1e-3, b24                    # 10% growth forecast, 10% delivered
assert abs(bt[1]["growth_act"] - (140 / 133.1 - 1)) < 1e-3 and bt[1]["rev_err"] > 0.04, bt[1]
assert abs(b24["gm_fc"] - 0.4) < 1e-9 and abs(b24["gm_err_pts"]) < 1e-9

detail_then = {"hist_n": 3, "years": ["FY2023A", "FY2024A", "FY2025A", "FY2026E", "FY2027E"],
               "is": {"revenue": [121, 133.1, 140, 150, 160], "gm": [0.4] * 5, "ebit_m": [0.2] * 5, "eps": [1, 1, 1, 1.1, 1.2]}}
snap = backtest.snapshot(detail_then, "FY2025", "2026-01-10", 1)
assert snap["years"] == ["FY2026", "FY2027"]
fcs = backtest.merge([], snap)
detail_now = {"hist_n": 3, "years": ["FY2024A", "FY2025A", "FY2026A", "FY2027E"],
              "is": {"revenue": [133.1, 140, 156, 165], "gm": [0.4, 0.4, 0.42, 0.42], "ebit_m": [0.2] * 4, "eps": [1, 1, 1.05, 1.2]}}
rows = backtest.check(fcs, detail_now)
assert len(rows) == 1 and rows[0]["year"] == "FY2026" and rows[0]["revenue"] == [150, 156], rows
assert abs(rows[0]["rev_err"] - (150 / 156 - 1)) < 1e-3
assert len(backtest.merge(fcs, {**snap, "made": "2026-02-01"})) == 1    # one forecast kept per 10-K
print("OK  backtest: rules re-run on past data, stored forecasts graded against new actuals")
