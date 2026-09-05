// BhuRakshak v3.0 — Complete Project Study Guide (docx generator)
// Follows docx skill: R1 cover recipe + DM-1 palette, Profile A fonts (EN: Times New Roman),
// 3-section numbering (cover / TOC roman / body arabic), TOC + refresh hint, line 312.
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, NumberFormat, AlignmentType, HeadingLevel,
  WidthType, BorderStyle, ShadingType, SectionType, TableOfContents,
  PageBreak, TableLayoutType,
} = require("docx");
const fs = require("fs");

const contentA = require("./study_content_a.js");
const contentB = require("./study_content_b.js");
const blocks = [...contentA, ...contentB];

// ── Palette: DM-1 Deep Cyan (tech report) ──────────────────────────────
const PAL = {
  bg: "162235", accent: "37DCF2",
  cover: { titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078" },
  table: { headerBg: "1B6B7A", headerText: "FFFFFF", accentLine: "1B6B7A", innerLine: "C8DDE2", surface: "EDF3F5" },
  heading: "0F2A33", body: "000000", secondary: "5B6B7D",
};

const NB = { style: BorderStyle.NONE, size: 0, color: "auto" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

const EN = { ascii: "Times New Roman", eastAsia: "SimSun" };
const EN_HEAD = { ascii: "Times New Roman", eastAsia: "SimHei" };

// ── Cover helpers (per design-system.md, English width-aware) ──────────
function textWidthTwips(text, pt) {
  // CJK ~pt*20 per char, ASCII ~pt*11 (TNR bold average) — conservative
  let w = 0;
  for (const ch of text) w += /[\u4e00-\u9fff\u3000-\u303f]/.test(ch) ? pt * 20 : pt * 11;
  return w;
}
function splitTitleLines(title, maxWidthTwips, pt) {
  const words = title.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (textWidthTwips(trial, pt) <= maxWidthTwips || !cur) cur = trial;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += " " + last;
  }
  return lines;
}
function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    lines = splitTitleLines(title, maxWidthTwips, titlePt);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) { lines = splitTitleLines(title, maxWidthTwips, minPt); titlePt = minPt; }
  return { titlePt, titleLines: lines };
}
function calcCoverSpacing(params) {
  const { titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0 } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const remainingSpace = usableHeight - contentHeight;
  const safeRemaining = Math.max(remainingSpace, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}

// ── Recipe R1: Pure Paragraph Cover (left-aligned, dark bg) ────────────
function buildCoverR1(config) {
  const P = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const children = [];
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));
  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join("  "), size: 18, color: P.accent, font: { ascii: "Calibri", eastAsia: "SimHei" }, characterSpacing: 40 })],
    }));
  }
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true, color: P.cover.titleColor, font: { eastAsia: "SimHei", ascii: "Arial" } })],
    }));
  }
  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL }, spacing: { after: 800 },
      children: [new TextRun({ text: config.subtitle, size: 24, color: P.cover.subtitleColor, font: { eastAsia: "Microsoft YaHei", ascii: "Arial" } })],
    }));
  }
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({ text: line, size: 24, color: P.cover.metaColor, font: { eastAsia: "Microsoft YaHei", ascii: "Arial" } })],
    }));
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: P.cover.footerColor, font: { ascii: "Arial" } }),
      new TextRun({ text: "                                        " }),
      new TextRun({ text: config.footerRight || "", size: 16, color: P.cover.footerColor, font: { ascii: "Arial" } }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders,
        children,
      })],
    })],
  })];
}

// ── Body builders ──────────────────────────────────────────────────────
function parseRuns(text, base) {
  // supports **bold** and *italic*
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map(part => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return new TextRun({ ...base, text: part.slice(2, -2), bold: true });
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return new TextRun({ ...base, text: part.slice(1, -1), italics: true });
    }
    return new TextRun({ ...base, text: part });
  });
}
const bodyBase = { size: 24, color: PAL.body, font: EN };

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160, line: 312 },
    keepNext: true,
    children: [new TextRun({ text, bold: true, size: 32, color: PAL.heading, font: EN_HEAD })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120, line: 312 },
    keepNext: true,
    children: [new TextRun({ text, bold: true, size: 28, color: PAL.heading, font: EN_HEAD })],
  });
}
function bodyP(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120, line: 312 },
    children: parseRuns(text, bodyBase),
  });
}
function bulletP(text) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    bullet: { level: 0 },
    spacing: { after: 80, line: 312 },
    children: parseRuns(text, { size: 24, color: PAL.body, font: EN }),
  });
}
function calloutTable(text) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { ...allNoBorders, left: { style: BorderStyle.SINGLE, size: 12, color: PAL.table.accentLine } },
    rows: [new TableRow({
      cantSplit: true,
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: PAL.table.surface },
        margins: { top: 100, bottom: 100, left: 160, right: 160 },
        children: [new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { line: 312 },
          children: parseRuns(text, { size: 22, color: PAL.heading, font: EN }),
        })],
      })],
    })],
  });
}
function dataTable(spec) {
  const els = [];
  els.push(new Paragraph({
    keepNext: true,
    spacing: { before: 160, after: 80, line: 312 },
    children: [new TextRun({ text: spec.title, bold: true, size: 21, color: PAL.heading, font: EN_HEAD })],
  }));
  const headerRow = new TableRow({
    tableHeader: true, cantSplit: true,
    children: spec.header.map((text, i) => new TableCell({
      shading: { type: ShadingType.CLEAR, fill: PAL.table.headerBg },
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      width: { size: spec.widths[i], type: WidthType.PERCENTAGE },
      children: [new Paragraph({
        alignment: AlignmentType.LEFT, spacing: { line: 276 },
        children: [new TextRun({ text, bold: true, size: 21, color: PAL.table.headerText, font: EN_HEAD })],
      })],
    })),
  });
  const dataRows = spec.rows.map((row, r) => new TableRow({
    cantSplit: true,
    children: row.map((cell, i) => new TableCell({
      shading: { type: ShadingType.CLEAR, fill: r % 2 === 1 ? PAL.table.surface : "FFFFFF" },
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      width: { size: spec.widths[i], type: WidthType.PERCENTAGE },
      children: [new Paragraph({
        alignment: AlignmentType.LEFT, spacing: { line: 276 },
        children: parseRuns(cell, { size: 21, color: PAL.body, font: EN }),
      })],
    })),
  }));
  els.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: PAL.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: PAL.table.accentLine },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: PAL.table.innerLine },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: PAL.table.innerLine },
    },
    rows: [headerRow, ...dataRows],
  }));
  els.push(new Paragraph({ spacing: { after: 120, line: 312 }, children: [] }));
  return els;
}

