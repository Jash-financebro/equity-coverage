"""Update an outside model: typed inputs and restated historicals change, formulas don't, log is written."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from openpyxl import Workbook, load_workbook

ROOT = Path(__file__).resolve().parent.parent
subprocess.run([sys.executable, str(ROOT / "tests" / "make_fixtures.py")], check=True, stdout=subprocess.DEVNULL)
tmp = Path(tempfile.mkdtemp())
env = dict(os.environ, FIXTURES_DIR=str(ROOT / "tests" / "fixtures"), SITE_DIR=str(tmp / "site"),
           LIBRARY_DIR=str(tmp / "library"), LO_PORT="2013")
subprocess.run([sys.executable, str(ROOT / "pipeline" / "universe.py")], check=True, env=env, cwd=ROOT,
               stdout=subprocess.DEVNULL)

wb = Workbook()
ws = wb.active
ws.title = "Model"
ws["A1"] = "My Microsoft model"
for c, h in zip("BCDEF", ["($ in millions)", "FY2023A", "FY2024A", "FY2025E", "FY2026E"]):
    ws[f"{c}3"] = h
ws["B4"], ws["C4"], ws["D4"], ws["E4"], ws["F4"] = "Revenue", 211915, 240000, "=D4*1.1", "=E4*1.1"
ws["B5"], ws["C5"], ws["D5"], ws["E5"], ws["F5"] = "Net income", 72361, 88136, "=E4*0.35", "=F4*0.35"
ws["A8"], ws["B8"] = "Current share price", 400
ws["A9"], ws["B9"] = "Shares outstanding (mm)", 7300
ws["A10"], ws["B10"] = "Risk-free rate", 0.04
ws["A11"], ws["B11"] = "Beta", 0.9
ws["A12"], ws["B12"] = "Target price", "=F5*30/B9"
raw = tmp / "raw.xlsx"
wb.save(raw)
# give it cached values, as a file saved by Excel would have
subprocess.run(["soffice", "--headless", "--convert-to", "xlsx", "--outdir", str(tmp / "conv"), str(raw)],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
src = tmp / "conv" / "raw.xlsx"

out, summ = tmp / "out.xlsx", tmp / "sum.json"
subprocess.run([sys.executable, str(ROOT / "pipeline" / "update.py"), str(src), "MSFT", str(out), str(summ)],
               check=True, env=env, cwd=ROOT, stdout=subprocess.DEVNULL)
s = json.loads(summ.read_text())
assert s["status"] == "ok", s
kinds = {c["kind"]: c for c in s["changes"]}
assert kinds["Share price"]["cell"] == "B8" and kinds["Share price"]["new"] == s["price"], kinds
assert kinds["Shares outstanding"]["cell"] == "B9" and 7000 < kinds["Shares outstanding"]["new"] < 8000, kinds
assert "Risk-free rate" in kinds and "Beta" in kinds, kinds
assert kinds["Historical restated"]["cell"] == "D4" and kinds["Historical restated"]["new"] == 245122, kinds
assert any(c["cell"] == "E4" and c["year"] == 2025 for c in s["compare"]), s["compare"]
assert s["stale"] == {"model_latest_actual": 2024, "available": 2025}, s["stale"]
assert s["old_target"] and s["new_target"] and s["new_target"] != s["old_target"], (s["old_target"], s["new_target"])

w = load_workbook(out)
assert w.sheetnames[0] == "Update Log" and "Live_Data" in w.sheetnames, w.sheetnames
m = w["Model"]
assert m["E4"].value == "=D4*1.1" and m["B12"].value == "=F5*30/B9", "formulas must be untouched"
assert m["B8"].value == s["price"] and m["D4"].value == 245122
v = load_workbook(out, data_only=True)["Model"]
assert abs(v["B12"].value - s["new_target"]) < 0.01, (v["B12"].value, s["new_target"])
shutil.rmtree(tmp, ignore_errors=True)
print(f"OK  update: target {s['old_target']:.2f} -> {s['new_target']:.2f} | {len(s['changes'])} inputs changed | "
      f"{len(s['compare'])} projection(s) vs actuals | stale flagged")
