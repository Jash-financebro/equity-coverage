"""Offline end-to-end test of the on-demand generator: universe → model → report → library index.

    /usr/bin/python3 tests/test_generate.py
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
env = dict(os.environ, FIXTURES_DIR=str(ROOT / "tests" / "fixtures"), SITE_DIR=str(tmp / "site"),
           LIBRARY_DIR=str(tmp / "library"), RESULT_FILE=str(tmp / "r.json"), LO_PORT="2011")
subprocess.run([sys.executable, str(ROOT / "pipeline" / "universe.py")], check=True, env=env, cwd=ROOT)
u = json.loads((tmp / "site" / "universe" / "companies.json").read_text())
assert u["count"] == 3 and u["companies"][0]["sector"] == "Information Technology", u
for _ in range(2):  # second run must bump the version
    subprocess.run([sys.executable, str(ROOT / "pipeline" / "generate.py"), "MSFT"], check=True, env=env, cwd=ROOT)
r = json.loads((tmp / "r.json").read_text())
folder = tmp / "library" / "information-technology" / "MSFT"
assert (folder / "MSFT_v2.xlsx").exists() and (folder / "MSFT_report_v2.pdf").exists(), list(folder.iterdir())
idx = json.loads((tmp / "library" / "index.json").read_text())
assert idx["count"] == 1 and idx["models"][0]["times_generated"] == 2 and idx["sectors"] == {"Information Technology": ["MSFT"]}
assert r["peers"] == ["ORCL", "GOOGL"] or set(r["peers"]) == {"ORCL", "GOOGL"}, r["peers"]
assert r["scenarios"]["bear"] < r["scenarios"]["base"] < r["scenarios"]["bull"], r["scenarios"]
assert abs(r["target"] - r["scenarios"]["base"]) < 0.01
bad = subprocess.run([sys.executable, str(ROOT / "pipeline" / "generate.py"), "OTCX"], env=env, cwd=ROOT,
                     capture_output=True, text=True)
assert bad.returncode != 0 and "not an NYSE- or Nasdaq" in (bad.stdout + bad.stderr), "OTC ticker must be rejected"
sys.path.insert(0, str(ROOT / "pipeline"))
import builder  # noqa: E402
issues = builder.verify(folder / "MSFT_v2.xlsx")
issues = [i for i in issues if "A1" in i or "SUMPRODUCT" in i or "hidden" in i]  # LO re-save keeps these exact
assert not issues, issues
print(f"OK  MSFT_v2 target ${r['target']} ({r['rating']}) | scenarios {r['scenarios']} | peers {r['peers']} | "
      f"report {(folder / 'MSFT_report_v2.pdf').stat().st_size // 1024} KB")
if "--keep" in sys.argv:
    print("kept:", tmp)
else:
    shutil.rmtree(tmp, ignore_errors=True)
