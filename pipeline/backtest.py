"""Forecast vs. actual.

Two checks, both shown on the model page and summed up on the Track record page:

1. Backtest: apply the model's own forecasting rules (builder._drivers) to the data that was available one and two
   years earlier, and compare next-year revenue and gross margin with what the company then reported.
2. Live forecasts: every build stores its five-year forecast. When a later build has actuals for a year an earlier
   build forecast, the two are compared.
"""
from __future__ import annotations


def _trim(fin: dict, k: int) -> dict:
    return {**fin, "labels": fin["labels"][:-k], "periods": fin.get("periods", [])[:-k],
            "items": {key: (v[:-k] if v else v) for key, v in fin["items"].items()}}


def _gm(fin: dict, i: int):
    r, c = fin["items"]["revenue"][i], (fin["items"].get("cogs") or [None] * len(fin["labels"]))[i]
    return (1 - c / r) if r and c is not None and c > 0 else None


def backtest(fin: dict) -> list[dict]:
    """What the model's rules would have forecast for each of the last two fiscal years, against the actuals."""
    import builder
    out = []
    n = len(fin["labels"])
    for k in (2, 1):
        if n - k < 3:          # the rules need three years of history
            continue
        past = _trim(fin, k)
        try:
            d = builder._drivers(past, "Balanced")
        except Exception:  # noqa: BLE001
            continue
        rev_prev, rev_act = past["items"]["revenue"][-1], fin["items"]["revenue"][n - k]
        if not rev_prev or not rev_act or rev_prev <= 0:
            continue
        fc_rev = rev_prev * (1 + d["base_growth"])
        fc_gm = (1 - d["cogs"]) if d.get("cogs") else None
        act_gm = _gm(fin, n - k)
        out.append({"year": fin["labels"][n - k], "from": past["labels"][-1],
                    "growth_fc": round(d["base_growth"], 4), "growth_act": round(rev_act / rev_prev - 1, 4),
                    "rev_fc": round(fc_rev, 1), "rev_act": round(rev_act, 1), "rev_err": round(fc_rev / rev_act - 1, 4),
                    "gm_fc": round(fc_gm, 4) if fc_gm is not None else None,
                    "gm_act": round(act_gm, 4) if act_gm is not None else None,
                    "gm_err_pts": round(fc_gm - act_gm, 4) if fc_gm is not None and act_gm is not None else None})
    return out


def snapshot(detail: dict, fiscal_year: str, date: str, version: int) -> dict:
    """This build's forecast, kept so a later build can grade it."""
    hn, years, isd = detail["hist_n"], detail["years"], detail["is"]
    pick = lambda k: [round(x, 4) if isinstance(x, float) else x for x in (isd.get(k) or [])[hn:]]  # noqa: E731
    return {"base_fy": fiscal_year, "made": date, "version": version,
            "years": [y.replace("E", "").replace("A", "") for y in years[hn:]],
            "revenue": pick("revenue"), "gm": pick("gm"), "ebit_m": pick("ebit_m"), "eps": pick("eps")}


def merge(prev: list[dict] | None, snap: dict) -> list[dict]:
    """One stored forecast per base fiscal year (the latest build on that 10-K), newest last."""
    keep = [f for f in (prev or []) if f.get("base_fy") != snap["base_fy"]]
    return (keep + [snap])[-6:]


def check(forecasts: list[dict] | None, detail: dict) -> list[dict]:
    """Earlier forecasts graded against the actuals in this build."""
    hn, years, isd = detail["hist_n"], detail["years"], detail["is"]
    actual = {y.replace("A", "").replace("E", ""): i for i, y in enumerate(years[:hn])}
    rows = []
    for f in forecasts or []:
        for j, y in enumerate(f.get("years") or []):
            i = actual.get(y)
            if i is None or y <= f["base_fy"]:
                continue
            row = {"year": y, "made": f["made"], "from": f["base_fy"], "version": f.get("version")}
            for k in ("revenue", "gm", "ebit_m", "eps"):
                fc, act = (f.get(k) or [None] * 9)[j], (isd.get(k) or [None] * 9)[i]
                row[k] = [fc, act]
            rv = row["revenue"]
            row["rev_err"] = round(rv[0] / rv[1] - 1, 4) if rv[0] and rv[1] else None
            rows.append(row)
    return rows
