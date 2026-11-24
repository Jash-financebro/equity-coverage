"""End-to-end offline test: fixtures -> pipeline -> refreshed Excel + JSON.

    /usr/bin/python3 tests/test_offline.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
subprocess.run([sys.executable, str(ROOT / "tests" / "make_fixtures.py")], check=True, stdout=subprocess.DEVNULL)

tmp = Path(tempfile.mkdtemp())
work = tmp / "repo"
shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns(".git", "site"))
shutil.rmtree(work / "models")
(work / "models").mkdir()
shutil.copy2(ROOT / "templates" / "DCF_Template.xlsx", work / "models" / "MSFT.xlsx")
(work / "models" / "MSFT.yml").write_text('set:\n  "DCF!B4": 0.13\n  "DCF!B11": 0.085\n  "DCF!B12": 0.035\n')

env = dict(os.environ, FIXTURES_DIR=str(ROOT / "tests" / "fixtures"))
subprocess.run([sys.executable, str(work / "pipeline" / "run.py")], check=True, env=env, cwd=work)
d = json.loads((work / "site" / "data" / "MSFT.json").read_text())

# independent recompute of the template DCF from the fixture numbers
rev, m, da, cx = 281724, 128528 / 281724, 34153 / 281724, 64551 / 281724
g, t, nwc, w, tg = .13, .21, .05, .085, .035
pv, prev = 0, rev
for n in range(1, 6):
    r = prev * (1 + g)
    f = r * m * (1 - t) + r * da - r * cx - (r - prev) * nwc
    pv += f / (1 + w) ** n
    prev, last = r, f
expected = (pv + last * (1 + tg) / (w - tg) / (1 + w) ** 5 - (2999 + 40152 - 30242)) / 7433.038381

assert d["status"] == "ok", d
assert abs(d["target"] - expected) < 0.02, (d["target"], expected)
assert d["financials"]["labels"] == ["FY2021", "FY2022", "FY2023", "FY2024", "FY2025"]
assert d["financials"]["items"]["net_income"][-1] == 101832  # 10-Q fact ignored
assert (work / "site" / "downloads" / "MSFT_model_live.xlsx").exists()
pe = next(i["value"] for g_ in d["ratios"] for i in g_["items"] if i["label"] == "P/E")
assert abs(pe - d["price"] / 13.64) < 0.01
shutil.rmtree(tmp, ignore_errors=True)
print(f"OK  target {d['target']:.2f} == {expected:.2f}; ratios & downloads present")
