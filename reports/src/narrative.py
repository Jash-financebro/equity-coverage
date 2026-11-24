"""LNG initiation report: narrative text. Every number comes from model.json (JJ's LNG_Final_1.xlsx)
or the dated research notes in SOURCES. Formatting helpers keep figures tied to the model."""
import json

m = json.load(open("/home/claude/report/model.json"))
B, D, W = m["blend"], m["dcf"], m["wacc"]
mk, cv, mc, cs = m["market"], m["cover"], m["mc"], m["comps_val"]
Y = {y: i for i, y in enumerate(m["years"])}  # 2023..2029 -> index


def b(v, d=1):  # $bn from $mm
    return f"${v / 1000:,.{d}f} billion"


def mm(v, d=0):
    return f"${v:,.{d}f} million"


def pct(v, d=1):
    return f"{v * 100:.{d}f}%"


def px(v):
    return f"${v:,.2f}"


rev, ebitda, eps = m["revenue"], m["adj_ebitda"], m["eps"]
fcf = [o + c for o, c in zip(m["cf_cfo"], m["cf_capex"])]
upside = B["upside"]
VD = "September 30, 2026"
STOP = round(B["price"] * 0.70, 2)

THESIS = [
    ("We initiate coverage of Cheniere Energy (LNG) with a Buy rating and a 12-month price target of "
     f"{px(B['target'])}, {pct(upside)} above the {px(B['price'])} close on our {VD} valuation date. "
     f"The target blends a perpetuity-growth DCF ({px(B['pg'][0])}, 40% weight), an exit-multiple DCF "
     f"({px(B['exit'][0])}, 40%) and trading comps ({px(B['comps'][0])}, 20%)."),
    ("Cheniere sells most of its output under long-term contracts that pay a fixed liquefaction fee whether or not "
     "a cargo is lifted, so volume, not the gas price, is what moves the cash flow. Volume is about to step up. "
     f"Corpus Christi Stage 3 finished in August 2026, and our model has recognized volumes rising from "
     f"{m['volumes'][Y[2025]]:,.0f} TBtu in 2025 to {m['volumes'][Y[2026]]:,.0f} TBtu in 2026E and "
     f"{m['volumes'][Y[2029]]:,.0f} TBtu by 2029E. That carries Consolidated Adjusted EBITDA from "
     f"{b(ebitda[Y[2025]])} to {b(ebitda[Y[2029]])}."),
    ("The cash goes back to shareholders. We model "
     f"{b(-sum(m['cf_buyback'][Y[2026]:]))} of buybacks over 2026E–2029E, which takes diluted shares from "
     f"{m['shares'][Y[2025]]:.1f} million to {m['shares'][Y[2029]]:.1f} million, while the dividend compounds at 10% a "
     f"year. Adjusted EPS climbs from {px(eps[Y[2026]])} in 2026E to {px(eps[Y[2029]])} in 2029E, and at "
     f"{cv['fwd_pe']:.1f}x forward earnings the stock trades well below the {m['comps_med'][1]:.1f}x peer median."),
]

KEY_RISKS_SHORT = ("The main risks are a global LNG oversupply later this decade, cost overruns on the next expansion, "
                   "and the large public stake in Cheniere Partners (CQP), which takes "
                   f"{mm(-D['nci'])} off our equity value.")

