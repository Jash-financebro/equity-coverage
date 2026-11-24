// Build the LNG initiation report (.docx) from content.json + charts. Template A: plain, underlined headers.
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, Footer, Header, PageNumber, LevelFormat, ExternalHyperlink, PageBreak, HeadingLevel,
} = require("docx");

const C = JSON.parse(fs.readFileSync("/home/claude/report/content.json"));
const CH = "/home/claude/report/charts/";
const FONT = "Arial", INK = "111111", GREY = "555555", RULE = "1F3A5F", LIGHT = "F2F4F7";
const PAGE_W = 12240, MARGIN = 1080, TW = PAGE_W - 2 * MARGIN; // 10080 DXA text width

const run = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size || 20, bold: o.bold, italics: o.italics, color: o.color || INK });
const para = (children, o = {}) => new Paragraph({ children: Array.isArray(children) ? children : [run(children, o)],
  spacing: { after: o.after ?? 120, before: o.before ?? 0, line: 276 }, alignment: o.align, keepNext: o.keepNext });
const H1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, font: FONT })],
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: RULE, space: 2 } } });
const H2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, font: FONT })] });
const inline = ([head, body]) => para([run(head + " ", { bold: true }), run(body)]);
const bullet = (children) => new Paragraph({ numbering: { reference: "bul", level: 0 },
  children: Array.isArray(children) ? children : [run(children)], spacing: { after: 80, line: 276 } });
const img = (file, wIn, hIn) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
  children: [new ImageRun({ type: "png", data: fs.readFileSync(CH + file), transformation: { width: wIn * 96, height: hIn * 96 } })] });
const caption = (t) => para([run(t, { size: 16, italics: true, color: GREY })], { align: AlignmentType.CENTER, after: 200 });
const thin = { style: BorderStyle.SINGLE, size: 4, color: "D0D4DA" };
const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

function table({ head, rows, bold = [] }, widths, o = {}) {
  const n = head.length;
  widths = widths || [Math.round(TW * (n > 6 ? 0.28 : 0.4)), ...Array(n - 1).fill(0)];
  if (widths.slice(1).every((w) => w === 0)) {
    const rest = Math.floor((TW - widths[0]) / (n - 1));
    widths = [TW - rest * (n - 1), ...Array(n - 1).fill(rest)];
  }
  const fs_ = o.size || (n > 6 ? 15 : 17);
  const leftCols = o.leftCols || [0];
  const cell = (t, i, isHead, isBold, shade) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA },
    shading: shade ? { type: ShadingType.CLEAR, color: "auto", fill: shade } : undefined,
    borders: { top: none, left: none, right: none, bottom: thin },
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({ alignment: leftCols.includes(i) ? AlignmentType.LEFT : AlignmentType.RIGHT,
      children: [run(String(t), { size: fs_, bold: isHead || isBold, color: isHead ? "FFFFFF" : INK })] })],
  });
  return new Table({
    width: { size: TW, type: WidthType.DXA }, columnWidths: widths,
    rows: [new TableRow({ tableHeader: true, children: head.map((t, i) => cell(t, i, true, false, RULE)) }),
      ...rows.map((r) => { const b = bold.includes(String(r[0]).trim());
        return new TableRow({ children: r.map((t, i) => cell(t, i, false, b, b ? LIGHT : undefined)) }); })],
  });
}
const gap = () => para("", { after: 120 });

