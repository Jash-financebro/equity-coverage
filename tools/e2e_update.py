"""End-to-end check of the live Update tab: upload a sample KO model through the public API like a visitor."""
import json
import subprocess
import time
from pathlib import Path

import requests
from openpyxl import Workbook, load_workbook

API = json.load(open("site/api.json"))["api"]
tmp = Path("/tmp/e2e")
tmp.mkdir(exist_ok=True)
wb = Workbook()
ws = wb.active
ws.title = "Model"
for c, h in zip("BCDEF", ["($ in millions)", "FY2023A", "FY2024A", "FY2025A", "FY2026E"]):
    ws[f"{c}3"] = h
ws["B4"], ws["C4"], ws["D4"], ws["E4"], ws["F4"] = "Revenue", 45754, 47061, 47000, "=E4*1.04"
ws["B5"], ws["C5"], ws["D5"], ws["E5"], ws["F5"] = "Net income", 10714, 10631, 12000, "=F4*0.25"
ws["A8"], ws["B8"] = "Current share price", 70
ws["A9"], ws["B9"] = "Diluted shares outstanding", 4300
ws["A10"], ws["B10"] = "Beta", 0.6
ws["A12"], ws["B12"] = "Target price", "=F5*24/B9"
wb.save(tmp / "raw.xlsx")
subprocess.run(["soffice", "--headless", "--convert-to", "xlsx", "--outdir", str(tmp / "c"), str(tmp / "raw.xlsx")], check=True,
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
body = (tmp / "c" / "raw.xlsx").read_bytes()
H = {"Origin": "https://jash-financebro.github.io"}
r = requests.post(f"{API}/api/update?ticker=KO", data=body, headers={**H, "X-Filename": "Sample KO model.xlsx"}, timeout=60)
print(f"::notice::upload {r.status_code} {r.text[:300]}")
j = r.json()
for i in range(75):
    time.sleep(6)
    s = requests.get(f"{API}/api/update/status/{j['id']}?token={j['token']}", headers=H, timeout=30).json()
    if s["status"] in ("ready", "failed"):
        break
sm = s.get("summary") or {}
print(f"::notice::status {s['status']} after {6 * (i + 1)}s: old {sm.get('old_target')} -> new {sm.get('new_target')} "
      f"cell {sm.get('target_cell')} | error {sm.get('error')}")
print(f"::notice::changes {[(c['kind'], c['cell'], c['old'], c['new']) for c in sm.get('changes', [])]}"[:900])
print(f"::notice::compare {[(c['line'], c['year'], c['model'], round(c['actual'])) for c in sm.get('compare', [])]} stale {sm.get('stale')}"[:900])
if s["status"] == "ready":
    f = requests.get(f"{API}/api/update/file/{j['id']}?token={j['token']}", headers=H, timeout=60)
    (tmp / "out.xlsx").write_bytes(f.content)
    w = load_workbook(tmp / "out.xlsx")
    print(f"::notice::download {f.status_code} {len(f.content)} bytes, {f.headers.get('Content-Disposition')}, sheets {w.sheetnames}, "
          f"F4 formula kept: {w['Model']['F4'].value}")
    bad = requests.get(f"{API}/api/update/file/{j['id']}?token=wrong", headers=H, timeout=30)
    print(f"::notice::wrong token -> {bad.status_code}")
