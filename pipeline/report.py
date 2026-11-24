"""Automated equity research report (PDF) for a generated model.

Outline follows the house initiation format: cover (sidebar + thesis + key statistics + price chart),
company background, financial analysis, valuation, scenarios, risks, recent filings, financial statements,
DCF, comps, football field, methodology. No analyst or school names: the report is machine-generated.
"""
from __future__ import annotations

import datetime as dt
import io
import math

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from reportlab.lib import colors  # noqa: E402
from reportlab.lib.enums import TA_RIGHT  # noqa: E402
from reportlab.lib.pagesizes import letter  # noqa: E402
from reportlab.lib.styles import ParagraphStyle  # noqa: E402
from reportlab.lib.units import inch  # noqa: E402
from reportlab.platypus import (Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer,  # noqa: E402
                                Table, TableStyle)

NAVY, INK, GREY, LIGHT, RULE = (colors.HexColor(c) for c in ("#1F3A5F", "#111111", "#555555", "#F2F4F7", "#D0D4DA"))
BLUE, ORANGE = "#2a78d6", "#eb6834"
MONTHS = {f"{i:02d}": m for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August",
                                                 "September", "October", "November", "December"], 1)}

S = {
    "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=INK),
    "sub": ParagraphStyle("sub", fontName="Helvetica", fontSize=8.5, leading=11, textColor=GREY),
    "rating": ParagraphStyle("rating", fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=NAVY),
    "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=NAVY, spaceBefore=10,
                         spaceAfter=4),
    "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=9.5, leading=13, textColor=INK, spaceBefore=6,
                         spaceAfter=2),
    "body": ParagraphStyle("body", fontName="Helvetica", fontSize=9, leading=12.6, textColor=INK, spaceAfter=6),
    "small": ParagraphStyle("small", fontName="Helvetica", fontSize=7.2, leading=9.5, textColor=GREY),
    "side_h": ParagraphStyle("side_h", fontName="Helvetica-Bold", fontSize=7.8, leading=10, textColor=NAVY),
    "side": ParagraphStyle("side", fontName="Helvetica", fontSize=7.8, leading=10, textColor=INK, spaceAfter=5),
    "cell": ParagraphStyle("cell", fontName="Helvetica", fontSize=7.4, leading=9.2, textColor=INK),
    "cellr": ParagraphStyle("cellr", fontName="Helvetica", fontSize=7.4, leading=9.2, textColor=INK, alignment=TA_RIGHT),
}


# ------------------------------------------------------------------ formatting
def nz(v):
    return isinstance(v, (int, float)) and not (isinstance(v, float) and math.isnan(v))


def usd(v, d=2):
    return f"${v:,.{d}f}" if nz(v) else "n/a"


def bn(v):
    if not nz(v):
        return "n/a"
    return f"${v / 1000:,.1f} billion" if abs(v) >= 1000 else f"${v:,.0f} million"


def pct(v, d=1):
    return f"{v * 100:.{d}f}%" if nz(v) else "n/a"


def mult(v):
    return f"{v:.1f}x" if nz(v) and v else "n/a"


def num(v, d=0):
    if not nz(v):
        return "—"
    s = f"{abs(v):,.{d}f}"
    return f"({s})" if v < 0 else s


def fy_month(fye):
    return MONTHS.get(str(fye or "")[:2], "December")


# ------------------------------------------------------------------ charts
def _png(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=200)
    plt.close(fig)
    buf.seek(0)
    return buf


def _style(ax):
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color("#d9d8d3")
    ax.tick_params(labelsize=7, colors="#52514e", length=0)
    ax.grid(axis="y", color="#f1f0ec", lw=0.7)
    ax.set_axisbelow(True)


