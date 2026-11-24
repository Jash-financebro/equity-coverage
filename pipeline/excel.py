"""Refresh an Excel model with headless LibreOffice (UNO).

LibreOffice opens the workbook as-is (charts, formatting and formulas are kept),
we write/refresh a `Live_Data` sheet, optionally link model input cells to it,
recalculate everything, read the target price, and save a refreshed .xlsx.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import uno  # provided by python3-uno
from com.sun.star.beans import PropertyValue  # type: ignore

from fundamentals import LINE_ITEMS

from layout import (FIRST_ITEM_ROW, LAST_ROW, MARKET, MARKET_HEADER_ROW, SCALARS, SHEET, YEAR_COLS,  # noqa: F401
                    item_row, ref_for)

BLUE, GREEN, BLACK, GREY = 0x0000FF, 0x008000, 0x000000, 0x666666
TARGET_LABELS = [
    "target price", "price target", "implied share price", "implied price per share",
    "implied value per share", "intrinsic value per share", "fair value per share",
    "implied stock price", "value per share", "share price target",
]
PRIORITY_SHEETS = ("summary", "cover", "dcf", "valuation", "output", "football")


def _prop(name, value):
    p = PropertyValue()
    p.Name, p.Value = name, value
    return p


class Calc:
    def __init__(self, port: int = 2002):
        self.port = port
        self.profile = tempfile.mkdtemp(prefix="lo-profile-")
        self.proc = subprocess.Popen(
            ["soffice", "--headless", "--invisible", "--nologo", "--norestore", "--nodefault",
             f"-env:UserInstallation=file://{self.profile}",
             f"--accept=socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext(
            "com.sun.star.bridge.UnoUrlResolver", local)
        for _ in range(60):
            try:
                ctx = resolver.resolve(
                    f"uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext")
                break
            except Exception:  # noqa: BLE001
                time.sleep(0.5)
        else:
            raise RuntimeError("LibreOffice did not start")
        self.desktop = ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)

    def open(self, path: Path):
        url = uno.systemPathToFileUrl(str(Path(path).resolve()))
        return self.desktop.loadComponentFromURL(url, "_blank", 0, (
            _prop("Hidden", True), _prop("UpdateDocMode", 0), _prop("MacroExecutionMode", 0)))

    def close(self):
        try:
            self.desktop.terminate()
        except Exception:  # noqa: BLE001
            pass
        try:
            self.proc.wait(timeout=10)
        except Exception:  # noqa: BLE001
            self.proc.kill()
        shutil.rmtree(self.profile, ignore_errors=True)


# ------------------------------------------------------------------ helpers
def _fmt(doc, code: str) -> int:
    formats = doc.NumberFormats
    locale = uno.createUnoStruct("com.sun.star.lang.Locale")
    key = formats.queryKey(code, locale, False)
    return key if key != -1 else formats.addNew(code, locale)


def _sheet(doc, name):
    sheets = doc.Sheets
    return sheets.getByName(name) if sheets.hasByName(name) else None


def _split(ref: str):
    """'DCF!C5' or "'My Sheet'!C5" -> (sheet, cell)."""
    if "!" not in ref:
        raise ValueError(f"cell reference needs a sheet: {ref!r} (e.g. DCF!C5)")
    s, c = ref.rsplit("!", 1)
    return s.strip("'"), c.replace("$", "")


def _cell(doc, ref: str):
    s, c = _split(ref)
    sh = _sheet(doc, s)
    if sh is None:
        raise KeyError(f"sheet {s!r} not found")
    return sh.getCellRangeByName(c)


def _value(cell):
    if cell.getError() != 0:
        return None
    t = cell.getType().value
    if t == "EMPTY":
        return None
    if t == "TEXT":
        return cell.getString()
    return cell.getValue()


def _set(cell, value, color=BLUE, fmt=None, bold=False):
    if value is None:
        cell.setString("")
    elif isinstance(value, (int, float)):
        cell.setValue(float(value))
    else:
        cell.setString(str(value))
    cell.CharColor = color
    cell.CharFontName = "Arial"
    cell.CharHeight = 10
    cell.CharWeight = 150 if bold else 100
    if fmt is not None:
        cell.NumberFormat = fmt


# ------------------------------------------------------------- main steps
def write_live_data(doc, data: dict) -> None:
    sheets = doc.Sheets
    if not sheets.hasByName(SHEET):
        sheets.insertNewByName(SHEET, sheets.getCount())
    sh = sheets.getByName(SHEET)
    sh.getCellRangeByName(f"A1:H{LAST_ROW}").clearContents(1 | 2 | 4 | 16)  # values, dates, strings, formulas

    _set(sh.getCellRangeByName("A1"), data.get("model_label", ""), BLACK)
    _set(sh.getCellRangeByName("A2"), "LIVE DATA (historicals source: SEC EDGAR 10-K XBRL; prices & market data: "
         "Yahoo Finance). Refreshed automatically — link your model to these cells. "
         f"Last refresh: {data['refreshed_at']}", GREY)

    num = {code: _fmt(doc, code) for code in
           ("#,##0.00", "#,##0.0", "#,##0", "#,##0;(#,##0);-", "#,##0.0;(#,##0.0);-")}
    for key, (row, label, code, _name) in SCALARS.items():
        _set(sh.getCellRangeByName(f"A{row}"), label, BLACK)
        _set(sh.getCellRangeByName(f"B{row}"), data.get(key), BLUE, num.get(code) if code else None)

    fin = data["financials"]
    labels = fin["labels"][-5:]
    periods = fin["periods"][-5:]
    pad = 5 - len(labels)
    _set(sh.getCellRangeByName("A15"), "($ millions unless noted)", BLACK, bold=True)
    _set(sh.getCellRangeByName("A16"), "Fiscal period end", GREY)
    _set(sh.getCellRangeByName("G15"), "SEC XBRL concept", GREY, bold=True)
    for j, col in enumerate(YEAR_COLS):
        idx = j - pad
        _set(sh.getCellRangeByName(f"{col}15"), labels[idx] if idx >= 0 else "", BLACK, bold=True)
        _set(sh.getCellRangeByName(f"{col}16"), periods[idx] if idx >= 0 else "", GREY)

    for key, label, _kind, _c in LINE_ITEMS:
        r = item_row(key)
        _set(sh.getCellRangeByName(f"A{r}"), label, BLACK)
        vals = fin["items"].get(key, [])[-5:]
        code = "#,##0.00" if key == "eps_diluted" else "#,##0.0;(#,##0.0);-"
        for j, col in enumerate(YEAR_COLS):
            idx = j - pad
            v = vals[idx] if 0 <= idx < len(vals) else None
            _set(sh.getCellRangeByName(f"{col}{r}"), v, BLUE, num[code])
        _set(sh.getCellRangeByName(f"G{r}"), fin["concepts"].get(key, "n/a"), GREY)

    mk = data.get("market") or {}
    _set(sh.getCellRangeByName(f"A{MARKET_HEADER_ROW}"), "Market data & cost of capital", BLACK, bold=True)
    for key, (row, label, code, _n) in MARKET.items():
        _set(sh.getCellRangeByName(f"A{row}"), label, BLACK)
        _set(sh.getCellRangeByName(f"B{row}"), mk.get(key), BLUE, _fmt(doc, code))

    cols = sh.getColumns()
    cols.getByIndex(0).Width = 7200
    for i in range(1, 6):
        cols.getByIndex(i).Width = 2600
    cols.getByIndex(6).Width = 9000

    # named ranges so models can say =LD_Price or =LD_REVENUE
    names = doc.NamedRanges
    addr = uno.createUnoStruct("com.sun.star.table.CellAddress")
    wanted = {n: f"${SHEET}.$B${row}" for _k, (row, _l, _f, n) in list(SCALARS.items()) + list(MARKET.items()) if n}
    for key, *_ in LINE_ITEMS:
        wanted[f"LD_{key.upper()}"] = f"${SHEET}.$F${item_row(key)}"
    for name, content in wanted.items():
        if not names.hasByName(name):
            names.addNewByName(name, content, addr, 0)


def link_inputs(doc, inputs: dict) -> list[str]:
    """Point model cells at Live_Data. inputs: {"DCF!C5": "price", "IS!F6": "revenue.FY0"}"""
    done = []
    for target, source in (inputs or {}).items():
        cell = _cell(doc, target)
        cell.setFormula("=" + ref_for(source, calc_syntax=True))
        cell.CharColor = GREEN  # cross-sheet link
        done.append(f"{target} <- {source}")
    return done


def set_values(doc, values: dict) -> list[str]:
    """Scenario overrides from the .yml: {"DCF!B4": 0.12} writes a hardcoded (blue) input."""
    done = []
    for target, v in (values or {}).items():
        cell = _cell(doc, target)
        if isinstance(v, (int, float)):
            cell.setValue(float(v))
        else:
            cell.setString(str(v))
        cell.CharColor = BLUE
        done.append(f"{target} = {v}")
    return done


def find_target(doc, explicit: str | None):
    """Return (value, where). Order: config cell, named range, label search."""
    if explicit:
        return _value(_cell(doc, explicit)), explicit
    names = doc.NamedRanges
    for n in ("TargetPrice", "Target_Price", "PriceTarget", "Price_Target", "ImpliedSharePrice"):
        if names.hasByName(n):
            cell = names.getByName(n).getReferredCells().getCellByPosition(0, 0)
            return _value(cell), f"named range {n}"

    sheets = [doc.Sheets.getByIndex(i) for i in range(doc.Sheets.getCount())]
    sheets = [s for s in sheets if s.getName() != SHEET]
    sheets.sort(key=lambda s: next((i for i, p in enumerate(PRIORITY_SHEETS) if p in s.getName().lower()), 99))
    best = None
    for sh in sheets:
        cur = sh.createCursor()
        cur.gotoEndOfUsedArea(False)
        last_r, last_c = cur.getRangeAddress().EndRow, cur.getRangeAddress().EndColumn
        if last_r > 2000 or last_c > 200:
            last_r, last_c = min(last_r, 2000), min(last_c, 200)
        grid = sh.getCellRangeByPosition(0, 0, last_c, last_r).getDataArray()
        for r, row in enumerate(grid):
            for c, v in enumerate(row):
                if not isinstance(v, str) or not v:
                    continue
                low = v.lower()
                rank = next((i for i, k in enumerate(TARGET_LABELS) if k in low), None)
                if rank is None:
                    continue
                for cc in range(c + 1, min(c + 9, len(row))):
                    cell = sh.getCellByPosition(cc, r)
                    val = _value(cell)
                    if isinstance(val, float) and val > 0:
                        cand = (rank, f"{sh.getName()}!{cell.AbsoluteName.split('.')[-1].replace('$', '')}", val)
                        if best is None or cand[0] < best[0]:
                            best = cand
                        break
        if best is not None and best[0] == 0:
            break
    return (best[2], best[1]) if best else (None, None)


def run_scenarios(doc, cfg: dict, base_target) -> dict:
    """Bull/bear (or any named) cases: apply overrides, recalc, read target, restore."""
    out = {"base": base_target}
    names = doc.NamedRanges
    selector = names.getByName("Scenario").getReferredCells().getCellByPosition(0, 0) \
        if names.hasByName("Scenario") else None
    scen = dict(cfg.get("scenarios") or {})
    if not scen and selector is not None:  # models from the builder: 1 = bull, 2 = base, 3 = bear
        scen = {"bull": {"selector": 1}, "base": {"selector": 2}, "bear": {"selector": 3}}
    for name, spec in scen.items():
        saved = []
        if "selector" in spec and selector is not None:
            saved.append((selector, selector.getFormula()))
            selector.setValue(float(spec["selector"]))
        for ref, v in (spec.get("set") or {}).items():
            cell = _cell(doc, ref)
            saved.append((cell, cell.getFormula()))
            cell.setValue(float(v)) if isinstance(v, (int, float)) else cell.setString(str(v))
        doc.calculateAll()
        t, _ = find_target(doc, cfg.get("target_price"))
        out[name] = t if isinstance(t, float) else None
        for cell, f in reversed(saved):
            cell.setFormula(f)
    doc.calculateAll()
    return out


def read_outputs(doc, outputs: dict) -> dict:
    out = {}
    for label, ref in (outputs or {}).items():
        try:
            out[label] = _value(_cell(doc, ref))
        except Exception as exc:  # noqa: BLE001
            out[label] = None
            print(f"  ! output {label} ({ref}): {exc}")
    return out


def save_xlsx(doc, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = uno.systemPathToFileUrl(str(dest.resolve()))
    doc.storeToURL(url, (_prop("FilterName", "Calc MS Excel 2007 XML"), _prop("Overwrite", True)))


def refresh(calc: Calc, src: Path, dest: Path, data: dict, cfg: dict) -> dict:
    work = Path(tempfile.mkdtemp()) / src.name
    shutil.copy2(src, work)
    doc = calc.open(work)
    if doc is None:
        raise RuntimeError(f"LibreOffice could not open {src.name}")
    try:
        write_live_data(doc, data)
        links = link_inputs(doc, cfg.get("inputs")) + set_values(doc, cfg.get("set"))
        doc.calculateAll()
        target, where = find_target(doc, cfg.get("target_price"))
        scenarios = run_scenarios(doc, cfg, target if isinstance(target, float) else None)
        outputs = read_outputs(doc, cfg.get("outputs"))
        save_xlsx(doc, dest)
    finally:
        doc.close(True)
        shutil.rmtree(work.parent, ignore_errors=True)
    return {"target": target if isinstance(target, float) else None, "target_cell": where,
            "links": links, "outputs": outputs,
            "scenarios": scenarios}


if __name__ == "__main__":  # quick manual check: python excel.py model.xlsx
    import sys
    c = Calc()
    try:
        d = c.open(Path(sys.argv[1]))
        d.calculateAll()
        print(find_target(d, None))
        d.close(True)
    finally:
        c.close()
    os._exit(0)
