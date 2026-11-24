# Equity Coverage: live valuation models

A minimalist research site that keeps Excel valuation models current on its own. Each trading day a GitHub Action:

1. pulls five years of fundamentals from **SEC EDGAR**: the XBRL data each company files with its 10-K,
2. pulls the latest share price and a year of history (Yahoo Finance, Stooq fallback),
3. writes that data into a `Live_Data` tab inside every model in `models/`,
4. **recalculates the whole workbook** in headless LibreOffice and reads the new target price,
5. computes 20+ financial ratios, and
6. publishes the site to GitHub Pages with the refreshed `.xlsx` ready to download.

The home page shows every covered name with price, **target price**, street median target, upside, rating, key ratios and an Excel download. Each ticker page adds:

| Feature | What it shows |
|---|---|
| **Scenarios** | Bear / base / bull targets, recalculated by flipping the model's own scenario toggle |
| **Football field** | 52-week range, street target range, peer-multiple ranges, DCF bear → bull, vs. price and target |
| **Street consensus** | Mean and median analyst price targets (Yahoo Finance), linked into the model if you want |
| **Peer comparison** | The same ratios from each peer's 10-K, peer medians, prices implied by the peer-median EV/EBITDA and P/E, and each peer's upside to its own street median target (plus the peer average) |
| **Market-data WACC** | 10Y Treasury + Yahoo beta + ERP + 10-K cost of debt, next to the model's WACC |
| **Track record** | Every change in rating or target is a "call", measured against the S&P 500; hit rate after 30 days |
| **Filing alerts** | A new 10-K / 10-Q flags the stock *Review* and opens a GitHub issue (GitHub emails you) |
| **Tear sheet** | One-page PDF, regenerated daily |
| **Research report** | Full initiation report (Word + PDF) from `reports/` |

A **Fund** page tracks the portfolio (holdings from `config.yml`, or equal-weight coverage): growth of 100 vs. the S&P 500, Sharpe ratio, beta, Jensen's alpha, volatility, max drawdown and sector weights.

## Adding a model

1. Drop your workbook into `models/`, named after the ticker: `models/LNG.xlsx` (`LNG_DCF_v3.xlsx` works too).
2. Commit/upload it. The Action runs automatically, and the site updates in about 3 minutes.

That's all a model needs. The target price is found in this order:

| Order | How the target is found |
|---|---|
| 1 | `target_price: DCF!H45` in the model's `.yml` file |
| 2 | a cell named `TargetPrice` (Formulas → Name Manager) |
| 3 | the first number next to a label such as "Target Price" or "Implied share price" (Summary/DCF/Valuation tabs searched first) |

### Making the model actually refresh

The first run adds a `Live_Data` tab with a fixed layout. Link your model's inputs to it once (use green cross-sheet links, per the color code) and they refresh every day after that:

| Cell | Contents | Named range |
|---|---|---|
| `Live_Data!B6` | current share price | `LD_Price` |
| `Live_Data!B8` | shares outstanding (mm, 10-K cover) | `LD_Shares` |
| `Live_Data!B9` | market cap ($mm) | `LD_MarketCap` |
| `Live_Data!B10` | net debt, latest FY ($mm) | `LD_NetDebt` |
| `Live_Data!B15:F15` | fiscal-year labels, oldest → newest (**F = latest 10-K**) | |
| `Live_Data!B17:F38` | revenue, COGS, gross profit, EBIT, D&A, interest, pre-tax, tax, net income, EPS, diluted shares, CFO, capex, dividends, cash, current assets, total assets, current liabilities, total liabilities, ST debt, LT debt, equity | `LD_REVENUE`, `LD_NET_INCOME`, … (latest FY) |

Column G shows the exact XBRL tag behind every number, so each figure traces back to the filing.

Or, without editing the workbook, let the `.yml` create the links:

