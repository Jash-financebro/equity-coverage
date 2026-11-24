"""Build templates/DCF_Template.xlsx — a starter DCF wired to the Live_Data sheet.

Color code: blue = hardcoded inputs, black = same-sheet formulas, green = links to other tabs.
"""
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Border, Font, PatternFill, Side
from openpyxl.workbook.defined_name import DefinedName

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
from fundamentals import LINE_ITEMS  # noqa: E402

ROW = {k: 17 + i for i, (k, *_r) in enumerate(LINE_ITEMS)}
F = "Arial"
BLUE, BLACK, GREEN = Font(name=F, size=10, color="0000FF"), Font(name=F, size=10), Font(name=F, size=10, color="008000")
BOLD, TITLE = Font(name=F, size=10, bold=True), Font(name=F, size=14, bold=True)
YELLOW = PatternFill("solid", start_color="FFFF00")
LINE = Border(top=Side(style="thin"))
USD, USD2, PCT, X = '#,##0;(#,##0);-', '$#,##0.00', '0.0%;(0.0%);-', '0.000'


def put(ws, ref, value, font=BLACK, fmt=None, fill=None, note=None):
    c = ws[ref]
    c.value, c.font = value, font
    if fmt:
        c.number_format = fmt
    if fill:
        c.fill = fill
    if note:
        c.comment = Comment(note, "ModelPulse")
    return c


def ld(key, col="F"):
    return f"Live_Data!${col}${ROW[key]}"


wb = Workbook()
summ = wb.active
summ.title = "Summary"
dcf = wb.create_sheet("DCF")
live = wb.create_sheet("Live_Data")
put(live, "A1", "LIVE DATA — filled automatically by the ModelPulse pipeline. Leave blank in the template.", BOLD)

# ---------------------------------------------------------------- DCF tab
dcf.column_dimensions["A"].width = 38
for col in "BCDEFGH":
    dcf.column_dimensions[col].width = 13
put(dcf, "A1", "Discounted Cash Flow — starter template", TITLE)
put(dcf, "A2", "Blue = input you can change · Green = pulled from Live_Data (SEC 10-K + market) · Black = formula")

put(dcf, "A3", "Assumptions", BOLD)
rows = [
    ("Revenue growth, years 1–5", 0.08, BLUE, PCT, True, "Analyst assumption"),
    ("EBIT margin, base (latest 10-K)", f"=IFERROR({ld('operating_income')}/{ld('revenue')},0)", GREEN, PCT, False,
     "Operating income / revenue from the latest 10-K"),
    ("EBIT margin change per year", 0.0, BLUE, PCT, True, "Analyst assumption: + expands, - compresses"),
    ("Tax rate", 0.21, BLUE, PCT, True, "US federal statutory rate; replace with effective rate if preferred"),
    ("D&A % of revenue (latest 10-K)", f"=IFERROR({ld('d_and_a')}/{ld('revenue')},0)", GREEN, PCT, False, None),
    ("Capex % of revenue (latest 10-K)", f"=IFERROR({ld('capex')}/{ld('revenue')},0)", GREEN, PCT, False, None),
    ("Net working capital % of incremental revenue", 0.05, BLUE, PCT, True, "Analyst assumption"),
    ("WACC", 0.09, BLUE, PCT, True, "Analyst assumption — link to your WACC tab if you have one"),
    ("Terminal growth rate", 0.03, BLUE, PCT, True, "Analyst assumption; keep below long-run nominal GDP"),
]
for i, (label, val, font, fmt, key, note) in enumerate(rows):
    r = 4 + i
    put(dcf, f"A{r}", label)
    put(dcf, f"B{r}", val, font, fmt, YELLOW if key else None, note)

put(dcf, "A15", "($ millions)", BOLD)
put(dcf, "C15", "=Live_Data!$F$15", Font(name=F, size=10, bold=True, color="008000"))
for j, col in enumerate("DEFGH", start=1):
    put(dcf, f"{col}15", f"Year {j}", BOLD)
    put(dcf, f"{col}14", j, BLACK)
put(dcf, "A14", "Discount period (years)")

lines = ["Revenue", "EBIT margin", "EBIT", "Taxes", "NOPAT", "D&A", "Capex", "Change in NWC",
         "Unlevered free cash flow", "Discount factor", "PV of free cash flow"]
