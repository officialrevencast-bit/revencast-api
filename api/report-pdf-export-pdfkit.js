'use strict';

const PDFDocument = require('pdfkit');

const DEBUG_LOGS =
  String(process.env.APP_DEBUG_LOGS || '').toLowerCase() === 'true' ||
  process.env.APP_DEBUG_LOGS === '1';

function logError(...args) {
  if (DEBUG_LOGS) console.error(...args);
}

function sanitizeFileName(name) {
  const cleaned = String(name || 'revencast_report.pdf')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned) return 'revencast_report.pdf';
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

function clampText(text, max = 220) {
  const t = String(text || '').trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function drawPageBackground(doc, color) {
  doc.save();
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(color);
  doc.restore();
}

function drawCover(doc, meta) {
  const bg = '#0a0e1a';
  const accent = '#5ed3f3';
  const accent2 = '#7b61ff';
  const muted = '#9aa9c7';
  const white = '#f5f7ff';

  drawPageBackground(doc, bg);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;

  // Decorative bands.
  doc.save();
  doc
    .fillColor(accent)
    .opacity(0.18)
    .rect(0, 0, doc.page.width, 130)
    .fill();
  doc
    .fillColor(accent2)
    .opacity(0.14)
    .rect(0, doc.page.height - 180, doc.page.width, 180)
    .fill();
  doc.opacity(1);
  doc.restore();

  doc.fillColor(white);
  doc.font('Helvetica-Bold').fontSize(30).text('Revencast', left, 96, { width: right - left });
  doc
    .font('Helvetica')
    .fillColor(muted)
    .fontSize(12)
    .text('AI-generated business report', left, doc.y + 6, { width: right - left });

  doc.moveDown(1.2);
  doc.fillColor(white);
  doc.font('Helvetica-Bold').fontSize(22).text(normalizeText(meta.idea_name || 'Report'), {
    width: right - left
  });

  const chips = [
    meta.target_country ? { k: 'Target', v: meta.target_country } : null,
    meta.generated_at ? { k: 'Generated', v: meta.generated_at } : null,
    meta.report_id_short ? { k: 'Report ID', v: meta.report_id_short } : null
  ].filter(Boolean);

  doc.moveDown(1.2);
  const chipY = doc.y;
  const chipH = 22;
  let x = left;
  for (const c of chips) {
    const label = `${c.k}: ${c.v}`;
    const w = Math.min(240, Math.max(120, doc.widthOfString(label, { font: 'Helvetica', size: 10 }) + 18));
    doc.save();
    doc
      .fillColor('#111827')
      .opacity(0.9)
      .roundedRect(x, chipY, w, chipH, 10)
      .fill();
    doc.opacity(1);
    doc
      .strokeColor(accent)
      .opacity(0.22)
      .roundedRect(x, chipY, w, chipH, 10)
      .stroke();
    doc.opacity(1);
    doc.fillColor('#eaf0ff').font('Helvetica').fontSize(10).text(label, x + 10, chipY + 6, {
      width: w - 20,
      ellipsis: true
    });
    doc.restore();
    x += w + 10;
    if (x > right - 120) {
      x = left;
      doc.y = chipY + chipH + 10;
    }
  }

  doc.y = Math.max(doc.y, chipY + chipH + 18);

  doc
    .fillColor(muted)
    .font('Helvetica')
    .fontSize(11)
    .text(
      'This report is generated from your simulation inputs plus research signals and strategic analysis. Treat it as a decision-support artifact, not financial advice.',
      left,
      doc.y + 18,
      { width: right - left, lineGap: 2 }
    );
}

function drawIndexTitle(doc) {
  drawPageBackground(doc, '#ffffff');
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  doc.fillColor('#0b1220').font('Helvetica-Bold').fontSize(22).text('Index', left, 58, {
    width: right - left
  });
  doc
    .fillColor('#5b6b88')
    .font('Helvetica')
    .fontSize(11)
    .text('Jump to a section (clickable in most PDF readers).', left, doc.y + 6, { width: right - left });
  doc.moveDown(1.2);
}

function drawSectionTitle(doc, title) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  drawPageBackground(doc, '#ffffff');

  // Accent bar.
  doc.save();
  doc.fillColor('#5ed3f3').opacity(0.16).rect(0, 0, doc.page.width, 58).fill();
  doc.opacity(1);
  doc.restore();

  doc
    .fillColor('#0b1220')
    .font('Helvetica-Bold')
    .fontSize(20)
    .text(normalizeText(title || 'Section'), left, 20, { width: right - left });
  doc.y = 78;
}

