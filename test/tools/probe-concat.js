/* probe-concat.js — 统计"拆行后仍被宽空档分成 2 块且左块窄"的行（= 真正的跨栏拼接）
 * 用法: node test/tools/probe-concat.js <原始PDF> [页数]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const DL = path.join(ROOT, '.dl');

const pdfPath = process.argv[2];
const maxPages = parseInt(process.argv[3] || '3', 10);
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
for (const f of ['core.js', 'layout.js', 'pdf-extract.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const px = sb.LingyiPdfExtract;
const L = sb.LingyiLayout;

/* 真正拼接的判据：行内含 ≥2 个"宽空档分隔的单元格"，且左单元格窄 */
function concatScore(ln, contentW, gapMin) {
  const items = (ln.items || []).slice().sort((a, b) => a.x0 - b.x0);
  const cuts = [];
  for (let i = 1; i < items.length; i++) {
    if (items[i].x0 - items[i - 1].x1 >= gapMin) cuts.push(i);
  }
  if (!cuts.length) return null;
  const first = cuts[0];
  const leftW = items[first - 1].x1 - items[0].x0;
  if (leftW >= contentW * 0.5) return null;      // 左块不窄 → 不是跨栏拼接
  return { leftW: leftW, text: String(items.map(x => x.str).join('')) };
}

(async () => {
  const bytes = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const n = Math.min(maxPages, doc.numPages);
  let totalBad = 0;
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items.filter(it => it && it.str !== undefined && String(it.str).length)
      .map(it => px.makeItem(it, tc.styles));
    const filtered = px.filterMargins(items, vp.height, vp.width, {});
    const norm = filtered.items;
    const raw = L.groupLines(norm);
    const contentW = Math.max.apply(null, norm.map(i => i.x1)) - Math.min.apply(null, norm.map(i => i.x0));
    const split = L.splitWideGapLines(raw, contentW, undefined);

    const badBefore = raw.filter(l => concatScore(l, contentW, 20)).length;
    const badAfter = split.filter(l => concatScore(l, contentW, 20)).length;
    totalBad += badAfter;
    console.log('  page ' + p + ': 行 ' + raw.length + '→' + split.length +
      '  跨栏拼接 ' + badBefore + '→' + badAfter +
      (badAfter ? '  ← 仍残留' : '  OK'));
    if (badAfter) {
      split.filter(l => concatScore(l, contentW, 20)).slice(0, 5).forEach(l => {
        const s = concatScore(l, contentW, 20);
        console.log('      leftW=' + Math.round(s.leftW) + ' ' + JSON.stringify(s.text.slice(0, 80)));
      });
    }
    /* 区域数 */
    const regions = L.analyzePage(norm, { pageWidth: vp.width });
    console.log('      区域 ' + regions.length + ': ' +
      regions.map(r => 'x' + Math.round(r.box.x0) + '~' + Math.round(r.box.x1) + '(' + r.lines.length + ')').join(' | '));
  }
  console.log('\n合计残留跨栏拼接行: ' + totalBad);
})().catch(e => { console.error('失败:', e && e.stack || e); process.exit(1); });
