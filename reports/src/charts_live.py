import json, os, statistics as st
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
m = json.load(open('/home/claude/report/model.json'))
live = json.load(open('/home/claude/report/live.json')) if os.path.exists('/home/claude/report/live.json') else {}
OUT = '/home/claude/report/charts/'
BLUE, ORANGE, INK, GREY = "#2a78d6", "#eb6834", "#0b0b0b", "#8a8984"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.edgecolor": "#e7e6e2", "xtick.color": "#52514e", "ytick.color": "#52514e"})
B, cs = m["blend"], m["comps_val"]
bridge = lambda mult: (mult * cs["ltm_ebitda"] + cs["debt"] + cs["cash"] + cs["nci"]) / cs["shares"]
peer_mults = sorted(c["ev_ebitda"] for c in m["comps"][:5])
q = lambda p: peer_mults[0] + (peer_mults[-1] - peer_mults[0]) * 0 if False else st.quantiles(peer_mults, n=4)
q1, _, q3 = st.quantiles(peer_mults, n=4, method="inclusive")
pg, ex = m["sens_pg"]["grid"], m["sens_exit"]["grid"]
rows = []
hist = live.get("price_history") or []
if hist:
    closes = [c for _, c in hist]
    rows.append(("52-week trading range", min(closes), max(closes), None))
cons = live.get("consensus") or {}
if cons.get("target_low") and cons.get("target_high"):
    rows.append((f"Street targets ({cons.get('analysts')} analysts)", cons["target_low"], cons["target_high"], cons.get("target_median")))
rows += [
    ("Trading comps, EV/EBITDA 25th–75th pct", bridge(q1), bridge(q3), cs["price"]),
    ("DCF perpetuity, WACC ±50 bp", min(pg[1][2], pg[3][2]), max(pg[1][2], pg[3][2]), m["dcf"]["px_pg"]),
    ("DCF exit multiple, ±1.0x", min(ex[2][1], ex[2][3]), max(ex[2][1], ex[2][3]), m["dcf"]["px_exit"]),
    ("Monte Carlo, 5th–95th percentile", *[float(x.strip().replace("$", "")) for x in m["mc"]["p5_p95"].split("-")], m["mc"]["mean"]),
    ("Scenarios: bear → bull", m["mc"]["targets"][0], m["mc"]["targets"][2], m["mc"]["targets"][1]),
]
fig, ax = plt.subplots(figsize=(6.6, 2.9))
for i, (lab, lo, hi, mid) in enumerate(rows[::-1]):
    ax.barh(i, hi - lo, left=lo, height=0.55, color=BLUE, alpha=0.9)
    ax.text(lo - 4, i, f"${lo:,.0f}", ha="right", va="center", fontsize=7)
    ax.text(hi + 4, i, f"${hi:,.0f}", ha="left", va="center", fontsize=7)
    if mid: ax.plot([mid, mid], [i - 0.3, i + 0.3], color="white", lw=2)
ax.set_yticks(range(len(rows)), [r[0] for r in rows[::-1]], fontsize=8)
ax.axvline(B["price"], color=INK, lw=1.2); ax.text(B["price"], len(rows) - 0.35, f"Price ${B['price']:.2f}", ha="center", fontsize=7)
ax.axvline(B["target"], color=ORANGE, lw=1.5, ls="--"); ax.text(B["target"], -0.95, f"Target ${B['target']:.2f}", ha="center", fontsize=7, color=ORANGE)
lo_all = min(r[1] for r in rows); hi_all = max(r[2] for r in rows)
ax.set_xlim(lo_all - 45, hi_all + 45); ax.set_ylim(-1.2, len(rows) - 0.1)
ax.xaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"${v:,.0f}"))
ax.grid(axis="x", color="#f1f0ec"); ax.set_axisbelow(True)
fig.tight_layout(); fig.savefig(OUT + "football.png", dpi=220); plt.close(fig)

fig, ax = plt.subplots(figsize=(6.6, 2.2))
if hist:
    xs = list(range(len(hist)))
    ax.plot(xs, [c for _, c in hist], color=BLUE, lw=1.5)
    ticks = xs[::max(1, len(xs) // 6)]
    ax.set_xticks(ticks, [hist[i][0][:7] for i in ticks], fontsize=7)
    ax.axhline(B["target"], color=ORANGE, lw=1.2, ls="--"); ax.text(xs[0], B["target"] + 3, f"Target ${B['target']:.2f}", ha="left", fontsize=7, color=ORANGE)
else:
    ax.text(0.5, 0.5, "Price history pending first live refresh", ha="center", transform=ax.transAxes, color=GREY)
ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"${v:,.0f}"))
ax.grid(axis="y", color="#f1f0ec")
fig.tight_layout(); fig.savefig(OUT + "price.png", dpi=220); plt.close(fig)
print("live charts ok", len(rows), "football rows", "live" if live else "no live")
