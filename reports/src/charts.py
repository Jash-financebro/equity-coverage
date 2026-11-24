import json, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
m = json.load(open('/home/claude/report/model.json'))
OUT = '/home/claude/report/charts/'
BLUE, ORANGE, AQUA, GREY, INK, LINE = "#2a78d6", "#eb6834", "#1baf7a", "#8a8984", "#0b0b0b", "#e7e6e2"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.edgecolor": LINE, "axes.labelcolor": INK,
                     "xtick.color": "#52514e", "ytick.color": "#52514e", "axes.spines.top": False, "axes.spines.right": False,
                     "axes.grid": True, "grid.color": "#f1f0ec", "grid.linewidth": 0.8, "axes.axisbelow": True})
yrs = [f"{y}{'A' if y <= 2025 else 'E'}" for y in m["years"]]

def save(fig, name):
    fig.tight_layout(); fig.savefig(OUT + name, dpi=220); plt.close(fig)

# 1. revenue & adjusted EBITDA
fig, ax = plt.subplots(figsize=(6.5, 2.8))
x = np.arange(len(yrs)); w = 0.38
ax.bar(x - w/2 - 0.01, [v/1000 for v in m["revenue"]], w, color=BLUE, label="Total revenue")
ax.bar(x + w/2 + 0.01, [v/1000 for v in m["adj_ebitda"]], w, color=ORANGE, label="Consolidated Adj. EBITDA")
for i, v in enumerate(m["adj_ebitda"]):
    ax.text(i + w/2, v/1000 + 0.3, f"{v/1000:.1f}", ha="center", fontsize=7, color=INK)
ax.set_xticks(x, yrs); ax.set_ylabel("$ billions"); ax.set_ylim(0, 31)
ax.legend(frameon=False, loc="upper left", fontsize=8, ncol=2, bbox_to_anchor=(0, 1.16))
ax.axvline(2.5, color=GREY, lw=0.8, ls=":"); ax.text(2.6, 29, "projected →", fontsize=7, color=GREY)
save(fig, "rev_ebitda.png")

# 2. revenue build: volumes and price per MMBtu (two panels, no dual axis)
fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.5, 2.5))
v_idx = [i for i, v in enumerate(m["volumes"]) if v]
a1.bar([yrs[i] for i in v_idx], [m["volumes"][i] for i in v_idx], color=BLUE, width=0.6)
a1.set_title("LNG volumes recognized (TBtu)", fontsize=9, loc="left")
for i in v_idx: a1.text(yrs[i], m["volumes"][i] + 40, f"{m['volumes'][i]:,.0f}", ha="center", fontsize=7)
p_idx = [i for i, v in enumerate(m["price_mmbtu"]) if v]
a2.plot([yrs[i] for i in p_idx], [m["price_mmbtu"][i] for i in p_idx], color=ORANGE, lw=2, marker="o", ms=4)
a2.set_title("Revenue per MMBtu ($)", fontsize=9, loc="left"); a2.set_ylim(0, 10)
for i in p_idx: a2.text(yrs[i], m["price_mmbtu"][i] + 0.35, f"{m['price_mmbtu'][i]:.2f}", ha="center", fontsize=7)
for a in (a1, a2): a.tick_params(axis="x", labelsize=7)
save(fig, "revenue_build.png")

# 3. comps
comps = m["comps"]
names = [c["name"].split("(")[-1].rstrip(")").replace(" - for reference", "").replace("LNG) ", "") for c in comps]
names = ["VG", "WMB", "KMI", "TRGP", "OKE", "LNG"]
for key, title, fname in (("ev_ebitda", "EV / EBITDA (LTM)", "comps_ev_ebitda.png"), ("fpe", "Forward P/E", "comps_fpe.png")):
    vals = [c[key] for c in comps]
    fig, ax = plt.subplots(figsize=(3.2, 2.4))
    order = np.argsort(vals)
    cols = [ORANGE if names[i] == "LNG" else BLUE for i in order]
    ax.barh([names[i] for i in order], [vals[i] for i in order], color=cols, height=0.6)
    for k, i in enumerate(order): ax.text(vals[i] + 0.3, k, f"{vals[i]:.1f}x", va="center", fontsize=7)
    med = m["comps_med"][2 if key == "ev_ebitda" else 1]
    ax.axvline(med, color=INK, lw=1, ls="--"); ax.text(med, len(vals) - 0.4, f" peer median {med:.1f}x", fontsize=7)
    ax.set_title(title, fontsize=9, loc="left"); ax.grid(axis="y", visible=False)
    save(fig, fname)

# 4. sensitivity heatmaps
for key, cols_key, label, fname, fmt in (("sens_pg", "g", "Terminal growth", "sens_pg.png", "{:.2%}"),
                                         ("sens_exit", "mult", "Exit EV/EBITDA", "sens_exit.png", "{:.1f}x")):
    s = m[key]; grid = np.array(s["grid"])
    fig, ax = plt.subplots(figsize=(3.2, 2.5))
    ax.imshow(grid, cmap="Blues", aspect="auto", alpha=0.85)
    ax.set_xticks(range(5), [fmt.format(v) for v in s[cols_key]], fontsize=7)
    ax.set_yticks(range(5), [f"{v:.2%}" for v in s["wacc"]], fontsize=7)
    ax.set_xlabel(label, fontsize=8); ax.set_ylabel("WACC", fontsize=8); ax.grid(False)
    for i in range(5):
        for j in range(5):
            ax.text(j, i, f"${grid[i, j]:.0f}", ha="center", va="center", fontsize=7,
                    color="white" if grid[i, j] > np.percentile(grid, 70) else INK, fontweight="bold" if i == 2 and j == 2 else None)
    ax.spines[:].set_visible(False)
    save(fig, fname)

# 5. free cash flow and leverage
fcf = [o + c for o, c in zip(m["cf_cfo"], m["cf_capex"])]
fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.5, 2.4))
a1.bar(yrs, [v/1000 for v in fcf], color=[BLUE if i < 3 else "#86b6ef" for i in range(len(yrs))], width=0.6)
for i, v in enumerate(fcf): a1.text(i, v/1000 + 0.1, f"{v/1000:.1f}", ha="center", fontsize=7)
a1.set_title("Free cash flow, CFO − capex ($bn)", fontsize=9, loc="left")
lev = m["ratios"]["Total debt / Consolidated Adjusted EBITDA"]
a2.plot(yrs, lev, color=ORANGE, lw=2, marker="o", ms=4)
for i, v in enumerate(lev): a2.text(i, v + 0.08, f"{v:.1f}x", ha="center", fontsize=7)
a2.set_title("Total debt / Adj. EBITDA", fontsize=9, loc="left"); a2.set_ylim(0, 4.5)
for a in (a1, a2): a.tick_params(axis="x", labelsize=7)
save(fig, "fcf_leverage.png")
print("charts ok")