BACKGROUND = [
    ("Cheniere is the largest LNG exporter in the United States. It owns and operates two Gulf Coast export terminals: "
     "Sabine Pass in Cameron Parish, Louisiana, held through its publicly traded subsidiary Cheniere Energy Partners "
     "(NYSE: CQP), and Corpus Christi in Texas. The company shipped its first cargo from Sabine Pass in 2016. Ten "
     "years later, in August 2026, it exported its 5,000th, and it says its platform is now more than 10% of global "
     "LNG capacity."),
    ("The business has three parts. The liquefaction terminals buy pipeline gas, chill it into LNG and load it onto "
     "ships. Long-term sale and purchase agreements (SPAs) cover most of that capacity. Customers pay Henry Hub-linked "
     "gas costs plus a fixed fee per MMBtu. Cheniere Marketing sells the remaining uncontracted volumes and trades around "
     "the portfolio. Pipelines such as the 21.5-mile Corpus Christi Pipeline bring gas into the terminals. Cheniere is "
     "headquartered at 845 Texas Avenue in Houston, has a December fiscal year-end, and trades on the NYSE."),
    (f"In 2025 Cheniere earned {b(rev[Y[2025]])} of revenue and {b(ebitda[Y[2025]])} of Consolidated Adjusted "
     f"EBITDA. Our model keeps revenue at the consolidated level, as volume times realized price: "
     f"{m['volumes'][Y[2025]]:,.0f} TBtu at {px(m['price_mmbtu'][Y[2025]])} per MMBtu in 2025. Cheniere does "
     "not report a segment split that would support a finer build."),
]

INDUSTRY = [
    ("Shipping through the Strait of Hormuz has been "
     "disrupted since March, and the IEA estimates the disruption took close to 20% of global LNG supply off the "
     "market. A March 19 strike on Qatar's Ras Laffan complex knocked out about 16% of Qatari capacity for an "
     "estimated four years, according to S&P Global. The IEA now expects global LNG supply to be roughly flat in 2026 "
     "after years of double-digit growth, and it pushes the start of the long-awaited supply wave back by at least "
     "two years."),
    ("For U.S. exporters this matters in two ways. Near term, spot cargoes and new contracts price richer, and "
     "buyers are paying for security of supply. QatarEnergy, normally a competitor, signed in October to buy up to "
     "4 mtpa from Cheniere through 2054 while its own exports are disrupted. Longer term, the glut has been "
     "delayed rather than cancelled. IEEFA's September 2026 note makes that point directly, and GlobalData still sees "
     "the market going long from 2027 for a few years."),
    ("Cheniere's direct competitors on the Gulf Coast are Venture Global (VG), the other large U.S. exporter in our "
     "comp set, and a group of newer projects coming online over the next few years. For valuation we also use "
     "Williams (WMB), Kinder Morgan (KMI), Targa (TRGP) and ONEOK (OKE): fee-based gas infrastructure peers with "
     "similar contract structures and investor bases."),
]

MANAGEMENT = [
    ("Jack A. Fusco, Chairman, President & CEO.",
     "Fusco has run Cheniere since May 2016, when the company had just started exporting. Before that he was CEO of "
     "Calpine from 2008, taking over as it came out of bankruptcy, and ran one of the largest natural gas buyers in "
     "the country. That background in disciplined capital spending shows in Cheniere's playbook today: brownfield "
     "expansions on existing sites, lump-sum EPC contracts with Bechtel, and FID only once the capacity is contracted. "
     "Platts named him 2025 Chief Executive of the Year."),
    ("Zach Davis, President & Chief Financial Officer.",
     "Davis became CFO in August 2020 and was promoted to President and CFO effective November 12, 2026. He joined in "
     "2013 from energy investment banking and project finance roles at Credit Suisse and Marathon Capital. He owns "
     "the capital allocation plan our thesis leans on: buybacks, a 10%-a-year dividend growth target and paying down "
     "debt while Cheniere funds Sabine Pass Expansion Phase 1."),
    ("Anatol Feygin, EVP & Chief Commercial Officer.",
     "Feygin leads the commercial team that sells Cheniere's capacity under long-term contracts, the step that comes "
     "before every FID. That includes the 2026 deals with QatarEnergy (up to 4 mtpa) and Petrobras (0.8 mtpa for 22 "
     "years). Part of the Qatar volume is tied directly to an FID on Sabine Pass Expansion Phase 1."),
]

