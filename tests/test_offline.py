"""End-to-end offline test: fixtures -> pipeline (ticker-only build + peers) -> JSON, Excel, PDF.

    /usr/bin/python3 tests/test_offline.py [--keep]
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
shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns(".git", "site", "reports"))
shutil.copytree(ROOT / "site", work / "site", ignore=shutil.ignore_patterns("data", "downloads"))
shutil.rmtree(work / "models")
(work / "models").mkdir()
(work / "models" / "MSFT.yml").write_text("build: true\nstance: Balanced\npeers: [ORCL, GOOGL]\n"
                                          "thesis: Test thesis.\nrisks: [Test risk]\n")

env = dict(os.environ, FIXTURES_DIR=str(ROOT / "tests" / "fixtures"))
subprocess.run([sys.executable, str(work / "pipeline" / "run.py")], check=True, env=env, cwd=work)
d = json.loads((work / "site" / "data" / "MSFT.json").read_text())

assert d["status"] == "ok", d
assert (work / "models" / "MSFT_v1.xlsx").exists(), "builder did not save MSFT_v1.xlsx"
assert abs(d["target"] - d["scenarios"]["base"]) < 0.01 and 150 < d["target"] < 300, d["target"]
assert d["scenarios"]["bear"] < d["scenarios"]["base"] < d["scenarios"]["bull"], d["scenarios"]
assert d["financials"]["items"]["net_income"][-1] == 101832     # 10-Q fact ignored
assert d["consensus"]["target_median"] == 625.0
assert d["peers"]["implied"]["ev_ebitda"]["median"] and len(d["peers"]["rows"]) == 3
assert d["peers"]["peer_avg_street_upside"] is not None
assert len(d["football"]) >= 3, d["football"]
assert 0.04 < d["wacc"]["risk_free"] < 0.046
assert (work / "site" / "downloads" / "MSFT_tearsheet.pdf").stat().st_size > 10000
assert (work / "site" / "downloads" / "MSFT_model_live.xlsx").exists()
fund = json.loads((work / "site" / "data" / "fund.json").read_text())
assert fund["stats"]["sharpe"] is not None and fund["holdings"][0]["ticker"] == "MSFT"
pe = next(i["value"] for g in d["ratios"] for i in g["items"] if i["label"] == "P/E")
assert abs(pe - d["price"] / 13.64) < 0.01
print(f"OK  target {d['target']:.2f} | scenarios {d['scenarios']} | peers-implied avg "
      f"{d['peers']['implied']['average']:.2f} | Sharpe {fund['stats']['sharpe']:.2f}")
if "--keep" in sys.argv:
    print("kept:", work)
else:
    shutil.rmtree(tmp, ignore_errors=True)
