"""Peers, market-data WACC, football field, track record and fund analytics."""
from __future__ import annotations

import math
import statistics as st

import fundamentals
import ratios
import sources

_peer_cache: dict[str, dict] = {}


def _ratio(groups, name):
    return next((i["value"] for g in groups for i in g["items"] if i["label"] == name), None)


def _pct(values, q):
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    k = (len(vals) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return vals[lo] + (vals[hi] - vals[lo]) * (k - lo)


def _med(values):
    vals = [v for v in values if v is not None]
    return st.median(vals) if vals else None


# ------------------------------------------------------------------ peers
def peer_snapshot(ticker: str) -> dict:
    t = ticker.upper()
    if t in _peer_cache:
        return _peer_cache[t]
    try:
        cik, name = sources.cik_for(t)
        facts = sources.company_facts(cik)
        fin = fundamentals.build(facts)
        shares = fundamentals.shares_outstanding(facts) or fin["items"]["shares_diluted"][-1]
        mkt = sources.price_history(t)
        rt = ratios.compute(fin, mkt["price"], shares)
        qs = sources.quote_summary(t)
        g = rt["groups"]
        med = qs.get("target_median")
        import re
        name = re.sub(r"\s*/[A-Za-z]{2,}/?\s*$", "", name)
        out = {
            "ticker": t, "name": name.title() if name.isupper() else name, "price": round(mkt["price"], 2),
            "market_cap": rt["snapshot"]["market_cap"],
            "pe": _ratio(g, "P/E"), "ev_ebitda": _ratio(g, "EV / EBITDA"), "ev_sales": _ratio(g, "EV / Sales"),
            "op_margin": _ratio(g, "Operating margin"), "rev_growth": _ratio(g, "Revenue growth (YoY)"),
            "roe": _ratio(g, "ROE"), "net_debt_ebitda": _ratio(g, "Net debt / EBITDA"),
            "street_mean": qs.get("target_mean"), "street_median": med,
            "street_upside": (med / mkt["price"] - 1) if med else None,
            "status": "ok",
        }
    except Exception as exc:  # noqa: BLE001
        print(f"  ! peer {t} skipped: {exc}")
        out = {"ticker": t, "status": "error", "error": str(exc)[:120]}
    _peer_cache[t] = out
    return out


def regression_beta(stock_hist, spy_hist):
    """Beta from ~1 year of daily returns vs SPY (fallback when the quoted beta is missing or implausible)."""
    s = {d: c for d, c in stock_hist or []}
    m = {d: c for d, c in spy_hist or []}
    dates = [d for d in sorted(s) if d in m]
    if len(dates) < 60:
        return None
    rs = [s[dates[i]] / s[dates[i - 1]] - 1 for i in range(1, len(dates))]
    rm = [m[dates[i]] / m[dates[i - 1]] - 1 for i in range(1, len(dates))]
    ms, mm_ = sum(rs) / len(rs), sum(rm) / len(rm)
    cov = sum((a - ms) * (b - mm_) for a, b in zip(rs, rm))
    var = sum((b - mm_) ** 2 for b in rm)
    return cov / var if var else None


def peer_analysis(self_row: dict, peers: list[str], snapshot: dict, price: float, adj: dict | None = None) -> dict | None:
    """adj (optional, read from the analyst's model): ebitda, debt, cash, nci, eps — used instead of the
    generic 10-K figures, e.g. Adjusted EBITDA ex-derivative marks and minority interest at market value."""
    if not peers:
        return None
    rows = [peer_snapshot(p) for p in peers]
    ok = [r for r in rows if r.get("status") == "ok"]
    keys = ["pe", "ev_ebitda", "ev_sales", "op_margin", "rev_growth", "roe", "net_debt_ebitda", "street_upside"]
    medians = {k: _med([r.get(k) for r in ok]) for k in keys}
    q25 = {k: _pct([r.get(k) for r in ok], .25) for k in ("pe", "ev_ebitda")}
    q75 = {k: _pct([r.get(k) for r in ok], .75) for k in ("pe", "ev_ebitda")}
    shares, net_debt, ebitda, eps = (snapshot.get(k) for k in ("shares_mm", "net_debt", "ebitda", "eps"))
    adj = {k: v for k, v in (adj or {}).items() if isinstance(v, (int, float))}
    if adj:
        ebitda = adj.get("ebitda", ebitda)
        if "debt" in adj or "cash" in adj or "nci" in adj:
            net_debt = adj.get("debt", 0) - adj.get("cash", 0) + adj.get("nci", 0)
        eps = adj["eps"] if "eps" in adj else (None if adj.get("skip_pe") else eps)
        if ebitda and snapshot.get("market_cap"):
            self_row["ev_ebitda"] = (snapshot["market_cap"] + net_debt) / ebitda
        if "eps" in adj and adj["eps"]:
            self_row["pe"] = price / adj["eps"]

    def from_ev_ebitda(m):
        if m is None or not ebitda or ebitda <= 0 or not shares:
            return None
        return (m * ebitda - (net_debt or 0)) / shares

    def from_pe(m):
        return m * eps if m is not None and eps and eps > 0 else None

    implied = {
        "ev_ebitda": {"median": from_ev_ebitda(medians["ev_ebitda"]), "low": from_ev_ebitda(q25["ev_ebitda"]),
                      "high": from_ev_ebitda(q75["ev_ebitda"])},
        "pe": {"median": from_pe(medians["pe"]), "low": from_pe(q25["pe"]), "high": from_pe(q75["pe"])},
    }
    vals = [v["median"] for v in implied.values() if v["median"]]
    implied["average"] = sum(vals) / len(vals) if vals else None
    street_meds = [r.get("street_median") for r in ok if r.get("street_median")]
    return {
        "rows": [self_row] + rows, "medians": medians, "implied": implied,
        "peer_avg_street_upside": (sum(r["street_upside"] for r in ok if r.get("street_upside") is not None)
                                   / max(1, sum(1 for r in ok if r.get("street_upside") is not None)))
        if any(r.get("street_upside") is not None for r in ok) else None,
        "peer_street_median_count": len(street_meds),
        "basis": "model-adjusted EBITDA / net debt incl. minority interest" if adj else "10-K EBITDA and net debt",
    }


# --------------------------------------------------------------------- WACC
def market_wacc(fin: dict, snapshot: dict, beta, rf: float, erp: float) -> dict:
    it = fin["items"]
    last = lambda k: (it.get(k) or [None])[-1]  # noqa: E731
    debt = (last("short_term_debt") or 0) + (last("long_term_debt") or 0)
    mcap = snapshot.get("market_cap") or 0
    beta = beta if beta and 0.1 < beta < 4 else 1.0
    ke = rf + beta * erp
    kd = (last("interest_expense") or 0) / debt if debt else rf + 0.015
    kd = min(max(kd, rf), 0.15)
    tax = (last("income_tax") or 0) / last("pretax_income") if last("pretax_income") else 0.21
    tax = tax if 0 <= tax <= 0.35 else 0.21
    total = mcap + debt
    we, wd = (mcap / total, debt / total) if total else (1, 0)
    return {"risk_free": rf, "beta": beta, "erp": erp, "cost_of_equity": ke, "pre_tax_cost_of_debt": kd,
            "tax_rate": tax, "after_tax_cost_of_debt": kd * (1 - tax), "weight_equity": we, "weight_debt": wd,
            "wacc": we * ke + wd * kd * (1 - tax)}


# ----------------------------------------------------------- football field
def football(price_hist, consensus, peers, scenarios, target, price) -> list[dict]:
    rows = []
    closes = [p[1] for p in price_hist or []]
    if closes:
        rows.append({"label": "52-week trading range", "low": min(closes), "high": max(closes), "mid": None})
    if consensus.get("target_low") and consensus.get("target_high"):
        rows.append({"label": f"Street targets ({consensus.get('analysts') or '?'} analysts)",
                     "low": consensus["target_low"], "high": consensus["target_high"],
                     "mid": consensus.get("target_median")})
    if peers:
        for key, label in (("ev_ebitda", "Peer EV/EBITDA (25th–75th pct)"), ("pe", "Peer P/E (25th–75th pct)")):
            v = peers["implied"][key]
            if v["low"] and v["high"] and v["low"] > 0:
                rows.append({"label": label, "low": min(v["low"], v["high"]), "high": max(v["low"], v["high"]),
                             "mid": v["median"]})
    sc = {k: v for k, v in (scenarios or {}).items() if v}
    if len(sc) >= 2:
        rows.append({"label": "DCF: bear → bull", "low": min(sc.values()), "high": max(sc.values()),
                     "mid": sc.get("base", target)})
    return [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items()} for r in rows]