function ensureRoom(doc, minHeight) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + minHeight > bottom) {
    doc.addPage();
    return true;
  }
  return false;
}

function renderParagraph(doc, text) {
  const t = normalizeText(text);
  if (!t) return;
  doc.fillColor('#1b2b44').font('Helvetica').fontSize(11);
  doc.text(t, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, lineGap: 2 });
  doc.moveDown(0.65);
}

function renderHeading(doc, text, level) {
  const t = normalizeText(text);
  if (!t) return;
  ensureRoom(doc, 26);
  doc.fillColor('#0b1220').font('Helvetica-Bold').fontSize(level === 2 ? 14 : 12);
  doc.text(t, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
  doc.moveDown(0.4);
}

function renderList(doc, items) {
  const arr = Array.isArray(items) ? items.map(normalizeText).filter(Boolean) : [];
  if (!arr.length) return;
  doc.fillColor('#1b2b44').font('Helvetica').fontSize(11);
  const left = doc.page.margins.left;
  const maxW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bulletIndent = 12;
  for (const item of arr) {
    ensureRoom(doc, 16);
    const y = doc.y;
    doc
      .fillColor('#5ed3f3')
      .circle(left + 2, y + 6, 1.6)
      .fill();
    doc.fillColor('#1b2b44');
    doc.text(item, left + bulletIndent, y, { width: maxW - bulletIndent, lineGap: 2 });
    doc.moveDown(0.3);
  }
  doc.moveDown(0.35);
}

function renderKeyValue(doc, rows) {
  const arr = Array.isArray(rows) ? rows : [];
  if (!arr.length) return;
  const left = doc.page.margins.left;
  const maxW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const keyW = Math.min(190, Math.max(140, maxW * 0.34));
  const valW = maxW - keyW - 14;

  for (const r of arr) {
    const key = normalizeText(r?.key);
    const val = normalizeText(r?.value);
    if (!key && !val) continue;
    ensureRoom(doc, 22);

    const y = doc.y;
    doc.save();
    doc
      .strokeColor('#e7eefc')
      .lineWidth(1)
      .moveTo(left, y - 2)
      .lineTo(left + maxW, y - 2)
      .stroke();
    doc.restore();

    doc.fillColor('#5b6b88').font('Helvetica-Bold').fontSize(9).text(key || '-', left, y, {
      width: keyW,
      lineGap: 2
    });
    doc.fillColor('#1b2b44').font('Helvetica').fontSize(11).text(val || '-', left + keyW + 14, y, {
      width: valW,
      lineGap: 2
    });

    doc.y = Math.max(doc.y, y + 18);
    doc.moveDown(0.25);
  }
  doc.moveDown(0.45);
}

function renderStats(doc, cards) {
  const arr = Array.isArray(cards) ? cards : [];
  const items = arr.filter((c) => normalizeText(c?.label) || normalizeText(c?.value));
  if (!items.length) return;

  const left = doc.page.margins.left;
  const maxW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gap = 10;
  const cols = 3;
  const boxW = (maxW - gap * (cols - 1)) / cols;
  const boxH = 64;

  let i = 0;
  while (i < items.length) {
    ensureRoom(doc, boxH + 10);
    const rowY = doc.y;
    for (let c = 0; c < cols && i < items.length; c++, i++) {
      const item = items[i];
      const x = left + c * (boxW + gap);
      doc.save();
      doc.fillColor('#f4f8ff').roundedRect(x, rowY, boxW, boxH, 10).fill();
      doc.strokeColor('#e2ecff').roundedRect(x, rowY, boxW, boxH, 10).stroke();
      doc.restore();

      doc.fillColor('#5b6b88').font('Helvetica-Bold').fontSize(9).text(clampText(item.label, 60), x + 10, rowY + 10, {
        width: boxW - 20
      });
      doc.fillColor('#0b1220').font('Helvetica-Bold').fontSize(14).text(clampText(item.value, 32), x + 10, rowY + 24, {
        width: boxW - 20
      });
      const d = normalizeText(item.description);
      if (d) {
        doc.fillColor('#5b6b88').font('Helvetica').fontSize(9).text(clampText(d, 100), x + 10, rowY + 44, {
          width: boxW - 20
        });
      }
    }
    doc.y = rowY + boxH + 12;
  }
  doc.moveDown(0.25);
}

function renderLink(doc, text, href) {
  const label = normalizeText(text) || normalizeText(href);
  if (!label) return;
  ensureRoom(doc, 18);
  const startY = doc.y;
  const left = doc.page.margins.left;
  doc.fillColor('#0b1220').font('Helvetica').fontSize(11).text(label, left, startY, {
    underline: true,
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right
  });
  const w = doc.widthOfString(label);
  if (href) {
    try {
      doc.link(left, startY, Math.min(w + 2, 520), 14, href);
    } catch {}
  }
  doc.moveDown(0.5);
}

function renderBlocks(doc, blocks) {
  const arr = Array.isArray(blocks) ? blocks : [];
  for (const b of arr) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'h') renderHeading(doc, b.text, Number(b.level) || 3);
    else if (b.type === 'p') renderParagraph(doc, b.text);
    else if (b.type === 'list') renderList(doc, b.items);
    else if (b.type === 'kv') renderKeyValue(doc, b.rows);
    else if (b.type === 'stats') renderStats(doc, b.cards);
    else if (b.type === 'link') renderLink(doc, b.text, b.href);
  }
}

