"""Financial ratios from the latest 10-K plus the current share price."""
from __future__ import annotations


def _div(a, b):
    if a is None or b is None or b == 0:
        return None
    return a / b


def _last(lst, back=0):
    if not lst or len(lst) <= back:
        return None
    return lst[-1 - back]


def compute(fin: dict, price: float, shares_mm: float | None) -> dict:
    it = fin["items"]
    g = lambda k, back=0: _last(it.get(k), back)  # noqa: E731

    shares = shares_mm or g("shares_diluted")
    mcap = price * shares if shares else None
    debt = (g("short_term_debt") or 0) + (g("long_term_debt") or 0)
    cash = g("cash") or 0
    ev = mcap + debt - cash if mcap is not None else None
    rev, ni, op = g("revenue"), g("net_income"), g("operating_income")
    da = g("d_and_a")
    ebitda = op + da if op is not None and da is not None else None
    capex = g("capex")
    fcf = g("cfo") - abs(capex) if g("cfo") is not None and capex is not None else None
    eps = g("eps_diluted") or _div(ni, g("shares_diluted"))
    tax_rate = _div(g("income_tax"), g("pretax_income"))
    if tax_rate is None or not 0 <= tax_rate <= 0.5:
        tax_rate = 0.21
    invested = (debt + (g("equity") or 0) - cash) if g("equity") is not None else None
    nopat = op * (1 - tax_rate) if op is not None else None

    rev_y = it.get("revenue") or []
    cagr = None
    if len(rev_y) >= 4 and rev_y[-4] and rev_y[-1] and rev_y[-4] > 0 and rev_y[-1] > 0:
        cagr = (rev_y[-1] / rev_y[-4]) ** (1 / 3) - 1

    def pos(x):  # multiples are not meaningful on negative earnings
        return x if x is not None and x > 0 else None

    groups = [
        ("Valuation", [
            ("P/E", pos(_div(price, eps)) if eps and eps > 0 else None, "x"),
            ("EV / EBITDA", pos(_div(ev, ebitda)) if ebitda and ebitda > 0 else None, "x"),
            ("EV / Sales", pos(_div(ev, rev)), "x"),
            ("P / Book", pos(_div(mcap, g("equity"))), "x"),
            ("FCF yield", _div(fcf, mcap), "%"),
            ("Dividend yield", _div(abs(g("dividends")) if g("dividends") else None, mcap), "%"),
        ]),
        ("Profitability", [
            ("Gross margin", _div(g("gross_profit"), rev), "%"),
            ("EBITDA margin", _div(ebitda, rev), "%"),
            ("Operating margin", _div(op, rev), "%"),
            ("Net margin", _div(ni, rev), "%"),
            ("ROE", _div(ni, g("equity")), "%"),
            ("ROA", _div(ni, g("total_assets")), "%"),
            ("ROIC", _div(nopat, invested) if invested and invested > 0 else None, "%"),
        ]),
        ("Balance sheet", [
            ("Debt / Equity", _div(debt, g("equity")) if (g("equity") or 0) > 0 else None, "x"),
            ("Net debt / EBITDA", _div(debt - cash, ebitda) if ebitda and ebitda > 0 else None, "x"),
            ("Current ratio", _div(g("current_assets"), g("current_liabilities")), "x"),
            ("Interest coverage", _div(op, g("interest_expense")) if g("interest_expense") else None, "x"),
        ]),
        ("Growth", [
            ("Revenue growth (YoY)", _div(rev - g("revenue", 1), abs(g("revenue", 1)))
             if rev is not None and g("revenue", 1) else None, "%"),
            ("Revenue CAGR (3y)", cagr, "%"),
            ("EPS growth (YoY)", _div(g("eps_diluted") - g("eps_diluted", 1), abs(g("eps_diluted", 1)))
             if g("eps_diluted") is not None and g("eps_diluted", 1) else None, "%"),
            ("Net income growth (YoY)", _div(ni - g("net_income", 1), abs(g("net_income", 1)))
             if ni is not None and g("net_income", 1) else None, "%"),
        ]),
    ]
    out_groups = [
        {"name": name, "items": [{"label": l, "value": None if v is None else round(v, 4), "unit": u}
                                 for l, v, u in rows]}
        for name, rows in groups
    ]
    snapshot = {
        "market_cap": mcap, "enterprise_value": ev, "net_debt": debt - cash,
        "ebitda": ebitda, "fcf": fcf, "eps": eps, "shares_mm": shares,
    }
    return {"groups": out_groups,
            "snapshot": {k: (None if v is None else round(v, 3)) for k, v in snapshot.items()}}
