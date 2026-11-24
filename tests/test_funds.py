"""13F information-table parsing and position combining (synthetic filing in SEC's XML format)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import funds  # noqa: E402

XML = """<?xml version="1.0" encoding="UTF-8"?>
<ns1:informationTable xmlns:ns1="http://www.sec.gov/edgar/document/thirteenf/informationtable" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <ns1:infoTable><ns1:nameOfIssuer>APPLE INC</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass><ns1:cusip>037833100</ns1:cusip>
  <ns1:value>60000000</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>300000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt></ns1:infoTable>
 <ns1:infoTable><ns1:nameOfIssuer>APPLE INC</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass><ns1:cusip>037833100</ns1:cusip>
  <ns1:value>20000000</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>100000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt></ns1:infoTable>
 <ns1:infoTable><ns1:nameOfIssuer>COCA COLA CO</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass><ns1:cusip>191216100</ns1:cusip>
  <ns1:value>20000000</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>250000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt></ns1:infoTable>
 <ns1:infoTable><ns1:nameOfIssuer>SPDR S&amp;P 500 ETF</ns1:nameOfIssuer><ns1:titleOfClass>PUT</ns1:titleOfClass><ns1:cusip>78462F103</ns1:cusip>
  <ns1:value>5000000</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>10000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt><ns1:putCall>Put</ns1:putCall></ns1:infoTable>
</ns1:informationTable>"""
rows = funds.parse_infotable(XML)
assert len(rows) == 4 and rows[0]["cusip"] == "037833100" and rows[0]["value"] == 60_000_000, rows
pos, opts = funds.combine(rows)
assert pos["037833100"]["shares"] == 400_000 and pos["037833100"]["value"] == 80_000_000, pos
assert len(pos) == 2 and len(opts) == 1 and opts[0]["putcall"] == "Put"
assert funds.norm("COCA COLA CO") == funds.norm("Coca-Cola Co") == "coca cola"
subs = {"filings": {"recent": {"form": ["13F-HR", "13F-HR/A", "13F-HR", "13F-HR"], "reportDate": ["2026-09-30", "2026-06-30", "2026-06-30", "2026-03-31"],
                               "accessionNumber": ["a", "b", "c", "d"], "filingDate": ["2026-11-14", "2026-09-01", "2026-08-14", "2026-05-15"]}}}
fl = funds.filings_13f(subs)
assert [f["accn"] for f in fl] == ["a", "c", "d"], fl
print("OK  13F parsing: sub-manager rows combined, options split out, amendments ignored")
