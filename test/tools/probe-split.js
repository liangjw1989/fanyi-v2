/* probe-split.js — 对单行复现 splitWideGapLines 的判定过程
 * 用法: node test/tools/probe-split.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = path.join(__dirname, '..', '..', 'src');

const sb = {
  console, Math, Object, Array, String, Number, Map, Set, Uint8Array, DataView, ArrayBuffer,
  Error, JSON, isFinite, parseInt, parseFloat, atob, setTimeout, clearTimeout, Promise, Date,
  RegExp, TextEncoder, Blob: function () { }, URL: {},
  document: { createElement: () => ({ style: {}, textContent: '', innerHTML: '' }) }
};
sb.globalThis = sb; sb.window = sb;
const ctx = vm.createContext(sb);
for (const f of ['core.js', 'layout.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const L = sb.LingyiLayout;

const it = (str, x0, x1, y, size) => ({ str, x0, x1, y0: y, y1: y + size, size, font: 'f', pageHeight: 842 });

/* 真实第 1 页 y=147 那行的片段（来自 probe-lines 输出） */
const items = [
  it('Copyright:', 36, 70, 147, 6.9738),
  it(' ', 70, 76, 147, 6.9738),
  it('© 2023 by the authors.', 76, 153, 147, 6.9738),
  it('expression profiles and regulatory funct', 166, 440, 147, 9.9626),
  it(' ', 440, 440, 147, 9.9626)
];

const lines = L.groupLines(items);
console.log('groupLines → ' + lines.length + ' 行');
const ln = lines[0];
console.log('  片段 ' + ln.items.length + '  span=' + Math.round(ln.x1 - ln.x0) +
  ' size=' + ln.size + '  x0=' + ln.x0 + ' x1=' + ln.x1);

const contentW = 526;
/* 复现内部判据 */
const sizeRef = ln.size || 10;
const gapMin = Math.max(20, sizeRef * 2);
const jumpMin = Math.max(60, contentW * 0.15);
console.log('  gapMin=' + gapMin.toFixed(1) + '  jumpMin=' + jumpMin.toFixed(1));

const sorted = ln.items.slice().sort((a, b) => a.x0 - b.x0);
let best = null;
for (let i = 1; i < sorted.length; i++) {
  const gap = sorted[i].x0 - sorted[i - 1].x1;
  const startJump = (sorted[i].x0 - sorted[0].x0) - (sorted[i - 1].x0 - sorted[0].x0);
  let score = 0, why = '';
  if (gap >= gapMin) { score = gap; why = 'gap'; }
  else if (startJump >= jumpMin) { score = startJump * 0.6; why = 'jump'; }
  console.log('    i=' + i + ' gap=' + gap.toFixed(1) + ' startJump=' + startJump.toFixed(1) +
    ' → ' + (score > 0 ? 'score=' + score.toFixed(1) + ' (' + why + ')' : '不满足'));
  if (score > 0 && (!best || score > best.score)) best = { score, at: i };
}

/* 表格保护判据 */
const multi = [ln].filter(l => (l.items || []).length >= 3);
console.log('  表格保护: 该行片段数=' + ln.items.length + '（≥3 则算"多列块"）');
console.log('    整页假设 55 行中多数行片段数 ≥3 → 保护可能触发');

if (best) {
  const leftW = sorted[best.at - 1].x1 - sorted[0].x0;
  console.log('  最强切割点 i=' + best.at + '  leftW=' + leftW.toFixed(1) +
    '  阈值 contentW*0.5=' + (contentW * 0.5));
  console.log('  → ' + (leftW >= contentW * 0.5 ? '被 leftW 判据拒绝（左块太宽）' : '会拆开'));
} else {
  console.log('  → 没有任何切割点满足判据');
}

const out = L.splitWideGapLines(lines, contentW, undefined);
console.log('\nsplitWideGapLines 结果: ' + out.length + ' 行');
out.forEach((l, i) => console.log('  #' + i + ' x0=' + Math.round(l.x0) + ' ' +
  JSON.stringify(String(l.items.map(x => x.str).join('')).slice(0, 70))));