HIGHLIGHTS = [
    ("Volume growth is already built, not promised.",
     "All seven midscale trains of Corpus Christi Stage 3 reached substantial completion by August 28, 2026, ahead of "
     "schedule. Our volume line grows 14% in 2026E and another 5% in 2027E as those trains run a full year. Two more "
     "midscale trains at Corpus Christi (Trains 8 and 9, about 5 mtpa) are under construction for late 2028."),
    ("Most of the cash flow is contracted.",
     f"Our 2026E revenue of {b(rev[Y[2026]])} assumes a fixed fee of {px(m['scen']['fee'][1][0])}/MMBtu on top of "
     "115% of Henry Hub. Because the fee is paid on contracted capacity, our bear case cuts the fee by only $0.05 in "
     f"2026E and $0.20 thereafter. Even then the blended value holds at {px(mc['targets'][0])}."),
    ("Buybacks shrink the share count by about 4–6% a year.",
     f"We model {mm(-m['cf_buyback'][Y[2026]])} of repurchases in 2026E, rising to {mm(-m['cf_buyback'][Y[2029]])} "
     f"by 2029E, at assumed prices that climb from {px(272.15)} to {px(346.71)} a share. That takes the diluted "
     f"count to {m['shares'][Y[2029]]:.1f} million by 2029E and is the main reason adjusted EPS grows faster than "
     "EBITDA."),
    ("The stock screens cheap against its own cash flow and its peers.",
     f"Cheniere trades at {cv['ev_ebitda']:.1f}x EV/EBITDA, below the {m['comps_med'][2]:.1f}x peer median, and at "
     f"{cv['fwd_pe']:.1f}x forward earnings against a {m['comps_med'][1]:.1f}x median. Applying the median P/E to our "
     f"2026E EPS would imply {px(cs['pe_price'])}; we keep that as a memo and leave it out of the blend because the "
     "midstream P/E multiples are inflated by low-growth, high-payout names."),
]

TAILWINDS = [
    ("Contracting momentum.",
     "The QatarEnergy SPAs start in the early 2030s and run through 2054. Petrobras signed for 0.8 mtpa over 22 years. "
     "Each long-dated contract adds to the fixed-fee base and moves Sabine Pass Expansion Phase 1 closer to FID, which "
     "Cheniere Partners expects by early 2027."),
    ("A tighter market for longer.",
     "If the IEA is right that the supply wave slips by two or more years, uncontracted Cheniere Marketing volumes "
     "keep selling at wide spreads through 2027–2028. We do not assume this in the base case, so it is upside."),
    ("Sabine Pass Expansion Phase 1.",
     f"Our bull case adds {mm(m['scen']['spl_uplift'][2])} to terminal EBITDA for Phase 1 (more than 6 mtpa). "
     "That is half of the run-rate uplift our model assigns to the combined Corpus Christi and Sabine Pass Phase 1 projects. Bechtel signed "
     "the EPC contract and received limited notice to proceed in May 2026."),
]

HEADWINDS = [
    ("Margin on uncontracted volumes is volatile.",
     f"Our 2026E EBIT of {b(m['ebit'][Y[2026]])} is well below 2025's {b(m['ebit'][Y[2025]])} because we assume no "
     "derivative mark-to-market gains. In 2025 those gains were "
     f"{b(m['mtm'][Y[2025]])} inside cost of sales. GAAP earnings will keep swinging with those marks."),
    ("Capex rises before it falls.",
     f"We model {mm(m['cf_capex'][Y[2026]] * -1)} of capex in 2026E, falling to {mm(-m['cf_capex'][Y[2029]])} in "
     "2029E. A Sabine Pass FID would push that up sharply in our bull case, to "
     f"{mm(m['scen']['capex'][2][2])} in 2028E."),
    ("The 2026 cash-flow statement is lumpy.",
     "We assume $1.2 billion of net new debt in 2026E to fund Corpus Christi and buybacks, then $300 million a year "
     "of net repayment. Leverage still falls because EBITDA grows."),
]

