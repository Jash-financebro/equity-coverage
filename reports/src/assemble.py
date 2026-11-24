"""Assemble report content (text + tables copied from the model) into content.json for build.js."""
import json
import sys

sys.path.insert(0, "/home/claude/report")
import narrative as n  # noqa: E402

m, B, D, W, cv, mk, cs = n.m, n.B, n.D, n.W, n.cv, n.mk, n.cs
live = json.load(open("/home/claude/report/live.json")) if len(sys.argv) > 1 else {}
yrs = [f"{y}{'A' if y <= 2025 else 'E'}" for y in m["years"]]


def f(v, d=0, paren=True):
    if v is None or v == "n/a":
        return "—"
    if isinstance(v, str):
        return v
    s = f"{abs(v):,.{d}f}"
    return f"({s})" if v < 0 and paren else s


def p(v, d=1):
    return "—" if v in (None, "n/a") or isinstance(v, str) else f"{v * 100:.{d}f}%"


def rows(spec, cols=None):
    cols = cols or list(range(len(yrs)))
    return [[lab] + [fn(m[k][i]) if m[k][i] is not None else "—" for i in cols] for lab, k, fn in spec]


IS = rows([("Total revenue", "revenue", f), ("  Growth", "rev_growth", p), ("Cost of sales", "cogs", f),
           ("Operating & maintenance", "om", f), ("SG&A", "sga", f), ("Depreciation, amortization & accretion", "da", f),
           ("Other operating costs", "other_opex", f), ("Total operating costs", "total_opex", f),
           ("Income from operations", "ebit", f), ("Interest expense, net", "int_exp", f), ("Other income, net", "other_inc", f),
           ("Income before taxes", "pretax", f), ("Income tax provision", "tax", f), ("Net income (consolidated)", "ni_cons", f),
           ("Less: noncontrolling interests", "nci", f), ("Net income attributable to Cheniere", "ni", f),
           ("Diluted shares (mm)", "shares", lambda v: f(v, 1)), ("Diluted EPS, adjusted ($)", "eps", lambda v: f(v, 2)),
           ("Consolidated Adjusted EBITDA", "adj_ebitda", f)])
BS = rows([("Cash & restricted cash", "bs_cash", f), ("Receivables", "bs_receivables", f), ("Inventory", "bs_inventory", f),
           ("Other current assets", "bs_oca", f), ("Total current assets", "bs_tca", f), ("PP&E, net", "bs_ppe", f),
           ("Other non-current assets", "bs_onca", f), ("Total assets", "bs_ta", f), ("Accounts payable", "bs_ap", f),
           ("Other current liabilities", "bs_ocl", f), ("Total current liabilities", "bs_tcl", f), ("Total debt", "bs_debt", f),
           ("Other non-current liabilities", "bs_oncl", f), ("Total liabilities", "bs_tl", f),
           ("Cheniere stockholders' equity", "bs_parent_eq", f), ("Noncontrolling interests", "bs_nci_eq", f),
           ("Total stockholders' equity", "bs_te", f)])
CF = rows([("Net income", "cf_ni", f), ("Depreciation, amortization & accretion", "cf_da", f), ("Share-based compensation", "cf_sbc", f),
           ("Cash from operating activities", "cf_cfo", f), ("Capital expenditures", "cf_capex", f),
           ("Cash used in investing", "cf_cfi", f), ("Debt issuance / (repayment), net", "cf_debt_net", f),
           ("Dividends paid", "cf_div", f), ("Share repurchases", "cf_buyback", f), ("Distributions to NCI & other", "cf_nci_dist", f),
           ("Cash used in financing", "cf_cff", f), ("Net change in cash", "cf_net_change", f), ("Cash, end of period", "cf_end_cash", f)])
BOLD_IS = {"Total revenue", "Income from operations", "Income before taxes", "Net income attributable to Cheniere",
           "Consolidated Adjusted EBITDA"}
BOLD_BS = {"Total current assets", "Total assets", "Total current liabilities", "Total liabilities", "Total stockholders' equity"}
BOLD_CF = {"Cash from operating activities", "Cash used in investing", "Cash used in financing", "Cash, end of period"}

REVB = [["", *yrs[1:]],
        ["LNG volumes recognized (TBtu)", *[f(v) for v in m["volumes"][1:]]],
        ["Henry Hub ($/MMBtu)", *["—" if v is None else f(v, 2) for v in m["henry_hub"][1:]]],
        ["Revenue per MMBtu ($)", *[f(v, 2) for v in m["price_mmbtu"][1:]]],
        ["Total revenue ($mm)", *[f(v) for v in m["revenue"][1:]]],
        ["Fixed fee, base case ($/MMBtu)", "—", "—", *[f(v, 2) for v in m["scen"]["fee"][1]]],
        ["Volume growth, base case", "—", "—", *[p(v) for v in m["scen"]["volume"][1]]]]

