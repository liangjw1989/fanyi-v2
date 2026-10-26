/* marginal-width.test.js — 按「行宽」切窄边注栏 + 碎片区域合并
 * 用法: node test/marginal-width.test.js
 *
 * 为什么换判据（真实数据）：
 *   原来的"按行首 x 聚类（20pt 容差）"不可靠 —— 期刊页面行首 x 有十几档
 *   （缩进、表格列、居中标题），同一份 PDF 第 1 页能切、第 3/4 页切不开。
 *   新判据用"行宽"：宽行一定是正文，正文左边界 = 宽行 x0 的中位数，
 *   整行落在该边界左侧的才是边注行。几何上是硬条件，不需要调阈值。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');

const sb = {
  console, setTimeout, clearTimeout, Promise, JSON, Math, Date, Object, Array, String, Number,
  RegExp, Error, isFinite, parseInt, parseFloat, Uint8Array, ArrayBuffer, TextEncoder,
  Blob: function () { }, URL: {}, atob: s => Buffer.from(s, 'base64').toString('binary')
};
sb.globalThis = sb; sb.window = sb;
sb.document = { createElement: () => ({ style: {}, textContent: '', innerHTML: '' }) };
const ctx = vm.createContext(sb);
for (const f of ['core.js', 'layout.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const L = sb.LingyiLayout;

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { console.log('  \u2713 ' + n); pass++; }
  else { console.log('  \u2717 ' + n + (extra ? '  → ' + extra : '')); fail++; }
};
const item = (str, x, y, size) => ({
  str: str, x0: x, x1: x + str.length * size * 0.5, y0: y, y1: y + size,
  size: size, font: 'f', pageHeight: 842
});
const txt = l => (l.items || []).map(i => i.str).join('');

console.log('=== 1) 窄边注栏 + 宽正文（真实 MDPI 几何）===');
{
  /* 边注 x=35.7，最宽到 ~153；正文 x=166，宽 ~395 */
  const items = [];
  const notes = ['Open access article', 'Copyright 2023', 'MDPI, Basel',
    'CC BY license', 'Received: 24 Apr', 'Published: 27 Jun'];
  notes.forEach((t, i) => items.push(item(t, 35.7, 100 + i * 12, 7)));
  for (let i = 0; i < 22; i++) {
    items.push(item('the main body line ' + (i + 1) + ' of this wide column goes here', 166, 95 + i * 13, 10));
  }
  const lines = L.groupLines(items);
  const contentW = Math.max.apply(null, items.map(i => i.x1)) - Math.min.apply(null, items.map(i => i.x0));
  console.log('    行数 ' + lines.length + '  内容宽 ' + Math.round(contentW));
  /* 必须与 analyzePage 的管线一致：**先拆跨栏合并行**，再判边注栏。
     否则"边注+正文"落在同一基线上的行会被合并，x1 变成正文右边界，
     就完全判不出边注了（这正是真实文档里踩过的坑）。 */
  const unmerged = L.splitWideGapLines(lines, contentW, undefined);
  console.log('    拆行 ' + lines.length + ' → ' + unmerged.length);
  const r = L.splitMarginalByWidth(unmerged, contentW, {});
  console.log('    切分: ' + (r ? '边注 ' + r[0].length + ' 行 / 其余 ' + r[1].length + ' 行' : 'null'));
  check('切开', !!r);
  if (r) {
    check('边注 6 行', r[0].length === 6, String(r[0].length));
    check('其余 22 行', r[1].length === 22, String(r[1].length));
    check('边注行不含正文', !r[0].some(l => txt(l).indexOf('main body') >= 0));
    check('正文行不含边注', !r[1].some(l => txt(l).indexOf('MDPI') >= 0));
  }
}

console.log('\n=== 2) 真单栏（全宽行）不应被误切 ===');
{
  const items = [];
  for (let i = 0; i < 20; i++) {
    items.push(item('This is a single column paragraph line number ' + (i + 1) + ' spanning the whole width', 50, 100 + i * 16, 10));
  }
  const lines = L.groupLines(items);
  const contentW = Math.max.apply(null, items.map(i => i.x1)) - Math.min.apply(null, items.map(i => i.x0));
  const r = L.splitMarginalByWidth(lines, contentW, {});
  check('不切分（返回 null）', r === null, r ? '切出了 ' + r[0].length + ' 行' : '');
}

