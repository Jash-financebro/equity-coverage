"""Update someone's existing Excel model with the latest SEC 10-K and market data.

    python pipeline/update.py MODEL.xlsx TICKER OUT.xlsx SUMMARY.json

What it changes (and nothing else):
  * adds / refreshes a Live_Data tab with the latest five 10-K years, price, shares, rates and consensus
    (a Model Builder workbook reads everything from that tab, so it updates end to end);
  * typed inputs it can identify with confidence: share price, shares outstanding, risk-free rate, beta;
  * typed historical figures that the company has since restated (same fiscal year, same units);
  * adds an "Update Log" tab listing every change, the old and new target, and how the model's projections
    compare with actuals reported since it was built.
Formulas are never overwritten; formatting is kept.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import excel  # noqa: E402
import fundamentals  # noqa: E402
import generate  # noqa: E402
import universe  # noqa: E402

LOG_SHEET = "Update Log"
SYNONYMS = {
    "revenue": ["total revenue", "total revenues", "revenue", "revenues", "net revenue", "net revenues", "net sales",
                "total net sales", "sales", "total net revenue"],
    "gross_profit": ["gross profit"],
    "operating_income": ["operating income", "income from operations", "operating profit", "ebit"],
    "net_income": ["net income", "net income attributable to common", "net income to common", "net earnings"],
    "eps_diluted": ["diluted eps", "eps (diluted)", "diluted earnings per share", "eps - diluted", "eps diluted"],
    "d_and_a": ["depreciation & amortization", "depreciation and amortization", "d&a"],
    "cash": ["cash & equivalents", "cash and cash equivalents", "cash & cash equivalents", "cash"],
    "total_assets": ["total assets"],
    "total_liabilities": ["total liabilities"],
    "equity": ["total shareholders' equity", "total stockholders' equity", "shareholders' equity",
               "stockholders' equity", "total equity"],
    "cfo": ["cash from operations", "cash from operating activities", "net cash from operating activities",
            "net cash provided by operating activities", "operating cash flow", "cash flow from operations"],
    "capex": ["capital expenditures", "capex", "capital expenditure", "purchases of property and equipment"],
}
PRICE_RE = re.compile(r"(current|last|latest|recent)?\s*(share|stock)\s*price|^price$|^current price|price per share", re.I)
PRICE_NOT = re.compile(r"target|implied|exit|intrinsic|offer|strike|value|fair|52|high|low|average|avg", re.I)
SHARES_RE = re.compile(r"(diluted\s+)?shares\s+outstanding|share count|diluted shares|basic shares", re.I)
SHARES_NOT = re.compile(r"%|growth|change|repurchas|buyback|issued|per share|price|weighted|average|avg|peer|"
                        r"basic weighted|\bfy\s*'?\d", re.I)
RF_RE = re.compile(r"risk[\s-]*free", re.I)
# the company's own beta only: "Beta", "Levered beta", "Equity beta (5Y monthly)" - not peer, average or asset betas
BETA_RE = re.compile(r"^(?:levered |equity |raw |adjusted |selected |company )?beta\b(?:\s*\(.*\))?\s*:?$", re.I)
BETA_NOT = re.compile(r"unlevered|asset|debt|peer|comp|average|median|industry|sector|relevered", re.I)
YEAR_RE = re.compile(r"^(?:FY|CY)?\s*'?(\d{4}|\d{2})\s*([AEPBF])?$", re.I)


def norm(s) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9&' ]", " ", str(s).lower())).strip()


def year_of(v):
    """(year, suffix) for a header cell like 2024, '2024A', 'FY24', 'FY2025E'."""
    if isinstance(v, (int, float)) and 1990 <= v <= 2100 and float(v).is_integer():
        return int(v), ""
    if isinstance(v, str):
        m = YEAR_RE.match(v.strip())
        if m:
            y = int(m.group(1))
            y = y + 2000 if y < 100 else y
            if 1990 <= y <= 2100:
                return y, (m.group(2) or "").upper()
    return None


def is_formula(c) -> bool:
    return isinstance(c.value, str) and c.value.startswith("=")


def num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def unit_scale(old: float, actual: float):
    """Model units vs $mm: 1 ($mm), 1e3 ($000s), 1e-3 ($bn), 1e6 (dollars). None if no fit."""
    if not actual or not old:
        return None
    for s in (1, 1e3, 1e-3, 1e6):
        if abs(abs(old) / (abs(actual) * s) - 1) < 0.15:
            return s
    return None


def scan(wf, wv, fin: dict, live: dict) -> dict:
    """Find what to update, without touching anything."""
    fy = {int(lab[2:]): i for i, lab in enumerate(fin["labels"])}
    latest_fy = max(fy)
    changes, compare, latest_actual = [], [], None
    for ws in wf.worksheets:
        if ws.title in (excel.SHEET, LOG_SHEET):
            continue
        vs = wv[ws.title]
        maxr, maxc = min(ws.max_row, 400), min(ws.max_column, 60)
        header = {}  # col -> (year, suffix)
        for r in range(1, maxr + 1):
            row_years = {}
            for c in range(1, maxc + 1):
                y = year_of(ws.cell(r, c).value)
                if y:
                    row_years[c] = y
            if len(row_years) >= 3:
                header = row_years
                continue
            if not header:
                continue
            label = next((ws.cell(r, c).value for c in range(1, min(5, maxc) + 1)
                          if isinstance(ws.cell(r, c).value, str) and ws.cell(r, c).value.strip()), None)
            if not label:
                continue
            nl = norm(label)
            key = next((k for k, syns in SYNONYMS.items() if nl in syns), None)
            if not key:
                continue
            series = fin["items"].get(key) or []
            scale = None
            for c, (y, suf) in sorted(header.items()):
                cell, cached = ws.cell(r, c), vs.cell(r, c).value
                if y in fy and fy[y] < len(series) and series[fy[y]] is not None:
                    actual = series[fy[y]]
                    if not num(cached) or cached == 0:
                        continue
                    s = unit_scale(cached, actual) if key != "eps_diluted" else (1 if abs(cached / actual - 1) < 0.15 else None)
                    if s is None:
                        continue
                    scale = scale or s
                    if suf != "E" and not is_formula(cell):
                        latest_actual = max(latest_actual or 0, y)
                    new = (abs(actual) * s) * (1 if cached >= 0 else -1)
                    if suf == "E" or is_formula(cell):
                        if abs(cached / new - 1) > 0.005:
                            compare.append({"sheet": ws.title, "cell": cell.coordinate, "line": str(label).strip(),
                                            "year": y, "model": cached, "actual": new, "diff": cached / new - 1,
                                            "units": s})
                    elif abs(cached / new - 1) > 0.005:
                        changes.append({"kind": "Historical restated", "sheet": ws.title, "cell": cell.coordinate,
                                        "label": f"{str(label).strip()} {y}", "old": cached, "new": round(new, 4)})
    inputs = []
    for ws in wf.worksheets:
        if ws.title in (excel.SHEET, LOG_SHEET):
            continue
        vs = wv[ws.title]
        for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 400), max_col=min(ws.max_column, 40)):
            for lc in row:
                if not isinstance(lc.value, str) or len(lc.value) > 80:
                    continue
                lab = lc.value.strip()
                target = None
                for dc in range(1, 7):
                    if lc.column + dc > ws.max_column:
                        break
                    c = ws.cell(lc.row, lc.column + dc)
                    if c.value is None:
                        continue
                    if num(c.value) and not is_formula(c):
                        target = c
                    break
                if target is None:
                    continue
                old = target.value
                new, kind = None, None
                if PRICE_RE.search(lab) and not PRICE_NOT.search(lab) and live.get("price") and 0.2 < old / live["price"] < 5:
                    new, kind = round(live["price"], 2), "Share price"
                elif SHARES_RE.search(lab) and not SHARES_NOT.search(lab) and live.get("shares"):
                    s = unit_scale(old, live["shares"])
                    if s:
                        new, kind = round(live["shares"] * s, 3), "Shares outstanding"
                elif RF_RE.search(lab) and (live.get("market") or {}).get("risk_free"):
                    rf = live["market"]["risk_free"]
                    if 0 < old < 0.2:
                        new, kind = round(rf, 4), "Risk-free rate"
                    elif 0.2 <= old < 20:
                        new, kind = round(rf * 100, 2), "Risk-free rate"
                elif BETA_RE.search(lab) and not BETA_NOT.search(lab) and 0.1 < old < 4 and (live.get("market") or {}).get("beta"):
                    new, kind = round(live["market"]["beta"], 2), "Beta"
                if kind and abs(new - old) > 1e-9 and sum(1 for i in inputs if i["kind"] == kind) < 3:
                    inputs.append({"kind": kind, "sheet": ws.title, "cell": target.coordinate, "label": lab,
                                   "old": old, "new": new})
    stale = None
    if latest_actual and latest_actual < latest_fy:
        stale = {"model_latest_actual": latest_actual, "available": latest_fy}
    return {"changes": inputs + changes, "compare": compare[:40], "stale": stale}


def old_target(wb_values):
    """(value, 'Sheet!A1') of the model's target price from cached values, via named range or label search."""
    for n in ("TargetPrice", "Target_Price", "PriceTarget", "Price_Target", "ImpliedSharePrice"):
        dn = wb_values.defined_names.get(n)
        if dn is not None:
            for sheet, ref in dn.destinations:
                v = wb_values[sheet][ref.replace("$", "").split(":")[0]].value
                if num(v):
                    return v, f"{sheet}!{ref.replace('$', '')}"
    best = None
    sheets = sorted(wb_values.worksheets, key=lambda s: next((i for i, p in enumerate(excel.PRIORITY_SHEETS)
                                                               if p in s.title.lower()), 99))
    for ws in sheets:
        if ws.title in (excel.SHEET, LOG_SHEET):
            continue
        for row in ws.iter_rows(max_row=min(ws.max_row, 400), max_col=min(ws.max_column, 60)):
            for c in row:
                if not isinstance(c.value, str):
                    continue
                rank = next((i for i, k in enumerate(excel.TARGET_LABELS) if k in c.value.lower()), None)
                if rank is None:
                    continue
                for dc in range(1, 9):
                    v = ws.cell(c.row, c.column + dc).value
                    if num(v) and v > 0:
                        cand = (rank, v, f"{ws.title}!{ws.cell(c.row, c.column + dc).coordinate}")
                        if best is None or cand[0] < best[0]:
                            best = cand
                        break
    return (best[1], best[2]) if best else (None, None)


