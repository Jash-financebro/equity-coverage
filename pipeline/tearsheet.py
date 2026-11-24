"""One-page PDF tear sheet per stock (reportlab + matplotlib)."""
from __future__ import annotations

import io
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from reportlab.lib import colors  # noqa: E402
from reportlab.lib.pagesizes import letter  # noqa: E402
from reportlab.lib.units import inch  # noqa: E402
from reportlab.lib.utils import ImageReader  # noqa: E402
from reportlab.pdfgen import canvas  # noqa: E402

INK, INK2, LINE = colors.HexColor("#0b0b0b"), colors.HexColor("#52514e"), colors.HexColor("#d9d8d3")
BLUE, UP, DOWN = "#2a78d6", colors.HexColor("#006300"), colors.HexColor("#c62f2f")


def _usd(v, d=2):
    return "—" if v is None else f"${v:,.{d}f}"


def _pct(v):
    return "—" if v is None else f"{v * 100:.1f}%"


def _x(v):
    return "—" if v is None else f"{v:.1f}x"


def _price_png(hist, target):
    fig, ax = plt.subplots(figsize=(4.6, 1.9), dpi=200)
    if hist:
        ax.plot(range(len(hist)), [p[1] for p in hist], color=BLUE, lw=1.4)
        ticks = list(range(0, len(hist), max(1, len(hist) // 5)))
        ax.set_xticks(ticks)
        ax.set_xticklabels([hist[i][0][2:7] for i in ticks], fontsize=6, color="#8a8984")
    if target:
        ax.axhline(target, color="#0b0b0b", lw=1, ls=(0, (4, 3)))
        ax.text(len(hist or [0]) - 1, target, " Target", fontsize=6, va="bottom", ha="right")
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.spines["left"].set_color("#d9d8d3")
    ax.spines["bottom"].set_color("#d9d8d3")
    ax.tick_params(labelsize=6, colors="#8a8984", length=0)
    ax.grid(axis="y", color="#f1f0ec", lw=0.6)
    fig.tight_layout(pad=0.3)
    buf = io.BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    buf.seek(0)
    return ImageReader(buf)


def make(r: dict, dest: Path, owner: str = "") -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(dest), pagesize=letter)
    W, H = letter
    m = 0.6 * inch
    y = H - m

    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(m, y - 6, f"{r['ticker']}  {r.get('name', '')}"[:60])
    c.setFont("Helvetica", 8.5)
    c.setFillColor(INK2)
    c.drawString(m, y - 22, "  ·  ".join(x for x in [r.get("sector"), f"Tear sheet as of {r.get('price_date')}",
                                                     owner] if x))
    c.setStrokeColor(LINE)
    c.line(m, y - 30, W - m, y - 30)

    # headline numbers
    y -= 62
    cols = [("Rating", r.get("rating") or "—"), ("Target price", _usd(r.get("target"))),
            ("Price", _usd(r.get("price"))), ("Upside", _pct(r.get("upside"))),
            ("Street median", _usd((r.get("consensus") or {}).get("target_median")))]
    cw = (W - 2 * m) / len(cols)
    for i, (k, v) in enumerate(cols):
        x = m + i * cw
        c.setFont("Helvetica", 7.5)
        c.setFillColor(INK2)
        c.drawString(x, y + 18, k.upper())
        c.setFont("Helvetica-Bold", 16)
        col = INK
        if k == "Upside" and r.get("upside") is not None:
            col = UP if r["upside"] >= 0 else DOWN
        c.setFillColor(col)
        c.drawString(x, y, v)

    # chart + scenarios
    y -= 30
    c.drawImage(_price_png(r.get("price_history"), r.get("target")), m, y - 150, width=4.6 * inch, height=1.9 * inch)
    sx = m + 4.85 * inch
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(INK)
    c.drawString(sx, y - 4, "SCENARIOS (MODEL)")
    yy = y - 18
    for k in ("bear", "base", "bull"):
        v = (r.get("scenarios") or {}).get(k)
        c.setFont("Helvetica", 8.5)
        c.setFillColor(INK2)
        c.drawString(sx, yy, k.title())
        c.setFillColor(INK)
        c.drawRightString(W - m, yy, _usd(v))
        yy -= 13
    yy -= 6
    c.setFont("Helvetica-Bold", 8)
    c.drawString(sx, yy, "VALUATION CROSS-CHECKS")
    yy -= 14
    peers = r.get("peers") or {}
    cons = r.get("consensus") or {}
    rows = [("Street mean target", _usd(cons.get("target_mean"))),
            ("Street median target", _usd(cons.get("target_median"))),
            ("Peer-median EV/EBITDA implied", _usd(((peers.get("implied") or {}).get("ev_ebitda") or {}).get("median"))),
            ("Peer-median P/E implied", _usd(((peers.get("implied") or {}).get("pe") or {}).get("median"))),
            ("Peer avg. upside to street median", _pct(peers.get("peer_avg_street_upside")))]
    for k, v in rows:
        c.setFont("Helvetica", 8.5)
        c.setFillColor(INK2)
        c.drawString(sx, yy, k)
        c.setFillColor(INK)
        c.drawRightString(W - m, yy, v)
        yy -= 13

    # ratios grid
    y -= 175
    c.setStrokeColor(LINE)
    c.line(m, y + 8, W - m, y + 8)
    groups = r.get("ratios") or []
    gw = (W - 2 * m) / max(1, len(groups))
    for i, g in enumerate(groups):
        x = m + i * gw
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(INK)
        c.drawString(x, y - 8, g["name"].upper())
        yy = y - 22
        for it in g["items"]:
            c.setFont("Helvetica", 8)
            c.setFillColor(INK2)
            c.drawString(x, yy, it["label"][:24])
            c.setFillColor(INK)
            c.drawRightString(x + gw - 10, yy, _pct(it["value"]) if it["unit"] == "%" else _x(it["value"]))
            yy -= 12

    # thesis
    y -= 120
    c.line(m, y + 8, W - m, y + 8)
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(INK)
    c.drawString(m, y - 8, "INVESTMENT THESIS")
    text = c.beginText(m, y - 22)
    text.setFont("Helvetica", 8.5)
    text.setFillColor(INK)
    words, line = (r.get("thesis") or "—").split(), ""
    for w in words:
        if c.stringWidth(line + " " + w, "Helvetica", 8.5) > W - 2 * m:
            text.textLine(line)
            line = w
        else:
            line = (line + " " + w).strip()
    text.textLine(line)
    for label, items in (("Catalysts", r.get("catalysts")), ("Risks", r.get("risks"))):
        if items:
            text.moveCursor(0, 4)
            text.setFont("Helvetica-Bold", 8.5)
            text.textLine(label)
            text.setFont("Helvetica", 8.5)
            for it in items[:4]:
                text.textLine(f"•  {it}"[:130])
    c.drawText(text)

    c.setFont("Helvetica", 6.5)
    c.setFillColor(INK2)
    c.drawString(m, m - 10, "Fundamentals: SEC EDGAR 10-K XBRL. Prices & consensus: Yahoo Finance. Target from the analyst's "
                            "Excel model, recalculated automatically. Independent research, not investment advice.")
    c.showPage()
    c.save()
    return dest
