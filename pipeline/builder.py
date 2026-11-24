"""Build a {TICKER}_v{N}.xlsx 3-statement model from SEC EDGAR data.

Follows JJ's three-statement-model-builder conventions:
* hidden historicals tab (Live_Data) labelled with its source; separate IS / BS / CF tabs,
  roll-forward schedules (PP&E, D&A, other NCA, equity/retained earnings, debt + revolver sweep,
  interest), Revenue Build, WACC, DCF and Financial Ratios tabs
* layout and look follow JJ's LNG model: Calibri 12, navy banners, Cover first; A1 left blank;
  column A narrow, labels in B, data from column D
* blue = hardcoded, black = same-sheet formula, green = cross-sheet link; no SUMPRODUCT/MMULT
* "$" number format and bold ONLY on summed (total / subtotal) rows
* balance check row nets to zero; bull / base / bear selector drives the assumptions
"""
from __future__ import annotations

import re
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.workbook.defined_name import DefinedName

from fundamentals import LINE_ITEMS
from layout import MARKET, MARKET_HEADER_ROW, SCALARS, YEAR_COLS, item_row

FONT = "Calibri"
SIZE = 12
NAVY, NAVY2, HILITE = "1F3864", "1F3764", "FFF2CC"
WHITE = "FFFFFF"
LAST_COL = "K"
BLUE, BLACK, GREEN = "0000FF", "000000", "008000"
NUM = '#,##0.0_);[Red](#,##0.0)'
TOT = '$#,##0.0_);[Red]($#,##0.0)'
PCT = '0.0%;[Red](0.0%)'
MULT = '0.0"x"'
PS = '0.00_);[Red](0.00)'
HIST, PROJ = ["D", "E", "F"], ["G", "H", "I", "J", "K"]
ALL = HIST + PROJ
PREV = {c: chr(ord(c) - 1) for c in ALL}
STANCES = {"bullish": 1, "bull": 1, "balanced": 2, "base": 2, "traditional": 2, "conservative": 2,
           "bearish": 3, "bear": 3}


def _q(sheet: str) -> str:
    return f"'{sheet}'" if re.search(r"[^A-Za-z0-9_]", sheet) else sheet


def L(key: str, col: str) -> str:
    """Link into the hidden historicals tab."""
    return f"Live_Data!{col}{item_row(key)}"


def LM(key: str) -> str:
    return f"Live_Data!$B${MARKET[key][0]}"


def _cols(a, b):
    return [chr(x) for x in range(ord(a), ord(b) + 1)]


def banner(ws, row, first="B", last=LAST_COL, fill=NAVY):
    """Navy band across the row, white text (the LNG model's title / section style)."""
    for col in _cols(first, last):
        c = ws[f"{col}{row}"]
        c.fill = PatternFill("solid", fgColor=fill)
        if not (isinstance(c.value, (int, float)) and not isinstance(c.value, bool)) and not (
                isinstance(c.value, str) and c.value.startswith("=")):
            c.font = Font(name=FONT, size=SIZE, bold=False, color=WHITE)


class Sheet:
    def __init__(self, wb, title, label, heading):
        self.ws = wb.create_sheet(title)
        self.title = title
        ws = self.ws
        ws.sheet_view.showGridLines = False
        ws.sheet_view.zoomScale = 80
        ws.column_dimensions["A"].width = 2.75
        ws.column_dimensions["B"].width = 50
        ws.column_dimensions["C"].width = 4
        for c in ALL:
            ws.column_dimensions[c].width = 13
        self.put("B2", heading)
        banner(ws, 2)

    def ref(self, cell):
        return f"{_q(self.title)}!{cell}"

    def put(self, cell, value, fmt=None, bold=False, note=None):
        c = self.ws[cell]
        c.value = value
        if isinstance(value, str) and value.startswith("="):
            color = GREEN if "!" in value else BLACK
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            color = BLUE
        else:
            color = BLACK
        c.font = Font(name=FONT, size=SIZE, bold=False, color=color)  # JJ: no bold anywhere
        if fmt:
            c.number_format = fmt
        if note:
            c.comment = Comment(note, "Model builder")
        return c

    def header(self, row, years):
        self.put(f"B{row}", "Fiscal year ($ in millions, except per-share data)")
        for c, y in zip(ALL, years):
            self.put(f"{c}{row}", str(y))
            self.ws[f"{c}{row}"].alignment = Alignment(horizontal="right")
        banner(self.ws, row, fill=NAVY2)

    def line(self, row, label, values: dict, fmt=NUM, total=False, note=None):
        self.put(f"B{row}", label, bold=total, note=note)
        for col, v in values.items():
            if v is None:
                continue
            self.put(f"{col}{row}", v, TOT if total and fmt == NUM else fmt, bold=total)

    def section(self, row, text):
        self.put(f"B{row}", text)
        banner(self.ws, row)


def _avg(xs):
    """Median of the available years: robust to one-off impairments or gains."""
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def _clip(x, lo, hi, default):
    if x is None:
        return default
    return max(lo, min(hi, x))


def _drivers(fin: dict, stance: str) -> dict:
    it = {k: (v[-3:] if v else [None] * 3) for k, v in fin["items"].items()}
    g = lambda k, i=-1: it[k][i]  # noqa: E731
    rev = it["revenue"]
    cagr = None
    if rev[0] and rev[-1] and rev[0] > 0 and rev[-1] > 0:
        cagr = (rev[-1] / rev[0]) ** 0.5 - 1
    base_g = _clip(cagr, -0.05, 0.12, 0.03)
    cogs = _avg([c / r for c, r in zip(it["cogs"], rev) if c is not None and r])
    gp = [r - c if r is not None and c is not None else None for r, c in zip(rev, it["cogs"])]
    opex = _avg([(p - o) / r for p, o, r in zip(gp, it["operating_income"], rev)
                 if p is not None and o is not None and r]) if cogs is not None else \
        _avg([(r - o) / r for r, o in zip(rev, it["operating_income"]) if r and o is not None])
    cogs = cogs or 0.0
    ppe_mode = g("ppe_net") is not None and (it["ppe_net"][-2] or 0) > 0
    da_rate = (g("d_and_a") or 0) / it["ppe_net"][-2] if ppe_mode else \
        _avg([d / r for d, r in zip(it["d_and_a"], rev) if d is not None and r]) or 0
    debt_now = (g("short_term_debt") or 0) + (g("long_term_debt") or 0)
    debt_prev = (it["short_term_debt"][-2] or 0) + (it["long_term_debt"][-2] or 0)
    net_repay = (g("debt_repaid") or 0) - (g("debt_issued") or 0)
    ni_cons = (g("pretax_income") or 0) - (g("income_tax") or 0)
    nci = ni_cons - (g("net_income") or 0)
    shares = it["shares_diluted"]
    sh_chg = (shares[-1] / shares[0]) ** 0.5 - 1 if shares[0] and shares[-1] else 0
    d = {
        "base_growth": base_g,
        "cogs": cogs, "opex": _clip(opex, -0.5, 1.5, 0.2),
        "ppe_mode": ppe_mode, "da_rate": _clip(da_rate, 0, 0.5, 0.05),
        "capex": _clip(_avg([c / r for c, r in zip(it["capex"], rev) if c is not None and r]), 0, 0.8, 0.05),
        "oca": _clip(((g("current_assets") or 0) - (g("cash") or 0)) / rev[-1] if rev[-1] else None, 0, 2, 0.1),
        "ocl": _clip(((g("current_liabilities") or 0) - (g("short_term_debt") or 0)) / rev[-1] if rev[-1] else None,
                     0, 2, 0.1),
        "tax": _clip((g("income_tax") or 0) / g("pretax_income") if g("pretax_income") else None, 0, 0.35, 0.21),
        "nci": _clip(nci / ni_cons if ni_cons > 0 else 0, 0, 0.9, 0),
        "payout": _clip((g("dividends") or 0) / g("net_income") if (g("net_income") or 0) > 0 else 0, 0, 1, 0),
        "buybacks": round(g("buybacks") or 0, 1),
        "share_chg": _clip(sh_chg, -0.05, 0.03, 0),
        "repay": _clip(net_repay / debt_prev if debt_prev else 0, 0, 0.15, 0),
        "min_cash": round((g("cash") or 0) * 0.5, 1),
        "rate": _clip((g("interest_expense") or 0) / ((debt_now + debt_prev) / 2) if debt_now + debt_prev else None,
                      0.02, 0.12, 0.05),
    }
    st = stance.lower().split()[0].strip("/")
    d["selector"] = STANCES.get(st, 2)
    d["conservative"] = st in ("traditional", "conservative")
    if d["conservative"]:
        d["base_growth"] -= 0.01
    return d


