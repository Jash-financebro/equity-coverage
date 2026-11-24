"""Fixed layout of the Live_Data sheet. Rows never move, so model links stay valid."""
from __future__ import annotations

from fundamentals import LINE_ITEMS

SHEET = "Live_Data"
YEAR_COLS = ["B", "C", "D", "E", "F"]          # oldest -> newest; F is always the latest 10-K
FIRST_ITEM_ROW = 17
SCALARS = {  # key -> (row, label, number format, named range)
    "ticker": (4, "Ticker", None, None),
    "company": (5, "Company", None, None),
    "price": (6, "Share price", "#,##0.00", "LD_Price"),
    "price_date": (7, "Price date", None, None),
    "shares": (8, "Shares outstanding (mm)", "#,##0.0", "LD_Shares"),
    "market_cap": (9, "Market cap ($mm)", "#,##0", "LD_MarketCap"),
    "net_debt": (10, "Net debt, latest FY ($mm)", "#,##0;(#,##0);-", "LD_NetDebt"),
    "tenk_filed": (11, "Latest 10-K filed", None, None),
    "tenk_url": (12, "Latest 10-K link", None, None),
    "sources": (13, "Sources", None, None),
}
MARKET_HEADER_ROW = FIRST_ITEM_ROW + len(LINE_ITEMS) + 1
_MARKET = [
    ("risk_free", "Risk-free rate (10Y Treasury)", "0.00%", "LD_RiskFree"),
    ("beta", "Beta (Yahoo Finance, 5Y monthly)", "0.00", "LD_Beta"),
    ("erp", "Equity risk premium", "0.00%", "LD_ERP"),
    ("cost_of_equity", "Cost of equity (CAPM)", "0.00%", "LD_CostOfEquity"),
    ("pre_tax_cost_of_debt", "Pre-tax cost of debt (interest / debt)", "0.00%", "LD_CostOfDebt"),
    ("tax_rate", "Effective tax rate (latest 10-K)", "0.00%", "LD_TaxRate"),
    ("after_tax_cost_of_debt", "After-tax cost of debt", "0.00%", None),
    ("weight_equity", "Equity weight (market)", "0.0%", None),
    ("weight_debt", "Debt weight (book)", "0.0%", None),
    ("wacc", "WACC (market data)", "0.00%", "LD_WACC"),
    ("street_mean", "Street mean target", "#,##0.00", "LD_StreetMean"),
    ("street_median", "Street median target", "#,##0.00", "LD_StreetMedian"),
    ("street_high", "Street high target", "#,##0.00", None),
    ("street_low", "Street low target", "#,##0.00", None),
    ("analysts", "Number of analysts", "0", None),
]
MARKET = {k: (MARKET_HEADER_ROW + 1 + i, label, fmt, name) for i, (k, label, fmt, name) in enumerate(_MARKET)}
LAST_ROW = MARKET_HEADER_ROW + len(_MARKET) + 2


def item_row(key: str) -> int:
    for i, (k, *_rest) in enumerate(LINE_ITEMS):
        if k == key:
            return FIRST_ITEM_ROW + i
    raise KeyError(key)


def ref_for(source: str, calc_syntax: bool = True) -> str:
    """'price' -> $Live_Data.$B$6 ; 'revenue.FY0' -> $Live_Data.$F$17 ; 'wacc' -> market block."""
    sep = "." if calc_syntax else "!"
    if source in SCALARS:
        return f"${SHEET}{sep}$B${SCALARS[source][0]}"
    if source in MARKET:
        return f"${SHEET}{sep}$B${MARKET[source][0]}"
    key, _, period = source.partition(".")
    period = (period or "FY0").upper()
    back = 0 if period == "FY0" else int(period.replace("FY", ""))
    if not -4 <= back <= 0:
        raise ValueError(f"period out of range in {source!r} (use FY0..FY-4)")
    return f"${SHEET}{sep}${YEAR_COLS[4 + back]}${item_row(key)}"