dc = D
DCF = [["", "2026E", "2027E", "2028E", "2029E"],
       ["EBIAT (EBIT x (1 - tax))", *[f(v) for v in dc["ebiat"]]],
       ["Plus: D&A", *[f(v) for v in dc["da"]]],
       ["Less: capex", *[f(v) for v in dc["capex"]]],
       ["Less: increase in NWC", *[f(v) for v in dc["nwc"]]],
       ["Unlevered free cash flow", *[f(v) for v in dc["ufcf"]]],
       ["Discount period (years)", *[f(v, 3) for v in dc["period"]]],
       ["Discount factor", *[f(v, 4) for v in dc["disc"]]],
       ["PV of UFCF", *[f(v) for v in dc["pv"]]]]
BRIDGE = [["", "Perpetuity growth", "Exit multiple"],
          ["Sum of PV of UFCF", f(dc["sum_pv"]), f(dc["sum_pv"])],
          ["Terminal value", f(dc["tv_pg"]), f(dc["tv_exit"])],
          ["PV of terminal value", f(dc["pv_tv_pg"]), f(dc["pv_tv_exit"])],
          ["Enterprise value", f(dc["ev_pg"]), f(dc["ev_exit"])],
          ["Less: total debt", f(dc["debt"]), f(dc["debt"])],
          ["Plus: cash & restricted cash", f(dc["cash"]), f(dc["cash"])],
          ["Plus: est. Q3 2026 FCF", f(dc["q3fcf"]), f(dc["q3fcf"])],
          ["Less: NCI at market value", f(dc["nci"]), f(dc["nci"])],
          ["Implied equity value", f(dc["eq_pg"]), f(dc["eq_exit"])],
          ["Diluted shares (mm)", f(dc["shares"], 2), f(dc["shares"], 2)],
          ["Implied value per share ($)", f(dc["px_pg"], 2), f(dc["px_exit"], 2)],
          ["Terminal assumption", f"g = {p(dc['g'], 2)}", f"{dc['exit_mult']:.2f}x EBITDA"]]


def sens(key, colfmt):
    s = m[key]
    return [["WACC \\ " + ("g" if key == "sens_pg" else "exit multiple"), *[colfmt(v) for v in s[list(s)[1]]]]] + \
           [[p(w, 2), *[f"${v:,.0f}" for v in r]] for w, r in zip(s["wacc"], s["grid"])]


WACC = [["Risk-free rate (10Y UST, 9/30/2026)", p(W["rf"], 2)], ["Beta (peer unlevered, relevered)", f"{W['beta']:.2f}"],
        ["Equity market risk premium", p(W["mrp"], 1)], ["Cost of equity", p(W["ke"], 2)],
        ["Pre-tax cost of debt (CQP 5.350% 2036s)", p(W["kd"], 2)], ["Tax rate", p(W["tax"], 0)],
        ["After-tax cost of debt", p(W["kd_at"], 2)], ["Weight: equity / NCI / debt",
                                                        f"{p(W['we'])} / {p(W['wnci'])} / {p(W['wd'])}"],
        ["WACC", p(W["wacc"], 2)]]
COMPS = [["Company", "Price", "Mkt cap ($bn)", "EV ($bn)", "Trailing P/E", "Forward P/E", "EV/EBITDA (LTM)"]] + \
        [[c["name"].replace(" - for reference", ""), f"${c['price']:,.2f}", f(c["mcap"], 1) if c["mcap"] else "—",
          f(c["ev"], 1) if c["ev"] else "—", f"{c['pe']:.1f}x", f"{c['fpe']:.1f}x", f"{c['ev_ebitda']:.1f}x"]
         for c in m["comps"]] + \
        [["Peer average", "", "", "", *[f"{v:.1f}x" for v in m["comps_avg"]]],
         ["Peer median", "", "", "", *[f"{v:.1f}x" for v in m["comps_med"]]]]
BLEND = [["Method", "Value / share", "Weight", "Contribution"],
         ["DCF – perpetuity growth", f"${B['pg'][0]:,.2f}", p(B["pg"][1], 0), f"${B['pg'][0] * B['pg'][1]:,.2f}"],
         ["DCF – exit EV/EBITDA", f"${B['exit'][0]:,.2f}", p(B["exit"][1], 0), f"${B['exit'][0] * B['exit'][1]:,.2f}"],
         ["Trading comps (EV/EBITDA)", f"${B['comps'][0]:,.2f}", p(B["comps"][1], 0), f"${B['comps'][0] * B['comps'][1]:,.2f}"],
         ["Blended target price", "", "", f"${B['target']:,.2f}"],
         ["Scenario targets (bear / base / bull)", "", "", " / ".join(f"${v:,.2f}" for v in m["mc"]["targets"])]]