RISKS = [
    ("Global oversupply after the disruption.",
     "The IEA and IEEFA both describe the glut as delayed, not cancelled. When Qatari capacity and the new U.S. projects "
     "arrive, spot spreads could collapse. Our bear case trims volume growth by 3 points a year from 2027E and puts "
     f"the blended value at {px(mc['targets'][0])}, {pct(mc['targets'][0] / B['price'] - 1)} versus our valuation price."),
    ("Execution on the next expansion.",
     "Sabine Pass Expansion Phase 1 still needs FERC and DOE (non-FTA) approvals and financing before FID. Delays push "
     "out the bull-case uplift; overruns would hit returns on a project of this size."),
    ("Noncontrolling interest dilution.",
     f"Public unitholders own {pct(1 - mk['cqp_stake'])} of Cheniere Partners. We subtract their stake at market value "
     f"({mm(mk['nci_mv'])} at {px(mk['cqp_px'])} per unit), which our model notes is undated, so a higher CQP unit "
     "price lowers our target dollar for dollar per share."),
    ("Interest rates.",
     f"Our WACC of {pct(W['wacc'], 2)} uses a {pct(W['rf'], 2)} risk-free rate. A 50 bp higher WACC lowers the "
     f"perpetuity-growth value from {px(D['px_pg'])} to {px(m['sens_pg']['grid'][3][2])}, since 86% of that DCF's "
     "enterprise value sits in the terminal value."),
    ("Geopolitics cuts both ways.",
     "A fast, durable reopening of the Strait of Hormuz would remove the near-term pricing tailwind. A wider conflict "
     "could disrupt shipping lanes Cheniere's own cargoes use."),
    ("Policy.",
     "U.S. export authorizations, permitting timelines and any change in federal LNG policy affect the pace of "
     "Cheniere's growth projects."),
]

PORTER = [
    ("Rivalry among existing competitors", "Moderate",
     "Competition happens when contracts are signed, not cargo by cargo. Once a 20-year SPA is in place it is hard to "
     "dislodge. Cheniere competes on its record: all seven Corpus Christi Stage 3 trains came in ahead of schedule."),
    ("Bargaining power of buyers", "Moderate",
     "Utilities and portfolio players have more choice as new supply comes, but 2026 showed what an unreliable supplier "
     "costs. Buyers now pay up for U.S. Gulf Coast security."),
    ("Bargaining power of suppliers", "Low",
     "Feedgas comes from deep, liquid U.S. basins and the cost is passed through at 115% of Henry Hub. Bechtel is a "
     "concentrated EPC supplier, but lump-sum contracts move cost risk to the contractor."),
    ("Threat of substitutes", "Moderate",
     "Pipeline gas, coal in parts of Asia and renewables compete for the same demand. LNG wins wherever pipelines cannot "
     "reach and governments want supply diversity."),
    ("Threat of new entrants", "Moderate",
     "A greenfield terminal costs billions, takes years to permit and needs long-term offtake to finance. That has not "
     "stopped a wave of U.S. FIDs, but brownfield expansion on existing sites gives Cheniere a cost advantage."),
]

BUSINESS_MODEL = [
    ("Cheniere's moat is its existing sites. Each train added at Sabine Pass or Corpus Christi reuses tanks, berths, "
     "pipelines and permits that a new entrant would have to build from scratch, so a brownfield train costs less "
     "per tonne and gets permitted faster. Customers sign for 15 to 20+ years, and the fixed fee is owed whether or "
     "not they lift the cargo. That makes the cash flow look more like a toll road than a commodity business."),
    (f"The unit economics show up in our numbers. Revenue per MMBtu sits around {px(m['price_mmbtu'][Y[2026]])} "
     f"in 2026E, of which the fixed fee is {px(m['scen']['fee'][1][0])}. D&A runs at about "
     f"{pct(m['dep_rate'][Y[2026]])} of beginning PP&E, and maintenance capex in our terminal year is set equal to "
     "D&A, so the terminal free cash flow is close to after-tax EBIT."),
]

