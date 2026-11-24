"""Pull every figure the report needs straight from JJ's LNG model (cached values)."""
import json, openpyxl
wb = openpyxl.load_workbook('/tmp/lngin/LNG_Final_1.xlsx', data_only=True)
def row(sheet, r, cols="CDEFGHI"):
    return [wb[sheet][f"{c}{r}"].value for c in cols]
IS, BS, CF, SC, DCF, CO, WA, SE, RB, FR, HI, MC, CV = ("LNG Income Statement","LNG Balance Sheet","LNG Cash Flow Statement",
  "LNG Schedules","LNG DCF","LNG Comps & Target Price","LNG WACC","LNG Sensitivity Analysis","LNG Revenue Build",
  "LNG Financial Ratios","LNG Historicals","LNG Monte Carlo","LNG Cover")
m = {"years": row(IS,3)}
for k, r in {"revenue":5,"rev_growth":6,"cogs":7,"om":8,"sga":9,"da":10,"other_opex":11,"total_opex":12,"ebit":13,"int_exp":16,"other_inc":17,
             "pretax":18,"tax":19,"ni_cons":20,"nci":21,"ni":22,"shares":24,"eps":25,"mtm":28,"cogs_pct":29,"tax_rate":34,"adj_ebitda":39}.items():
    m[k] = row(IS, r)
for k, r in {"cash":6,"receivables":7,"inventory":8,"oca":9,"tca":10,"ppe":11,"onca":12,"ta":13,"ap":16,"ocl":17,"tcl":18,"debt":19,"oncl":20,"tl":21,"parent_eq":24,"nci_eq":25,"te":26}.items():
    m["bs_"+k] = row(BS, r)
for k, r in {"ni":6,"da":7,"sbc":8,"cfo":16,"capex":19,"cfi":21,"debt_net":24,"div":25,"buyback":26,"nci_dist":27,"cff":28,"net_change":31,"end_cash":34}.items():
    m["cf_"+k] = row(CF, r)
m["dps"] = row(SC, 36); m["dep_rate"] = row(SC, 13); m["int_rate"] = row(SC, 23)
m["volumes"] = row(RB, 4); m["henry_hub"] = row(RB, 5); m["price_mmbtu"] = row(RB, 6)
m["ratios"] = {wb[FR][f"B{r}"].value.strip(): row(FR, r) for r in range(5, 17)}
d = wb[DCF]
m["dcf"] = {"ebiat": row(DCF,7,"FGHI"), "ufcf": row(DCF,11,"FGHI"), "pv": row(DCF,18,"FGHI"), "disc": row(DCF,17,"FGHI"),
            "period": row(DCF,16,"FGHI"), "capex": row(DCF,9,"FGHI"), "nwc": row(DCF,10,"FGHI"), "da": row(DCF,8,"FGHI"),
            "sum_pv": d["I19"].value, "g": d["D22"].value, "tv_fcf": d["D26"].value, "tv_pg": d["D27"].value, "pv_tv_pg": d["D28"].value,
            "ev_pg": d["D29"].value, "exit_mult": d["D32"].value, "exit_ebitda": d["D33"].value, "tv_exit": d["D34"].value,
            "pv_tv_exit": d["D36"].value, "ev_exit": d["D37"].value, "implied_mult": d["D39"].value, "implied_g": d["D40"].value,
            "debt": d["D44"].value, "cash": d["D45"].value, "q3fcf": d["D46"].value, "nci": d["D47"].value,
            "eq_pg": d["D48"].value, "eq_exit": d["E48"].value, "shares": d["D49"].value, "px_pg": d["D50"].value,
            "px_exit": d["E50"].value, "price": d["D51"].value, "tv_pct": d["D65"].value, "wacc": d["F14"].value}
m["sens_pg"] = {"wacc": [d[f"C{r}"].value for r in range(59,64)], "g": [d[f"{c}58"].value for c in "DEFGH"],
                "grid": [[d[f"{c}{r}"].value for c in "DEFGH"] for r in range(59,64)]}
