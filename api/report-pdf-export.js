'use strict';

const DEBUG_LOGS =
  String(process.env.APP_DEBUG_LOGS || '').toLowerCase() === 'true' ||
  process.env.APP_DEBUG_LOGS === '1';
const MAX_HTML_BYTES = 2_500_000;

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
    const fileName = sanitizeFileName(req.body?.file_name);

    if (!html.trim()) {
      return res.status(400).json({ error: 'html is required' });
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
      const { puppeteer, launchArgs } = await getPuppeteer();
      browser = await puppeteer.launch({
        ...launchArgs,
        defaultViewport: { width: 1440, height: 2200, deviceScaleFactor: 2 }
      });

      const page = await browser.newPage();
      await page.setContent(html, {
        waitUntil: ['domcontentloaded', 'networkidle0'],
        timeout: 45000
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '12mm' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `
          <div style="width:100%;font-size:9px;color:#64748b;padding:0 10mm;display:flex;justify-content:space-between;">
            <span>Revencast Report ${reportId ? `• ${reportId.slice(0, 8)}` : ''}</span>
            <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
          </div>
        `
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return res.status(200).send(pdfBuffer);
    } finally {
      if (browser) {
        try { await browser.close(); } catch {}
      }
    }
  } catch (err) {
    setCors(res, 'POST, OPTIONS');
    logError('[report-pdf-export] failed:', err);
    return res.status(500).json({
      error: 'Failed to generate PDF',
      details: String(err?.message || err || 'Unknown error')
    });
  }
}

module.exports = handler;
module.exports.config = { runtime: 'nodejs' };