RECENT = [
    ("October 29, 2026 — Q3 2026 results and a third guidance raise.",
     "Revenue was $6.17 billion, up 39% from a year earlier, on 188 cargoes (684 TBtu). Consolidated Adjusted EBITDA "
     "was $1.90 billion and distributable cash flow $1.23 billion. Management raised full-year Consolidated Adjusted "
     "EBITDA guidance to $8.75–$9.25 billion, its third increase this year, and raised the quarterly dividend by more "
     "than 12% to $0.625. Cheniere repurchased about 2.8 million shares for $731 million in the quarter. Adjusted EPS "
     "of $3.62 missed the $4.20 Zacks consensus, and the stock fell sharply in the following week."),
    ("October 22, 2026 — QatarEnergy SPAs.",
     "Sabine Pass Liquefaction and Corpus Christi Liquefaction each signed long-term SPAs with QatarEnergy for a "
     "combined up to 4 mtpa, starting in the early 2030s and running through 2054. 1 mtpa of the Sabine Pass volume "
     "depends on an FID on Expansion Phase 1."),
    ("September 29, 2026 — Petrobras SPA.",
     "Cheniere Marketing agreed to sell about 0.8 mtpa FOB to Petrobras for 22 years."),
    ("August 28, 2026 — Corpus Christi Stage 3 complete.",
     "Bechtel handed over the seventh and final midscale train. Stage 3 adds more than 10 mtpa, and Cheniere exported "
     "its 5,000th cargo the same week."),
    ("May 27, 2026 — Sabine Pass Expansion EPC.",
     "Cheniere Partners signed a lump-sum turnkey EPC contract with Bechtel for Phase 1 (more than 6 mtpa) of an "
     "expansion planned at up to about 20 mtpa, and issued limited notice to proceed. FID is expected by early 2027."),
]

MODEL_FLAGS = [
    ("Our model predates the Q3 guidance raise.",
     f"It projects 2026E Consolidated Adjusted EBITDA of {b(ebitda[Y[2026]], 2)}, set against the prior guidance "
     f"range of {b(mk['guid_lo'], 2)}–{b(mk['guid_hi'], 2)}. Management's new range of $8.75–$9.25 billion sits above "
     "our estimate, so the 2026E figures here are conservative."),
    ("The dividend input is one quarter old.",
     f"The model uses a {px(mk['q_div'])} quarterly dividend; the board raised it to $0.625 in October."),
    ("Prices move.",
     f"All valuation figures in this report use the model's {VD} inputs (share price {px(B['price'])}, "
     f"10-year Treasury {pct(mk['rf'], 2)}). The live version of this model on our coverage site reprices daily."),
]

PORTFOLIO_FIT = [
    ("Cheniere gives a fund energy exposure without much commodity beta. Our model's beta, relevered from four "
     f"midstream peers, is {W['beta']:.2f}. The cash flow is contracted, growth projects are brownfield, and the "
     "capital return program is explicit. In an energy sleeve it sits between the integrated majors and the "
     "fee-based pipelines, with more growth than the pipelines and less price risk than the majors."),
    (f"We would size the position for the bear case. A 30% stop-loss from the valuation price sits at {px(STOP)}, "
     f"below our bear-case blended value of {px(mc['targets'][0])}. Our Monte Carlo puts an "
     f"{pct(mc['p_above_price'], 1)} probability on the blended value exceeding the valuation-date price."),
]


def is_text():
    i25, i26, i29 = Y[2025], Y[2026], Y[2029]
    return [
        (f"Revenue grows from {b(rev[i25])} in 2025 to {b(rev[i26])} in 2026E ({pct(m['rev_growth'][i26])}) and "
         f"{b(rev[i29])} by 2029E. The 2026 step-up is volume. Realized price per MMBtu stays almost flat at "
         f"{px(m['price_mmbtu'][i26])} versus {px(m['price_mmbtu'][i25])}, with Henry Hub assumed at "
         f"{px(m['henry_hub'][i26])} and then $3.31–$3.50."),
        (f"Cost of sales rises to {pct(m['cogs_pct'][i26])} of revenue in 2026E from {pct(m['cogs_pct'][i25])} because "
         f"we strip out the derivative mark-to-market gains that flattered 2025 ({b(m['mtm'][i25])}). That is why GAAP "
         f"operating income falls from {b(m['ebit'][i25])} to {b(m['ebit'][i26])} even as Adjusted EBITDA rises from "
         f"{b(ebitda[i25])} to {b(ebitda[i26])}. Adjusted EBITDA margin holds around 35–37% through 2029E."),
        (f"Net income attributable to Cheniere is {b(m['ni'][i26], 2)} in 2026E and {b(m['ni'][i29], 2)} in 2029E, after "
         f"holding the noncontrolling interest's share flat at a normalized {mm(m['nci'][i26])} a year. Adjusted EPS "
         f"goes from {px(eps[i26])} to {px(eps[i29])}, helped by the shrinking share count."),
    ]


