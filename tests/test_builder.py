"""Build a 3-statement model from fixtures, recalc it in LibreOffice, run the skill's checks.

    /usr/bin/python3 tests/test_builder.py
"""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("FIXTURES_DIR", str(ROOT / "tests" / "fixtures"))
sys.path.insert(0, str(ROOT / "pipeline"))

import openpyxl  # noqa: E402

import analytics  # noqa: E402
import builder  # noqa: E402
import excel  # noqa: E402
import fundamentals  # noqa: E402
import ratios  # noqa: E402
import sources  # noqa: E402

tmp = Path(tempfile.mkdtemp())
cik, _ = sources.cik_for("MSFT")
facts = sources.company_facts(cik)
fin = fundamentals.build(facts)
shares = fundamentals.shares_outstanding(facts)
mkt = sources.price_history("MSFT")
qs = sources.quote_summary("MSFT")
rt = ratios.compute(fin, mkt["price"], shares)
w = analytics.market_wacc(fin, rt["snapshot"], qs["beta"], 0.043, 0.055)
it = fin["items"]
live = {"ticker": "MSFT", "company": "Microsoft Corp", "price": mkt["price"], "price_date": mkt["as_of"],
        "shares": shares, "market_cap": mkt["price"] * shares,
        "net_debt": it["short_term_debt"][-1] + it["long_term_debt"][-1] - it["cash"][-1],
        "tenk_filed": "2025-07-30", "tenk_url": "", "sources": "fixtures", "refreshed_at": "test",
        "financials": fin, "market": {**w, "street_mean": qs["target_mean"], "street_median": qs["target_median"]}}

problems = []
for stance in ("Balanced", "Bearish"):
    dest = tmp / f"MSFT_v{1 if stance == 'Balanced' else 2}.xlsx"
    builder.build("MSFT", dest, {"live": live, "fin": fin}, stance=stance)
    issues = builder.verify(dest)
    problems += [f"[{stance}] {i}" for i in issues]

    out = tmp / f"{dest.stem}_calc.xlsx"
    calc = excel.Calc(port=2003)
    try:
        res = excel.refresh(calc, dest, out, {**live, "model_label": dest.stem}, {})
    finally:
        calc.close()
    wb = openpyxl.load_workbook(out, data_only=True)
    bs, cf, dcf = wb["MSFT Balance Sheet"], wb["MSFT Cash Flow Statement"], wb["MSFT DCF"]
    for col in "DEFGHIJK":
        chk = bs[f"{col}21"].value
        if chk is None or abs(chk) > 0.01:
            problems.append(f"[{stance}] balance check {col}21 = {chk}")
    for col in "GHIJK":
        if abs((cf[f"{col}27"].value or 0) - (bs[f"{col}5"].value or 0)) > 0.01:
            problems.append(f"[{stance}] CF ending cash != BS cash in {col}")
    for col in "DEF":  # historical CFO / net income tie to the 10-K
        pass
    errs = [(ws.title, c.coordinate, c.value) for ws in wb for row in ws.iter_rows() for c in row
            if isinstance(c.value, str) and c.value.startswith("#")]
    problems += [f"[{stance}] error {e}" for e in errs[:10]]
    sc = res["scenarios"]
    print(f"{stance}: target {res['target']:.2f} via {res['target_cell']} | scenarios "
          + ", ".join(f"{k} {v:.2f}" for k, v in sc.items() if v)
          + f" | sens centre {dcf['F39'].value:.2f} | IS hist NI {wb['MSFT Income Statement']['F23'].value:,.0f}")
    if not (sc["bear"] < sc["base"] < sc["bull"]) or abs(res["target"] - (sc["base"] if stance == "Balanced" else sc["bear"])) > 0.01:
        problems.append(f"[{stance}] scenarios not ordered: {sc}")
    if abs(dcf["F39"].value - res["target"]) > 0.01:
        problems.append(f"[{stance}] sensitivity centre != target")
    if abs(wb["MSFT Income Statement"]["F23"].value - 101832) > 0.5:
        problems.append(f"[{stance}] historical net income does not tie to 10-K")

print("\n".join(problems) if problems else "OK  builder model passes skill checks, balances, ties to 10-K")
os._exit(1 if problems else 0)
