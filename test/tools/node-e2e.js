/* node-e2e.js — 在 Node 里跑真实 PDF 的完整链路，生成可视检查用 PDF
 *
 * 用法:
 *   node test/tools/node-e2e.js <原始PDF> <输出PDF> [页号,页号] [--text 替换为原文]
 *
 * 目的：在没有浏览器的情况下验证「抽取 → 分块 → 绘制」的坐标与位置是否正确。
 * 做法：用 pdf.js(legacy, Node 可用) 抽取真实文字与坐标，走**线上同一套代码**
 *      （extractPDF → buildBlocks → buildOps → buildPdf），然后用 LibreOffice
 *      渲染生成的 PDF，逐页与原始 PDF 对比位置。
 *
 * 注意：这里不放原页底图（Node 里没有 canvas），所以结果只有"白底 + 文字"。
 *      检查点是：文字落点是否与原文位置一致（上下不翻转、不重叠、不错行）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const DL = path.join(ROOT, '.dl');

const pdfPath = process.argv[2];
const outPath = process.argv[3] || path.join(ROOT, 'test', 'out', 'node-e2e.pdf');
const pageArg = process.argv[4] || '1';

if (!pdfPath || !fs.existsSync(pdfPath)) {
  console.log('用法: node test/tools/node-e2e.js <原始PDF> <输出PDF> [页号]');
  process.exit(1);
}
if (!fs.existsSync(path.join(DL, 'pdf-node.js'))) {
  console.log('缺少 .dl/pdf-node.js（Node 版 pdf.js）');
  process.exit(1);
}

/* ---------- pdf.js（Node legacy 构建） ---------- */
const pdfjs = require(path.join(DL, 'pdf-node.js'));
try {
  pdfjs.GlobalWorkerOptions.workerSrc = path.join(DL, 'pdf-node.worker.js');
} catch (e) { /* 部分版本不需要 */ }

/* ---------- 在沙箱里加载线上模块 ---------- */
const sb = {
  console, Math, Object, Array, String, Number, Map, Set, Uint8Array, DataView, ArrayBuffer,
  Error, JSON, isFinite, parseInt, parseFloat, atob, setTimeout, clearTimeout, Promise, Date,
  RegExp, TextEncoder, Uint8Array: Uint8Array,
  Blob: function () { }, URL: {},
  document: { createElement: () => ({ style: {}, textContent: '', innerHTML: '' }) }
};
sb.globalThis = sb; sb.window = sb;
const ctx = vm.createContext(sb);
for (const f of ['core.js', 'layout.js', 'pdf-extract.js', 'pdf-font.js', 'render-pdf-inplace.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const core = sb.LingyiCore;
const px = sb.LingyiPdfExtract;
const F = sb.LingyiPdfFont;
const R = sb.LingyiPdfInPlace;

(async () => {
  const bytes = new Uint8Array(fs.readFileSync(pdfPath));
  console.log('原始 PDF: ' + path.basename(pdfPath) + '  ' + (bytes.length / 1024 / 1024).toFixed(2) + ' MB');

  /* 1) 抽取（与浏览器里同一函数） */
  const ir = await px.extractPDF(
    { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
    { pdfjs: pdfjs, fileName: path.basename(pdfPath), maxPages: 3 }
  );
  console.log('块数: ' + (ir.blocks || []).length + '   页数: ' + (ir.pages || []).length);
  (ir.pages || []).forEach(p => {
    console.log('  page ' + p.number + ': 行 ' + (p.lines || []).length +
      '  区域 ' + ((p.columns || []).length) +
      '  y 范围 ' + (p.lines && p.lines.length
        ? Math.round(Math.min.apply(null, p.lines.map(l => l.y))) + '~' + Math.round(Math.max.apply(null, p.lines.map(l => l.y)))
        : '-'));
  });

  /* 2) 分块（y 向上 → 向下） */
  const pagesIn = (ir.pages || []).map(p => ({
    number: p.number, width: p.width, height: p.height,
    lines: (p.lines || []).map(l => ({ x: l.x, x1: l.x1, y: l.y, size: l.size, text: l.text }))
  }));
  const blocksPages = R.buildBlocks(pagesIn);
  blocksPages.forEach(p => {
    const bs = p.blocks || [];
    console.log('  page ' + p.number + ': 块 ' + bs.length +
      (bs.length ? '  y 范围 ' + Math.round(Math.min.apply(null, bs.map(b => b.y))) +
        '~' + Math.round(Math.max.apply(null, bs.map(b => b.y))) : '') +
      (bs.length ? '  首块 y=' + Math.round(bs[0].y) + ' ' + JSON.stringify(String(bs[0].text).slice(0, 34)) : ''));
  });

  /* 3) 生成 PDF（白底 + 文字），页面尺寸与原页一致 */
  const fontPath = ['C:\\Windows\\Fonts\\simhei.ttf', 'C:\\Windows\\Fonts\\simfang.ttf',
    'C:\\Windows\\Fonts\\msyh.ttc'].find(p => { try { return fs.statSync(p).size > 100000; } catch (e) { return false; } });
  if (!fontPath) { console.log('没有可用中文字体'); process.exit(1); }
  const font = F.parseTtf(new Uint8Array(fs.readFileSync(fontPath)), 0);
  const used = new Map();

  const WHITE = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
    'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAED' +
    'ASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUF' +
    'BAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0' +
    'NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKj' +
    'pKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QA' +
    'HwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEE' +
    'BSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZH' +
    'SElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0' +
    'tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3' +
    '+iiigD//2Q==', 'base64');

  const outPages = blocksPages.map(p => ({
    width: p.width, height: p.height, pxW: 1, pxH: 1,
    jpeg: new Uint8Array(WHITE),
    ops: R.buildOps(p, p.height, F, font, used)
  }));
  const pdf = R.buildPdf({
    pages: outPages,
    fontObjs: F.buildFontObjects(font, used),
    title: 'node-e2e'
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(pdf));
  console.log('\n已生成: ' + outPath + '  (' + (pdf.length / 1024 / 1024).toFixed(2) + ' MB, ' +
    outPages.length + ' 页, 字形 ' + used.size + ')');
  console.log('检查点：每页文字落点应与原始 PDF 一致（标题在上、脚注在下、不重叠）');
})().catch(e => { console.error('失败:', e && e.message); process.exit(1); });
