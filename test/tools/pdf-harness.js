/* pdf-harness.js — 在真实浏览器里跑真实 pdf.js 抽取，输出块结构统计
 * 由 test/tools/trace-pdf.ps1 自动生成并驱动，不需要手工打开。
 *
 * 输出：把统计结果写进 <pre id="result">，浏览器 --dump-dom 就能读到。
 */
(function () {
  'use strict';
  const log = function (s) { document.getElementById('result').textContent += s + '\n'; };
  const stats = {};

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const len = bin.length;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  (async function main() {
    try {
      log('== 灵译 PDF 抽取诊断 ==');
      log('文件: ' + (window.__PDF_NAME__ || '?'));

      if (typeof pdfjsLib === 'undefined') { log('FATAL: pdfjsLib 未加载'); done(); return; }
      log('pdf.js: ' + (pdfjsLib.version || '?'));

      const b64 = (window.__PDF_PARTS__ || []).join('');
      if (!b64) { log('FATAL: 没有 PDF 数据'); done(); return; }
      const bytes = b64ToBytes(b64);
      log('PDF 字节数: ' + bytes.length + ' (' + (bytes.length / 1024 / 1024).toFixed(2) + ' MB)');

      /* ---- 1) 直接用 pdf.js 看每页有多少文字项 ---- */
      /* 诊断环境（file:// 无头浏览器）里 worker 常常起不来，必须禁用它 */
      log('worker 模式: 禁用（诊断环境用主线程解析）');
      const doc = await pdfjsLib.getDocument({ data: bytes, disableWorker: true, useWorkerFetch: false, isEvalSupported: false }).promise;
      log('总页数: ' + doc.numPages);
      const pageInfo = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        const n = tc.items.filter(it => it && it.str && String(it.str).length).length;
        const ops = await page.getOperatorList().catch(() => null);
        pageInfo.push({ page: p, w: Math.round(vp.width), h: Math.round(vp.height), items: n });
        log('  page ' + p + ': ' + Math.round(vp.width) + 'x' + Math.round(vp.height) + '  文字项=' + n);
      }
      stats.pages = pageInfo;
      const totalItems = pageInfo.reduce((a, b) => a + b.items, 0);
      log('文字项合计: ' + totalItems);
      if (totalItems === 0) {
        log('=> 这份 PDF 没有可提取的文字（扫描件/图片型），必须走 OCR');
        stats.textLayer = false;
        done(); return;
      }
      stats.textLayer = true;

      /* ---- 2) 跑项目自己的抽取流程 ---- */
      log('');
      log('== 跑项目抽取器 extractPDF ==');
      const file = { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
      const ir = await LingyiPdfExtract.extractPDF(file, { pdfjs: pdfjsLib, fileName: window.__PDF_NAME__ });

      const byType = {};
      ir.blocks.forEach(b => { byType[b.type] = (byType[b.type] || 0) + 1; });
      log('块统计: ' + JSON.stringify(byType));
      log('blocks 总数: ' + ir.blocks.length);
      log('bodySize: ' + ir.bodySize);
      if (ir.pages) log('pages: ' + ir.pages.length + '  ' + JSON.stringify(ir.pages.map(p => (p.width | 0) + 'x' + (p.height | 0))));

      /* 每个表格的规格 */
      const tables = ir.blocks.filter(b => b.type === 'table');
      log('');
      log('== 表格明细（共 ' + tables.length + ' 个）==');
      tables.forEach((t, i) => {
        const cols = (t.rows && t.rows[0]) ? t.rows[0].length : 0;
        const first = (t.rows && t.rows[0] || []).map(c => (c.text || '').slice(0, 14)).join('|');
        log('  表' + (i + 1) + ': ' + (t.rows ? t.rows.length : 0) + ' 行 x ' + cols + ' 列   首行: ' + first);
      });
      stats.tables = tables.map(t => ({ rows: t.rows ? t.rows.length : 0, cols: (t.rows && t.rows[0]) ? t.rows[0].length : 0 }));

      /* 文本块数量与抽样 */
      const texts = ir.blocks.filter(b => b.type === 'paragraph' || b.type === 'heading');
      log('');
      log('== 文本块（共 ' + texts.length + ' 个）抽样 ==');
      texts.slice(0, 12).forEach((b, i) => {
        const txt = LingyiCore.runsToText(b.runs || []);
        log('  ' + (i + 1) + '. [' + b.type + '] size=' + (b.size || '?') + ' ' + txt.slice(0, 80));
      });
      stats.textBlocks = texts.length;

      /* 页面几何：看看列检测结果 */
      if (ir.pages) {
        log('');
        log('== 每页的分栏信息 ==');
        ir.pages.forEach(p => {
          log('  page ' + p.number + ': columns=' + (p.columns ? p.columns.length : 0) +
            (p.columns ? '  x=' + JSON.stringify(p.columns.map(c => Math.round(c.x))) : ''));
        });
      }

      log('');
      log('DONE');
    } catch (e) {
      log('EXCEPTION: ' + (e && e.message ? e.message : e));
      log((e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : ''));
    }
    done();
  })();

  function done() {
    const pre = document.getElementById('result');
    const s = document.createElement('script');
    s.textContent = 'window.__DONE__ = true;';
    document.head.appendChild(s);
    pre.setAttribute('data-done', '1');
  }
})();