function calcTocPages(doc, entryCount) {
  const top = 120; // space for Index title
  const bottom = doc.page.height - doc.page.margins.bottom - 52;
  const rowH = 18;
  const perPage = Math.max(1, Math.floor((bottom - top) / rowH));
  const pages = Math.max(1, Math.ceil(entryCount / perPage));
  return { pages, perPage, rowH, top };
}

function fillToc(doc, { tocStartIndex, tocPages, meta, entries, sectionStartPages }) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;

  // We assume the page size/margins remain consistent across buffered pages.
  const layout = calcTocPages(doc, entries.length);

  for (let p = 0; p < tocPages; p++) {
    doc.switchToPage(tocStartIndex + p);
    drawIndexTitle(doc);

    const start = p * layout.perPage;
    const end = Math.min(entries.length, start + layout.perPage);
    let y = layout.top;

    for (let i = start; i < end; i++) {
      const title = String(entries[i] || '').trim() || 'Section';
      const pageNo = Number(sectionStartPages[title] || 0) || 0;

      doc.fillColor('#0b1220').font('Helvetica').fontSize(11);
      const titleW = Math.min(390, right - left - 90);
      const titleText = clampText(title, 90);
      doc.text(titleText, left, y, { width: titleW, continued: false });

      // Dot leaders.
      const dotsStartX = left + titleW + 8;
      const pageText = pageNo ? String(pageNo) : '-';
      const pageW = doc.widthOfString(pageText, { font: 'Helvetica-Bold', size: 11 });
      const dotsEndX = right - pageW - 2;
      if (dotsEndX > dotsStartX) {
        doc.save();
        doc.fillColor('#c6d3ee').font('Helvetica').fontSize(10);
        const dotW = doc.widthOfString('.', { font: 'Helvetica', size: 10 });
        const count = Math.max(0, Math.floor((dotsEndX - dotsStartX) / Math.max(dotW, 1)));
        const dots = '.'.repeat(Math.min(count, 160));
        doc.text(dots, dotsStartX, y + 1, { width: Math.max(10, dotsEndX - dotsStartX) });
        doc.restore();
      }

      doc.fillColor('#0b1220').font('Helvetica-Bold').fontSize(11).text(pageText, right - pageW, y);

      // Clickable link area (PDFKit supports page links in many readers).
      if (pageNo) {
        try {
          doc.link(left, y - 2, right - left, layout.rowH, { page: Math.max(0, pageNo - 1) });
        } catch (e) {
          logError('[pdfkit toc] link failed', e?.message || e);
        }
      }

      y += layout.rowH;
    }

    // Meta footer on TOC pages.
    if (meta?.report_id_short) {
      doc
        .fillColor('#5b6b88')
        .font('Helvetica')
        .fontSize(9)
        .text(`Report ${String(meta.report_id_short).trim()}`, left, doc.page.height - doc.page.margins.bottom - 20);
    }
  }
}