def write_log(doc, s: dict):
    sheets = doc.Sheets
    if sheets.hasByName(LOG_SHEET):
        sheets.removeByName(LOG_SHEET)
    sheets.insertNewByName(LOG_SHEET, 0)
    sh = sheets.getByName(LOG_SHEET)
    r = 0

    def put(row, col, v, bold=False):
        c = sh.getCellByPosition(col, row)
        if num(v):
            c.setValue(float(v))
        elif v is not None:
            c.setString(str(v))
        if bold:
            c.CharWeight = 150
    put(r, 0, f"Model update: {s['name']} ({s['ticker']})", True); r += 1
    put(r, 0, f"Updated {s['updated_at']} with SEC 10-K data (latest {s['latest_fy']}, filed {s['tenk_filed']}) and "
              f"market data priced {s['price_date']}. Formulas were not changed; typed inputs below were."); r += 2
    put(r, 0, "Target price before", True); put(r, 1, s.get("old_target")); r += 1
    put(r, 0, "Target price after", True); put(r, 1, s.get("new_target")); r += 1
    put(r, 0, "Target cell"); put(r, 1, s.get("target_cell") or "not found"); r += 1
    put(r, 0, "Current share price"); put(r, 1, s.get("price")); r += 2
    if s.get("stale"):
        put(r, 0, f"Heads up: the model's latest actual year is FY{s['stale']['model_latest_actual']}, but FY"
                  f"{s['stale']['available']} has been reported. The new year's figures are in the Live_Data tab; "
                  "roll the model forward to use them.", True); r += 2
    put(r, 0, "Changes made", True); r += 1
    for i, h in enumerate(("What", "Sheet", "Cell", "Label", "Before", "After")):
        put(r, i, h, True)
    r += 1
    for c in s["changes"] or [{"kind": "No typed inputs needed changing"}]:
        for i, k in enumerate(("kind", "sheet", "cell", "label", "old", "new")):
            put(r, i, c.get(k))
        r += 1
    r += 1
    if s.get("compare"):
        put(r, 0, "Your projections vs reported actuals", True); r += 1
        for i, h in enumerate(("Line", "Year", "Sheet", "Cell", "Your model", "Actual", "Difference")):
            put(r, i, h, True)
        r += 1
        for c in s["compare"]:
            for i, v in enumerate((c["line"], c["year"], c["sheet"], c["cell"], c["model"], round(c["actual"], 2),
                                   f"{c['diff']:+.1%}")):
                put(r, i, v)
            r += 1
        r += 1
    put(r, 0, "Sources: SEC EDGAR XBRL company facts; Yahoo Finance prices, beta and consensus; 10-year Treasury yield.")
    cols = sh.getColumns()
    for i, w in enumerate((9000, 5200, 2200, 9000, 3000, 3000, 2800)):
        cols.getByIndex(i).Width = w