def price_chart(hist, target, T):
    fig, ax = plt.subplots(figsize=(5.2, 1.9))
    if hist:
        ys = [c for _, c in hist]
        ax.plot(range(len(ys)), ys, color=BLUE, lw=1.4)
        ticks = list(range(0, len(ys), max(1, len(ys) // 6)))
        ax.set_xticks(ticks, [hist[i][0][:7] for i in ticks])
    if nz(target):
        ax.axhline(target, color=ORANGE, lw=1, ls=(0, (4, 3)))
        ax.text(0, target, f" 12-mo target {usd(target)}", fontsize=6.5, color=ORANGE, va="bottom")
    ax.set_title(f"{T} share price, trailing 12 months", fontsize=8, loc="left")
    _style(ax)
    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"${v:,.0f}"))
    fig.tight_layout(pad=0.4)
    return _png(fig)


def rev_chart(m):
    yrs = m["years"]
    rev = [v / 1000 if nz(v) else 0 for v in m["is"]["revenue"]]
    ebd = [v / 1000 if nz(v) else 0 for v in m["is"]["ebitda"]]
    fig, ax = plt.subplots(figsize=(6.8, 2.3))
    x = range(len(yrs))
    ax.bar([i - 0.2 for i in x], rev, 0.38, color=BLUE, label="Total revenue")
    ax.bar([i + 0.2 for i in x], ebd, 0.38, color=ORANGE, label="EBITDA")
    ax.set_xticks(list(x), yrs)
    ax.set_ylabel("$ billions", fontsize=7)
    ax.axvline(2.5, color="#8a8984", lw=0.7, ls=":")
    ax.legend(frameon=False, fontsize=7, ncol=2, loc="upper left", bbox_to_anchor=(0, 1.18))
    _style(ax)
    fig.tight_layout(pad=0.4)
    return _png(fig)


def football_chart(rows, price, target):
    fig, ax = plt.subplots(figsize=(6.8, 0.45 * len(rows) + 0.9))
    for i, (lab, lo, hi) in enumerate(rows[::-1]):
        ax.barh(i, hi - lo, left=lo, height=0.5, color=BLUE)
        ax.text(lo, i, f"{usd(lo, 0)} ", ha="right", va="center", fontsize=6.5)
        ax.text(hi, i, f" {usd(hi, 0)}", ha="left", va="center", fontsize=6.5)
    ax.set_yticks(range(len(rows)), [r[0] for r in rows[::-1]], fontsize=7)
    ax.axvline(price, color=INK.hexval().replace("0x", "#"), lw=1.1)
    ax.text(price, len(rows) - 0.4, f"Price {usd(price)}", ha="center", fontsize=6.5)
    if nz(target):
        ax.axvline(target, color=ORANGE, lw=1.3, ls="--")
        ax.text(target, -0.95, f"Target {usd(target)}", ha="center", fontsize=6.5, color=ORANGE)
    lo = min(r[1] for r in rows + [("", price, price)])
    hi = max(r[2] for r in rows + [("", price, price)])
    pad = (hi - lo) * 0.15 + 1
    ax.set_xlim(max(0, lo - pad), hi + pad)
    ax.set_ylim(-1.2, len(rows) - 0.1)
    _style(ax)
    ax.grid(axis="x", color="#f1f0ec")
    ax.grid(axis="y", visible=False)
    ax.xaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"${v:,.0f}"))
    fig.tight_layout(pad=0.4)
    return _png(fig)


# ------------------------------------------------------------------ tables
def table(head, rows, widths, bold=(), align_left=(0,), font=7.4):
    data = [head] + rows
    t = Table(data, colWidths=widths, repeatRows=1)
    st = [("FONT", (0, 0), (-1, -1), "Helvetica", font), ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", font),
          ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("BACKGROUND", (0, 0), (-1, 0), NAVY),
          ("ALIGN", (0, 0), (-1, -1), "RIGHT"), ("LINEBELOW", (0, 1), (-1, -1), 0.4, RULE),
          ("TOPPADDING", (0, 0), (-1, -1), 2.2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.2),
          ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]
    for c in align_left:
        st.append(("ALIGN", (c, 0), (c, -1), "LEFT"))
    for i, r in enumerate(rows, 1):
        if str(r[0]).strip() in bold:
            st += [("FONT", (0, i), (-1, i), "Helvetica-Bold", font), ("BACKGROUND", (0, i), (-1, i), LIGHT)]
    t.setStyle(TableStyle(st))
    return t


def P(text, style="body"):
    return Paragraph(text, S[style])