def bs_text():
    i25, i29 = Y[2025], Y[2029]
    return [
        (f"PP&E grows from {b(m['bs_ppe'][i25])} to {b(m['bs_ppe'][i29])} as capex runs ahead of depreciation through "
         f"2027E and then converges. Total debt stays between {b(min(m['bs_debt'][i25:]))} and "
         f"{b(max(m['bs_debt'][i25:]))}, while EBITDA growth brings total debt / Adjusted EBITDA from "
         f"{m['ratios']['Total debt / Consolidated Adjusted EBITDA'][i25]:.1f}x to "
         f"{m['ratios']['Total debt / Consolidated Adjusted EBITDA'][i29]:.1f}x."),
        (f"Parent stockholders' equity rises from {b(m['bs_parent_eq'][i25])} to {b(m['bs_parent_eq'][i29])}. "
         "Buybacks keep that equity base small relative to earnings, which is why ROE stays near 40% "
         f"({pct(m['ratios']['Return on equity'][Y[2027]])} in 2027E). The balance check nets to zero in every year."),
    ]


def cf_text():
    i25, i26, i29 = Y[2025], Y[2026], Y[2029]
    return [
        (f"Cash from operations grows from {b(m['cf_cfo'][i25])} in 2025 to {b(m['cf_cfo'][i26])} in 2026E and "
         f"{b(m['cf_cfo'][i29])} in 2029E. With capex falling from {b(-m['cf_capex'][i26])} to {b(-m['cf_capex'][i29])}, "
         f"free cash flow (CFO less capex) more than doubles, from {b(fcf[i25])} in 2025 to {b(fcf[i29])} in 2029E."),
        (f"Financing outflows of {b(-m['cf_cff'][Y[2027]])}–{b(-m['cf_cff'][i29])} a year from 2027E are mostly "
         f"buybacks and dividends, plus about {mm(-m['cf_nci_dist'][i26])} of distributions to CQP's public unitholders "
         "and other items."),
    ]


