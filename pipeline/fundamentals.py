"""Turn SEC XBRL company facts into clean annual (10-K) financials."""
from __future__ import annotations

import datetime as dt

ANNUAL_FORMS = {"10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"}

# key -> (label, kind, candidate us-gaap concepts in priority order)
# kind: "flow" = income/cash-flow item over a year, "stock" = balance-sheet point in time
LINE_ITEMS: list[tuple[str, str, str, list[str]]] = [
    ("revenue", "Revenue", "flow", [
        "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet",
        "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueGoodsNet"]),
    ("cogs", "Cost of revenue", "flow", [
        "CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfServices"]),
    ("gross_profit", "Gross profit", "flow", ["GrossProfit"]),
    ("operating_income", "Operating income", "flow", ["OperatingIncomeLoss"]),
    ("d_and_a", "Depreciation & amortization", "flow", [
        "DepreciationDepletionAndAmortization", "DepreciationAndAmortization",
        "DepreciationAmortizationAndAccretionNet", "Depreciation"]),
    ("interest_expense", "Interest expense", "flow", [
        "InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt"]),
    ("pretax_income", "Pre-tax income", "flow", [
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"]),
    ("income_tax", "Income tax expense", "flow", ["IncomeTaxExpenseBenefit"]),
    ("net_income", "Net income", "flow", ["NetIncomeLoss", "ProfitLoss"]),
    ("eps_diluted", "Diluted EPS ($)", "flow", ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"]),
    ("shares_diluted", "Diluted shares (mm)", "flow", ["WeightedAverageNumberOfDilutedSharesOutstanding"]),
    ("cfo", "Cash from operations", "flow", [
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"]),
    ("capex", "Capital expenditures", "flow", [
        "PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"]),
    ("dividends", "Dividends paid", "flow", ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"]),
    ("cash", "Cash & equivalents", "stock", [
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]),
    ("current_assets", "Current assets", "stock", ["AssetsCurrent"]),
    ("total_assets", "Total assets", "stock", ["Assets"]),
    ("current_liabilities", "Current liabilities", "stock", ["LiabilitiesCurrent"]),
    ("total_liabilities", "Total liabilities", "stock", ["Liabilities"]),
    ("short_term_debt", "Short-term debt", "stock", [
        "LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings", "LoansAndNotesPayable",
        "LongTermDebtAndCapitalLeaseObligationsCurrent", "CommercialPaper"]),
    ("long_term_debt", "Long-term debt", "stock", [
        "LongTermDebtNoncurrent", "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations"]),
    ("equity", "Shareholders' equity", "stock", [
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]),
    # appended later (keep order: Live_Data rows are fixed)
    ("ppe_net", "PP&E, net", "stock", [
        "PropertyPlantAndEquipmentNet",
        "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization"]),
    ("sga", "SG&A", "flow", ["SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense"]),
    ("buybacks", "Share repurchases", "flow", ["PaymentsForRepurchaseOfCommonStock"]),
    ("debt_repaid", "Debt repayments", "flow", ["RepaymentsOfLongTermDebt", "RepaymentsOfDebt",
                                                 "RepaymentsOfDebtMaturingInMoreThanThreeMonths",
                                                 "RepaymentsOfLongTermDebtAndCapitalSecurities", "RepaymentsOfSeniorDebt"]),
    ("debt_issued", "Debt issued", "flow", ["ProceedsFromIssuanceOfLongTermDebt", "ProceedsFromIssuanceOfDebt",
                                                "ProceedsFromDebtMaturingInMoreThanThreeMonths",
                                                "ProceedsFromIssuanceOfSeniorLongTermDebt"]),
    ("cfi", "Cash from investing", "flow", [
        "NetCashProvidedByUsedInInvestingActivities",
        "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations"]),
    ("cff", "Cash from financing", "flow", [
        "NetCashProvidedByUsedInFinancingActivities",
        "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations"]),
    ("equity_investments", "Equity-method & long-term investments", "stock", [
        "EquityMethodInvestments", "LongTermInvestments"]),
]

PER_SHARE = {"eps_diluted"}
ZERO_IF_UNTAGGED = ("short_term_debt", "debt_repaid", "debt_issued", "buybacks", "dividends",
                    "equity_investments")
SHARE_COUNTS = {"shares_diluted"}


def _d(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


class NonUSD(ValueError):
    """Company reports in another currency (typically an IFRS 20-F filer)."""


def reporting_currency(facts: dict) -> str | None:
    """Currency of the revenue / net income facts; None if no such facts."""
    for key in ("revenue", "net_income"):
        for _k, _l, _kind, concepts in [x for x in LINE_ITEMS if x[0] == key]:
            for c in concepts:
                node = facts.get("facts", {}).get("us-gaap", {}).get(c) or facts.get("facts", {}).get("ifrs-full", {}).get(c)
                if node and node.get("units"):
                    units = node["units"]
                    return "USD" if "USD" in units else next(iter(units))
    return None


def _facts(facts: dict, concept: str, unit_pref: str) -> list[dict]:
    node = facts.get("facts", {}).get("us-gaap", {}).get(concept) \
        or facts.get("facts", {}).get("ifrs-full", {}).get(concept)
    if not node:
        return []
    units = node.get("units", {})
    rows = units.get(unit_pref) or next(iter(units.values()), [])
    return [r for r in rows if r.get("form") in ANNUAL_FORMS]


def _annual_values(rows: list[dict], kind: str) -> dict[str, tuple[float, str]]:
    """period-end date -> (value, filed). Latest filing wins (captures restatements)."""
    out: dict[str, tuple[float, str]] = {}
    for r in rows:
        if kind == "flow":
            if "start" not in r:
                continue
            days = (_d(r["end"]) - _d(r["start"])).days
            if not 340 <= days <= 380:
                continue
        prev = out.get(r["end"])
        if prev is None or r.get("filed", "") >= prev[1]:
            out[r["end"]] = (float(r["val"]), r.get("filed", ""))
    return out


def build(facts: dict, years: int = 5) -> dict:
    """Return {"periods": [...end dates oldest->newest], "labels": [...], "items": {key: [...]},
    "concepts": {key: concept used}} in $ millions (EPS in $, shares in millions)."""
    cur = reporting_currency(facts)
    if cur and cur != "USD":
        raise NonUSD(cur)
    series: dict[str, dict[str, float]] = {}
    used: dict[str, str] = {}
    for key, _label, kind, concepts in LINE_ITEMS:
        unit = "USD/shares" if key in PER_SHARE else ("shares" if key in SHARE_COUNTS else "USD")
        # pick the concept with the most recent data as primary, fill older gaps from the rest
        ranked = []
        for c in concepts:
            vals = _annual_values(_facts(facts, c, unit), kind)
            if vals:
                ranked.append((max(vals), c, vals))
        ranked.sort(key=lambda x: x[0], reverse=True)
        merged: dict[str, float] = {}
        for _, c, vals in ranked:
            used.setdefault(key, c)
            for end, (v, _f) in vals.items():
                merged.setdefault(end, v)
        series[key] = merged

    # fiscal year ends = flow periods reported for revenue / net income
    anchor = series.get("revenue") or series.get("net_income") or {}
    if len(anchor) < 2 and series.get("net_income"):
        anchor = series["net_income"]
    ends = sorted(anchor)[-years:]
    if not ends:
        raise ValueError("no annual 10-K data found in XBRL facts")

    def scale(key, v):
        if v is None:
            return None
        if key in PER_SHARE:
            return round(v, 4)
        return round(v / 1e6, 3)

    items = {}
    for key, *_ in LINE_ITEMS:
        s = series.get(key, {})
        items[key] = [scale(key, s.get(e)) for e in ends]

    # derived where the tag is missing
    for i in range(len(ends)):
        if items["gross_profit"][i] is None and items["revenue"][i] is not None and items["cogs"][i] is not None:
            items["gross_profit"][i] = round(items["revenue"][i] - items["cogs"][i], 3)

    # total liabilities is often not tagged: derive it from assets - total equity (incl. NCI)
    if any(v is None for v in items["total_liabilities"]):
        eq_total = _annual_values(_facts(facts, "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
                                         "USD"), "stock")
        for i, e in enumerate(ends):
            if items["total_liabilities"][i] is None and items["total_assets"][i] is not None:
                eq = eq_total.get(e, (None,))[0]
                eq = eq / 1e6 if eq is not None else items["equity"][i]
                if eq is not None:
                    items["total_liabilities"][i] = round(items["total_assets"][i] - eq, 3)

    # detail lines a company doesn't tag in some years: an explicit 0 so every model link has a value to flow
    for key in ZERO_IF_UNTAGGED:
        if any(v is None for v in items.get(key, [])):
            items[key] = [0.0 if v is None else v for v in items[key]]
            used[key] = used.get(key, "not tagged") + " (untagged years = 0)"

    labels = [f"FY{_d(e).year}" for e in ends]
    return {"periods": ends, "labels": labels, "items": items, "concepts": used,
            "meta": {key: {"label": label, "kind": kind} for key, label, kind, _ in LINE_ITEMS}}


def shares_outstanding(facts: dict) -> float | None:
    """Latest cover-page share count (millions)."""
    node = facts.get("facts", {}).get("dei", {}).get("EntityCommonStockSharesOutstanding")
    if not node:
        return None
    rows = node.get("units", {}).get("shares", [])
    if not rows:
        return None
    # cover page may list several share classes for the same date: sum the latest date
    latest = max(r["end"] for r in rows)
    latest_filed = max(r.get("filed", "") for r in rows if r["end"] == latest)
    total = sum(r["val"] for r in rows if r["end"] == latest and r.get("filed", "") == latest_filed)
    return round(total / 1e6, 3)
