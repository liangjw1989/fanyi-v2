/* probe-lines.js — 检查哪些行仍然把"边注 + 正文"拼在一起，以及为什么没被拆开
 * 用法: node test/tools/probe-lines.js <原始PDF> [页号]
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
for (const f of ['core.js', 'layout.js', 'pdf-extract.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const px = sb.LingyiPdfExtract;
const L = sb.LingyiLayout;

(async () => {
  const bytes = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const page = await doc.getPage(wantPage);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = tc.items.filter(it => it && it.str !== undefined && String(it.str).length)
    .map(it => px.makeItem(it, tc.styles));
  const filtered = px.filterMargins(items, vp.height, vp.width, {});
  const norm = px.__normalize ? px.__normalize(filtered.items, vp.width, vp.height) : filtered.items;

  const raw = L.groupLines(norm);
  const contentW = Math.max.apply(null, norm.map(i => i.x1)) - Math.min.apply(null, norm.map(i => i.x0));
  console.log('页 ' + wantPage + '  页宽 ' + Math.round(vp.width) + '  文字项 ' + norm.length +
    '  行 ' + raw.length + '  内容宽 ' + Math.round(contentW));

  /* 找"看起来像拼接"的行：同一行里既有明显靠左的片段、又有靠右的片段 */
  const susp = raw.filter(ln => {
    const its = (ln.items || []).slice().sort((a, b) => a.x0 - b.x0);
    if (its.length < 2) return false;
    return (its[its.length - 1].x0 - its[0].x0) > 90;
  });
  console.log('可疑拼接行（首末片段 x 差 > 90pt）: ' + susp.length);
  susp.slice(0, 8).forEach((ln, i) => {
    const its = (ln.items || []).slice().sort((a, b) => a.x0 - b.x0);
    console.log('  #' + i + ' y=' + Math.round(ln.y0) + ' size=' + ln.size +
      ' span=' + Math.round(ln.x1 - ln.x0) + ' 片段=' + its.length);
    its.slice(0, 5).forEach(it => console.log('      x ' + Math.round(it.x0) + '~' + Math.round(it.x1) +
      ' sz=' + Math.round((it.size || 0) * 10) / 10 + ' ' + JSON.stringify(String(it.str).slice(0, 40))));
    console.log('      文本: ' + JSON.stringify(String(ln.items.map(x => x.str).join('')).slice(0, 90)));
  });

  const split = L.splitWideGapLines(raw, contentW, undefined);
  console.log('\n拆行: ' + raw.length + ' → ' + split.length + '（拆开 ' + (split.length - raw.length) + ' 条）');

  /* 拆后还有多少可疑拼接 */
  const susp2 = split.filter(ln => {
    const its = (ln.items || []).slice().sort((a, b) => a.x0 - b.x0);
    if (its.length < 2) return false;
    return (its[its.length - 1].x0 - its[0].x0) > 90;
  });
  console.log('拆后可疑拼接行: ' + susp2.length);
  susp2.slice(0, 6).forEach((ln, i) => {
    const its = (ln.items || []).slice().sort((a, b) => a.x0 - b.x0);
    console.log('  #' + i + ' y=' + Math.round(ln.y0) + ' span=' + Math.round(ln.x1 - ln.x0) +
      ' 片段=' + its.length + ' 文本=' + JSON.stringify(String(ln.items.map(x => x.str).join('')).slice(0, 80)));
  });
})().catch(e => { console.error('失败:', e && e.stack || e); process.exit(1); });