// ---------------------------------------------------------------- cover
const ratingBox = new Table({
  width: { size: TW, type: WidthType.DXA }, columnWidths: [TW / 3, TW / 3, TW / 3],
  rows: [new TableRow({ children: [["Rating", C.rating], ["12-month price target", C.target], ["Upside", C.upside]].map(([k, v]) =>
    new TableCell({ width: { size: TW / 3, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, color: "auto", fill: LIGHT },
      borders: { top: { style: BorderStyle.SINGLE, size: 12, color: RULE }, bottom: none, left: none, right: none },
      margins: { top: 100, bottom: 100, left: 140, right: 140 },
      children: [para([run(k.toUpperCase(), { size: 15, color: GREY })], { after: 20 }), para([run(v, { size: 30, bold: true })], { after: 0 })] })) })],
});
const statsTable = new Table({
  width: { size: TW, type: WidthType.DXA }, columnWidths: [1900, 1460, 1900, 1460, 1900, 1460],
  rows: C.stats.map((r) => new TableRow({ children: r.map((t, i) => new TableCell({
    width: { size: [1900, 1460, 1900, 1460, 1900, 1460][i], type: WidthType.DXA },
    borders: { top: none, left: none, right: none, bottom: thin }, margins: { top: 30, bottom: 30, left: 60, right: 60 },
    children: [new Paragraph({ alignment: i % 2 ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: [run(t, { size: 15, bold: i % 2 === 1, color: i % 2 ? INK : GREY })] })] })) })),
});

