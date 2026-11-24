"""Build a 3-statement model from fixtures, recalc it in LibreOffice, run the skill's checks.

    /usr/bin/python3 tests/test_builder.py
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
subprocess.run([sys.executable, str(ROOT / "tests" / "make_fixtures.py")], check=True, stdout=subprocess.DEVNULL)
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

def peer(t):
    c, _ = sources.cik_for(t)
    f = sources.company_facts(c)
    fi = fundamentals.build(f)
    it = fi["items"]
    return {"ticker": t, "name": t, "price": sources.price_history(t)["price"], "shares": fundamentals.shares_outstanding(f),
            "net_debt": it["short_term_debt"][-1] + it["long_term_debt"][-1] - it["cash"][-1],
            "ebitda": it["operating_income"][-1] + it["d_and_a"][-1], "eps": it["eps_diluted"][-1]}


PEERS = [peer("ORCL"), peer("GOOGL")]
problems = []
for stance in ("Balanced", "Bearish"):
    dest = tmp / f"MSFT_v{1 if stance == 'Balanced' else 2}.xlsx"
    builder.build("MSFT", dest, {"live": live, "fin": fin, "peers": PEERS,
                                 "anchor": {"street_median": 625.0, "analysts": 55, "peer_avg_upside": 0.10,
                                            "peer_count": 2, "peers_used": ["ORCL", "GOOGL"]}}, stance=stance)
    issues = builder.verify(dest)
    problems += [f"[{stance}] {i}" for i in issues]

    out = tmp / f"{dest.stem}_calc.xlsx"
    calc = excel.Calc(port=2003)
    try:
        vs = "'MSFT Valuation Summary'"
        res = excel.refresh(calc, dest, out, {**live, "model_label": dest.stem},
                            {"scenario_cells": {"bear": f"{vs}!D23", "base": f"{vs}!E23", "bull": f"{vs}!F23"},
                             "scenario_value_ref": f"{vs}!D13"})
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
    if not (sc["bear"] < sc["base"] < sc["bull"]):
        problems.append(f"[{stance}] scenarios not ordered: {sc}")
    vsh = wb["MSFT Valuation Summary"]
    blend = vsh["D5"].value * vsh["D8"].value + vsh["D6"].value * vsh["D9"].value + vsh["D7"].value * vsh["D10"].value
    px_ = vsh["D14"].value
    anchored = 0.5 * blend + 0.25 * 625.0 + 0.25 * px_ * 1.10
    final = min(px_ * 1.25, max(px_ * 0.95, anchored))
    print(f"   final cases {[round(vsh[c + '24'].value, 2) for c in 'DEF']} | model {blend:.2f} | anchored {anchored:.2f} | band {px_ * 0.95:.2f}-{px_ * 1.25:.2f} | final {res['target']:.2f}")
    if abs(final - res["target"]) > 0.01 or abs(blend - vsh["D13"].value) > 0.01 or abs(dcf["F39"].value - vsh["D5"].value) > 0.01:
        problems.append(f"[{stance}] blend/sensitivity mismatch {blend} {res['target']}")
    if abs(vsh["E23"].value - sc["base"]) > 0.01 or abs(vsh["F23"].value - sc["bull"]) > 0.01:
        problems.append(f"[{stance}] scenario table not filled")
    fin3 = [vsh[f"{c}24"].value for c in "DEF"]
    if not (fin3[0] < fin3[1] < fin3[2]) or abs(fin3[1] * sc["base"] / vsh["E23"].value - fin3[1]) > 0.01:
        problems.append(f"[{stance}] anchored scenarios wrong {fin3}")
    if not vsh["D6"].value or vsh["D6"].value <= 0:
        problems.append(f"[{stance}] comps value missing: {vsh['D6'].value}")
    print(f"   comps median EV/EBITDA {wb['MSFT Comps']['D' + str(next(r for r in range(5, 40) if wb['MSFT Comps'][f'B{r}'].value == 'Peer median EV / EBITDA'))].value:.1f}x"
          f" | DCF {vsh['D5'].value:.2f} | comps {vsh['D6'].value:.2f} | blend {res['target']:.2f}"
          f" | scenario row {vsh['D23'].value:.2f}/{vsh['E23'].value:.2f}/{vsh['F23'].value:.2f}")
    if abs(wb["MSFT Income Statement"]["F23"].value - 101832) > 0.5:
        problems.append(f"[{stance}] historical net income does not tie to 10-K")

print("\n".join(problems) if problems else "OK  builder model passes skill checks, balances, ties to 10-K")
os._exit(1 if problems else 0)
