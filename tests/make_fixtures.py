"""Build offline fixtures shaped exactly like the SEC EDGAR / Yahoo Finance API responses.

Numbers are illustrative (roughly Microsoft-sized) and only exercise the pipeline;
live runs always pull real data.
"""
import json
import math
from pathlib import Path

OUT = Path(__file__).parent / "fixtures"
OUT.mkdir(exist_ok=True)
CIK = 789019
YEARS = [2021, 2022, 2023, 2024, 2025]
FLOW = {  # $mm
    "RevenueFromContractWithCustomerExcludingAssessedTax": [168088, 198270, 211915, 245122, 281724],
    "CostOfRevenue": [52232, 62650, 65863, 74114, 87831],
    "GrossProfit": [115856, 135620, 146052, 171008, 193893],
    "OperatingIncomeLoss": [69916, 83383, 88523, 109433, 128528],
    "DepreciationDepletionAndAmortization": [11686, 14460, 13861, 22287, 34153],
    "InterestExpense": [2346, 2063, 1968, 2935, 2385],
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest": [71102, 83716, 89311, 107787, 123614],
    "IncomeTaxExpenseBenefit": [9831, 10978, 16950, 19651, 21795],
    "NetIncomeLoss": [61271, 72738, 72361, 88136, 101832],
    "NetCashProvidedByUsedInOperatingActivities": [76740, 89035, 87582, 118548, 136162],
    "PaymentsToAcquirePropertyPlantAndEquipment": [20622, 23886, 28107, 44477, 64551],
    "PaymentsOfDividends": [16521, 18135, 19800, 21771, 24082],
    "PaymentsForRepurchaseOfCommonStock": [27385, 32696, 22245, 17254, 18420],
    "RepaymentsOfLongTermDebt": [8250, 9023, 2750, 29070, 2999],
    "NetCashProvidedByUsedInInvestingActivities": [-27577, -30311, -22680, -96970, -72599],
    "NetCashProvidedByUsedInFinancingActivities": [-48486, -58876, -43935, -37757, -51699],
}
STOCK = {
    "CashAndCashEquivalentsAtCarryingValue": [14224, 13931, 34704, 18315, 30242],
    "AssetsCurrent": [184406, 169684, 184257, 159734, 191131],
    "Assets": [333779, 364840, 411976, 512163, 619003],
    "LiabilitiesCurrent": [88657, 95082, 104149, 125286, 141218],
    "Liabilities": [191791, 198298, 205753, 243686, 275524],
    "LongTermDebtCurrent": [8072, 2749, 5247, 2249, 2999],
    "LongTermDebtNoncurrent": [50074, 47032, 41990, 42688, 40152],
    "StockholdersEquity": [141988, 166542, 206223, 268477, 343479],
    "PropertyPlantAndEquipmentNet": [59715, 74398, 95641, 135591, 204966],
}
EPS = [8.05, 9.65, 9.68, 11.80, 13.64]
SHARES = [7608, 7540, 7472, 7469, 7465]


def fact(y, val, start=True):
    r = {"end": f"{y}-06-30", "val": val, "accn": f"0000950170-{y % 100 + 1:02d}-0000{y % 10}",
         "fy": y, "fp": "FY", "form": "10-K", "filed": f"{y}-07-30"}
    if start:
        r["start"] = f"{y - 1}-07-01"
    return r


usgaap = {}
for c, vals in FLOW.items():
    usgaap[c] = {"label": c, "units": {"USD": [fact(y, v * 1e6) for y, v in zip(YEARS, vals)]}}
for c, vals in STOCK.items():
    usgaap[c] = {"label": c, "units": {"USD": [fact(y, v * 1e6, False) for y, v in zip(YEARS, vals)]}}
usgaap["EarningsPerShareDiluted"] = {"units": {"USD/shares": [fact(y, v) for y, v in zip(YEARS, EPS)]}}
usgaap["WeightedAverageNumberOfDilutedSharesOutstanding"] = {
    "units": {"shares": [fact(y, v * 1e6) for y, v in zip(YEARS, SHARES)]}}
# a quarterly 10-Q fact that must be ignored
usgaap["NetIncomeLoss"]["units"]["USD"].append(
    {"start": "2025-07-01", "end": "2025-09-30", "val": 27.7e9, "fy": 2026, "fp": "Q1", "form": "10-Q", "filed": "2025-10-29"})

facts = {"cik": CIK, "entityName": "MICROSOFT CORP", "facts": {
    "us-gaap": usgaap,
    "dei": {"EntityCommonStockSharesOutstanding": {"units": {"shares": [
        {"end": "2025-07-24", "val": 7433038381, "fy": 2025, "fp": "FY", "form": "10-K", "filed": "2025-07-30"}]}}}}}
(OUT / f"companyfacts_{CIK}.json").write_text(json.dumps(facts))