def run(src: Path, ticker: str, dest: Path) -> dict:
    import openpyxl
    T = ticker.upper().replace(".", "-")
    uni = universe.load()["companies"]
    me = next((c for c in uni if c["ticker"] == T or T in c.get("other_tickers", [])), None)
    if me is None:
        raise SystemExit(f"{T} is not an NYSE- or Nasdaq-listed SEC filer")
    now = dt.datetime.now(dt.timezone.utc)
    x = generate.market_inputs(T, me, now)
    live, fin = x["live"], x["fin"]
    live["model_label"] = src.stem
    live.setdefault("market", {})["beta"] = (x.get("beta") if x.get("beta_src") != "default 1.0" else None)
    live["market"]["risk_free"] = x["rates"]["rf_10y"]
    try:
        wf = openpyxl.load_workbook(src)
        wv = openpyxl.load_workbook(src, data_only=True)
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"Couldn't read the workbook ({exc}). Save it as .xlsx from Excel and try again.")
    found = scan(wf, wv, fin, live)
    old_val, old_ref = old_target(wv)
    is_ours = any(n.endswith(" Scenarios") for n in wf.sheetnames) and excel.SHEET in wf.sheetnames
    calc = excel.Calc(port=int(__import__("os").environ.get("LO_PORT", "2002")))
    try:
        doc = calc.open(src)
        if doc is None:
            raise SystemExit("LibreOffice could not open the workbook.")
        try:
            excel.write_live_data(doc, live)
            for c in found["changes"]:
                excel._cell(doc, f"'{c['sheet']}'!{c['cell']}").setValue(float(c["new"]))
            doc.calculateAll()
            new_val, where = excel.find_target(doc, f"'{old_ref.split('!')[0]}'!{old_ref.split('!')[1]}" if old_ref else None)
            if not isinstance(new_val, float):
                new_val, where = excel.find_target(doc, None)
            summary = {
                "status": "ok", "ticker": T, "name": x["name"], "updated_at": now.strftime("%Y-%m-%d %H:%M UTC"),
                "latest_fy": fin["labels"][-1], "tenk_filed": live.get("tenk_filed"), "price": round(x["price"], 2),
                "price_date": live.get("price_date"), "old_target": old_val,
                "new_target": round(new_val, 2) if isinstance(new_val, float) else None,
                "target_cell": where if isinstance(new_val, float) else old_ref,
                "changes": found["changes"], "compare": found["compare"], "stale": found["stale"],
                "model_builder_file": is_ours,
                "latest_quarter": fundamentals.latest_quarter(x["facts"], fin),
            }
            write_log(doc, summary)
            doc.calculateAll()
            excel.save_xlsx(doc, dest)
        finally:
            doc.close(True)
    finally:
        calc.close()
    return summary


if __name__ == "__main__":
    src, tick, out, summ = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4])
    try:
        res = run(src, tick, out)
    except SystemExit as e:
        res = {"status": "failed", "error": str(e)}
    except Exception as e:  # noqa: BLE001
        res = {"status": "failed", "error": f"The update failed: {e}"}
    summ.write_text(json.dumps(res, default=str))
    print(json.dumps({k: v for k, v in res.items() if k not in ("compare",)}, default=str)[:2000])
    __import__("os")._exit(0)
