"""Peer selection: right industry, no affiliates, no broad-SIC strays (mocked SEC + Yahoo)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import generate  # noqa: E402

YAHOO = {  # ticker -> (industry, sector)
    "SN": ("Furnishings, Fixtures & Appliances", "Consumer Cyclical"),
    "WHR": ("Furnishings, Fixtures & Appliances", "Consumer Cyclical"),
    "HELE": ("Furnishings, Fixtures & Appliances", "Consumer Cyclical"),
    "IRBT": ("Furnishings, Fixtures & Appliances", "Consumer Cyclical"),
    "AMKR": ("Semiconductor Equipment & Materials", "Technology"),
    "ADI": ("Semiconductors", "Technology"), "ARM": ("Semiconductors", "Technology"),
    "AOS": ("Specialty Industrial Machinery", "Industrials"),
    "LNG": ("Oil & Gas Midstream", "Energy"), "CQP": ("Oil & Gas Midstream", "Energy"),
    "VG": ("Oil & Gas Midstream", "Energy"), "KMI": ("Oil & Gas Midstream", "Energy"),
    "WMB": ("Oil & Gas Midstream", "Energy"), "ATO": ("Utilities - Regulated Gas", "Utilities"),
    "KO": ("Beverages - Non-Alcoholic", "Consumer Defensive"), "PEP": ("Beverages - Non-Alcoholic", "Consumer Defensive"),
    "KDP": ("Beverages - Non-Alcoholic", "Consumer Defensive"), "MNST": ("Beverages - Non-Alcoholic", "Consumer Defensive"),
    "BF-B": ("Beverages - Wineries & Distilleries", "Consumer Defensive"), "WEST": ("Packaged Foods", "Consumer Defensive"),
    **{t: ("Internet Content & Information", "Communication Services") for t in ("GOOG", "META", "PINS", "SNAP", "RDDT")},
    **{f"AA{i}": ("Internet Content & Information", "Communication Services") for i in range(20)},
}
UNI = [
    {"ticker": "SN", "cik": 1, "name": "SharkNinja, Inc.", "sic": "3630"},
    {"ticker": "WHR", "cik": 2, "name": "Whirlpool Corp", "sic": "3630"},
    {"ticker": "HELE", "cik": 3, "name": "Helen of Troy Ltd", "sic": "3634"},
    {"ticker": "IRBT", "cik": 4, "name": "iRobot Corp", "sic": "3569"},
    {"ticker": "AMKR", "cik": 5, "name": "Amkor Technology", "sic": "3674"},
    {"ticker": "ADI", "cik": 6, "name": "Analog Devices", "sic": "3674"},
    {"ticker": "ARM", "cik": 7, "name": "Arm Holdings", "sic": "3674"},
    {"ticker": "AOS", "cik": 8, "name": "Smith A O Corp", "sic": "3630"},
    {"ticker": "LNG", "cik": 10, "name": "Cheniere Energy, Inc.", "sic": "4924"},
    {"ticker": "CQP", "cik": 11, "name": "Cheniere Energy Partners, L.P.", "sic": "4924"},
    {"ticker": "VG", "cik": 12, "name": "Venture Global, Inc.", "sic": "4924"},
    {"ticker": "KMI", "cik": 13, "name": "Kinder Morgan, Inc.", "sic": "4922"},
    {"ticker": "WMB", "cik": 14, "name": "Williams Companies, Inc.", "sic": "4922"},
    {"ticker": "ATO", "cik": 15, "name": "Atmos Energy Corp", "sic": "4923"},
    {"ticker": "KO", "cik": 20, "name": "COCA COLA CO", "sic": "2080"},
    {"ticker": "PEP", "cik": 21, "name": "PEPSICO INC", "sic": "2080"},
    {"ticker": "KDP", "cik": 22, "name": "Keurig Dr Pepper Inc.", "sic": "2086"},
    {"ticker": "MNST", "cik": 23, "name": "Monster Beverage Corp", "sic": "2086"},
    {"ticker": "BF-B", "cik": 24, "name": "BROWN FORMAN CORP", "sic": "2085"},
    {"ticker": "WEST", "cik": 25, "name": "Westrock Coffee Co", "sic": "2080"},
    {"ticker": "SPAC", "cik": 30, "name": "Blank Check Acquisition Corp", "sic": "6770"},
    {"ticker": "GOOG", "cik": 40, "name": "Alphabet Inc.", "sic": "7370"},
    {"ticker": "META", "cik": 41, "name": "Meta Platforms, Inc.", "sic": "7370"},
    {"ticker": "PINS", "cik": 42, "name": "Pinterest, Inc.", "sic": "7370"},
    {"ticker": "SNAP", "cik": 43, "name": "Snap Inc", "sic": "7370"},
    {"ticker": "RDDT", "cik": 44, "name": "Reddit, Inc.", "sic": "7370"},
] + [{"ticker": f"AA{i}", "cik": 100 + i, "name": f"Tiny Web {i} Inc", "sic": "7370"} for i in range(20)]
CIK2T = {c["cik"]: c["ticker"] for c in UNI}
REV = {"SN": 5500, "WHR": 16000, "HELE": 1900, "IRBT": 700, "AMKR": 6300, "ADI": 9400, "ARM": 3200, "AOS": 3800,
       "LNG": 15700, "CQP": 9000, "VG": 8000, "KMI": 15100, "WMB": 10500, "ATO": 4200,
       "KO": 47000, "PEP": 92000, "KDP": 15400, "MNST": 7500, "BF-B": 4100, "WEST": 900,
       "GOOG": 350000, "META": 165000, "PINS": 3600, "SNAP": 5400, "RDDT": 1300, **{f"AA{i}": 50 + i for i in range(20)}}


class S:  # stand-in for pipeline/sources.py
    @staticmethod
    def quote_summary(t):
        ind, sec = YAHOO.get(t, (None, None))
        return {"industry": ind, "sector": sec, "target_median": 100.0, "target_mean": 100.0, "revenue": REV.get(t)}

    @staticmethod
    def similar_symbols(t):
        return {"SN": ["IRBT", "ADI"], "KO": ["PEP", "KDP"]}.get(t, [])

    @staticmethod
    def company_facts(cik):
        return {"t": CIK2T[cik]}

    @staticmethod
    def price_history(t):
        return {"price": 50.0}


class F:  # stand-in for fundamentals
    @staticmethod
    def build(facts, years=3):
        r = REV[facts["t"]]
        return {"items": {"revenue": [r], "shares_diluted": [100.0], "operating_income": [r * 0.2], "d_and_a": [r * 0.05],
                          "eps_diluted": [2.0], "short_term_debt": [0], "long_term_debt": [10], "cash": [5],
                          "equity": [r], "net_income": [r * 0.1]}}

    @staticmethod
    def shares_outstanding(facts):
        return 100.0


generate.sources, generate.fundamentals = S, F
pick = lambda t: generate.pick_peers(next(c for c in UNI if c["ticker"] == t), UNI, REV[t])  # noqa: E731

sn = pick("SN")
sn_t = [p["ticker"] for p in sn]
assert not {"AMKR", "ADI", "ARM"} & set(sn_t), f"chip makers must not be SharkNinja peers: {sn_t}"
assert sn_t[:3] and set(sn_t) >= {"WHR", "HELE", "IRBT"}, sn_t
assert all(p["match"] for p in sn), sn

lng_t = [p["ticker"] for p in pick("LNG")]
assert "CQP" not in lng_t, f"Cheniere's own subsidiary must be excluded: {lng_t}"
assert lng_t[:3] == sorted(lng_t[:3], key=lambda t: ["VG", "KMI", "WMB"].index(t) if t in ("VG", "KMI", "WMB") else 9) or "VG" in lng_t, lng_t

ko = pick("KO")
ko_t = [p["ticker"] for p in ko]
assert {"PEP", "KDP", "MNST"} <= set(ko_t), ko_t
assert ko_t.index("BF-B") > ko_t.index("MNST") if "BF-B" in ko_t else True, ko_t
assert "SPAC" not in ko_t
goog_t = [p["ticker"] for p in pick("GOOG")]
assert goog_t[0] == "META" and not any(t.startswith("AA") for t in goog_t), f"Alphabet's peers should start with Meta, not tiny names: {goog_t}"
print("OK  peers:", "GOOG", goog_t, "|", "SN", sn_t, "| LNG", lng_t, "| KO", ko_t, "|", {p["ticker"]: p["match"] for p in ko})