// assemble body children from blocks
const bodyChildren = [];
for (const b of blocks) {
  if (b.h1) bodyChildren.push(h1(b.h1));
  else if (b.h2) bodyChildren.push(h2(b.h2));
  else if (b.p) bodyChildren.push(bodyP(b.p));
  else if (b.bullets) b.bullets.forEach(t => bodyChildren.push(bulletP(t)));
  else if (b.callout) bodyChildren.push(calloutTable(b.callout), new Paragraph({ spacing: { after: 100 }, children: [] }));
  else if (b.table) dataTable(b.table).forEach(e => bodyChildren.push(e));
}

// ── Headers / footers ──────────────────────────────────────────────────
function pageHeader() {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: PAL.table.innerLine, space: 4 } },
      children: [new TextRun({ text: "BhuRakshak v3.0 — Complete Project Study Guide", size: 18, color: "808080", font: EN })],
    })],
  });
}
function pageNumFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: EN })],
    })],
  });
}

// ── Document ───────────────────────────────────────────────────────────
const doc = new Document({
  creator: "Team BhuRakshak",
  title: "BhuRakshak v3.0 — Complete Project Study Guide",
  styles: {
    default: {
      document: {
        run: { font: EN, size: 24, color: PAL.body },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: EN_HEAD, size: 32, bold: true, color: PAL.heading },
        paragraph: { spacing: { before: 360, after: 160, line: 312 }, outlineLevel: 0 },
      },
      heading2: {
        run: { font: EN_HEAD, size: 28, bold: true, color: PAL.heading },
        paragraph: { spacing: { before: 240, after: 120, line: 312 }, outlineLevel: 1 },
      },
    },
  },
  sections: [
    { // Section 1: Cover — margin 0, no header/footer
      properties: {
        page: { size: { width: 11906, height: 16838 }, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
      },
      children: buildCoverR1({
        title: "BhuRakshak v3.0",
        subtitle: "Complete Project Study Guide — every model, every dataset, every number, every answer",
        englishLabel: "STUDY GUIDE",
        metaLines: [
          "Problem: AI-Based Landslide Early Warning (SIH 26001)",
          "Coverage: 5 districts, 621 hexagonal response zones, 4.86 million residents",
          "Platform: Next.js 16 + Prisma + SQLite + MapLibre + pure-Java Android",
          "Prepared for: Team BhuRakshak — strict-judge defense",
        ],
        footerLeft: "BhuRakshak v3.0 — internal team study guide",
        footerRight: "September 2026",
        palette: PAL,
      }),
    },
    { // Section 2: Front matter (TOC) — Roman numerals
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 },
          pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN },
        },
      },
      headers: { default: pageHeader() },
      footers: { default: pageNumFooter() },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 480, after: 360 },
          children: [new TextRun({ text: "Table of Contents", bold: true, size: 32, font: EN_HEAD, color: PAL.heading })],
        }),
        new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({
            text: "Note: This Table of Contents is generated via field codes. To ensure page number accuracy after editing, please right-click the TOC and select \"Update Field.\"",
            italics: true, size: 18, color: "888888", font: EN,
          })],
        }),
        new Paragraph({ children: [new PageBreak()] }),
      ],
    },
    { // Section 3: Body — Arabic numerals from 1
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 },
          pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
        },
      },
      headers: { default: pageHeader() },
      footers: { default: pageNumFooter() },
      children: bodyChildren,
    },
  ],
});

const OUT = "/home/z/my-project/download/BhuRakshak-Complete-Study-Guide.docx";
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log("WROTE", OUT, buf.length, "bytes");
}).catch(e => { console.error("FAIL", e); process.exit(1); });