def _write_live_data(wb, label, live: dict, fin: dict):
    ws = wb.create_sheet("Live_Data")
    ws.sheet_state = "hidden"
    ws.sheet_view.showGridLines = False
    f = lambda color=BLACK, bold=False: Font(name=FONT, size=10, color=color, bold=False)  # noqa: E731
    ws["A1"].value = None
    ws["A2"].value = ("LIVE DATA (historicals source: SEC EDGAR 10-K XBRL; prices & market data: Yahoo Finance). "
                      "Refreshed automatically by the pipeline.")
    ws["A2"].font = f()
    for key, (row, lab, fmt, _n) in SCALARS.items():
        ws[f"A{row}"].value, ws[f"A{row}"].font = lab, f()
        c = ws[f"B{row}"]
        c.value, c.font = live.get(key), f(BLUE)
        if fmt:
            c.number_format = fmt
    labels, periods = fin["labels"][-5:], fin["periods"][-5:]
    pad = 5 - len(labels)
    ws["A15"].value, ws["A15"].font = "($ millions unless noted)", f(bold=True)
    ws["A16"].value, ws["A16"].font = "Fiscal period end", f()
    for j, col in enumerate(YEAR_COLS):
        i = j - pad
        ws[f"{col}15"].value, ws[f"{col}15"].font = (labels[i] if i >= 0 else None), f(bold=True)
        ws[f"{col}16"].value, ws[f"{col}16"].font = (periods[i] if i >= 0 else None), f()
    for key, lab, _k, _c in LINE_ITEMS:
        r = item_row(key)
        ws[f"A{r}"].value, ws[f"A{r}"].font = lab, f()
        vals = fin["items"].get(key, [])[-5:]
        for j, col in enumerate(YEAR_COLS):
            i = j - pad
            v = vals[i] if 0 <= i < len(vals) else None
            ws[f"{col}{r}"].value, ws[f"{col}{r}"].font = v, f(BLUE)
            ws[f"{col}{r}"].number_format = NUM
        ws[f"G{r}"].value, ws[f"G{r}"].font = fin["concepts"].get(key, "n/a"), f()
    ws[f"A{MARKET_HEADER_ROW}"].value, ws[f"A{MARKET_HEADER_ROW}"].font = "Market data & cost of capital", f(bold=True)
    mk = live.get("market") or {}
    for key, (row, lab, fmt, _n) in MARKET.items():
        ws[f"A{row}"].value, ws[f"A{row}"].font = lab, f()
        ws[f"B{row}"].value, ws[f"B{row}"].font = mk.get(key), f(BLUE)
        ws[f"B{row}"].number_format = fmt
    ws.column_dimensions["A"].width = 40