```yaml
# models/LNG.yml  (every key is optional)
ticker: LNG
sector: Energy
thesis: "One-paragraph thesis shown on the ticker page."
catalysts: ["Corpus Christi Stage 3 ramp", "Contract renewals"]
risks: ["Henry Hub spread compression"]
target_price: DCF!H45          # skip auto-detect
inputs:                        # model cell  <-  live field   (links, drawn green)
  "DCF!C5": price
  "DCF!C6": shares
  "Financials!H6": revenue.FY0  # FY0 = latest 10-K, FY-1 = the year before ... FY-4
set:                           # scenario overrides (hardcoded, drawn blue)
  "WACC!C20": 0.085
outputs:                       # extra model cells to show on the site
  WACC: WACC!C20
  Terminal growth: DCF!C30
rating: Buy                    # override the upside-based rating
```

### No model yet? Add a ticker and the pipeline builds one

```yaml
# models/NEE.yml
build: true
stance: Balanced        # Bullish | Balanced | Bearish | Conservative
peers: [DUK, SO, D, AEP]
```

The pipeline builds `models/NEE_v1.xlsx` from SEC EDGAR following the three-statement-model-builder conventions:

- a hidden historicals tab labelled with its source
- separate Income Statement, Balance Sheet and Cash Flow tabs
- roll-forward schedules: PP&E, D&A, other NCA, equity / retained earnings, term debt + revolver cash sweep, interest
- Revenue Build with a bull/base/bear selector, plus WACC, DCF (with a WACC × g sensitivity grid) and Financial Ratios tabs
- `{Ticker}_v#` in A1 of every tab, a balance check that nets to zero, no SUMPRODUCT, `$` and bold only on totals, and blue / black / green color coding

When a newer 10-K lands, it rolls the model to `_v2` and moves `_v1` to `models/archive/`. `tests/test_builder.py` runs the skill's verification scans on every deploy.

`templates/DCF_Template.xlsx` is a simpler starter DCF that is also wired to `Live_Data`.

## Research reports

Put a report in `reports/` as `TICKER_*.pdf` and/or `TICKER_*.docx`. The site links it from the ticker page. `reports/equity-report-config.md` holds the byline used by the equity-research-report workflow.

## One-time setup

1. **Settings → Pages → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions → Variables → New variable**: `SEC_USER_AGENT` = `Your Name your@email.com`. SEC asks every automated client to identify itself.
3. **Actions → Refresh models & deploy site → Run workflow** to run the first refresh.
4. Edit `config.yml` to set the site title, your LinkedIn, your portfolio site link and (optionally) your fund's holdings.
5. Watch the repo (it's on by default for your own repos) so new-filing issues reach your email.

## Run it locally

```bash
sudo apt install libreoffice-calc python3-uno        # macOS: brew install --cask libreoffice
pip install requests pyyaml openpyxl
SEC_USER_AGENT="Your Name you@email.com" python3 pipeline/run.py
python3 -m http.server -d site 8000                   # open http://localhost:8000
python3 tests/test_offline.py                         # end-to-end test, no internet needed
```

## How it's built

```
models/          your .xlsx models (+ optional TICKER.yml)
pipeline/        sources.py (SEC EDGAR, prices) · fundamentals.py (XBRL → annual 10-K data)
                 ratios.py · excel.py (LibreOffice UNO: write, link, recalc, extract) · run.py
site/            static front end (no framework, no build step) + generated data/ and downloads/
templates/       starter DCF
tests/           offline fixtures + end-to-end test, run on every deploy
```

* **Verified data only.** Fundamentals come from the company's own 10-K XBRL facts via SEC's APIs. Restated values replace originals (latest filing wins), quarterly facts are ignored, and periods must span a full fiscal year.
* **Your workbook survives.** LibreOffice edits the workbook in place, so charts, formatting and formulas are kept. You can download both the refreshed file and your untouched upload.
* **Failure-safe.** If a model fails to refresh, the site keeps its last good numbers and flags it. If LibreOffice can't evaluate a formula (e.g. `XLOOKUP`), the target falls back to the value Excel last saved, marked with `*`.

## Notes

* LibreOffice can't calculate `XLOOKUP`, `LET`, `FILTER` or dynamic arrays. Use `INDEX/MATCH` in the target-price chain, or the cached-value fallback applies.
* Banks and insurers report with different XBRL tags, so some ratios (gross margin, EBITDA) will show "—" for them.
* Educational project, not investment advice.