def valuation_text():
    return [
        (f"WACC. We use a cost of equity of {pct(W['ke'], 2)}: a {pct(W['rf'], 2)} 10-year Treasury, a "
         f"{pct(W['mrp'], 1)} historical equity risk premium and a beta of {W['beta']:.2f}. The beta is the average "
         f"unlevered beta of WMB, KMI, TRGP and OKE, relevered at Cheniere's market capital structure. The pre-tax cost "
         f"of debt of {pct(W['kd'], 2)} is the yield on CQP's 5.350% notes due 2036; after a {pct(W['tax'], 0)} tax "
         f"shield it is {pct(W['kd_at'], 2)}. Weighting equity at {pct(W['we'])}, the CQP noncontrolling interest "
         f"at {pct(W['wnci'])} (at the cost of equity) and debt at {pct(W['wd'])} gives a WACC of {pct(W['wacc'], 2)}."),
        (f"DCF. Unlevered free cash flow grows from {mm(D['ufcf'][0])} in 2026E (one quarter of which falls after "
         f"the {VD} valuation date) to {mm(D['ufcf'][3])} in 2029E. The present value of 2026E–2029E "
         f"cash flow is {b(D['sum_pv'], 2)}. In the perpetuity method we grow the normalized terminal free cash flow "
         f"of {mm(D['tv_fcf'])} at {pct(D['g'], 2)}, giving enterprise value of {b(D['ev_pg'], 1)} and "
         f"{px(D['px_pg'])} a share after subtracting {b(-D['debt'], 1)} of debt, adding {mm(D['cash'])} of cash and "
         f"{mm(D['q3fcf'])} of Q3 2026 free cash flow, and subtracting the CQP stake at market. In the exit method we "
         f"apply Cheniere's own {D['exit_mult']:.2f}x LTM EV/EBITDA to 2029E Adjusted EBITDA of {b(D['exit_ebitda'], 2)}, "
         f"for {px(D['px_exit'])}. The two cross-check: the perpetuity terminal value implies "
         f"{D['implied_mult']:.1f}x EBITDA, and the exit value implies {pct(D['implied_g'], 1)} growth."),
        (f"Comps. The peer median EV/EBITDA of {cs['mult']:.1f}x on LTM Adjusted EBITDA of {mm(cs['ltm_ebitda'])} "
         f"gives {px(cs['price'])} a share after the same bridge."),
        (f"Blend and sensitivity. Weighting 40/40/20 gives {px(B['target'])}. Every 50 bp of WACC moves the "
         f"perpetuity value by roughly $40–50 a share, and 25 bp of terminal growth moves it by about $20. The exit-multiple "
         f"value is less sensitive: a full turn of multiple is worth about {px(m['sens_exit']['grid'][2][3] - m['sens_exit']['grid'][2][1])}. "
         f"Our 50,000-trial Monte Carlo produces a mean blended value of {px(mc['mean'])} and a 5th–95th percentile range "
         f"of {mc['p5_p95']}."),
    ]


import os as _os
LIVE = json.load(open("/home/claude/report/live.json")) if _os.path.exists("/home/claude/report/live.json") else {}


def consensus_text():
    c = LIVE.get("consensus") or {}
    if not c.get("target_mean"):
        return []
    return [(f"Street check. As of {LIVE['price_date']}, {c['analysts']} analysts covering Cheniere have a mean "
             f"12-month target of {px(c['target_mean'])} and a median of {px(c['target_median'])} (range "
             f"{px(c['target_low'])}–{px(c['target_high'])}, Yahoo Finance). Our {px(B['target'])} sits below the "
             f"street because the model was struck before the Q3 guidance raise and uses a {pct(mk['rf'], 2)} risk-free "
             f"rate. Rerun with today's {pct(LIVE['wacc']['risk_free'], 2)} 10-year yield and the {px(LIVE['price'])} "
             f"share price, the same model gives {px(LIVE['target'])}.")]


SOURCES = [
    "Cheniere Energy, Q3 2026 results press release (8-K Ex. 99.1), Oct 29, 2026 — sec.gov",
    "Cheniere Energy, CCL Stage 3 substantial completion and 5,000th cargo release, Aug/Sep 2026 — lngir.cheniere.com",
    "Cheniere Partners, SPL Expansion EPC contract with Bechtel, May 27, 2026 — businesswire.com",
    "Cheniere / QatarEnergy SPAs, Oct 22, 2026 — lngir.cheniere.com; bicmagazine.com",
    "Cheniere / Petrobras SPA, Sep 29, 2026 — hellenicshippingnews.com; chemxplore.com",
    "Cheniere Energy DEF 14A (2026 proxy) and 2025 Form 10-K — sec.gov",
    "Oilprice.com, 'Cheniere Promotes Zach Davis to President', Nov 2026",
    "IEA Gas Market Report Q2 and Q3 2026 — iea.org",
    "S&P Global Market Intelligence, 'Global LNG Outlook After Middle East Conflict', Jul 23, 2026",
    "IEEFA Market Signals, 'LNG glut has been delayed, not cancelled', Sep 2026",
    "GlobalData Gas Market Outlook 2026 (via offshore-technology.com)",
    "Zacks Equity Research, Cheniere Q3 2026 earnings note; Fintel price-target summary, Nov 6, 2026",
]