def build(ticker: str, dest: Path, ctx: dict, stance: str = "Balanced") -> Path:
    live, fin = ctx["live"], ctx["fin"]
    label = dest.stem
    T = ticker.upper()
    d = _drivers(fin, stance)
    y0 = int(fin["labels"][-1][2:])
    years = [f"FY{y0 - 2}A", f"FY{y0 - 1}A", f"FY{y0}A"] + [f"FY{y0 + i}E" for i in range(1, 6)]

    wb = Workbook()
    wb.remove(wb.active)
    IS = Sheet(wb, f"{T} Income Statement", label, f"{live['company']} ({T}) - Income Statement")
    BS = Sheet(wb, f"{T} Balance Sheet", label, f"{live['company']} ({T}) - Balance Sheet")
    CF = Sheet(wb, f"{T} Cash Flow Statement", label, f"{live['company']} ({T}) - Cash Flow Statement")
    SC = Sheet(wb, f"{T} Schedules", label, f"{live['company']} ({T}) - Supporting Schedules")
    RB = Sheet(wb, f"{T} Revenue Build", label, f"{live['company']} ({T}) - Revenue Build & Assumptions")
    WA = Sheet(wb, f"{T} WACC", label, f"{live['company']} ({T}) - Weighted Average Cost of Capital")
    DC = Sheet(wb, f"{T} DCF", label, f"{live['company']} ({T}) - Discounted Cash Flow")
    CO = Sheet(wb, f"{T} Comps", label, f"{live['company']} ({T}) - Comparable Companies")
    VS = Sheet(wb, f"{T} Target Price", label, f"{live['company']} ({T}) - Target Price: Valuation Blend, Anchoring & Scenarios")
    FR = Sheet(wb, f"{T} Financial Ratios", label, f"{live['company']} ({T}) - Financial Ratios")
    _write_live_data(wb, label, live, fin)
    for s in (IS, BS, CF, SC, RB, FR):
        s.header(3, years)
    DC.header(3, years)

    # --------------------------------------------------------- Revenue Build
    rb = RB.ref
    RB.put("B5", "Active scenario (1 = Bull, 2 = Base, 3 = Bear)")
    RB.put("D5", d["selector"], "0", note="Change to 1 / 2 / 3 to switch the whole model")
    RB.put("B6", "Model stance")
    RB.put("D6", {1: "Bullish", 2: "Traditional / Conservative" if d["conservative"] else "Balanced / Base case",
                  3: "Bearish"}[d["selector"]])
    RB.section(8, "Revenue growth")
    fade = [d["base_growth"] + (0.03 - d["base_growth"]) * i / 4 for i in range(5)]
    RB.line(9, "Bull case growth", {c: round(v + 0.03, 4) for c, v in zip(PROJ, fade)}, PCT)
    RB.line(10, "Base case growth", {c: round(v, 4) for c, v in zip(PROJ, fade)}, PCT,
            note="Base: 2-year revenue CAGR from the 10-K (clipped to -5%/+12%), fading to 3% by year 5")
    RB.line(11, "Bear case growth", {c: round(v - 0.03, 4) for c, v in zip(PROJ, fade)}, PCT)
    RB.line(12, "Selected revenue growth", {c: f"=CHOOSE($D$5,{c}9,{c}10,{c}11)" for c in PROJ}, PCT)
    RB.line(14, "Total Revenue", {**{c: f"={L('revenue', c)}" for c in HIST},
                                  **{c: f"={PREV[c]}14*(1+{c}12)" for c in PROJ}}, total=True)
    RB.line(15, "Revenue growth", {**{c: f"=IFERROR({c}14/{PREV[c]}14-1,0)" for c in HIST[1:]},
                                   **{c: f"={c}12" for c in PROJ}}, PCT)
    RB.put("B16", "Revenue is driven at the consolidated level: segment detail is not in standardized XBRL.")

    RB.section(18, "Operating drivers")
    cogs_rows = {"bull": d["cogs"] - 0.01, "base": d["cogs"], "bear": d["cogs"] + 0.01}
    if d["conservative"]:
        cogs_rows = {k: v + 0.005 for k, v in cogs_rows.items()}
    RB.line(19, "Cost of revenue % of revenue - bull", {c: round(max(0, cogs_rows["bull"]), 4) for c in PROJ}, PCT)
    RB.line(20, "Cost of revenue % of revenue - base", {c: round(cogs_rows["base"], 4) for c in PROJ}, PCT,
            note="3-year median from the 10-K")
    RB.line(21, "Cost of revenue % of revenue - bear", {c: round(cogs_rows["bear"], 4) for c in PROJ}, PCT)
    RB.line(22, "Selected cost of revenue % of revenue",
            {**{c: f"=IFERROR({IS.ref(c + '7')}/{IS.ref(c + '5')},0)" for c in HIST},
             **{c: f"=CHOOSE($D$5,{c}19,{c}20,{c}21)" for c in PROJ}}, PCT)
    drivers = [
        (23, "Operating expenses (incl. D&A) % of revenue", d["opex"], PCT, "3-year median from the 10-K"),
        (24, "D&A % of beginning PP&E" if d["ppe_mode"] else "D&A % of revenue", d["da_rate"], PCT,
         "Latest 10-K D&A over prior-year net PP&E" if d["ppe_mode"] else "PP&E not tagged: D&A tied to revenue"),
        (25, "Capital expenditures % of revenue", d["capex"], PCT, "3-year median from the 10-K"),
        (26, "Other current assets % of revenue", d["oca"], PCT, "Latest 10-K"),
        (27, "Current liabilities (excl. debt) % of revenue", d["ocl"], PCT, "Latest 10-K"),
        (28, "Tax rate", d["tax"], PCT, "Latest 10-K effective rate (clipped 0-35%)"),
        (29, "Noncontrolling interest share of net income", d["nci"], PCT, "Latest 10-K"),
        (30, "Dividend payout (% of net income to common)", d["payout"], PCT, "Latest 10-K"),
        (31, "Share repurchases", d["buybacks"], NUM, "Held flat at the latest 10-K level"),
        (32, "Diluted share count change", d["share_chg"], PCT, "2-year trend from the 10-K"),
        (33, "Mandatory debt repayment (% of beginning term debt)", d["repay"], PCT, "Latest 10-K net repayment"),
        (34, "Minimum cash balance", d["min_cash"], NUM, "50% of latest 10-K cash"),
        (35, "Interest rate on term debt", d["rate"], PCT, "Latest 10-K interest / average debt"),
        (36, "Interest rate on revolver", round(d["rate"] + 0.005, 4), PCT, "Term debt rate + 50 bp"),
    ]
    for row, lab, v, fmt, note in drivers:
        RB.line(row, lab, {c: round(v, 4) if fmt == PCT else v for c in PROJ}, fmt, note=note)
    for row, num, den in ((23, "10", "5"), (28, "19", "18")):
        for c in HIST:
            RB.put(f"{c}{row}", f"=IFERROR({IS.ref(c + num)}/{IS.ref(c + den)},0)", PCT)
    for c in HIST:
        RB.put(f"{c}25", f"=IFERROR(-{CF.ref(c + '12')}/{IS.ref(c + '5')},0)", PCT)
    RB.line(37, "Interest rate on cash (10Y Treasury, live)", {c: f"={LM('risk_free')}" for c in PROJ}, PCT)
    RB.section(39, "Terminal growth rate")
    RB.line(40, "Bull", {"D": 0.03}, PCT)
    RB.line(41, "Base", {"D": 0.02 if d["conservative"] else 0.025}, PCT)
    RB.line(42, "Bear", {"D": 0.02}, PCT)
    RB.line(43, "Selected terminal growth rate", {"D": "=CHOOSE($D$5,D40,D41,D42)"}, PCT)
    RB.line(44, "Exit multiple vs. current EV/EBITDA: bull / base / bear", {"D": 1.1, "E": 1.0, "F": 0.9}, '0.00"x"')
    RB.line(45, "Selected exit multiple factor", {"D": "=CHOOSE($D$5,D44,E44,F44)"}, '0.00"x"')
    RB.put("B47", f"Stance note: {RB.ws['D6'].value}. Bull = base growth +3 pts and cost of revenue -1 pt, "
                  "terminal growth 3.0%, exit multiple +10%; bear = growth -3 pts, cost of revenue +1 pt, terminal growth 2.0%, "
                  "exit multiple -10%."
                  + (" Conservative: base growth -1 pt, cost of revenue +0.5 pt, terminal 2.0%." if d["conservative"]
                     else ""))
    RB.put("B48", "Historicals source: SEC EDGAR 10-K XBRL company facts (hidden Live_Data tab).")

    # --------------------------------------------------------- Income Statement
    IS.line(5, "Total Revenue", {c: f"={rb(c + '14')}" for c in ALL}, total=True)
    IS.line(6, "Revenue growth", {c: f"=IFERROR({c}5/{PREV[c]}5-1,0)" for c in ALL[1:]}, PCT)
    IS.line(7, "Cost of revenue", {**{c: f"={L('cogs', c)}" for c in HIST},
                                   **{c: f"={c}5*{rb(c + '22')}" for c in PROJ}})
    IS.line(8, "Gross Profit", {c: f"={c}5-{c}7" for c in ALL}, total=True)
    IS.line(9, "Gross margin", {c: f"=IFERROR({c}8/{c}5,0)" for c in ALL}, PCT)
    IS.line(10, "Operating expenses (incl. D&A)", {**{c: f"={c}8-{L('operating_income', c)}" for c in HIST},
                                                   **{c: f"={c}5*{rb(c + '23')}" for c in PROJ}})
    IS.line(11, "Operating Income (EBIT)", {c: f"={c}8-{c}10" for c in ALL}, total=True)
    IS.line(12, "EBIT margin", {c: f"=IFERROR({c}11/{c}5,0)" for c in ALL}, PCT)
    IS.line(13, "Depreciation & amortization (memo)", {**{c: f"={L('d_and_a', c)}" for c in HIST},
                                                       **{c: f"={SC.ref(c + '14')}" for c in PROJ}})
    IS.line(14, "EBITDA", {c: f"={c}11+{c}13" for c in ALL}, total=True)
    IS.line(15, "EBITDA margin", {c: f"=IFERROR({c}14/{c}5,0)" for c in ALL}, PCT)
    IS.line(16, "Interest expense", {**{c: f"={L('interest_expense', c)}" for c in HIST},
                                     **{c: f"={SC.ref(c + '48')}" for c in PROJ}})
    IS.line(17, "Interest income & other, net", {**{c: f"={L('pretax_income', c)}-({c}11-{c}16)" for c in HIST},
                                                 **{c: f"={SC.ref(c + '49')}" for c in PROJ}})
    IS.line(18, "Pre-Tax Income", {c: f"={c}11-{c}16+{c}17" for c in ALL}, total=True)
    IS.line(19, "Income tax expense", {**{c: f"={L('income_tax', c)}" for c in HIST},
                                       **{c: f"={c}18*{rb(c + '28')}" for c in PROJ}})
    IS.line(20, "Effective tax rate", {c: f"=IFERROR({c}19/{c}18,0)" for c in ALL}, PCT)
    IS.line(21, "Net Income (consolidated)", {c: f"={c}18-{c}19" for c in ALL}, total=True)
    IS.line(22, "Less: net income attributable to noncontrolling interests",
            {**{c: f"={c}21-{L('net_income', c)}" for c in HIST}, **{c: f"={c}21*{rb(c + '29')}" for c in PROJ}})
    IS.line(23, "Net Income to Common", {c: f"={c}21-{c}22" for c in ALL}, total=True)
    IS.line(24, "Diluted shares outstanding (mm)", {**{c: f"={L('shares_diluted', c)}" for c in HIST},
                                                    **{c: f"={PREV[c]}24*(1+{rb(c + '32')})" for c in PROJ}}, '#,##0.0')
    IS.line(25, "Diluted EPS", {c: f"=IFERROR({c}23/{c}24,0)" for c in ALL}, PS)

    # --------------------------------------------------------- Balance Sheet
    BS.section(4, "Assets")
    BS.line(5, "Cash & equivalents", {**{c: f"={L('cash', c)}" for c in HIST}, **{c: f"={SC.ref(c + '43')}" for c in PROJ}})
    BS.line(6, "Other current assets", {**{c: f"={L('current_assets', c)}-{L('cash', c)}" for c in HIST},
                                        **{c: f"={IS.ref(c + '5')}*{rb(c + '26')}" for c in PROJ}})
    BS.line(7, "Total Current Assets", {c: f"={c}5+{c}6" for c in ALL}, total=True)
    BS.line(8, "PP&E, net", {**{c: f"={L('ppe_net', c)}" for c in HIST}, **{c: f"={SC.ref(c + '9')}" for c in PROJ}})
    BS.line(9, "Other non-current assets",
            {**{c: f"={L('total_assets', c)}-{L('current_assets', c)}-{L('ppe_net', c)}" for c in HIST},
             **{c: f"={SC.ref(c + '20')}" for c in PROJ}})
    BS.line(10, "Total Assets", {c: f"={c}7+{c}8+{c}9" for c in ALL}, total=True)
    BS.section(11, "Liabilities & equity")
    BS.line(12, "Current liabilities (excl. debt)",
            {**{c: f"={L('current_liabilities', c)}-{L('short_term_debt', c)}" for c in HIST},
             **{c: f"={IS.ref(c + '5')}*{rb(c + '27')}" for c in PROJ}})
    BS.line(13, "Revolver", {**{c: 0 for c in HIST}, **{c: f"={SC.ref(c + '42')}" for c in PROJ}})
    BS.line(14, "Term debt (incl. current portion)",
            {**{c: f"={L('short_term_debt', c)}+{L('long_term_debt', c)}" for c in HIST},
             **{c: f"={SC.ref(c + '34')}" for c in PROJ}})
    BS.line(15, "Other non-current liabilities",
            {**{c: f"={L('total_liabilities', c)}-{L('current_liabilities', c)}-{L('long_term_debt', c)}" for c in HIST},
             **{c: f"={PREV[c]}15" for c in PROJ}})
    BS.line(16, "Total Liabilities", {c: f"=SUM({c}12:{c}15)" for c in ALL}, total=True)
    BS.line(18, "Total Equity (incl. noncontrolling interests)",
            {**{c: f"={L('total_assets', c)}-{L('total_liabilities', c)}" for c in HIST},
             **{c: f"={SC.ref(c + '27')}" for c in PROJ}}, total=True)
    BS.line(19, "Total Liabilities & Equity", {c: f"={c}16+{c}18" for c in ALL}, total=True)
    BS.line(21, "Balance check (total assets - total liabilities & equity)", {c: f"=ROUND({c}10-{c}19,3)" for c in ALL})

    # --------------------------------------------------------- Cash Flow
    def chg(sheet, row, c, live_expr):
        """change vs prior year; first historical column reaches back into Live_Data column C"""
        if c == "D":
            return live_expr
        return f"{sheet.ref(c + row)}-{sheet.ref(PREV[c] + row)}"

    CF.section(4, "Operating activities")
    CF.line(5, "Net income (consolidated)", {c: f"={IS.ref(c + '21')}" for c in ALL})
    CF.line(6, "Depreciation & amortization", {c: f"={IS.ref(c + '13')}" for c in ALL})
    CF.line(7, "(Increase) / decrease in other current assets", {c: "=-(" + chg(
        BS, "6", c, f"({L('current_assets', 'D')}-{L('cash', 'D')})-({L('current_assets', 'C')}-{L('cash', 'C')})") + ")"
        for c in ALL})
    CF.line(8, "Increase / (decrease) in current liabilities", {c: "=" + chg(
        BS, "12", c, f"({L('current_liabilities', 'D')}-{L('short_term_debt', 'D')})-"
                     f"({L('current_liabilities', 'C')}-{L('short_term_debt', 'C')})") for c in ALL})
    CF.line(9, "Other operating items (historical: reconciles to reported CFO)",
            {**{c: f"={L('cfo', c)}-SUM({c}5:{c}8)" for c in HIST}, **{c: 0 for c in PROJ}})
    CF.line(10, "Net Cash from Operating Activities", {c: f"=SUM({c}5:{c}9)" for c in ALL}, total=True)
    CF.section(11, "Investing activities")
    CF.line(12, "Capital expenditures", {**{c: f"=-{L('capex', c)}" for c in HIST},
                                         **{c: f"=-{SC.ref(c + '7')}" for c in PROJ}})
    CF.line(13, "Other investing", {**{c: f"={L('cfi', c)}-{c}12" for c in HIST},
                                    **{c: f"=-{SC.ref(c + '19')}" for c in PROJ}})
    CF.line(14, "Net Cash from Investing Activities", {c: f"={c}12+{c}13" for c in ALL}, total=True)
    CF.section(15, "Financing activities")
    CF.line(16, "Debt issued", {**{c: f"={L('debt_issued', c)}" for c in HIST}, **{c: 0 for c in PROJ}})
    CF.line(17, "Debt repaid", {**{c: f"=-{L('debt_repaid', c)}" for c in HIST},
                                **{c: f"=-{SC.ref(c + '33')}" for c in PROJ}})
    CF.line(18, "Revolver draw / (repayment)", {**{c: 0 for c in HIST}, **{c: f"={SC.ref(c + '41')}" for c in PROJ}})
    CF.line(19, "Dividends paid", {**{c: f"=-{L('dividends', c)}" for c in HIST},
                                   **{c: f"=-{SC.ref(c + '24')}" for c in PROJ}})
    CF.line(20, "Share repurchases", {**{c: f"=-{L('buybacks', c)}" for c in HIST},
                                      **{c: f"=-{SC.ref(c + '25')}" for c in PROJ}})
    CF.line(21, "Distributions to noncontrolling interests", {**{c: 0 for c in HIST},
                                                               **{c: f"=-{SC.ref(c + '26')}" for c in PROJ}})
    CF.line(22, "Other financing (historical: reconciles to reported CFF)",
            {**{c: f"={L('cff', c)}-SUM({c}16:{c}21)" for c in HIST}, **{c: 0 for c in PROJ}})
    CF.line(23, "Net Cash from Financing Activities", {c: f"=SUM({c}16:{c}22)" for c in ALL}, total=True)
    CF.line(25, "Net Change in Cash", {c: f"={c}10+{c}14+{c}23" for c in ALL}, total=True)
    CF.line(26, "Beginning cash", {c: (f"={L('cash', 'C')}" if c == "D" else f"={BS.ref(PREV[c] + '5')}") for c in ALL})
    CF.line(27, "Ending Cash", {c: f"={c}26+{c}25" for c in ALL}, total=True)
    CF.line(28, "Memo: cash per balance sheet", {c: f"={BS.ref(c + '5')}" for c in ALL})
    CF.line(29, "Memo: difference (historical restricted cash / FX only)", {c: f"={c}27-{c}28" for c in ALL})

    # --------------------------------------------------------- Schedules
    SC.section(4, "PP&E roll-forward")
    SC.line(6, "Beginning PP&E, net", {c: (f"={BS.ref('F8')}" if c == "G" else f"={PREV[c]}9") for c in PROJ})
    SC.line(7, "Plus: capital expenditures", {c: f"={IS.ref(c + '5')}*{rb(c + '25')}" for c in PROJ})
    SC.line(8, "Less: depreciation & amortization", {c: f"=-{c}14" for c in PROJ})
    SC.line(9, "Ending PP&E, net", {"F": f"={BS.ref('F8')}", **{c: f"=SUM({c}6:{c}8)" for c in PROJ}}, total=True)
    SC.section(11, "D&A schedule")
    SC.line(12, "D&A rate", {c: f"={rb(c + '24')}" for c in PROJ}, PCT)
    SC.line(13, "Beginning PP&E, net" if d["ppe_mode"] else "Revenue",
            {c: (f"={c}6" if d["ppe_mode"] else f"={IS.ref(c + '5')}") for c in PROJ})
    SC.line(14, "Depreciation & amortization", {c: f"={c}12*{c}13" for c in PROJ})
    SC.section(16, "Other non-current assets roll-forward")
    SC.line(17, "Other non-current assets % of revenue (latest 10-K)",
            {"F": f"=IFERROR({BS.ref('F9')}/{IS.ref('F5')},0)"}, PCT)
    SC.line(18, "Beginning other non-current assets", {c: (f"={BS.ref('F9')}" if c == "G" else f"={PREV[c]}20")
                                                      for c in PROJ})
    SC.line(19, "Plus: additions (held at % of incremental revenue)",
            {c: f"=({IS.ref(c + '5')}-{IS.ref(PREV[c] + '5')})*$F$17" for c in PROJ})
    SC.line(20, "Ending other non-current assets", {"F": f"={BS.ref('F9')}", **{c: f"={c}18+{c}19" for c in PROJ}},
            total=True)
    SC.section(22, "Retained earnings / total equity roll-forward")
    SC.line(23, "Beginning total equity", {c: (f"={BS.ref('F18')}" if c == "G" else f"={PREV[c]}27") for c in PROJ})
    SC.line(24, "Dividends to common", {c: f"=MAX(0,{IS.ref(c + '23')}*{rb(c + '30')})" for c in PROJ})
    SC.line(25, "Share repurchases", {c: f"={rb(c + '31')}" for c in PROJ})
    SC.line(26, "Distributions to noncontrolling interests", {c: f"=MAX(0,{IS.ref(c + '22')})" for c in PROJ})
    SC.line(27, "Ending total equity", {"F": f"={BS.ref('F18')}", **{
        c: f"={c}23+{IS.ref(c + '21')}-{c}24-{c}25-{c}26" for c in PROJ}}, total=True)
    SC.section(31, "Debt schedule & revolver cash sweep")
    SC.line(32, "Beginning term debt", {c: (f"={BS.ref('F14')}" if c == "G" else f"={PREV[c]}34") for c in PROJ})
    SC.line(33, "Mandatory term debt repayment", {c: f"={c}32*{rb(c + '33')}" for c in PROJ})
    SC.line(34, "Ending term debt", {"F": f"={BS.ref('F14')}", **{c: f"={c}32-{c}33" for c in PROJ}}, total=True)
    SC.line(35, "Beginning cash", {c: (f"={BS.ref('F5')}" if c == "G" else f"={PREV[c]}43") for c in PROJ})
    SC.line(36, "Plus: cash from operating and investing activities",
            {c: f"={CF.ref(c + '10')}+{CF.ref(c + '14')}" for c in PROJ})
    SC.line(37, "Less: mandatory repayment, dividends, buybacks, NCI distributions",
            {c: f"=-({c}33+{c}24+{c}25+{c}26)" for c in PROJ})
    SC.line(38, "Cash Available Before Revolver", {c: f"=SUM({c}35:{c}37)" for c in PROJ}, total=True)
    SC.line(39, "Minimum cash balance", {c: f"={rb(c + '34')}" for c in PROJ})
    SC.line(40, "Beginning revolver", {c: (f"={BS.ref('F13')}" if c == "G" else f"={PREV[c]}42") for c in PROJ})
    SC.line(41, "Revolver draw / (repayment)", {c: f"=MAX({c}39-{c}38,-{c}40)" for c in PROJ})
    SC.line(42, "Ending revolver", {"F": f"={BS.ref('F13')}", **{c: f"={c}40+{c}41" for c in PROJ}}, total=True)
    SC.line(43, "Ending Cash", {"F": f"={BS.ref('F5')}", **{c: f"={c}38+{c}41" for c in PROJ}}, total=True)
    SC.section(45, "Interest expense / income (on beginning balances, no circularity)")
    SC.line(46, "Interest on term debt", {c: f"={c}32*{rb(c + '35')}" for c in PROJ})
    SC.line(47, "Interest on revolver", {c: f"={c}40*{rb(c + '36')}" for c in PROJ})
    SC.line(48, "Total Interest Expense", {c: f"={c}46+{c}47" for c in PROJ}, total=True)
    SC.line(49, "Interest income on cash", {c: f"={c}35*{rb(c + '37')}" for c in PROJ})

    # --------------------------------------------------------- WACC
    WA.section(4, "Cost of equity (CAPM)")
    WA.line(5, "Risk-free rate (10Y Treasury, live)", {"D": f"={LM('risk_free')}"}, PCT)
    WA.line(6, "Beta (Yahoo Finance)", {"D": f"={LM('beta')}"}, '0.00')
    WA.line(7, "Equity risk premium", {"D": f"={LM('erp')}"}, PCT)
    WA.line(8, "Beta x equity risk premium", {"D": "=D6*D7"}, PCT)
    WA.line(9, "Cost of equity", {"D": "=D5+D8"}, PCT)
    WA.section(10, "Cost of debt")
    WA.line(11, "Pre-tax cost of debt (10-K interest / debt)", {"D": f"={LM('pre_tax_cost_of_debt')}"}, PCT)
    WA.line(12, "Tax rate", {"D": f"={LM('tax_rate')}"}, PCT)
    WA.line(13, "After-tax cost of debt", {"D": "=D11*(1-D12)"}, PCT)
    WA.section(14, "Capital structure")
    WA.line(15, "Market value of equity", {"D": "=Live_Data!$B$9"})
    WA.line(16, "Total debt (latest 10-K)", {"D": f"={BS.ref('F13')}+{BS.ref('F14')}"})
    WA.line(17, "Total Capital", {"D": "=D15+D16"}, total=True)
    WA.line(18, "Weight of equity", {"D": "=IFERROR(D15/D17,1)"}, PCT)
    WA.line(19, "Weight of debt", {"D": "=IFERROR(D16/D17,0)"}, PCT)
    WA.line(21, "Weighted cost of equity", {"D": "=D18*D9"}, PCT)
    WA.line(22, "Weighted cost of debt", {"D": "=D19*D13"}, PCT)
    WA.line(23, "WACC", {"D": "=D21+D22"}, PCT)

    # --------------------------------------------------------- DCF
    DC.line(5, "EBIT", {c: f"={IS.ref(c + '11')}" for c in PROJ})
    DC.line(6, "Tax rate", {c: f"={rb(c + '28')}" for c in PROJ}, PCT)
    DC.line(7, "NOPAT (EBIT x (1 - tax rate))", {c: f"={c}5*(1-{c}6)" for c in PROJ})
    DC.line(8, "Plus: depreciation & amortization", {c: f"={IS.ref(c + '13')}" for c in PROJ})
    DC.line(9, "Less: capital expenditures", {c: f"={CF.ref(c + '12')}" for c in PROJ})
    DC.line(10, "Less: increase in net working capital", {c: f"={CF.ref(c + '7')}+{CF.ref(c + '8')}" for c in PROJ})
    DC.line(11, "Unlevered Free Cash Flow", {c: f"={c}7+{c}8+{c}9+{c}10" for c in PROJ}, total=True)
    DC.line(13, "Discount period (years)", {c: (1 if i == 0 else f"={PROJ[i - 1]}13+1") for i, c in enumerate(PROJ)}, '0.0')
    DC.line(14, "WACC", {c: f"={WA.ref('$D$23')}" for c in PROJ}, PCT)
    DC.line(15, "Discount factor", {c: f"=1/(1+{c}14)^{c}13" for c in PROJ}, '0.0000')
    DC.line(16, "PV of unlevered free cash flow", {c: f"={c}11*{c}15" for c in PROJ})
    DC.line(18, "Sum of PV of UFCF", {"D": "=SUM(G16:K16)"}, total=True)
    DC.line(19, "Terminal growth rate (selected scenario)", {"D": f"={rb('$D$43')}"}, PCT)
    DC.line(20, "Terminal value (perpetuity growth)", {"D": "=K11*(1+D19)/(K14-D19)"})
    DC.line(21, "PV of terminal value", {"D": "=D20*K15"})
    DC.line(22, "Enterprise Value", {"D": "=D18+D21"}, total=True)
    DC.line(23, "Less: total debt incl. revolver (latest 10-K)", {"D": f"=-({BS.ref('F13')}+{BS.ref('F14')})"})
    DC.line(24, "Plus: cash and equity-method / long-term investments (latest 10-K)",
            {"D": f"={BS.ref('F5')}+{L('equity_investments', 'F')}"})
    DC.line(25, "Equity Value (incl. noncontrolling interests)", {"D": "=D22+D23+D24"}, total=True)
    DC.line(26, "Less: noncontrolling interests' share", {"D": f"=-D25*{rb('G29')}"})
    DC.line(27, "Equity Value to Common", {"D": "=D25+D26"}, total=True)
    DC.line(28, "Shares outstanding (mm, latest cover page)", {"D": "=Live_Data!$B$8"}, '#,##0.0')
    DC.line(29, "Target Price (implied value per share)", {"D": "=IFERROR(D27/D28,0)"}, PS)
    DC.line(30, "Current share price", {"D": "=Live_Data!$B$6"}, PS)
    DC.line(31, "Implied upside / (downside)", {"D": "=IFERROR(D29/D30-1,0)"}, PCT)
    DC.line(32, "PV of terminal value as % of enterprise value", {"D": "=IFERROR(D21/D22,0)"}, PCT)
    DC.line(33, "Implied terminal EV / EBITDA", {"D": f"=IFERROR(D20/{IS.ref('K14')},0)"}, MULT)

    DC.section(35, "Sensitivity - implied value per share: WACC (rows) vs. terminal growth (columns)")
    DC.put("C36", "WACC \\ g")
    steps = [-0.01, -0.005, 0, 0.005, 0.01]
    gcols = ["D", "E", "F", "G", "H"]
    for gc, s in zip(gcols, steps):
        DC.put(f"{gc}36", f"=$D$19+({s})" if s else "=$D$19", PCT)
    for i, s in enumerate(steps):
        r = 37 + i
        DC.put(f"C{r}", f"=$K$14+({s})" if s else "=$K$14", PCT)
        for gc in gcols:
            w, g = f"$C{r}", f"{gc}$36"
            pv = "+".join(f"${c}$11/(1+{w})^${c}$13" for c in PROJ)
            tv = f"($K$11*(1+{g})/({w}-{g}))/(1+{w})^$K$13"
            DC.put(f"{gc}{r}", f"=IFERROR(({pv}+{tv}+$D$23+$D$24)*(1+$D$26/$D$25)/$D$28,0)", PS)

    DC.section(44, "Terminal value - exit multiple method")
    DC.line(45, "Current EV / EBITDA (market, latest FY)",
            {"D": f"=IFERROR((Live_Data!$B$9+{BS.ref('F13')}+{BS.ref('F14')}-{BS.ref('F5')})/{IS.ref('F14')},0)"}, MULT)
    DC.line(46, "Exit multiple (current, bounded 4x-30x, scenario factor applied)",
            {"D": f"=MIN(30,MAX(4,D45))*{rb('$D$45')}"}, MULT)
    DC.line(47, "Final-year EBITDA", {"D": f"={IS.ref('K14')}"})
    DC.line(48, "Terminal value (exit multiple)", {"D": "=D46*D47"})
    DC.line(49, "PV of terminal value", {"D": "=D48*K15"})
    DC.line(50, "Enterprise Value (exit multiple)", {"D": "=D18+D49"}, total=True)
    DC.line(51, "Equity Value to Common (exit multiple)", {"D": "=(D50+D23+D24)*(1+D26/D25)"}, total=True)
    DC.line(52, "Exit-multiple value per share", {"D": "=IFERROR(MAX(0,D51/D28),0)"}, PS)
    DC.line(53, "Implied perpetual growth in exit terminal value", {"D": "=IFERROR((D48*K14-K11)/(D48+K11),0)"}, PCT)

    # --------------------------------------------------------- Financial Ratios
    i_, b_ = IS.ref, BS.ref
    ratio_rows = [
        ("Gross margin", lambda c: f"={i_(c + '9')}", PCT),
        ("EBITDA margin", lambda c: f"={i_(c + '15')}", PCT),
        ("EBIT margin", lambda c: f"={i_(c + '12')}", PCT),
        ("Net margin (to common)", lambda c: f"=IFERROR({i_(c + '23')}/{i_(c + '5')},0)", PCT),
        ("Return on equity", lambda c: f"=IFERROR({i_(c + '21')}/{b_(c + '18')},0)", PCT),
        ("Return on assets", lambda c: f"=IFERROR({i_(c + '21')}/{b_(c + '10')},0)", PCT),
        ("Current ratio", lambda c: f"=IFERROR({b_(c + '7')}/{b_(c + '12')},0)", MULT),
        ("Debt / equity", lambda c: f"=IFERROR(({b_(c + '13')}+{b_(c + '14')})/{b_(c + '18')},0)", MULT),
        ("Net debt / EBITDA", lambda c: f"=IFERROR(({b_(c + '13')}+{b_(c + '14')}-{b_(c + '5')})/{i_(c + '14')},0)", MULT),
        ("Interest coverage (EBIT / interest)", lambda c: f"=IFERROR({i_(c + '11')}/{i_(c + '16')},0)", MULT),
        ("Revenue growth", lambda c: f"={i_(c + '6')}", PCT),
        ("Diluted EPS", lambda c: f"={i_(c + '25')}", PS),
        ("P / E at current price", lambda c: f"=IFERROR(Live_Data!$B$6/{i_(c + '25')},0)", MULT),
        ("EV / EBITDA at current price", lambda c: f"=IFERROR((Live_Data!$B$9+{b_(c + '13')}+{b_(c + '14')}-"
                                                   f"{b_(c + '5')})/{i_(c + '14')},0)", MULT),
    ]
    for k, (lab, fn, fmt) in enumerate(ratio_rows):
        FR.line(5 + k, lab, {c: fn(c) for c in (ALL if lab != "Revenue growth" else ALL[1:])}, fmt)

    # --------------------------------------------------------- Comps
    peers = [p for p in (ctx.get("peers") or []) if p.get("price") and p.get("shares")]
    for col, w in zip("DEFGHIJKL", (10, 11, 12, 12, 12, 12, 10, 11, 10)):
        CO.ws.column_dimensions[col].width = w
    CO.ws.column_dimensions["C"].width = 9
    heads = ["Ticker", "Price", "Shares (mm)", "Market cap", "Net debt", "Enterprise value", "EBITDA (10-K)",
             "Diluted EPS", "EV / EBITDA", "P / E"]
    CO.put("B3", "Company ($ in millions, except per-share data)", bold=True)
    for col, h in zip("CDEFGHIJKL", heads):
        CO.put(f"{col}3", h, bold=True)
        CO.ws[f"{col}3"].alignment = Alignment(horizontal="right", wrap_text=True)
    first = 5
    for i, p in enumerate(peers):
        r = first + i
        CO.put(f"B{r}", p.get("name", p["ticker"])[:40])
        CO.put(f"C{r}", p["ticker"])
        CO.put(f"D{r}", round(p["price"], 2), PS, note="Close from Yahoo Finance at generation")
        CO.put(f"E{r}", round(p["shares"], 2), '#,##0.0', note="SEC 10-K / 10-Q cover page")
        CO.put(f"F{r}", f"=D{r}*E{r}")
        CO.put(f"G{r}", round(p.get("net_debt") or 0, 1), note="SEC 10-K: total debt less cash")
        CO.put(f"H{r}", f"=F{r}+G{r}")
        CO.put(f"I{r}", round(p.get("ebitda") or 0, 1), note="SEC 10-K: operating income + D&A")
        CO.put(f"J{r}", round(p.get("eps") or 0, 2), PS, note="SEC 10-K diluted EPS")
        CO.put(f"K{r}", f'=IF(I{r}>0,H{r}/I{r},"")', MULT)
        CO.put(f"L{r}", f'=IF(J{r}>0,D{r}/J{r},"")', MULT)
        for col in "FH":
            CO.ws[f"{col}{r}"].number_format = NUM
    last = first + max(len(peers), 1) - 1
    rm = last + 2
    CO.put(f"B{rm}", "Peer median")
    CO.put(f"K{rm}", f'=IFERROR(MEDIAN(K{first}:K{last}),0)', MULT)
    CO.put(f"L{rm}", f'=IFERROR(MEDIAN(L{first}:L{last}),0)', MULT)
    rs = rm + 1
    CO.put(f"B{rs}", f"{live['company']} ({T}) at current price")
    CO.put(f"K{rs}", f"=IFERROR((Live_Data!$B$9+{BS.ref('F13')}+{BS.ref('F14')}-{BS.ref('F5')})/{IS.ref('F14')},0)", MULT)
    CO.put(f"L{rs}", f"=IFERROR(Live_Data!$B$6/{IS.ref('F25')},0)", MULT)
    r0 = rs + 2
    CO.section(r0, "Comps-implied value (peer median EV / EBITDA)")
    CO.line(r0 + 1, "Peer median EV / EBITDA", {"D": f"=K{rm}"}, MULT)
    CO.line(r0 + 2, "EBITDA, latest fiscal year", {"D": f"={IS.ref('F14')}"})
    CO.line(r0 + 3, "Implied enterprise value", {"D": f"=D{r0 + 1}*D{r0 + 2}"})
    CO.line(r0 + 4, "Less: total debt", {"D": f"=-({BS.ref('F13')}+{BS.ref('F14')})"})
    CO.line(r0 + 5, "Plus: cash", {"D": f"={BS.ref('F5')}"})
    CO.line(r0 + 6, "Implied Equity Value", {"D": f"=SUM(D{r0 + 3}:D{r0 + 5})"}, total=True)
    CO.line(r0 + 7, "Less: noncontrolling interests' share", {"D": f"=-D{r0 + 6}*{rb('G29')}"})
    CO.line(r0 + 8, "Implied Equity Value to Common", {"D": f"=D{r0 + 6}+D{r0 + 7}"}, total=True)
    CO.line(r0 + 9, "Shares outstanding (mm)", {"D": "=Live_Data!$B$8"}, '#,##0.0')
    CO.line(r0 + 10, "Comps-implied value per share", {"D": f"=IFERROR(MAX(0,D{r0 + 8}/D{r0 + 9}),0)"}, PS)
    CO.put(f"B{r0 + 12}", f"Peers: {len(peers)} NYSE-listed companies in the same SEC industry (SIC) group, chosen by "
                          "closest revenue. Inputs are hardcoded at generation (blue).")
    comps_ref = CO.ref(f"$D${r0 + 10}")

    # --------------------------------------------------------- Valuation Summary
    VS.section(4, "Blended price target")
    VS.line(5, "DCF value per share (perpetuity growth)", {"D": f"={DC.ref('$D$29')}"}, PS)
    VS.line(6, "Comps-implied value per share", {"D": f"={comps_ref}"}, PS)
    VS.line(7, "DCF value per share (exit multiple)", {"D": f"={DC.ref('$D$52')}"}, PS)
    w_c = 0.2 if peers else 0.0
    VS.line(8, "Weight: DCF perpetuity growth", {"D": "=(1-D9)/2"}, PCT)
    VS.line(9, "Weight: trading comps", {"D": w_c}, PCT,
            note=None if peers else "No usable peers found: comps weight set to 0")
    VS.line(10, "Weight: DCF exit multiple", {"D": "=(1-D9)/2"}, PCT)
    VS.line(11, "DCF perpetuity contribution", {"D": "=D5*D8"}, PS)
    VS.line(12, "Comps + exit-multiple contribution", {"D": "=D6*D9+D7*D10"}, PS)
    VS.line(13, "Model value (blended intrinsic, per share)", {"D": "=D11+D12"}, PS)
    VS.line(14, "Current share price", {"D": "=Live_Data!$B$6"}, PS)
    VS.line(15, "Model upside / (downside)", {"D": "=IFERROR(D13/D14-1,0)"}, PCT)
    VS.section(17, "Scenario comparison")
    for col, name in zip("DEF", ("Bear", "Base", "Bull")):
        VS.put(f"{col}18", name, bold=True)
        VS.ws[f"{col}18"].alignment = Alignment(horizontal="right")
    VS.line(19, "Revenue growth, year 1", {"D": f"={rb('G11')}", "E": f"={rb('G10')}", "F": f"={rb('G9')}"}, PCT)
    VS.line(20, "Revenue growth, year 5", {"D": f"={rb('K11')}", "E": f"={rb('K10')}", "F": f"={rb('K9')}"}, PCT)
    VS.line(21, "Cost of revenue % of revenue", {"D": f"={rb('G21')}", "E": f"={rb('G20')}", "F": f"={rb('G19')}"}, PCT)
    VS.line(22, "Terminal growth rate", {"D": f"={rb('D42')}", "E": f"={rb('D41')}", "F": f"={rb('D40')}"}, PCT)
    VS.put("B26", "Exit multiple factor bull / base / bear: Revenue Build row 44.")
    VS.line(23, "Model value per case (blended intrinsic)", {"D": 0, "E": 0, "F": 0}, PS,
            note="Recorded at generation by switching Revenue Build D5 to 3 / 2 / 1 and recalculating the model")
    VS.line(24, "Final target per case (anchored base x case / base)",
            {c: f"=IFERROR($D$43*{c}23/$E$23,0)" for c in "DEF"}, PS)
    VS.line(25, "Upside / (downside) vs current price", {c: f"=IFERROR({c}24/$D$14-1,0)" for c in "DEF"}, PCT)
    VS.put("B27", "To rerun a case yourself: set Revenue Build D5 to 1 (bull), 2 (base) or 3 (bear); every tab follows.")

    # ---- peer & consensus anchoring: keep the call in line with what the industry's analysts see
    anc = ctx.get("anchor") or {}
    street, peer_up = anc.get("street_median"), anc.get("peer_avg_upside")
    w_m, w_s, w_p = 0.5, 0.25 if street else 0.0, 0.25 if peer_up is not None else 0.0
    tot = w_m + w_s + w_p
    VS.section(28, "Peer & consensus anchoring (final price target)")
    VS.line(29, "Model value (blended intrinsic)", {"D": "=D13"}, PS)
    VS.line(30, "Street median price target", {"D": round(street, 2) if street else 0}, PS,
            note=f"Yahoo Finance consensus, {anc.get('analysts') or 'n/a'} analysts, at generation" if street
            else "No consensus available: weight set to 0")
    VS.line(31, "Industry peers' average upside to their street median targets",
            {"D": round(peer_up, 4) if peer_up is not None else 0}, PCT,
            note=f"Average over {anc.get('peer_count', 0)} peers with consensus targets ({', '.join(anc.get('peers_used', []))})"
            if peer_up is not None else "No peer consensus available: weight set to 0, band centred on street/model")
    VS.line(32, "Peer-relative value (price x (1 + peer average upside))", {"D": "=D14*(1+D31)"}, PS)
    VS.line(33, "Weight: model value", {"D": "=1-D34-D35"}, PCT)
    VS.line(34, "Weight: street median target", {"D": round(w_s / tot, 4)}, PCT)
    VS.line(35, "Weight: peer-relative value", {"D": round(w_p / tot, 4)}, PCT)
    VS.line(36, "Model contribution", {"D": "=D29*D33"}, PS)
    VS.line(37, "Street contribution", {"D": "=D30*D34"}, PS)
    VS.line(38, "Peer-relative contribution", {"D": "=D32*D35"}, PS)
    VS.line(39, "Anchored value", {"D": "=D36+D37+D38"}, PS)
    centre = "D31" if peer_up is not None else ("(D30/D14-1)" if street else "D15")
    VS.line(40, "Band around the peer average upside (+/-)", {"D": 0.15}, PCT)
    VS.line(41, "Lower bound", {"D": f"=D14*(1+{centre}-D40)"}, PS)
    VS.line(42, "Upper bound", {"D": f"=D14*(1+{centre}+D40)"}, PS)
    VS.line(43, "Target Price (final, per share)", {"D": "=MIN(D42,MAX(D41,D39))"}, PS)
    VS.line(44, "Upside / (downside) to final target", {"D": "=IFERROR(D43/D14-1,0)"}, PCT)
    VS.put("B46", "The final target blends the model with what the street and the industry's analysts see, then keeps the "
                  "upside within 15 points of the peer average so no single call stands far outside its industry.")

    _cover(wb, T, label, live, ctx, VS, WA, RB, IS, BS, CF)
    order = [f"{T} Cover", RB.title, IS.title, BS.title, CF.title, SC.title, WA.title, DC.title, CO.title,
             VS.title, FR.title, "Live_Data"]
    wb._sheets.sort(key=lambda w: order.index(w.title) if w.title in order else 99)
    wb.active = 0

    for sheet, cells in ((RB, ["D5", "D40", "D41", "D42", "D44", "E44", "F44"]),
                         (VS, ["D9", "D30", "D31", "D34", "D35", "D40"])):
        for cell in cells:
            sheet.ws[cell].fill = PatternFill("solid", fgColor="FFFF00")
    RB.put("B49", "Yellow cells are the key levers: scenario switch, terminal growth and exit multiple. "
                  "Blue = typed input, black = formula on this tab, green = link from another tab.")

    wb.defined_names["Scenario"] = DefinedName("Scenario", attr_text=f"{RB.ref('$D$5')}")
    wb.defined_names["TargetPrice"] = DefinedName("TargetPrice", attr_text=f"{VS.ref('$D$43')}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    wb.save(dest)
    return dest


def _big(sheet, cell, value, fmt, size, bold=True, fill=None):
    c = sheet.put(cell, value, fmt, bold=bold)
    c.font = Font(name=FONT, size=size, bold=False, color=c.font.color)
    if fill:
        c.fill = PatternFill("solid", fgColor=fill)
    return c


def _cover(wb, T, label, live, ctx, VS, WA, RB, IS, BS, CF):
    """First tab, laid out like JJ's LNG model cover: snapshot, market data, capital structure and the
    valuation summary, with the final target price highlighted at the top and the bottom."""
    CV = Sheet(wb, f"{T} Cover", label, "")
    ws = CV.ws
    ws["B2"].value = None
    for col in _cols("B", LAST_COL):
        ws[f"{col}2"].fill = PatternFill(fill_type=None)
    widths = {"B": 2, "C": 40, "D": 26, "E": 3, "F": 34, "G": 16, "H": 3, "I": 30, "J": 16, "K": 3}
    for k, v in widths.items():
        ws.column_dimensions[k].width = v
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_area = "B2:K44"
    vs, wa = VS.ref, WA.ref
    i_, b_, c_ = IS.ref, BS.ref, CF.ref

    def band(row, text, fill=NAVY, first="C", last="J"):
        CV.put(f"{first}{row}", text)
        banner(ws, row, first, last, fill)

    def kv(row, col, label_, value, fmt=None):
        CV.put(f"{col}{row}", label_)
        CV.put(f"{chr(ord(col) + 1)}{row}", value, fmt)

    band(3, f"{live['company'].upper()}  (NYSE: {T})")

    # ---- headline: the call
    for col in ("C", "D", "F", "G", "I", "J"):
        ws[f"{col}5"].fill = ws[f"{col}6"].fill = PatternFill("solid", fgColor=HILITE)
    CV.put("C5", "12-MONTH PRICE TARGET", bold=True)
    _big(CV, "C6", f"={vs('$D$43')}", '$#,##0.00', 36, fill=HILITE)
    CV.put("F5", "RATING", bold=True)
    _big(CV, "F6", '=IF(G6>=0.15,"BUY",IF(G6<=-0.1,"SELL","HOLD"))', None, 28, fill=HILITE)
    CV.put("G5", "UPSIDE", bold=True)
    _big(CV, "G6", f"={vs('$D$44')}", PCT, 24, fill=HILITE)
    CV.put("I5", "BEAR / BASE / BULL", bold=True)
    _big(CV, "I6", f'=TEXT({vs("$D$24")},"$0")&" / "&TEXT({vs("$E$24")},"$0")&" / "&TEXT({vs("$F$24")},"$0")',
         None, 16, fill=HILITE)
    for c in ("C6", "F6", "G6", "I6"):
        ws[c].alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[6].height = 50
    CV.put("C7", "Rating rule: Buy at 15%+ upside to target, Sell at 10%+ downside, otherwise Hold.")

    band(9, "COMPANY SNAPSHOT")
    kv(10, "C", "Company:", live["company"]); kv(10, "F", "Ticker:", T); kv(10, "I", "Exchange:", "NYSE")
    kv(11, "C", "Sector:", ctx.get("sector") or "n/a"); kv(11, "F", "Price date:", "=Live_Data!$B$7")
    kv(11, "I", "Currency:", "USD ($mm)")
    kv(12, "C", "Share price:", "=Live_Data!$B$6", PS); kv(12, "F", "Latest 10-K filed:", "=Live_Data!$B$11")
    kv(12, "I", "Active case:", f'=CHOOSE({RB.ref("$D$5")},"Bull","Base","Bear")')
    kv(13, "C", "Shares out. (mm):", "=Live_Data!$B$8", NUM)

    band(15, "MARKET DATA")
    for col, t in (("C", "PRICE & SHARES"), ("F", "VALUATION MULTIPLES"), ("I", "CAPITAL RETURN")):
        band(16, t, NAVY2, col, chr(ord(col) + 1))
    kv(17, "C", "Share price", "=D12", PS)
    kv(18, "C", "Shares out. (mm)", "=D13", NUM)
    kv(19, "C", "Market cap ($mm)", "=D17*D18", NUM)
    kv(20, "C", "Beta", f"={wa('$D$6')}", "0.00")
    kv(17, "F", "P / E (latest FY EPS)", f"=IFERROR(D17/{i_('$F$25')},0)", MULT)
    kv(18, "F", "Enterprise value ($mm)", f"=D19+{b_('$F$13')}+{b_('$F$14')}-{b_('$F$5')}", NUM)
    kv(19, "F", "EV / EBITDA (latest FY)", f"=IFERROR(G18/{i_('$F$14')},0)", MULT)
    kv(20, "F", "Dividend yield", f"=IFERROR(J18/D19,0)", PCT)
    kv(17, "I", "Latest FY buybacks ($mm)", f"=-{c_('$F$20')}", NUM)
    kv(18, "I", "Latest FY dividends ($mm)", f"=-{c_('$F$19')}", NUM)
    kv(19, "I", "Payout (% of net income)", f"=IFERROR(J18/{i_('$F$23')},0)", PCT)

    band(22, "CAPITAL STRUCTURE (LATEST FY)")
    kv(23, "C", "Total debt ($mm)", f"={b_('$F$13')}+{b_('$F$14')}", NUM)
    kv(24, "C", "Cash & equivalents ($mm)", f"={b_('$F$5')}", NUM)
    kv(25, "C", "Net debt ($mm)", "=D23-D24", NUM)
    kv(26, "C", "Net debt / EBITDA", f"=IFERROR(D25/{i_('$F$14')},0)", MULT)
    kv(27, "C", "WACC", f"={wa('$D$23')}", PCT)

    band(29, "VALUATION SUMMARY")
    for col, t in (("C", "Method"), ("F", "Value / share"), ("G", "vs. current"), ("I", "Weighting"),
                   ("J", "Wtd. contribution")):
        CV.put(f"{col}30", t)
    banner(ws, 30, "C", "J", NAVY2)
    CV.put("C31", "Current share price"); CV.put("F31", "=D17", PS)
    rows = [  # (label, value, weight, contribution)
        ("DCF - perpetuity growth", "$D$5", "$D$8", None),
        ("DCF - exit EV/EBITDA multiple", "$D$7", "$D$10", None),
        ("Trading comps (peer median EV/EBITDA)", "$D$6", "$D$9", None),
        ("Model value (step 1 blend)", "$D$13", "$D$33", "$D$36"),
        ("Street median price target", "$D$30", "$D$34", "$D$37"),
        ("Peer-relative value (peer avg analyst upside)", "$D$32", "$D$35", "$D$38"),
        ("Anchored value (step 2 blend)", "$D$39", None, None),
    ]
    for i, (lab, v, w, contrib) in enumerate(rows):
        r = 32 + i
        CV.put(f"C{r}", lab, bold=lab.startswith(("Model value", "Anchored")))
        CV.put(f"F{r}", f"={vs(v)}", PS)
        CV.put(f"G{r}", f"=IFERROR(F{r}/$D$17-1,0)", PCT)
        if w:
            CV.put(f"I{r}", f"={vs(w)}", PCT)
            CV.put(f"J{r}", f"={vs(contrib)}" if contrib else f"=F{r}*I{r}", PS)
    CV.put("C39", "Allowed range (peer avg upside +/-15 pts)")
    CV.put("F39", f"={vs('$D$41')}", PS); CV.put("G39", f"={vs('$D$42')}", PS)
    CV.put("I39", "low / high")
    CV.put("C41", "MODEL TARGET PRICE")
    _big(CV, "F41", "=C6", '$#,##0.00', 16)
    _big(CV, "G41", "=G6", PCT, 16)
    banner(ws, 41, "C", "J", NAVY)
    for col in ("F", "G"):
        ws[f"{col}41"].fill = PatternFill("solid", fgColor=HILITE)

    CV.put("C43", "Sources: SEC EDGAR (10-K XBRL) for financials; Yahoo Finance for prices, beta and consensus. "
                  "Automated model for educational use, not investment advice.")
    ws.merge_cells("C43:J43")
    ws["C43"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.row_dimensions[43].height = 32


# ------------------------------------------------------------------ verify
def verify(path: Path) -> list[str]:
    """The skill's verification scans. Returns a list of problems (empty = pass)."""
    issues = []
    wb = load_workbook(path)
    label = path.stem
    for ws in wb:
        if ws["A1"].value not in (None, ""):
            issues.append(f"{ws.title}!A1 should be blank, has {ws['A1'].value!r}")
        for row in ws.iter_rows():
            for c in row:
                v = c.value
                if isinstance(v, str) and v.startswith("="):
                    up = v.upper()
                    if "SUMPRODUCT" in up or "MMULT" in up:
                        issues.append(f"{ws.title}!{c.coordinate} uses SUMPRODUCT/MMULT")
                    want = GREEN if "!" in v else BLACK
                    if (c.font.color.rgb if c.font.color else None) not in (f"00{want}", f"FF{want}", want):
                        issues.append(f"{ws.title}!{c.coordinate} formula colour {c.font.color.rgb if c.font.color else None}")
                elif isinstance(v, (int, float)) and not isinstance(v, bool):
                    if ws.title != "Live_Data" or c.column > 1:
                        rgb = c.font.color.rgb if c.font.color else None
                        if rgb not in ("000000FF", "FF0000FF", "0000FF"):
                            issues.append(f"{ws.title}!{c.coordinate} hardcode colour {rgb}")
                if c.value is not None and c.font.bold:
                    issues.append(f"{ws.title}!{c.coordinate} is bold")
    for ws in wb:
        if ws.sheet_view.showGridLines:
            issues.append(f"{ws.title} shows gridlines")
    if wb["Live_Data"].sheet_state != "hidden":
        issues.append("Live_Data is not hidden")
    return issues