const kids = [
  para([run(C.title, { size: 40, bold: true })], { after: 40 }),
  para([new ExternalHyperlink({ link: C.website, children: [new TextRun({ text: C.website.replace("https://", ""), style: "Hyperlink", font: FONT, size: 18 })] }),
    run(`   ·   Initiation of coverage   ·   ${C.date}`, { size: 18, color: GREY })], { after: 200 }),
  ratingBox,
  para([run(C.byline, { bold: true, size: 18 }), run(`   ·   ${C.brand}   ·   Report date ${C.date}`, { size: 18, color: GREY })],
    { before: 120, after: 120 }),
  H1("Investment Thesis"), ...C.thesis.map((t) => para(t)), para([run("Key risks. ", { bold: true }), run(C.risks_short)]),
  H2("Key Statistics"), statsTable,
  para([run(C.live_note, { size: 15, italics: true, color: GREY })], { before: 80, after: 160 }),
  img("price.png", 6.4, 2.0), caption("Cheniere share price, trailing 12 months, with the model target. Source: Yahoo Finance; JJ's LNG model."),

  H1("Company Background"), ...C.background.map((t) => para(t)),
  img("revenue_build.png", 6.6, 2.5), caption("Revenue build: volumes recognized in income and realized revenue per MMBtu. Source: LNG model, Revenue Build tab."),
  H1("Industry Analysis"), ...C.industry.map((t) => para(t)),
  H1("Management Team"), ...C.management.map(inline),
  H1("Reasons to Buy"), ...C.highlights.map(inline),
  H1("Growth Drivers / Tailwinds"), ...C.tailwinds.map(([h, b]) => bullet([run(h + " ", { bold: true }), run(b)])),
  H1("Headwinds"), ...C.headwinds.map(([h, b]) => bullet([run(h + " ", { bold: true }), run(b)])),
  H1("Risks"), ...C.risks.map(([h, b]) => bullet([run(h + " ", { bold: true }), run(b)])),
  H1("Competitive Positioning: Porter's Five Forces"),
  table({ head: ["Force", "Rating", "Assessment"], rows: C.porter, bold: [] }, [2300, 1000, TW - 3300], { size: 16, leftCols: [0, 1, 2] }), gap(),
  H1("Business Model"), ...C.business_model.map((t) => para(t)),
  H1("Recent Developments"), ...C.recent.map(inline),
  H2("What the model has not caught up with yet"), ...C.model_flags.map(([h, b]) => bullet([run(h + " ", { bold: true }), run(b)])),
  H1("Portfolio Fit / Investment Case Summary"), ...C.fit.map((t) => para(t)),

  H1("Financial Analysis"),
  H2("Income Statement"), ...C.is_text.map((t) => para(t)),
  img("rev_ebitda.png", 6.6, 2.85), caption("Total revenue and Consolidated Adjusted EBITDA. Source: LNG model."),
  H2("Balance Sheet"), ...C.bs_text.map((t) => para(t)),
  H2("Cash Flow"), ...C.cf_text.map((t) => para(t)),
  img("fcf_leverage.png", 6.6, 2.45), caption("Free cash flow (CFO less capex) and total debt / Adjusted EBITDA. Source: LNG model."),

  H1("Valuation"), ...C.valuation_text.map((t) => { const i = t.indexOf(". "); return inline([t.slice(0, i + 1), t.slice(i + 2)]); }),
  table(C.tables.blend, [3800, 2093, 2093, 2094]), gap(),
  img("football.png", 6.6, 2.9), caption("Football field: valuation ranges vs. the valuation-date price and target. Source: LNG model; Yahoo Finance."),

  new Paragraph({ children: [new PageBreak()] }),
  H1("Financial Statements"),
  H2("Income Statement"), table(C.tables.is), gap(),
  H2("Balance Sheet"), table(C.tables.bs), gap(),
  H2("Cash Flow Statement"), table(C.tables.cf), gap(),
  H2("Revenue Build"), table(C.tables.revb), gap(),

  H1("DCF Model"),
  H2("Weighted Average Cost of Capital"), table(C.tables.wacc, [6000, TW - 6000]), gap(),
  H2("Unlevered Free Cash Flow ($ millions)"), table(C.tables.dcf, [3600, 1620, 1620, 1620, 1620]), gap(),
  H2("Enterprise Value to Equity Value ($ millions)"), table(C.tables.bridge, [4480, 2800, 2800]), gap(),
  H2("Sensitivity: Value per Share"),
  table(C.tables.sens_pg), caption("Perpetuity growth method: WACC (rows) vs. terminal growth (columns)."),
  table(C.tables.sens_exit), caption("Exit multiple method: WACC (rows) vs. exit EV/EBITDA (columns)."),
  img("sens_pg.png", 3.4, 2.65),

  H1("Comparable Company Analysis"), table(C.tables.comps, [3280, 1100, 1140, 1140, 1140, 1140, 1140]), gap(),
  img("comps_ev_ebitda.png", 3.3, 2.5), img("comps_fpe.png", 3.3, 2.5),
  caption("Trading multiples, Cheniere highlighted. Source: LNG model, Comps & Target Price tab."),

  H1("Appendix"), img("sens_exit.png", 3.4, 2.65), caption("Exit-multiple sensitivity heatmap. Source: LNG model, DCF tab."),
  H2("Sources"), ...C.sources.map((s) => bullet([run(s, { size: 17 })])),
  para([run("Disclaimer. ", { bold: true, size: 16 }), run("This is independent student research, not investment advice. "
    + "Projections, valuation and price targets are estimates from the author's Excel model and may not be realized. "
    + "The author may hold positions in the securities discussed.", { size: 16, color: GREY })], { before: 200 }),
];

const doc = new Document({
  creator: C.byline, title: `${C.title} — Initiation of Coverage`,
  styles: {
    default: { document: { run: { font: FONT, size: 20 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 24, bold: true, color: RULE }, paragraph: { spacing: { before: 280, after: 120 }, keepNext: true, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 21, bold: true, color: INK }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [{ reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: 15840 }, margin: { top: 1300, bottom: 1000, left: MARGIN, right: MARGIN, header: 500, footer: 500 } } },
    headers: { default: new Header({ children: [para([run(`Cheniere Energy (LNG)  ·  Initiation of Coverage  ·  ${C.date}`, { size: 15, color: GREY })],
      { align: AlignmentType.RIGHT, after: 0 })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
      run(`${C.byline}  ·  ${C.brand}  ·  Page `, { size: 15, color: GREY }),
      new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 15, color: GREY })] })] }) },
    children: kids,
  }],
});
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(process.argv[2] || "/home/claude/report/LNG_Initiation.docx", buf); console.log("docx ok"); });