hist = live.get("price_history") or []
closes = [c for _, c in hist]
cons = live.get("consensus") or {}
lr = {i["label"]: i["value"] for g in live.get("ratios", []) for i in g["items"]}
STATS = [
    ["Price (9/30/2026, model)", f"${B['price']:,.2f}", "Headquarters", "Houston, TX", "Sector", "Energy"],
    ["Market cap ($mm)", f(cv["mcap"]), "Price, latest (" + live.get("price_date", "n/a") + ")",
     f"${live['price']:,.2f}" if live.get("price") else "N/A", "Industry", "LNG export / midstream"],
    ["Fiscal year end", "December 31", "52-week range", f"${min(closes):,.2f} – ${max(closes):,.2f}" if closes else "N/A",
     "Exchange", "NYSE"],
    ["12-month target / method", f"${B['target']:,.2f} · DCF + comps", "Forward P/E (FY26E)", f"{cv['fwd_pe']:.1f}x",
     "Beta (model)", f"{W['beta']:.2f}"],
    ["Upside to target", p(B["upside"]), "EV / EBITDA", f"{cv['ev_ebitda']:.1f}x", "Dividend yield", p(cv["div_yield"], 2)],
    ["Bear / bull value", f"${m['mc']['targets'][0]:,.0f} / ${m['mc']['targets'][2]:,.0f}", "Net debt / Adj. EBITDA",
     f"{cv['nd_ebitda']:.1f}x", "Price / book (latest 10-K)", f"{lr['P / Book']:.1f}x" if lr.get("P / Book") else "N/A"],
    ["Stop-loss (30%)", f"${n.STOP:,.2f}", "Street mean / median target",
     f"${cons['target_mean']:,.0f} / ${cons['target_median']:,.0f}" if cons.get("target_mean") else "N/A",
     "EV / sales (latest 10-K)", f"{lr["EV / Sales"]:.1f}x" if lr.get("EV / Sales") else "N/A"],
]

content = {
    "title": "Cheniere Energy, Inc. (NYSE: LNG)", "website": "https://www.cheniere.com",
    "rating": "BUY", "target": f"${B['target']:,.2f}", "upside": p(B["upside"]),
    "date": "November 23, 2026", "byline": "Jash Nayan Rajgandhi", "brand": "Independent Equity Research",
    "thesis": n.THESIS, "risks_short": n.KEY_RISKS_SHORT, "stats": STATS,
    "live_note": (f"Model valuation date September 30, 2026. Latest close {('$%.2f' % live['price']) if live.get('price') else 'n/a'} "
                  f"on {live.get('price_date', 'n/a')}; at that price the target implies "
                  f"{p(B['target'] / live['price'] - 1) if live.get('price') else 'n/a'} upside. The live model on our coverage "
                  f"site recalculates to {('$%.2f' % live['target']) if live.get('target') else 'n/a'} using current inputs."),
    "background": n.BACKGROUND, "industry": n.INDUSTRY, "management": n.MANAGEMENT, "highlights": n.HIGHLIGHTS,
    "tailwinds": n.TAILWINDS, "headwinds": n.HEADWINDS, "risks": n.RISKS, "porter": n.PORTER,
    "business_model": n.BUSINESS_MODEL, "recent": n.RECENT, "model_flags": n.MODEL_FLAGS, "fit": n.PORTFOLIO_FIT,
    "is_text": n.is_text(), "bs_text": n.bs_text(), "cf_text": n.cf_text(), "valuation_text": n.valuation_text() + n.consensus_text(),
    "tables": {
        "is": {"head": ["$ millions", *yrs], "rows": IS, "bold": sorted(BOLD_IS)},
        "bs": {"head": ["$ millions", *yrs], "rows": BS, "bold": sorted(BOLD_BS)},
        "cf": {"head": ["$ millions", *yrs], "rows": CF, "bold": sorted(BOLD_CF)},
        "revb": {"head": REVB[0], "rows": REVB[1:], "bold": ["Total revenue ($mm)"]},
        "dcf": {"head": DCF[0], "rows": DCF[1:], "bold": ["Unlevered free cash flow"]},
        "bridge": {"head": BRIDGE[0], "rows": BRIDGE[1:], "bold": ["Enterprise value", "Implied value per share ($)"]},
        "sens_pg": {"head": sens("sens_pg", lambda v: p(v, 2))[0], "rows": sens("sens_pg", lambda v: p(v, 2))[1:], "bold": []},
        "sens_exit": {"head": sens("sens_exit", lambda v: f"{v:.1f}x")[0], "rows": sens("sens_exit", lambda v: f"{v:.1f}x")[1:], "bold": []},
        "wacc": {"head": ["Input", "Value"], "rows": WACC, "bold": ["WACC"]},
        "comps": {"head": COMPS[0], "rows": COMPS[1:], "bold": ["Peer median"]},
        "blend": {"head": BLEND[0], "rows": BLEND[1:], "bold": ["Blended target price"]},
    },
    "sources": n.SOURCES + ["Yahoo Finance quote, price history and analyst consensus, Nov 23, 2026 (via the coverage site pipeline)"],
}
json.dump(content, open("/home/claude/report/content.json", "w"), indent=1)
print("content ok;", "live" if live else "no live data")