m["sens_exit"] = {"wacc": [d[f"C{r}"].value for r in range(70,75)], "mult": [d[f"{c}69"].value for c in "DEFGH"],
                  "grid": [[d[f"{c}{r}"].value for c in "DEFGH"] for r in range(70,75)]}
w = wb[WA]
m["wacc"] = {k: w[c].value for k, c in {"rf":"D4","beta":"D14","peer_beta_avg":"D11","mrp":"D19","ke":"D20","mv_eq":"D25","debt":"D26",
             "nci_mv":"D27","we":"D29","wd":"D30","wnci":"D31","kd":"D34","tax":"D35","kd_at":"D36","wacc":"D39"}.items()}
m["peer_betas"] = [(w[f"B{r}"].value.split(":")[1].split(",")[0].strip(), w[f"D{r}"].value) for r in range(7,11)]
c = wb[CO]
m["comps"] = [{"name": c[f"B{r}"].value, "price": c[f"C{r}"].value, "mcap": c[f"D{r}"].value, "ev": c[f"E{r}"].value,
               "pe": c[f"F{r}"].value, "fpe": c[f"G{r}"].value, "ev_ebitda": c[f"H{r}"].value} for r in range(6,12)]
m["comps_avg"] = [c["F13"].value, c["G13"].value, c["H13"].value]; m["comps_med"] = [c["F14"].value, c["G14"].value, c["H14"].value]
m["comps_val"] = {k: c[x].value for k, x in {"ltm_ebitda":"D20","mult":"D22","ev":"D23","debt":"D24","cash":"D25","nci":"D26",
                  "eq":"D27","shares":"D28","price":"D29","fwd_eps":"D43","fpe":"D44","pe_price":"D45"}.items()}
m["blend"] = {"pg": (c["C35"].value, c["D35"].value), "exit": (c["C36"].value, c["D36"].value), "comps": (c["C37"].value, c["D37"].value),
              "target": c["E38"].value, "price": c["E39"].value, "upside": c["E40"].value}
s = wb[SE]
m["scen"] = {"volume": [row(SE,r,"FGHI") for r in (10,11,12)], "fee": [row(SE,r,"FGHI") for r in (16,17,18)],
             "capex": [row(SE,r,"FGHI") for r in (22,23,24)], "buyback": [row(SE,r,"FGHI") for r in (34,35,36)],
             "tg": [s[f"F{r}"].value for r in (46,47,48)], "exit": [s[f"F{r}"].value for r in (52,53,54)],
             "spl_uplift": [s[f"F{r}"].value for r in (64,65,66)], "dps_g": [s[f"F{r}"].value for r in (40,41,42)]}
mc = wb[MC]
m["mc"] = {"targets": [mc["C7"].value, mc["D7"].value, mc["E7"].value], "mean": mc["C12"].value, "median": mc["C13"].value,
           "p5_p95": mc["C14"].value, "p_above_price": mc["C15"].value, "p_above_target": mc["C16"].value}
h = wb[HI]
m["market"] = {k: h[x].value for k, x in {"price":"C86","rf":"C89","mrp":"C88","shares":"E81","diluted":"E83","debt_q2":"E75","cash_q2":"E76",
               "guid_lo":"E79","guid_hi":"E80","guid_mid":"E78","cons_rev":"E77","cqp_units":"E67","cqp_stake":"E68","cqp_px":"E70",
               "nci_mv":"E71","q_div":"E101","adj_ebitda_ttm":"E61","buyback_auth":None} .items() if x}
m["cover"] = {k: wb[CV][x].value for k, x in {"consensus":"G33","fwd_pe":"G14","ev_ebitda":"G15","mcap":"D16","ev":"G16","div_yield":"G17",
              "net_debt":"D23","nd_ebitda":"D24","val_date":"G8"}.items()}
m["cover"]["val_date"] = str(m["cover"]["val_date"])[:10]
json.dump(m, open('/home/claude/report/model.json','w'), indent=1, default=str)
print("target", m["blend"]["target"], "price", m["blend"]["price"], "keys", len(m))