# ------------------------------------------------------------- track record
def track_record(history: list[dict]) -> dict:
    """Each change of rating or target is a 'call'; measure it against SPY since that day."""
    if not history:
        return {"calls": [], "hit_rate": None}
    now = history[-1]
    calls, prev = [], None
    for h in history:
        key = (h.get("rating"), h.get("target"))
        if prev is None or key != prev:
            calls.append(h)
        prev = key
    out = []
    for c in calls:
        ret = now["price"] / c["price"] - 1 if c.get("price") else None
        spy = (now["spy"] / c["spy"] - 1) if c.get("spy") and now.get("spy") else None
        alpha = ret - spy if ret is not None and spy is not None else None
        days = (_days(c["date"], now["date"]))
        hit = None
        if alpha is not None and days >= 30:
            r = c.get("rating")
            hit = alpha > 0 if r == "Buy" else alpha < 0 if r == "Sell" else abs(alpha) < 0.10 if r == "Hold" else None
        reached = None
        if c.get("target") and c.get("price"):
            path = [h["price"] for h in history if h["date"] >= c["date"]]
            reached = (max(path) >= c["target"]) if c["target"] >= c["price"] else (min(path) <= c["target"])
        out.append({"date": c["date"], "rating": c.get("rating"), "target": c.get("target"), "price": c.get("price"),
                    "return": ret, "spy_return": spy, "alpha": alpha, "days": days, "hit": hit,
                    "target_reached": reached})
    judged = [c for c in out if c["hit"] is not None]
    return {"calls": out[::-1], "hit_rate": (sum(c["hit"] for c in judged) / len(judged)) if judged else None,
            "judged": len(judged), "since": history[0]["date"],
            "since_return": now["price"] / history[0]["price"] - 1 if history[0].get("price") else None,
            "since_spy": now["spy"] / history[0]["spy"] - 1 if history[0].get("spy") and now.get("spy") else None}