function addFooters(doc, meta) {
  const range = doc.bufferedPageRange();
  const total = range.count;
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;

  for (let i = 0; i < total; i++) {
    doc.switchToPage(i);

    const y = doc.page.height - doc.page.margins.bottom + 10;
    doc.save();
    doc.fillColor('#5b6b88').font('Helvetica').fontSize(9);
    const leftText = `Revencast Report${meta?.report_id_short ? ` | ${String(meta.report_id_short).trim()}` : ''}`;
    doc.text(leftText, left, y, { width: right - left - 60 });
    doc.text(`${i + 1} / ${total}`, right - 50, y, { width: 50, align: 'right' });
    doc.restore();
  }
}

async function handler(req, res) {
  const { authorizeRequest, setCors } = await import('./_auth-utils.js');
  setCors(res, 'POST, OPTIONS');

  try {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const auth = await authorizeRequest(req, res);
    if (!auth || !auth.ok) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const reportId = String(req.body?.report_id || '').trim();
    const incomingFileName = String(req.body?.file_name || '').trim();
    const fileName = sanitizeFileName(incomingFileName);
    const meta = req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : {};
    const sections = Array.isArray(req.body?.sections) ? req.body.sections : [];

    if (!reportId) return res.status(400).json({ error: 'report_id is required' });
    if (!incomingFileName) return res.status(400).json({ error: 'file_name is required' });
    if (!sections.length) return res.status(400).json({ error: 'sections are required' });

    const pdfBuffer = await new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 54, bufferPages: true });
        const chunks = [];
        doc.on('data', (d) => chunks.push(d));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Cover page (page 1).
        drawCover(doc, {
          idea_name: meta.idea_name,
          target_country: meta.target_country,
          generated_at: meta.generated_at,
          report_id_short: meta.report_id_short
        });

        // Reserve TOC pages (page 2..).
        const tocEntries = sections.map((s) => String(s?.title || '').trim()).filter(Boolean);
        const { pages: tocPages } = calcTocPages(doc, tocEntries.length);
        const tocStartIndex = 1; // 0 = cover
        for (let i = 0; i < tocPages; i++) doc.addPage();

        // Content pages start after TOC.
        const sectionStartPages = {};
        for (const section of sections) {
          const title = String(section?.title || 'Section').trim() || 'Section';
          doc.addPage();
          sectionStartPages[title] = doc.bufferedPageRange().count; // 1-based page number

          drawSectionTitle(doc, title);
          renderBlocks(doc, section?.blocks);
        }

        // Fill TOC once we know start pages.
        fillToc(doc, {
          tocStartIndex,
          tocPages,
          meta,
          entries: tocEntries,
          sectionStartPages
        });

        // Page numbers + footer (post-pass).
        addFooters(doc, { report_id_short: meta.report_id_short });

        doc.end();
      } catch (e) {
        reject(e);
      }
    });

    const pdfBase64 = pdfBuffer.toString('base64');
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        data: pdfBase64,
        filename: fileName
      })
    );
    return;
  } catch (err) {
    setCors(res, 'POST, OPTIONS');
    const errorMsg = String(err?.message || err || 'Unknown error');
    logError('[report-pdf-export-pdfkit] failed:', errorMsg);
    return res.status(500).json({
      error: 'Failed to generate PDF',
      details: errorMsg,
      type: err?.constructor?.name || 'Error'
    });
  }
}

module.exports = handler;
module.exports.config = { runtime: 'nodejs' };

