/* Check my model: an Excel model audit that runs entirely in the browser. The file is never uploaded.
   Reads the .xlsx (a zip of XML files) directly, then runs the checks a reviewer would. */
(function () {
  "use strict";

  // ---------------------------------------------------------------- zip
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), files = {};
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("This isn't a valid .xlsx file.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true), name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      files[name] = { method, csize, off };
      p += 46 + nlen + xlen + clen;
    }
    const read = async (name) => {
      const f = files[name]; if (!f) return null;
      const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
      const raw = u8.subarray(start, start + f.csize);
      if (f.method === 0) return dec.decode(raw);
      if (f.method !== 8) throw new Error("Unsupported compression in the file.");
      const ds = new DecompressionStream("deflate-raw");
      const out = await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer();
      return dec.decode(out);
    };
    return { names: Object.keys(files), read };
  }
  const xml = (s) => new DOMParser().parseFromString(s, "application/xml");
  const kids = (el, tag) => (el ? Array.from(el.getElementsByTagName(tag)) : []);

  // ---------------------------------------------------------------- references
  const colNum = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const colStr = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const parseAddr = (a) => { const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(a); return m ? { c: colNum(m[1]), r: +m[2] } : null; };
  // sheet-qualified or plain refs, single cells or ranges; not function names (followed by "(")
  const REF = /(?<![\w.$])((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![\w(])/g;
  const stripStrings = (f) => f.replace(/"(?:[^"]|"")*"/g, '""');
  function refsOf(f) {
    const out = [], s = stripStrings(f);
    let m; REF.lastIndex = 0;
    while ((m = REF.exec(s))) {
      const before = s[m.index - 1];
      if (before && /[A-Za-z0-9_.$]/.test(before) && !m[1]) continue;
      out.push({ sheet: m[1] ? m[1].slice(0, -1).replace(/^'|'$/g, "").replace(/''/g, "'") : null,
                 a: { c: colNum(m[3]), r: +m[5], ac: !!m[2], ar: !!m[4] },
                 b: m[7] ? { c: colNum(m[7]), r: +m[9], ac: !!m[6], ar: !!m[8] } : null, text: m[0] });
    }
    return out;
  }
  // R1C1-style signature: the same formula copied across a row gives the same signature
  function signature(f, cell) {
    return stripStrings(f).replace(REF, (all, sh, dc1, c1, dr1, r1, dc2, c2, dr2, r2) => {
      const one = (dc, c, dr, r) => `${dr ? "R" + r : "R[" + (+r - cell.r) + "]"}${dc ? "C" + colNum(c) : "C[" + (colNum(c) - cell.c) + "]"}`;
      return (sh || "") + one(dc1, c1, dr1, r1) + (c2 ? ":" + one(dc2, c2, dr2, r2) : "");
    });
  }
  function shift(f, dr, dc) {   // copy a shared formula from its master cell
    return f.replace(REF, (all, sh, dc1, c1, dr1, r1, dc2, c2, dr2, r2) => {
      const one = (d$, c, r$, r) => `${d$ || ""}${d$ ? c : colStr(colNum(c) + dc)}${r$ || ""}${r$ ? r : +r + dr}`;
      return (sh || "") + one(dc1, c1, dr1, r1) + (c2 ? ":" + one(dc2, c2, dr2, r2) : "");
    });
  }

  // ---------------------------------------------------------------- colours
  function rgbOf(colorEl, theme) {
    if (!colorEl) return null;
    const rgb = colorEl.getAttribute("rgb");
    if (rgb) return rgb.slice(-6).toUpperCase();
    const t = colorEl.getAttribute("theme");
    if (t != null && theme[+t]) return theme[+t];
    const idx = colorEl.getAttribute("indexed");
    const IDX = { 8: "000000", 9: "FFFFFF", 10: "FF0000", 11: "00FF00", 12: "0000FF", 17: "008000", 18: "000080", 30: "0066CC", 39: "0000FF", 64: "000000" };
    return idx != null ? IDX[+idx] || null : null;
  }
  const kind = (hex) => {
    if (!hex) return "black";
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    if (b > 140 && r < 110 && g < 140) return "blue";
    if (g > 90 && r < 90 && b < 90) return "green";
    if (r < 70 && g < 70 && b < 70) return "black";
    if (r > 170 && g < 90 && b < 90) return "red";
    return "other";
  };

  // ---------------------------------------------------------------- read the workbook
  async function load(buf) {
    const z = await unzip(buf);
    const wbx = xml(await z.read("xl/workbook.xml") || "");
    const rels = xml(await z.read("xl/_rels/workbook.xml.rels") || "<r/>");
    const relMap = Object.fromEntries(kids(rels.documentElement, "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target")]));
    const ss = xml(await z.read("xl/sharedStrings.xml") || "<sst/>");
    const strings = kids(ss.documentElement, "si").map((si) => kids(si, "t").map((t) => t.textContent).join(""));
    const themeX = xml(await z.read("xl/theme/theme1.xml") || "<t/>");
    const scheme = themeX.getElementsByTagName("a:clrScheme")[0];
    const themeCols = [];
    if (scheme) {
      const order = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
      for (const nm of order) { const e = scheme.getElementsByTagName("a:" + nm)[0]; const c = e && (e.getElementsByTagName("a:srgbClr")[0] || e.getElementsByTagName("a:sysClr")[0]);
        themeCols.push(c ? (c.getAttribute("val") || c.getAttribute("lastClr") || "").toUpperCase() : null); }
    }
    const st = xml(await z.read("xl/styles.xml") || "<s/>");
    const fonts = kids(st.getElementsByTagName("fonts")[0], "font").map((f) => kind(rgbOf(f.getElementsByTagName("color")[0], themeCols)));
    const xfs = kids(st.getElementsByTagName("cellXfs")[0], "xf").map((x) => fonts[+x.getAttribute("fontId") || 0] || "black");
    const calcPr = wbx.getElementsByTagName("calcPr")[0];
    const sheets = [];
    for (const s of kids(wbx.documentElement, "sheet")) {
      const name = s.getAttribute("name"), state = s.getAttribute("state") || "visible";
      let target = relMap[s.getAttribute("r:id")] || "";
      target = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
      const sx = await z.read(target); if (!sx) continue;
      const doc = xml(sx), cells = new Map(), shared = {};
      for (const c of kids(doc.documentElement, "c")) {
        const ref = c.getAttribute("r"), a = parseAddr(ref); if (!a) continue;
        const t = c.getAttribute("t") || "n", fe = c.getElementsByTagName("f")[0], ve = c.getElementsByTagName("v")[0];
        let f = fe ? fe.textContent : null;
        if (fe && fe.getAttribute("t") === "shared") {
          const si = fe.getAttribute("si");
          if (f) shared[si] = { f, at: a, sig: signature(f, a) };
          else if (shared[si]) { f = shift(shared[si].f, a.r - shared[si].at.r, a.c - shared[si].at.c); }
        }
        let v = ve ? ve.textContent : null;
        if (t === "s" && v != null) v = strings[+v];
        else if (t === "inlineStr") v = kids(c, "t").map((x) => x.textContent).join("");
        else if (t === "n" && v != null) v = +v;
        else if (t === "b") v = v === "1";
        cells.set(ref, { ref, ...a, t, f, v, font: xfs[+c.getAttribute("s") || 0] || "black" });
      }
      sheets.push({ name, state, cells });
    }
    return { sheets, iterate: calcPr?.getAttribute("iterate") === "1", external: z.names.some((n) => n.startsWith("xl/externalLinks/")) };
  }

  // ---------------------------------------------------------------- checks
  const OK_CONST = new Set([0, 1, 2, 3, 4, 5, 6, 10, 12, 100, 1000, 1e6, 365, 360, 52, 4, 0.5, 2.5]);
  function audit(book) {
    const issues = [], add = (sev, check, sheet, cell, detail) => issues.push({ sev, check, sheet, cell, detail });
    const byName = Object.fromEntries(book.sheets.map((s) => [s.name, s]));
    const stats = { sheets: book.sheets.length, formulas: 0, inputs: 0, cells: 0 };
    let blueInputs = 0, colourBad = [];
    const lit = {}, vol = {}, typed = [];
    // one line per tab and pattern, not one per cell: a formula copied across 1,000 rows is one decision
    const group = (bag, sheet, c, what) => { const key = sheet + "|" + signature(c.f, c); (bag[key] ||= { sheet, what, cells: [], f: c.f }).cells.push(c.ref); };
    for (const sh of book.sheets) {
      const rows = new Map();
      for (const c of sh.cells.values()) {
        stats.cells++;
        if (!rows.has(c.r)) rows.set(c.r, []);
        rows.get(c.r).push(c);
        if (c.f) stats.formulas++; else if (typeof c.v === "number") stats.inputs++;
        if (c.t === "e") add("high", "Formula error", sh.name, c.ref, `shows ${c.v}${c.f ? " (=" + c.f.slice(0, 80) + ")" : ""}`);
        else if (c.f && /#REF!/.test(c.f)) add("high", "Broken reference", sh.name, c.ref, `=${c.f.slice(0, 100)}`);
        if (c.f && /\[\d+\]/.test(c.f)) add("medium", "Link to another workbook", sh.name, c.ref, `=${c.f.slice(0, 100)}`);
        if (c.f && /\b(OFFSET|INDIRECT|NOW|TODAY|RAND|RANDBETWEEN)\s*\(/i.test(c.f)) group(vol, sh.name, c, c.f.match(/\b(OFFSET|INDIRECT|NOW|TODAY|RAND|RANDBETWEEN)/i)[1].toUpperCase());
        // numbers typed inside formulas
        if (c.f) {
          const lits = stripStrings(c.f).replace(REF, " ").match(/(?<![\w.])\d+(?:\.\d+)?%?(?![\w.(])/g) || [];
          const bad = lits.filter((x) => { const n = parseFloat(x) / (x.endsWith("%") ? 100 : 1); return !OK_CONST.has(n); });
          if (bad.length) group(lit, sh.name, c, bad.slice(0, 3).join(", "));
        }
        // colour convention
        if (typeof c.v === "number" && !c.f) {
          if (c.font === "blue") blueInputs++;
          else if (!(Number.isInteger(c.v) && c.v >= 1900 && c.v <= 2100)) colourBad.push([sh.name, c.ref, "typed number is not blue"]);
        } else if (c.f) {
          const cross = /!/.test(c.f);
          if (cross && c.font !== "green" && c.font !== "black") colourBad.push([sh.name, c.ref, `link to another tab is ${c.font}, should be green`]);
          else if (cross && c.font === "black") colourBad.push([sh.name, c.ref, "link to another tab is black, should be green"]);
          else if (!cross && c.font === "blue") colourBad.push([sh.name, c.ref, "formula is blue, which signals a typed input"]);
          else if (!cross && c.font === "green") colourBad.push([sh.name, c.ref, "same-tab formula is green, should be black"]);
        }
      }
      // row checks: typed numbers breaking a formula row; inconsistent formulas
      for (const [r, cs] of rows) {
        cs.sort((a, b) => a.c - b.c);
        const numeric = cs.filter((c) => c.f || typeof c.v === "number");
        for (let i = 1; i < numeric.length; i++) {
          const c = numeric[i], L = numeric[i - 1], R = numeric[i + 1];
          if (!c.f && L.f && L.c === c.c - 1 && (R ? R.f && R.c === c.c + 1 : numeric.filter((x) => x.f).length >= 3)) typed.push([sh.name, c]);
        }
        const fs = numeric.filter((c) => c.f).map((c) => ({ c, sig: signature(c.f, c) }));
        for (let i = 1; i < fs.length - 1; i++) {
          const L = fs[i - 1], C = fs[i], R = fs[i + 1];
          if (L.c.c === C.c.c - 1 && R.c.c === C.c.c + 1 && L.sig === R.sig && C.sig !== L.sig) {
            add("medium", "Formula doesn't match its neighbours", sh.name, C.c.ref, `=${C.c.f.slice(0, 80)}  but ${L.c.ref} and ${R.c.ref} follow a different pattern`);
          }
        }
      }
      // balance sheet
      const label = (r) => (rows.get(r) || []).filter((c) => c.c <= 4 && typeof c.v === "string").map((c) => c.v.trim()).join(" ");
      let ta = null, tle = null;
      for (const r of rows.keys()) {
        const l = label(r).toLowerCase();
        if (/check/.test(l)) { /* handled below */ } else if (/^total assets\b/.test(l)) ta = r;
        else if (/^total liabilities\s*(and|&|,)\s*.*(equity|deficit|capital)/.test(l)) tle = r;
        if (/^(balance )?check\b|balance check/.test(l)) {
          for (const c of rows.get(r)) if (typeof c.v === "number" && c.c > 3 && Math.abs(c.v) > 0.01) add("high", "Balance check is not zero", sh.name, c.ref, `${label(r)} = ${c.v.toLocaleString()}`);
        }
      }
      if (ta && tle) {
        const A = new Map(rows.get(ta).filter((c) => typeof c.v === "number").map((c) => [c.c, c.v]));
        let n = 0;
        for (const c of rows.get(tle)) {
          if (typeof c.v !== "number" || !A.has(c.c)) continue;
          const d = A.get(c.c) - c.v;
          if (Math.abs(d) > Math.max(0.5, Math.abs(c.v) * 0.0005)) { n++; if (n <= 8) add("high", "Balance sheet doesn't balance", sh.name, colStr(c.c) + tle, `total assets ${A.get(c.c).toLocaleString()} vs liabilities + equity ${c.v.toLocaleString()} (off by ${d.toLocaleString(undefined, { maximumFractionDigits: 1 })})`); }
        }
        if (!n) stats.balanced = (stats.balanced || 0) + 1;
      }
      if (sh.state !== "visible") add("info", "Hidden tab", sh.name, "", `${sh.state === "veryHidden" ? "very hidden" : "hidden"}: reviewers may miss what's on it`);
    }
    // typed numbers inside formula rows: a blue number is a deliberate input when the model uses the colour convention
    typed.filter(([, c]) => !(blueInputs >= 10 && c.font === "blue")).slice(0, 80).forEach(([s, c]) =>
      add("medium", "Typed number in a row of formulas", s, c.ref, `${c.v.toLocaleString()} is typed where the cells beside it are formulas: it won't update when inputs change`));
    const span = (cells) => cells.length === 1 ? cells[0] : `${cells[0]} and ${cells.length - 1} more`;
    Object.values(lit).sort((a, b) => b.cells.length - a.cells.length).slice(0, 40).forEach((g) =>
      add("low", "Number typed inside a formula", g.sheet, span(g.cells), `=${g.f.slice(0, 80)}  →  put ${g.what} in its own labelled input cell${g.cells.length > 1 ? ` (same formula in ${g.cells.length} cells)` : ""}`));
    Object.values(vol).slice(0, 20).forEach((g) =>
      add(g.what === "RAND" || g.what === "RANDBETWEEN" ? "info" : "low", "Volatile function", g.sheet, span(g.cells), `${g.what} recalculates on every change${g.what.startsWith("RAND") ? " (expected in a Monte Carlo or simulation tab)" : ", which slows the model and makes it hard to trace"}`));
    if (blueInputs >= 10 && colourBad.length) {
      colourBad.slice(0, 60).forEach(([s, c, d]) => add("low", "Colour coding", s, c, d));
      if (colourBad.length > 60) add("low", "Colour coding", "", "", `${colourBad.length - 60} more cells break the blue / black / green convention`);
    }
    stats.colourConvention = blueInputs >= 10;
    if (book.external) add("medium", "Link to another workbook", "", "", "This file has external workbook links. They break when the file is sent to someone else.");

    // circular references (cell-level graph, capped for very large models)
    const graph = new Map(); let edges = 0;
    for (const sh of book.sheets) for (const c of sh.cells.values()) {
      if (!c.f) continue;
      const from = sh.name + "!" + c.ref, deps = [];
      for (const r of refsOf(c.f)) {
        const tsn = r.sheet || sh.name, ts = byName[tsn]; if (!ts) continue;
        const b = r.b || r.a, n = (Math.abs(b.r - r.a.r) + 1) * (Math.abs(b.c - r.a.c) + 1);
        if (n > 4000) continue;
        for (let rr = Math.min(r.a.r, b.r); rr <= Math.max(r.a.r, b.r); rr++) for (let cc = Math.min(r.a.c, b.c); cc <= Math.max(r.a.c, b.c); cc++) {
          const key = colStr(cc) + rr; if (ts.cells.get(key)?.f) deps.push(tsn + "!" + key);
        }
      }
      edges += deps.length; graph.set(from, deps);
      if (edges > 400000) break;
    }
    const color = new Map(); let cycle = null;
    for (const start of graph.keys()) {
      if (cycle || color.get(start)) continue;
      const stack = [[start, 0]], path = [];
      color.set(start, 1); path.push(start);
      while (stack.length && !cycle) {
        const top = stack[stack.length - 1], deps = graph.get(top[0]) || [];
        if (top[1] < deps.length) {
          const nx = deps[top[1]++], st = color.get(nx);
          if (st === 1) { cycle = path.slice(path.indexOf(nx)).concat(nx); break; }
          if (!st) { color.set(nx, 1); path.push(nx); stack.push([nx, 0]); }
        } else { color.set(top[0], 2); path.pop(); stack.pop(); }
      }
    }
    if (cycle) add(book.iterate ? "medium" : "high", "Circular reference", cycle[0].split("!")[0], cycle[0].split("!").pop(),
      `${cycle.slice(0, 6).join(" → ")}${cycle.length > 6 ? " → …" : ""}${book.iterate ? " (iterative calculation is on, so this is probably the interest-on-cash loop; make sure it's intended)" : ""}`);
    else if (book.iterate) add("info", "Iterative calculation is on", "", "", "No circular reference was found, so it can be turned off (File → Options → Formulas).");
    stats.circular = !!cycle;
    const order = { high: 0, medium: 1, low: 2, info: 3 };
    issues.sort((a, b) => order[a.sev] - order[b.sev]);
    return { issues, stats };
  }

  window.MBAudit = { run: async (buf) => audit(await load(buf)) };
})();
