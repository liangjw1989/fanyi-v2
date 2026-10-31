/* probe-blocks.js — 列出某页的块，检查是否有 y 区间重叠（会导致文字叠印）
 * 用法: node test/tools/probe-blocks.js <PDF> [页号]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const DL = path.join(ROOT, '.dl');
const pdfPath = process.argv[2];
const wantPage = parseInt(process.argv[3] || '1', 10);

const pdfjs = require(path.join(DL, 'pdf-node.js'));
try { pdfjs.GlobalWorkerOptions.workerSrc = path.join(DL, 'pdf-node.worker.js'); } catch (e) { }

const sb = {
  console, Math, Object, Array, String, Number, Map, Set, Uint8Array, DataView, ArrayBuffer,
  Error, JSON, isFinite, parseInt, parseFloat, atob, setTimeout, clearTimeout, Promise, Date,
  RegExp, TextEncoder, Blob: function () { }, URL: {},
  document: { createElement: () => ({ style: {}, textContent: '', innerHTML: '' }) }
};
sb.globalThis = sb; sb.window = sb;
const ctx = vm.createContext(sb);
for (const f of ['core.js', 'layout.js', 'pdf-extract.js', 'pdf-font.js', 'render-pdf-inplace.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const px = sb.LingyiPdfExtract;
const R = sb.LingyiPdfInPlace;

(async () => {
  const bytes = new Uint8Array(fs.readFileSync(pdfPath));
  const ir = await px.extractPDF({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
    { pdfjs: pdfjs, fileName: 'x.pdf', maxPages: wantPage });
  const p = (ir.pages || []).find(x => x.number === wantPage);
  if (!p) { console.log('没有这一页'); return; }
  const blocks = R.buildBlocks([{ number: p.number, width: p.width, height: p.height, lines: p.lines }])[0].blocks;
  console.log('页 ' + wantPage + '  行 ' + p.lines.length + '  块 ' + blocks.length);

  const sorted = blocks.slice().sort((a, b) => a.y - b.y);
  let overlap = 0;
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i], b = sorted[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 4 && oy > 2) {
        overlap++;
        if (overlap <= 8) {
          console.log('  重叠 #' + i + ' / #' + j + '  ox=' + Math.round(ox) + ' oy=' + Math.round(oy));
          console.log('     A y=' + Math.round(a.y) + ' h=' + Math.round(a.h) + ' x=' + Math.round(a.x) + ' ' + JSON.stringify(String(a.text).slice(0, 60)));
          console.log('     B y=' + Math.round(b.y) + ' h=' + Math.round(b.h) + ' x=' + Math.round(b.x) + ' ' + JSON.stringify(String(b.text).slice(0, 60)));
        }
      }
    }
  }
  console.log('重叠对数: ' + overlap);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