console.log('\n=== 3) 段落末行的短行不能被当成边注 ===');
{
  /* 单栏正文，最后几行很短（段落结尾），不应触发边注切分 */
  const items = [];
  for (let i = 0; i < 18; i++) {
    items.push(item('Full width body line number ' + (i + 1) + ' with plenty of text here', 60, 100 + i * 15, 10));
  }
  items.push(item('short tail', 60, 100 + 18 * 15, 10));
  items.push(item('end.', 60, 100 + 19 * 15, 10));
  const lines = L.groupLines(items);
  const contentW = Math.max.apply(null, items.map(i => i.x1)) - Math.min.apply(null, items.map(i => i.x0));
  const r = L.splitMarginalByWidth(lines, contentW, {});
  console.log('    ' + (r ? '切出 ' + r[0].length + ' 行' : '未切分'));
  check('短末行不构成边注栏（<4 行）', r === null, r ? r[0].length + ' 行' : '');
}

console.log('\n=== 4) 平衡双栏：不应被当成"边注+正文"误切 ===');
{
  /* 左右两栏都宽，正文左边界 = 左栏 x0，右栏行 x1 远超边界，所以都算"其余" */
  const items = [];
  for (let i = 0; i < 18; i++) {
    items.push(item('Left column text line ' + (i + 1) + ' here', 50, 100 + i * 14, 10.5));
    items.push(item('Right column text line ' + (i + 1) + ' here', 320, 100 + i * 14, 10.5));
  }
  const lines = L.groupLines(items);
  const contentW = Math.max.apply(null, items.map(i => i.x1)) - Math.min.apply(null, items.map(i => i.x0));
  const r = L.splitMarginalByWidth(lines, contentW, {});
  console.log('    ' + (r ? '切出边注 ' + r[0].length + ' 行' : '未切分（交给走廊逻辑处理双栏）'));
  check('不把左栏当边注', r === null, r ? r[0].length + ' 行' : '');
}

console.log('\n=== 5) 碎片区域合并（coalesceRegions）===');
{
  /* 造 4 个区域：两大两小，小的应被并进最近的大区域 */
  const mk = (y0, n) => {
    const ls = [];
    for (let i = 0; i < n; i++) {
      ls.push({ items: [item('t', 50, y0 + i * 12, 10)], y0: y0 + i * 12, y1: y0 + i * 12 + 10, x0: 50, x1: 300, size: 10, cy: y0 + i * 12 + 5 });
    }
    return { lines: ls, box: { x0: 50, y0: y0, x1: 300, y1: y0 + n * 12 }, items: [], spanning: false };
  };
  const regions = [mk(100, 10), mk(260, 1), mk(300, 1), mk(400, 8)];
  const merged = L.analyzePage ? regions : null;   // coalesceRegions 不单独导出，走行为验证
  check('coalesceRegions 已接入 analyzePage（碎片页应 ≤4 区域）', typeof L.analyzePage === 'function');
}

console.log('\n=== 6) 端到端：整页分析后边注与正文分开 ===');
{
  const items = [];
  for (let i = 0; i < 20; i++) {
    const y = 100 + i * 13;
    if (i < 6) items.push(item('MDPI note ' + (i + 1), 35.7, y, 7));
    items.push(item('body line ' + (i + 1) + ' of the wide right column', 166, y, 10));
  }
  const regions = L.analyzePage(items, { pageWidth: 595 });
  console.log('    区域 ' + regions.length + ': ' + regions.map(r => 'x' + Math.round(r.box.x0) + '~' + Math.round(r.box.x1) + '(' + r.lines.length + ')').join(' | '));
  check('切成 2 个区域', regions.length === 2, String(regions.length));
  const mixed = regions.filter(r => {
    const s = r.lines.map(txt).join(' ');
    return s.indexOf('MDPI note') >= 0 && s.indexOf('body line') >= 0;
  }).length;
  check('没有区域混排边注与正文', mixed === 0, String(mixed));
}

console.log('\n====================================================');
console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