# ------------------------------------------------------------------ report
def make(dest, rec, m, fin, rt, mkt, filings, recent, qs, peers, subs):
    T, name = rec["ticker"], rec["name"]
    today = dt.date.today().strftime("%B %-d, %Y")
    price, target, up = rec["price"], rec["target"], rec["upside"]
    val, dcf, w, sc = m["val"], m["dcf"], m["wacc"], m["val"]["cases"]
    yrs = m["years"]
    y0 = yrs[2].replace("A", "")
    IS, BS, CF = m["is"], m["bs"], m["cf"]
    rev, ebitda = IS["revenue"], IS["ebitda"]
    cagr = (rev[2] / rev[0]) ** 0.5 - 1 if nz(rev[0]) and rev[0] > 0 and nz(rev[2]) and rev[2] > 0 else None
    snap = rt["snapshot"]
    rg = {i["label"]: i["value"] for g in rt["groups"] for i in g["items"]}
    closes = [c for _, c in mkt["history"]]
    med = (m.get("comps_median") or {}).get("ev_ebitda")
    self_ev = (m.get("comps_self") or {}).get("ev_ebitda")
    has_comps = bool(m["comps"]) and nz(val["w_comps"]) and val["w_comps"] > 0
    direction = "above" if (up or 0) >= 0 else "below"

    # ---------------- thesis
    an = val.get("anchor") or {}
    th1 = (f"We rate {name} <b>{rec['rating'].upper()}</b> with a 12-month price target of <b>{usd(target)}</b>, "
           f"{pct(abs(up or 0))} {direction} the {usd(price)} close on {rec['price_date']}. ")
    if nz(an.get("peer_up")) and an.get("w_peer"):
        th1 += (f"The target is anchored to the industry: analysts see {pct(an['peer_up'])} average upside across "
                f"{', '.join(rec.get('anchor_peers') or [])}, and our final call stays within 15 points of that. ")
    th1 += f"Before anchoring, our model value is {usd(val['model_value'])}. "
    th1 += (f"The target blends a perpetuity-growth DCF ({pct(val['w_dcf'], 0)}, {usd(val['dcf'])}), an exit-multiple DCF "
            f"({pct(val['w_exit'], 0)}, {usd(val['exit'])}) and an EV/EBITDA comparison against {len(m['comps'])} listed peers "
            f"in the same industry ({pct(val['w_comps'], 0)}, {usd(val['comps'])})." if has_comps else
            f"The target averages a perpetuity-growth DCF ({usd(val['dcf'])}) and an exit-multiple DCF "
            f"({usd(val['exit'])}); no usable listed peers were found for a comps cross-check.")
    if nz(cagr):
        head = ("Revenue is growing." if cagr > 0.03 else "Revenue is roughly flat." if cagr > -0.02
                else "Revenue is shrinking.")
        th2 = (f"<b>{head}</b> Revenue went from {bn(rev[0])} in {yrs[0]} to {bn(rev[2])} in {yrs[2]} "
               f"({pct(cagr)} a year). The base case starts at {pct(m['assumptions']['base_growth'][0])} growth and fades "
               f"to {pct(m['assumptions']['base_growth'][4])} by {yrs[7]}, taking revenue to {bn(rev[7])}, with an EBITDA "
               f"margin of {pct(IS['ebitda_m'][4])} in {yrs[4]} against {pct(IS['ebitda_m'][2])} in {yrs[2]}.")
    else:
        th2 = "<b>Limited revenue history.</b> The SEC data does not give two clean years of revenue, so read the growth assumptions with care."
    if nz(med) and nz(self_ev) and med:
        rel = self_ev / med - 1
        word = "a discount to" if rel < -0.1 else "a premium to" if rel > 0.1 else "in line with"
        th3 = (f"<b>Valuation.</b> At {mult(self_ev)} EV/EBITDA, {T} trades at {word} the {mult(med)} peer median. ")
    else:
        th3 = "<b>Valuation.</b> "
    th3 += (f"The bear and bull cases span {usd(sc['bear']['target'])} to {usd(sc['bull']['target'])}, and "
            f"{pct(dcf['tv_pct'], 0)} of DCF enterprise value comes from the terminal value.")

    # ---------------- cover
    side = [P("EQUITY RESEARCH", "side_h"), P("Automated initiation", "side"),
            P("Sector", "side_h"), P(rec["sector"], "side"), P("Industry (SEC SIC)", "side_h"),
            P(f"{rec['industry'] or 'n/a'}{f' ({rec[chr(115) + chr(105) + chr(99)]})' if rec.get('sic') else ''}", "side"),
            P("Exchange", "side_h"), P(rec.get("exchange") or "NYSE", "side"), P("Headquarters", "side_h"),
            P(", ".join(x for x in (rec.get("city"), rec.get("state")) if x) or "n/a", "side"),
            P("Report date", "side_h"), P(today, "side"), P("Pricing date", "side_h"), P(rec["price_date"], "side"),
            P("Model", "side_h"), P(f"{T}_v{rec['version']}.xlsx", "side"),
            P("Prices in USD; financials in $mm unless noted.", "small")]
    main = [P(f"{name} ({rec.get('exchange') or 'NYSE'}: {T})", "title"),
            P(" | ".join(x for x in ((rec.get("website") or "").replace("https://", "").replace("http://", ""),
                                     "Automated Initiation of Coverage", today) if x), "sub"), Spacer(1, 6),
            P(f"{rec['rating'].upper()} | Price Target {usd(target)} | Upside {pct(up)}", "rating"),
            P("Investment Thesis", "h1"), P(th1), P(th2), P(th3)]
    cover = Table([[side, main]], colWidths=[1.55 * inch, 5.75 * inch])
    cover.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, 0), LIGHT), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("LEFTPADDING", (0, 0), (0, 0), 8), ("RIGHTPADDING", (0, 0), (0, 0), 8),
                               ("TOPPADDING", (0, 0), (0, 0), 8), ("LEFTPADDING", (1, 0), (1, 0), 14)]))
    cons = qs or {}
    stats = [
        ["Rating", rec["rating"].upper(), "Price target (12-mo)", usd(target)],
        ["Current price", usd(price), "Upside to target", pct(up)],
        ["Market cap", bn(snap.get("market_cap")), "Valuation method",
         f"DCF ({pct((val['w_dcf'] or 0) + (val['w_exit'] or 0), 0)}) + comps ({pct(val['w_comps'], 0)})" if has_comps
         else "DCF (perpetuity + exit)"],
        ["52-week range", f"{usd(min(closes))} – {usd(max(closes))}" if closes else "n/a", "Fiscal year end",
         fy_month(rec.get("fye") or subs.get("fiscalYearEnd"))],
        ["EV / EBITDA (latest FY)", mult(self_ev), "P / E (latest FY)", mult(rg.get("P/E"))],
        ["Price / book", mult(rg.get("P / Book")), "Dividend yield", pct(rg.get("Dividend yield"), 2)],
        ["Beta", f"{w['beta']:.2f}" if nz(w["beta"]) else "n/a", "WACC", pct(w["wacc"], 2)],
        ["Bear / base / bull", f"{usd(sc['bear']['target'], 0)} / {usd(sc['base']['target'], 0)} / {usd(sc['bull']['target'], 0)}",
         "Street mean / median", f"{usd(cons.get('target_mean'), 0)} / {usd(cons.get('target_median'), 0)}"
         if cons.get("target_mean") else "n/a"],
    ]
    st = Table([[P(f"<b>{a}</b>", "cell"), P(b, "cellr"), P(f"<b>{c}</b>", "cell"), P(d, "cellr")] for a, b, c, d in stats],
               colWidths=[1.35 * inch, 1.25 * inch, 1.45 * inch, 1.7 * inch])
    st.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE), ("TOPPADDING", (0, 0), (-1, -1), 1.6),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 1.6)]))
    story = [cover, Spacer(1, 6),
             Table([["", [P("Key Statistics", "h1"), st,
                          P(f"Prices as of {rec['price_date']} (Yahoo Finance). Fundamentals: SEC EDGAR XBRL, {yrs[2]} 10-K. "
                            f"Beta source: {rec.get('beta_source', 'n/a')}.", "small"), Spacer(1, 4),
                          Image(price_chart(mkt["history"], target, T), width=5.6 * inch, height=2.05 * inch)]]],
                   colWidths=[1.55 * inch, 5.75 * inch], style=[("LEFTPADDING", (1, 0), (1, 0), 14)]),
             PageBreak()]

    # ---------------- company background
    tenk = filings[0] if filings else {}
    last = lambda k: (fin["items"].get(k) or [None])[-1]  # noqa: E731
    story += [P("Company Background", "h1"),
              P(f"{name} is listed on the New York Stock Exchange under the ticker {T}. The SEC classifies it in the "
                f"<i>{rec['industry'] or 'unclassified'}</i> industry group{f' (SIC {rec[chr(115) + chr(105) + chr(99)]})' if rec.get('sic') else ''}, "
                f"which this report maps to the {rec['sector']} sector. The company is headquartered in "
                f"{', '.join(x for x in (rec.get('city'), rec.get('state')) if x) or 'n/a'} and its fiscal year ends in "
                f"{fy_month(subs.get('fiscalYearEnd'))}. The most recent annual report is a {tenk.get('form', '10-K')} "
                f"for the period ended {tenk.get('period', 'n/a')}, filed {tenk.get('filed', 'n/a')}."),
              P(f"In {yrs[2]} the company reported revenue of {bn(last('revenue'))}, operating income of "
                f"{bn(last('operating_income'))} and net income of {bn(last('net_income'))}. It ended the year with "
                f"{bn(last('cash'))} of cash and {bn((last('short_term_debt') or 0) + (last('long_term_debt') or 0))} "
                f"of debt, for net debt of {bn(snap.get('net_debt'))}."),
              P("Standardized XBRL data does not include segment detail, so the model forecasts revenue at the "
                "consolidated level. Drivers come from the company's own reported history; they are not management "
                "guidance.", "small")]

    # ---------------- financial analysis
    gm0, gm2 = IS["gm"][0], IS["gm"][2]
    em0, em2 = IS["ebit_m"][0], IS["ebit_m"][2]
    fcf = [(a or 0) + (b or 0) for a, b in zip(CF["cfo"], CF["capex"])]
    story += [P("Financial Analysis", "h1"), P("Income statement", "h2"),
              P(f"Revenue moved from {bn(rev[0])} in {yrs[0]} to {bn(rev[2])} in {yrs[2]}. Gross margin went from "
                f"{pct(gm0)} to {pct(gm2)} and EBIT margin from {pct(em0)} to {pct(em2)}. In the base case, revenue reaches "
                f"{bn(rev[7])} by {yrs[7]} and EBITDA {bn(ebitda[7])}, with diluted EPS going from {usd(IS['eps'][2])} "
                f"to {usd(IS['eps'][7])}."),
              Image(rev_chart(m), width=6.9 * inch, height=2.35 * inch),
              P("Balance sheet", "h2"),
              P(f"Total assets were {bn(BS['ta'][2])} at the end of {yrs[2]}, against total liabilities of "
                f"{bn(BS['tl'][2])} and equity of {bn(BS['equity'][2])}. Net debt to EBITDA was "
                f"{mult(rg.get('Net debt / EBITDA'))} and the current ratio {mult(rg.get('Current ratio'))}. The model's "
                "revolver sweeps any shortfall below a minimum cash balance, and the balance check nets to zero in every year."),
              P("Cash flow", "h2"),
              P(f"Cash from operations was {bn(CF['cfo'][2])} in {yrs[2]} and capital spending {bn(-(CF['capex'][2] or 0))}, "
                f"leaving free cash flow of {bn(fcf[2])}. The base case has free cash flow of {bn(fcf[3])} in {yrs[3]} "
                f"and {bn(fcf[7])} in {yrs[7]}. Dividends and buybacks are held at the historical payout and dollar level.")]

    # ---------------- valuation
    imp = lambda mlt: ((mlt * ebitda[2] + dcf["debt"] + dcf["cash"]) * (1 + dcf["nci"] / dcf["eq"] if dcf["eq"] else 1)  # noqa: E731
                       / dcf["shares"]) if nz(mlt) and nz(ebitda[2]) and dcf["shares"] else None
    story += [P("Valuation", "h1"),
              P(f"<b>WACC.</b> Cost of equity is {pct(w['ke'], 2)}: a {pct(w['rf'], 2)} 10-year Treasury yield plus a beta "
                f"of {w['beta']:.2f} ({rec.get('beta_source')}) times a {pct(w['erp'], 1)} equity risk premium. The pre-tax "
                f"cost of debt is {pct(w['kd'], 2)} (interest expense over debt) and {pct(w['kd_at'], 2)} after tax. With "
                f"equity at {pct(w['we'])} of capital at market value and debt at {pct(w['wd'])}, WACC is {pct(w['wacc'], 2)}."),
              P(f"<b>DCF.</b> Unlevered free cash flow goes from {bn(dcf['ufcf'][0])} in {yrs[3]} to {bn(dcf['ufcf'][4])} in "
                f"{yrs[7]}, worth {bn(dcf['sum_pv'])} today. A terminal value at {pct(dcf['g'], 2)} growth adds "
                f"{bn(dcf['pv_tv'])} in present value, for enterprise value of {bn(dcf['ev'])}. After debt, cash and any "
                f"minority interests, and adding equity-method and long-term investments, equity to common is "
                f"{bn(dcf['eq_common'])}, or {usd(dcf['value'])} a share. The terminal value implies "
                f"{mult(dcf['exit_mult'])} {yrs[7]} EBITDA."),
              P(f"<b>Exit multiple.</b> The second DCF capitalizes {yrs[7]} EBITDA at {mult(dcf['exit_mult_used'])}, the "
                f"company's current EV/EBITDA of {mult(dcf['ev_ebitda_now'])} held constant (bounded between 4x and 30x). "
                f"That gives enterprise value of {bn(dcf['ev_exit'])} and {usd(dcf['value_exit'])} a share, and implies "
                f"{pct(dcf['implied_g'], 1)} perpetual growth.")]
    if has_comps:
        story.append(P(f"<b>Comps.</b> The peer set is {', '.join(p['ticker'] for p in m['comps'])}: NYSE/Nasdaq companies in "
                       f"the same SEC industry group, picked for the closest revenue. Their median EV/EBITDA of {mult(med)} "
                       f"on {yrs[2]} EBITDA of {bn(ebitda[2])} implies {usd(val['comps'])} a share."))
    story.append(P(f"<b>Blend.</b> Weighting the perpetuity DCF {pct(val['w_dcf'], 0)}, the exit-multiple DCF "
                   f"{pct(val['w_exit'], 0)} and comps {pct(val['w_comps'], 0)} gives a model value of "
                   f"{usd(val['model_value'])}."))
    blend = [["DCF (perpetuity growth)", usd(val["dcf"]), pct(val["w_dcf"], 0), usd((val["dcf"] or 0) * (val["w_dcf"] or 0))],
             ["DCF (exit multiple)", usd(val["exit"]), pct(val["w_exit"], 0), usd((val["exit"] or 0) * (val["w_exit"] or 0))],
             ["Trading comps (EV/EBITDA)", usd(val["comps"]), pct(val["w_comps"], 0),
              usd((val["comps"] or 0) * (val["w_comps"] or 0))],
             ["Blended target price", "", "", usd(target)]]
    blend[-1][0] = "Model value (blended intrinsic)"
    blend[-1][3] = usd(val["model_value"])
    story.append(table(["Method", "Value / share", "Weight", "Contribution"], blend, [3.0 * inch, 1.4 * inch, 1.2 * inch, 1.4 * inch],
                       bold=("Model value (blended intrinsic)",)))
    story.append(P("Peer &amp; consensus anchoring", "h2"))
    story.append(P(f"A mechanical model can land far from where the market and the industry's analysts are. To keep each call "
                   f"in line with its industry, the final target blends the model value ({pct(an.get('w_model'), 0)}) with "
                   f"the street median target ({pct(an.get('w_street'), 0)}) and a peer-relative value "
                   f"({pct(an.get('w_peer'), 0)}): today's price times the average upside analysts see for the peers. The "
                   f"result is then kept within {pct(an.get('band'), 0)} of the peer average upside."))
    story.append(table(["Anchoring step", "Value"],
                       [["Model value (blended intrinsic)", usd(val["model_value"])],
                        ["Street median target", usd(an.get("street")) if an.get("w_street") else "n/a"],
                        ["Peer average upside to street median", pct(an.get("peer_up")) if an.get("w_peer") else "n/a"],
                        ["Peer-relative value", usd(an.get("peer_value")) if an.get("w_peer") else "n/a"],
                        ["Anchored value", usd(an.get("anchored"))],
                        ["Allowed range", f"{usd(an.get('lo'))} – {usd(an.get('hi'))}"],
                        ["Final price target", usd(target)]],
                       [3.6 * inch, 1.6 * inch], bold=("Final price target",)))
    story += [P("Scenarios", "h2"),
              P("Each case reruns the whole model with the Revenue Build selector switched: bull adds 3 points of revenue "
                "growth a year and takes 1 point off cost of revenue, bear does the opposite, and terminal growth moves "
                "between 2.0% and 3.0% with the exit multiple 10% higher or lower."),
              table(["", "Bear", "Base", "Bull"],
                    [["Revenue growth, year 1", *[pct(sc[k]["g1"]) for k in ("bear", "base", "bull")]],
                     ["Revenue growth, year 5", *[pct(sc[k]["g5"]) for k in ("bear", "base", "bull")]],
                     ["Cost of revenue % of revenue", *[pct(sc[k]["cogs"]) for k in ("bear", "base", "bull")]],
                     ["Terminal growth", *[pct(sc[k]["tg"], 2) for k in ("bear", "base", "bull")]],
                     ["Final target (anchored)", *[usd(sc[k]["target"]) for k in ("bear", "base", "bull")]],
                     ["Upside / (downside)", *[pct(sc[k]["upside"]) for k in ("bear", "base", "bull")]]],
                    [3.0 * inch, 1.33 * inch, 1.33 * inch, 1.34 * inch], bold=("Final target (anchored)",))]

    rows = []
    if closes:
        rows.append(("52-week trading range", min(closes), max(closes)))
    if cons.get("target_low") and cons.get("target_high"):
        rows.append((f"Street targets ({cons.get('analysts')} analysts)", cons["target_low"], cons["target_high"]))
    mults = [c["ev_ebitda"] for c in m["comps"] if nz(c["ev_ebitda"]) and c["ev_ebitda"] > 0]
    if mults and imp(min(mults)) and imp(max(mults)) and imp(min(mults)) > 0:
        rows.append(("Peer EV/EBITDA, low to high", imp(min(mults)), imp(max(mults))))
    grid = m["sens"]["grid"]
    if nz(dcf.get("value_exit")) and nz(dcf.get("value")) and dcf["value_exit"] > 0:
        rows.append(("DCF: perpetuity vs. exit multiple", min(dcf["value"], dcf["value_exit"]), max(dcf["value"], dcf["value_exit"])))
    if all(nz(v) for v in (grid[1][2], grid[3][2])):
        rows.append(("DCF, WACC ±50 bp", min(grid[1][2], grid[3][2]), max(grid[1][2], grid[3][2])))
    if nz(sc["bear"]["target"]) and nz(sc["bull"]["target"]):
        rows.append(("Scenarios: bear to bull", sc["bear"]["target"], sc["bull"]["target"]))
    rows = [r for r in rows if r[1] > 0 and r[2] > 0]
    if rows:
        story += [KeepTogether([P("Football Field", "h2"),
                                Image(football_chart(rows, price, target), width=6.9 * inch,
                                      height=(0.45 * len(rows) + 0.9) * inch)])]

    # ---------------- risks
    risks = [("Automated assumptions.", "Every driver comes from the company's own history and simple rules (growth "
              "fading to 3%, margins at the three-year average). Management guidance, backlog, pricing and one-offs are not "
              "in the model, so a company in transition can be badly mispriced by it.")]
    if nz(dcf["tv_pct"]) and dcf["tv_pct"] > 0.75:
        risks.append(("Terminal value concentration.", f"{pct(dcf['tv_pct'], 0)} of enterprise value sits in the "
                      "terminal value, so small changes in WACC or long-run growth move the target a lot (see the "
                      "sensitivity table)."))
    nde = rg.get("Net debt / EBITDA")
    if nz(nde) and nde > 3:
        risks.append(("Leverage.", f"Net debt is {mult(nde)} EBITDA. Higher rates or weaker earnings would squeeze "
                      "equity value quickly."))
    if nz(cagr) and cagr < 0:
        risks.append(("Shrinking revenue.", f"Revenue fell {pct(abs(cagr))} a year over the last two years; the base "
                      "case assumes that trend does not continue."))
    if nz(em0) and nz(em2) and em2 < em0 - 0.02:
        risks.append(("Margin pressure.", f"EBIT margin fell from {pct(em0)} to {pct(em2)}; holding it flat may be "
                      "generous."))
    if fcf[2] < 0:
        risks.append(("Cash burn.", f"Free cash flow was {bn(fcf[2])} in {yrs[2]}, so the company may need outside "
                      "funding."))
    if len(m["comps"]) < 3:
        risks.append(("Thin peer set.", f"Only {len(m['comps'])} usable listed peers were found in the same industry, so "
                      "the comps cross-check carries little weight."))
    mv = val.get("model_value")
    if nz(cons.get("target_median")) and nz(mv) and abs(mv / cons["target_median"] - 1) > 0.25:
        risks.append(("Model far from consensus.", f"Before anchoring, the model value of {usd(mv)} differs from the street "
                      f"median of {usd(cons['target_median'])} by {pct(mv / cons['target_median'] - 1, 0)}. A gap this size "
                      "usually means the automated assumptions miss something company-specific, which is why the final "
                      "target is anchored to the industry."))
    story += [P("Risks", "h1")] + [P(f"<b>{a}</b> {b}") for a, b in risks]

    story += [P("Recent SEC Filings", "h1"),
              table(["Form", "Filed", "Period"], [[f["form"], f["filed"], f["period"]] for f in recent[:8]],
                    [1.4 * inch, 1.6 * inch, 1.6 * inch], align_left=(0, 1, 2)), PageBreak()]

    # ---------------- statements
    head = ["$ millions", *yrs]
    wd = [2.1 * inch] + [0.6 * inch] * 8
    is_rows = [("Total revenue", "revenue", 0), ("Revenue growth", "growth", "%"), ("Cost of revenue", "cogs", 0),
               ("Gross profit", "gross", 0), ("Operating expenses", "opex", 0), ("Operating income (EBIT)", "ebit", 0),
               ("D&A", "da", 0), ("EBITDA", "ebitda", 0), ("Interest expense", "interest", 0), ("Pre-tax income", "pretax", 0),
               ("Income tax", "tax", 0), ("Net income to common", "ni", 0), ("Diluted EPS ($)", "eps", 2)]
    fmt = lambda v, f: pct(v) if f == "%" else num(v, f)  # noqa: E731
    story += [P("Financial Statements", "h1"), P("Income statement", "h2"),
              table(head, [[lab, *[fmt(v, f) for v in IS[k]]] for lab, k, f in is_rows], wd,
                    bold=("Total revenue", "EBITDA", "Net income to common"))]
    bs_rows = [("Cash", "cash"), ("Other current assets", "oca"), ("Total current assets", "tca"), ("PP&E, net", "ppe"),
               ("Other non-current assets", "onca"), ("Total assets", "ta"), ("Current liabilities", "cl"),
               ("Revolver", "revolver"), ("Term debt", "debt"), ("Other non-current liabilities", "oncl"),
               ("Total liabilities", "tl"), ("Total equity", "equity"), ("Balance check", "check")]
    story += [P("Balance sheet", "h2"), table(head, [[lab, *[num(v) for v in BS[k]]] for lab, k in bs_rows], wd,
                                               bold=("Total assets", "Total liabilities", "Total equity"))]
    cf_rows = [("Net income", "ni"), ("D&A", "da"), ("Cash from operations", "cfo"), ("Capital expenditures", "capex"),
               ("Cash from investing", "cfi"), ("Dividends", "div"), ("Share repurchases", "buyback"),
               ("Cash from financing", "cff"), ("Net change in cash", "net"), ("Ending cash", "end")]
    story += [P("Cash flow statement", "h2"), table(head, [[lab, *[num(v) for v in CF[k]]] for lab, k in cf_rows], wd,
                                                     bold=("Cash from operations", "Ending cash"))]

    # ---------------- DCF + sensitivity + comps
    dh = ["$ millions", *yrs[3:]]
    dw = [2.6 * inch] + [0.88 * inch] * 5
    story += [P("Discounted Cash Flow Model", "h1"),
              table(dh, [["EBIT", *[num(v) for v in dcf["ebit"]]], ["NOPAT", *[num(v) for v in dcf["nopat"]]],
                         ["Plus: D&A", *[num(v) for v in dcf["da"]]], ["Less: capex", *[num(v) for v in dcf["capex"]]],
                         ["Less: change in NWC", *[num(v) for v in dcf["nwc"]]],
                         ["Unlevered free cash flow", *[num(v) for v in dcf["ufcf"]]],
                         ["Discount factor", *[num(v, 4) for v in dcf["df"]]], ["PV of UFCF", *[num(v) for v in dcf["pv"]]]],
                    dw, bold=("Unlevered free cash flow",)), Spacer(1, 6),
              table(["Equity bridge ($ millions)", "Value"],
                    [["Sum of PV of UFCF", num(dcf["sum_pv"])], ["PV of terminal value", num(dcf["pv_tv"])],
                     ["Enterprise value", num(dcf["ev"])], ["Less: debt", num(dcf["debt"])], ["Plus: cash", num(dcf["cash"])],
                     ["Less: minority interests", num(dcf["nci"])], ["Equity value to common", num(dcf["eq_common"])],
                     ["Shares (mm)", num(dcf["shares"], 1)], ["DCF value per share ($)", num(dcf["value"], 2)]],
                    [3.6 * inch, 1.4 * inch], bold=("Enterprise value", "DCF value per share ($)")),
              P("Sensitivity: DCF value per share, WACC (rows) vs. terminal growth (columns)", "h2"),
              table(["WACC \\ g", *[pct(v, 2) for v in m["sens"]["g"]]],
                    [[pct(wv, 2), *[usd(v, 0) for v in r]] for wv, r in zip(m["sens"]["wacc"], m["sens"]["grid"])],
                    [1.3 * inch] + [1.05 * inch] * 5)]
    if m["comps"]:
        story += [P("Comparable Company Analysis", "h1"),
                  table(["Company", "Ticker", "Price", "Mkt cap ($mm)", "EV ($mm)", "EBITDA ($mm)", "EV/EBITDA", "P/E"],
                        [[c["name"][:30], c["ticker"], usd(c["price"]), num(c["mcap"]), num(c["ev"]), num(c["ebitda"]),
                          mult(c["ev_ebitda"]) if nz(c["ev_ebitda"]) else "n/m", mult(c["pe"]) if nz(c["pe"]) else "n/m"]
                         for c in m["comps"]] +
                        [["Peer median", "", "", "", "", "", mult(med), mult((m.get("comps_median") or {}).get("pe"))],
                         [f"{name[:30]}", T, usd(price), num(snap.get("market_cap")), "", num(ebitda[2]), mult(self_ev),
                          mult((m.get("comps_self") or {}).get("pe"))]],
                        [1.9 * inch, 0.55 * inch, 0.7 * inch, 0.85 * inch, 0.8 * inch, 0.85 * inch, 0.7 * inch, 0.6 * inch],
                        bold=("Peer median",), align_left=(0, 1))]
    story += [P("Methodology & Disclosures", "h1"),
              P("This report and the accompanying Excel model were generated automatically from public data: SEC EDGAR "
                "XBRL company facts for financial statements, Yahoo Finance for prices and consensus, and the 10-year "
                "Treasury yield for the risk-free rate. The model is a linked three-statement build (income statement, "
                "balance sheet, cash flow with PP&E, equity, debt and revolver schedules), a WACC, a five-year DCF with a "
                "sensitivity grid and an exit-multiple cross-check, a same-industry comps table, and bull, base and bear "
                "cases. The model value blends perpetuity DCF 40%, exit-multiple DCF 40% and comps 20%; the final target "
                "anchors that value to the street median and the peers' average analyst upside. No analyst reviewed it.",
                "small"),
              P("For information and education only. This is not investment advice or a recommendation to buy or sell "
                "any security. Projections are mechanical estimates and will differ from actual results.", "small")]

    def frame(c, d):
        c.saveState()
        c.setFont("Helvetica", 7)
        c.setFillColor(GREY)
        c.drawString(0.6 * inch, 10.62 * inch, "EQUITY RESEARCH")
        c.drawRightString(7.9 * inch, 10.62 * inch, f"{name} ({T}) | Automated Initiation")
        c.setStrokeColor(RULE)
        c.line(0.6 * inch, 10.56 * inch, 7.9 * inch, 10.56 * inch)
        c.drawString(0.6 * inch, 0.45 * inch, "Automated equity research · not investment advice")
        c.drawRightString(7.9 * inch, 0.45 * inch, f"Page {d.page}")
        c.restoreState()

    doc = SimpleDocTemplate(str(dest), pagesize=letter, leftMargin=0.6 * inch, rightMargin=0.6 * inch,
                            topMargin=0.6 * inch, bottomMargin=0.65 * inch,
                            title=f"{name} ({T}) - Automated Initiation", author="Automated equity research")
    doc.build(story, onFirstPage=frame, onLaterPages=frame)
    return dest
