'use strict';

const DEBUG_LOGS =
  String(process.env.APP_DEBUG_LOGS || '').toLowerCase() === 'true' ||
  process.env.APP_DEBUG_LOGS === '1';
const MAX_HTML_BYTES = 2_500_000;
const PDF_MARGIN_MM = { top: 16, right: 12, bottom: 16, left: 12 };
const A4_HEIGHT_MM = 297;
const PX_PER_MM = 96 / 25.4;

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

async function getPuppeteer() {
  const [puppeteerCoreMod, chromiumMod] = await Promise.all([
    import('puppeteer-core'),
    import('@sparticuz/chromium')
  ]);
  const puppeteer = puppeteerCoreMod.default || puppeteerCoreMod;
  const chromium = chromiumMod.default || chromiumMod;
  return {
    puppeteer,
    launchArgs: {
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true
    }
  };
}

async function injectTocPageNumbers(page) {
  const printableHeightPx = (A4_HEIGHT_MM - PDF_MARGIN_MM.top - PDF_MARGIN_MM.bottom) * PX_PER_MM;
  const tocPages = await page.evaluate((contentHeightPx) => {
    const anchors = [...document.querySelectorAll('[data-pdf-anchor]')];
    if (!anchors.length) return {};

    const pageMap = {};
    let currentPage = 3; // cover + TOC

    anchors.forEach((el) => {
      const id = String(el.getAttribute('data-pdf-anchor') || '').trim();
      if (!id) return;
      const elementHeight = Math.max(
        Number(el.scrollHeight || 0),
        Number(el.getBoundingClientRect().height || 0),
        1
      );
      const pageSpan = Math.max(1, Math.ceil(elementHeight / Math.max(contentHeightPx, 1)));
      pageMap[id] = currentPage;
      currentPage += pageSpan;
    });

    document.querySelectorAll('[data-toc-page-for]').forEach((node) => {
      const key = String(node.getAttribute('data-toc-page-for') || '').trim();
      const pageNo = pageMap[key];
      node.textContent = Number.isFinite(pageNo) ? String(pageNo) : '-';
    });

    return pageMap;
  }, printableHeightPx);

  logError('[report-pdf-export] TOC page map:', tocPages);
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

    const html = String(req.body?.html || '');
    const reportId = String(req.body?.report_id || '').trim();
    const incomingFileName = String(req.body?.file_name || '').trim();
    const fileName = sanitizeFileName(incomingFileName);

    if (!html.trim()) {
      return res.status(400).json({ error: 'html is required' });
    }
    if (!reportId) {
      return res.status(400).json({ error: 'report_id is required' });
    }
    if (!incomingFileName) {
      return res.status(400).json({ error: 'file_name is required' });
    }

    const htmlBytes = Buffer.byteLength(html, 'utf8');
    if (htmlBytes > MAX_HTML_BYTES) {
      return res.status(413).json({
        error: 'html payload too large',
        details: `Max allowed size is ${MAX_HTML_BYTES} bytes`
      });
    }

    let browser;
    try {
      logError('[report-pdf-export] Starting PDF generation for report:', reportId);
      
      const { puppeteer, launchArgs } = await getPuppeteer();
      logError('[report-pdf-export] Puppeteer loaded, launching browser...');
      
      browser = await puppeteer.launch({
        ...launchArgs,
        defaultViewport: { width: 1440, height: 2200, deviceScaleFactor: 2 }
      });
      logError('[report-pdf-export] Browser launched successfully');

      const page = await browser.newPage();
      logError('[report-pdf-export] New page created, setting content...');
      
      await page.setContent(html, {
        waitUntil: ['domcontentloaded', 'networkidle0'],
        timeout: 60000
      });
      logError('[report-pdf-export] Page content set, generating PDF...');

      // Pass 1: compute section start pages and inject TOC page numbers.
      await injectTocPageNumbers(page);
      // Pass 2: re-render the adjusted DOM before final PDF generation.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: `${PDF_MARGIN_MM.top}mm`,
          right: `${PDF_MARGIN_MM.right}mm`,
          bottom: `${PDF_MARGIN_MM.bottom}mm`,
          left: `${PDF_MARGIN_MM.left}mm`
        },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `
          <div style="width:100%;font-size:9px;color:#64748b;padding:0 10mm;display:flex;justify-content:space-between;">
            <span>Revencast Report ${reportId ? `• ${reportId.slice(0, 8)}` : ''}</span>
            <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
          </div>
        `
      });
      logError('[report-pdf-export] PDF generated successfully, size:', pdfBuffer.length, 'type:', typeof pdfBuffer);

      // Workaround for Vercel JSON serialization: send as base64
      try {
        // Ensure pdfBuffer is a Buffer, not something else
        const bufferToEncode = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
        const pdfBase64 = bufferToEncode.toString('base64');
        
        // Verify it's a string, not an object
        logError('[report-pdf-export] Base64 type:', typeof pdfBase64, 'length:', pdfBase64.length, 'first 50 chars:', pdfBase64.slice(0, 50));
        
        if (typeof pdfBase64 !== 'string') {
          throw new Error(`pdfBase64 is not a string, it's a ${typeof pdfBase64}`);
        }
        
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        
        // Build and serialize JSON explicitly
        const responseBody = JSON.stringify({
          success: true,
          data: pdfBase64,
          filename: fileName
        });
        
        logError('[report-pdf-export] Response body length:', responseBody.length);
        res.end(responseBody);
        return;
      } catch (encodeErr) {
        logError('[report-pdf-export] Base64 encoding failed:', encodeErr);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 500;
        res.end(JSON.stringify({
          error: 'PDF encoding failed',
          details: encodeErr?.message || 'Unknown encoding error'
        }));
        return;
      }
    } finally {
      if (browser) {
        try { await browser.close(); } catch {}
      }
    }
  } catch (err) {
    setCors(res, 'POST, OPTIONS');
    const errorMsg = String(err?.message || err || 'Unknown error');
    const errorStack = String(err?.stack || '');
    logError('[report-pdf-export] failed:', errorMsg);
    logError('[report-pdf-export] stack:', errorStack);
    return res.status(500).json({
      error: 'Failed to generate PDF',
      details: errorMsg,
      type: err?.constructor?.name || 'Error'
    });
  }
}

module.exports = handler;
module.exports.config = { runtime: 'nodejs' };