for i, label in enumerate(lines):
    put(dcf, f"A{16 + i}", label, BOLD if label.startswith(("Unlevered", "PV")) else BLACK)

put(dcf, "C16", f"={ld('revenue')}", GREEN, USD)
put(dcf, "C17", "=$B$5", BLACK, PCT)
put(dcf, "C18", f"={ld('operating_income')}", GREEN, USD)
for col, prev in zip("DEFGH", "CDEFG"):
    put(dcf, f"{col}16", f"={prev}16*(1+$B$4)", BLACK, USD)
    put(dcf, f"{col}17", f"={prev}17+$B$6", BLACK, PCT)
    put(dcf, f"{col}18", f"={col}16*{col}17", BLACK, USD)
    put(dcf, f"{col}19", f"=-MAX({col}18,0)*$B$7", BLACK, USD)
    put(dcf, f"{col}20", f"={col}18+{col}19", BLACK, USD)
    put(dcf, f"{col}21", f"={col}16*$B$8", BLACK, USD)
    put(dcf, f"{col}22", f"=-{col}16*$B$9", BLACK, USD)
    put(dcf, f"{col}23", f"=-({col}16-{prev}16)*$B$10", BLACK, USD)
    put(dcf, f"{col}24", f"=SUM({col}20:{col}23)", BLACK, USD).border = LINE
    put(dcf, f"{col}25", f"=1/(1+$B$11)^{col}14", BLACK, X)
    put(dcf, f"{col}26", f"={col}24*{col}25", BLACK, USD)

put(dcf, "A28", "Valuation", BOLD)
val_rows = [
    ("Sum of PV of free cash flows", "=SUM(D26:H26)", BLACK, USD),
    ("Terminal value (Gordon growth)", "=IFERROR(H24*(1+B12)/(B11-B12),0)", BLACK, USD),
    ("PV of terminal value", "=B30*H25", BLACK, USD),
    ("Enterprise value", "=B29+B31", BLACK, USD),
    ("Less: net debt (latest 10-K)", "=Live_Data!$B$10", GREEN, USD),
    ("Equity value", "=B32-B33", BLACK, USD),
    ("Shares outstanding (mm, 10-K cover)", "=Live_Data!$B$8", GREEN, '#,##0.0'),
    ("Target Price", "=IFERROR(B34/B35,0)", Font(name=F, size=11, bold=True), USD2),
    ("Current share price", "=Live_Data!$B$6", GREEN, USD2),
    ("Upside / (downside)", "=IFERROR(B36/B37-1,0)", BLACK, PCT),
    ("Terminal value as % of EV", "=IFERROR(B31/B32,0)", BLACK, PCT),
]
for i, (label, f, font, fmt) in enumerate(val_rows):
    r = 29 + i
    put(dcf, f"A{r}", label, BOLD if label == "Target Price" else BLACK)
    put(dcf, f"B{r}", f, font, fmt)
wb.defined_names["TargetPrice"] = DefinedName("TargetPrice", attr_text="DCF!$B$36")

# ------------------------------------------------------------ Summary tab
summ.column_dimensions["A"].width = 30
summ.column_dimensions["B"].width = 18
put(summ, "A1", "Valuation summary", TITLE)
for i, (label, f, fmt) in enumerate([
    ("Ticker", "=Live_Data!$B$4", None), ("Company", "=Live_Data!$B$5", None),
    ("Current price", "=DCF!$B$37", USD2), ("Target price", "=DCF!$B$36", USD2),
    ("Upside / (downside)", "=DCF!$B$38", PCT), ("WACC", "=DCF!$B$11", PCT),
    ("Terminal growth", "=DCF!$B$12", PCT), ("Data as of", "=Live_Data!$B$7", None),
    ("Latest 10-K", "=Live_Data!$B$12", None),
]):
    put(summ, f"A{3 + i}", label)
    put(summ, f"B{3 + i}", f, GREEN, fmt)
put(summ, "A14", "How to use: change the yellow cells on the DCF tab. Everything green refreshes on its own "
                 "every trading day when this file sits in the website's /models folder.")

out = ROOT / "templates" / "DCF_Template.xlsx"
out.parent.mkdir(exist_ok=True)
wb.save(out)
print("wrote", out)