(OUT / "company_tickers.json").write_text(json.dumps(
    {"0": {"cik_str": CIK, "ticker": "MSFT", "title": "MICROSOFT CORP"},
     "1": {"cik_str": 1341439, "ticker": "ORCL", "title": "ORACLE CORP"},
     "2": {"cik_str": 1652044, "ticker": "GOOGL", "title": "ALPHABET INC."}}))

subs = {"cik": str(CIK), "name": "MICROSOFT CORP", "tickers": ["MSFT"], "filings": {"recent": {
    "accessionNumber": [f"0000950170-{y % 100 + 1:02d}-0000{y % 10}" for y in reversed(YEARS)] + ["0000950170-25-000100"],
    "form": ["10-K"] * 5 + ["10-Q"],
    "filingDate": [f"{y}-07-30" for y in reversed(YEARS)] + ["2025-10-29"],
    "reportDate": [f"{y}-06-30" for y in reversed(YEARS)] + ["2025-09-30"],
    "primaryDocument": [f"msft-{y}0630.htm" for y in reversed(YEARS)] + ["msft-20250930.htm"],
}}}
(OUT / f"submissions_{CIK}.json").write_text(json.dumps(subs))

ts0 = 1732492800  # 2024-11-25
stamps = [ts0 + 86400 * i for i in range(365) if (i % 7) < 5]
closes = [415 + 60 * math.sin(i / 40) + i * 0.12 for i in range(len(stamps))]
chart = {"chart": {"result": [{"meta": {"currency": "USD", "symbol": "MSFT",
                                        "regularMarketPrice": round(closes[-1], 2), "regularMarketTime": stamps[-1]},
                               "timestamp": stamps, "indicators": {"quote": [{"close": closes}]}}]}}
(OUT / "chart_MSFT.json").write_text(json.dumps(chart))


def series(sym, start, drift, amp, period=40):
    c = [start + amp * math.sin(i / period) + i * drift for i in range(len(stamps))]
    return {"chart": {"result": [{"meta": {"currency": "USD", "symbol": sym, "regularMarketPrice": round(c[-1], 2),
                                           "regularMarketTime": stamps[-1]},
                                  "timestamp": stamps, "indicators": {"quote": [{"close": c}]}}]}}


(OUT / "chart_SPY.json").write_text(json.dumps(series("SPY", 590, 0.3, 20, 50)))
(OUT / "chart__TNX.json").write_text(json.dumps(series("^TNX", 4.3, 0, 0.1)))
(OUT / "chart__IRX.json").write_text(json.dumps(series("^IRX", 4.0, -0.002, 0.05)))
(OUT / "chart_ORCL.json").write_text(json.dumps(series("ORCL", 170, 0.2, 25, 30)))
(OUT / "chart_GOOGL.json").write_text(json.dumps(series("GOOGL", 165, 0.15, 12, 35)))


def qs(mean, median, hi, lo, n, beta, sector):
    return {"quoteSummary": {"result": [{
        "financialData": {"targetMeanPrice": {"raw": mean}, "targetMedianPrice": {"raw": median},
                          "targetHighPrice": {"raw": hi}, "targetLowPrice": {"raw": lo},
                          "numberOfAnalystOpinions": {"raw": n}, "recommendationKey": "buy"},
        "defaultKeyStatistics": {"beta": {"raw": beta}},
        "summaryProfile": {"sector": sector, "industry": "Software - Infrastructure", "website": "https://example.com"}}]}}


(OUT / "quoteSummary_MSFT.json").write_text(json.dumps(qs(612.5, 625.0, 700, 480, 55, 1.05, "Technology")))
(OUT / "quoteSummary_ORCL.json").write_text(json.dumps(qs(260, 255, 330, 175, 40, 1.3, "Technology")))
(OUT / "quoteSummary_GOOGL.json").write_text(json.dumps(qs(240, 238, 290, 185, 60, 1.0, "Communication Services")))

# two peers: same structure, scaled numbers, different CIKs
for cik, tick, name, k in ((1341439, "ORCL", "ORACLE CORP", 0.22), (1652044, "GOOGL", "ALPHABET INC.", 1.25)):
    f2 = json.loads(json.dumps(facts))
    f2["cik"], f2["entityName"] = cik, name
    for concept in f2["facts"]["us-gaap"].values():
        for unit, rows in concept["units"].items():
            for r in rows:
                if unit != "USD/shares":
                    r["val"] = r["val"] * k
    f2["facts"]["dei"]["EntityCommonStockSharesOutstanding"]["units"]["shares"][0]["val"] = 7433038381 * k * 0.4
    (OUT / f"companyfacts_{cik}.json").write_text(json.dumps(f2))
    s2 = json.loads(json.dumps(subs))
    s2["name"] = name
    (OUT / f"submissions_{cik}.json").write_text(json.dumps(s2))
print("fixtures written to", OUT)