def _days(a, b):
    import datetime as dt
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days


# ---------------------------------------------------------------- portfolio
def portfolio(holdings: list[dict], spy_hist, rf: float, sectors: dict) -> dict | None:
    """holdings: [{ticker, shares}] or [{ticker, weight}]. Returns value series and risk stats."""
    if not holdings:
        return None
    series = {}
    for h in holdings:
        try:
            series[h["ticker"]] = {d: c for d, c in sources.price_history(h["ticker"])["history"]}
        except Exception as exc:  # noqa: BLE001
            print(f"  ! portfolio price {h['ticker']}: {exc}")
    spy = {d: c for d, c in spy_hist}
    dates = sorted(set(spy).intersection(*[set(s) for s in series.values()])) if series else []
    if len(dates) < 30:
        return None
    first = dates[0]
    use_shares = all("shares" in h for h in holdings)
    if use_shares:
        units = {h["ticker"]: h["shares"] for h in holdings if h["ticker"] in series}
    else:
        tot = sum(h.get("weight", 1) for h in holdings if h["ticker"] in series)
        units = {h["ticker"]: (h.get("weight", 1) / tot) * 100 / series[h["ticker"]][first]
                 for h in holdings if h["ticker"] in series}
    values = [sum(u * series[t][d] for t, u in units.items()) for d in dates]
    base, sbase = values[0], spy[first]
    idx = [[d, round(v / base * 100, 3), round(spy[d] / sbase * 100, 3)] for d, v in zip(dates, values)]
    r = [values[i] / values[i - 1] - 1 for i in range(1, len(values))]
    rs = [spy[dates[i]] / spy[dates[i - 1]] - 1 for i in range(1, len(dates))]
    n = len(r)
    mean, sd = sum(r) / n, (sum((x - sum(r) / n) ** 2 for x in r) / (n - 1)) ** .5
    smean = sum(rs) / n
    cov = sum((a - mean) * (b - smean) for a, b in zip(r, rs)) / (n - 1)
    svar = sum((b - smean) ** 2 for b in rs) / (n - 1)
    ann_ret = (values[-1] / base) ** (252 / n) - 1
    ann_vol = sd * 252 ** .5
    peak, mdd = values[0], 0.0
    for v in values:
        peak = max(peak, v)
        mdd = min(mdd, v / peak - 1)
    beta = cov / svar if svar else None
    spy_ann = (spy[dates[-1]] / sbase) ** (252 / n) - 1
    last_val = {t: u * series[t][dates[-1]] for t, u in units.items()}
    tot_val = sum(last_val.values())
    weights = [{"ticker": t, "weight": v / tot_val, "sector": sectors.get(t) or "Other"} for t, v in last_val.items()]
    sec_w = {}
    for w in weights:
        sec_w[w["sector"]] = sec_w.get(w["sector"], 0) + w["weight"]
    return {
        "as_of": dates[-1], "start": first, "index": idx, "holdings": sorted(weights, key=lambda x: -x["weight"]),
        "sectors": sorted(({"sector": k, "weight": v} for k, v in sec_w.items()), key=lambda x: -x["weight"]),
        "value": tot_val if use_shares else None,
        "stats": {
            "return_1y": values[-1] / base - 1, "spy_return_1y": spy[dates[-1]] / sbase - 1,
            "ann_return": ann_ret, "ann_vol": ann_vol, "sharpe": (ann_ret - rf) / ann_vol if ann_vol else None,
            "beta": beta, "alpha": (ann_ret - (rf + (beta or 1) * (spy_ann - rf))) if beta is not None else None,
            "max_drawdown": mdd, "risk_free": rf,
        },
    }
