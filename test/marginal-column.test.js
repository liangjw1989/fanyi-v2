/* marginal-column.test.js — 「宽正文栏 + 窄左边注栏」必须切成两块（不能交错）
 * 用法: node test/marginal-column.test.js
 *
 * 背景（来自真实诊断报告）：
 *   MDPI 期刊版式 = 宽正文栏（x≈166）+ 窄左边注栏（x≈36，放版权声明、
 *   投稿日期、DOI、通讯作者）。原实现发现走廊后要求"左右各 ≥3 行且比例
 *   ≥0.2"，左侧内容太少就整个退回单栏 → 按 y 排序读 → 正文与边注**逐行交替**，
 *   读者看到的就是"句子被截断"。
 * 本测试断言：这种情况必须切成两块独立区域，且各自的阅读顺序正确。
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

/** 造文字项 */
function item(str, x, y, size) {
  return {
    str: str, x0: x, x1: x + str.length * size * 0.5, y0: y, y1: y + size,
    size: size, font: 'f', pageHeight: 842
  };
}

/** MDPI 式页面：窄左边注（x=36，6.97pt）+ 宽正文（x=166，9.96pt） */
function mkMdpiPage() {
  const items = [];
  /* 左边注：版权/日期/DOI —— 只占页面上半部分（约 12 行）。
     文本长度刻意控制在"不越过 x=166（正文起点）"的范围内，
     这正是真实 MDPI 版式的形态：边注栏窄，与正文栏之间有明显空档。
     （若边注行过长而越过正文起点，两栏 x 区间重叠，就不该判为两栏——
       那种情况下保持单栏才是正确的，见场景 5。） */
  const notes = [
    'Open access article',
    'Copyright: © 2023',
    'Licensee MDPI, Basel',
    'under the terms and',
    'Creative Commons',
    'CC BY license',
    'Received: 24 Apr 2023',
    'Revised: 20 Jun 2023',
    'Accepted: 27 Jun 2023',
    'Published: 27 Jun 2023',
    'doi.org/10.3390/x',
    '* Correspondence: a@b.c'
  ];
  notes.forEach((t, i) => items.push(item(t, 36, 90 + i * 12, 6.97)));
  /* 右侧正文：30 行（远多于左边注） */
  for (let i = 0; i < 30; i++) {
    items.push(item('Body text line number ' + (i + 1) + ' of the main wide column', 166, 72 + i * 12, 9.96));
  }
  return items;
}

/** 普通双栏平衡页面（左右各 15 行）——不应被新逻辑破坏 */
function mkBalancedPage() {
  const items = [];
  for (let i = 0; i < 15; i++) items.push(item('Left column line number ' + (i + 1), 50, 100 + i * 14, 10.5));
  for (let i = 0; i < 15; i++) items.push(item('Right column line number ' + (i + 1), 320, 100 + i * 14, 10.5));
  return items;
}

/** 真单栏页面（每行都横跨整宽）——必须保持单栏 */
function mkSingleColumnPage() {
  const items = [];
  for (let i = 0; i < 24; i++) {
    items.push(item('This is a single column paragraph line number ' + (i + 1) + ' spanning the full width of the page', 50, 100 + i * 16, 10.5));
  }
  return items;
}

console.log('=== 1) MDPI 式：窄左边注 + 宽正文（关键场景）===');
{
  const regions = L.analyzePage(mkMdpiPage(), {});
  console.log('    区域数: ' + regions.length);
  regions.forEach((r, i) => {
    console.log('      区域' + i + ': x=' + Math.round(r.box.x0) + '~' + Math.round(r.box.x1) +
      '  行数=' + r.lines.length);
  });
  check('切成 ≥2 个区域（不再退回单栏）', regions.length >= 2, '实际 ' + regions.length);

  /* 关键断言：任一行区域内，不能同时包含"左边注"与"右正文" */
  let mixed = 0;
  regions.forEach(r => {
    const txtOf = l => (l.items || []).map(i => i.str).join('');
    const hasNote = r.lines.some(l => txtOf(l).indexOf('Creative Commons') >= 0 || txtOf(l).indexOf('Received:') >= 0);
    const hasBody = r.lines.some(l => txtOf(l).indexOf('Body text line') >= 0);
    if (hasNote && hasBody) mixed++;
  });
  check('没有"边注与正文混在同一区域"的情况', mixed === 0, mixed + ' 个区域混排');

  /* 主栏（正文）应完整包含 30 行 */
  const txtOf2 = l => (l.items || []).map(i => i.str).join('');
  const bodyRegion = regions.find(r => r.lines.some(l => txtOf2(l).indexOf('Body text line') >= 0));
  check('正文 30 行在同一区域内（阅读顺序正确）', !!bodyRegion && bodyRegion.lines.length >= 30,
    bodyRegion ? String(bodyRegion.lines.length) : '未找到正文区域');

  /* 正文区域内的行必须按 y 递增（顺序正确） */
  if (bodyRegion) {
    const ys = bodyRegion.lines.map(l => l.y0);
    let ok = true;
    for (let i = 1; i < ys.length; i++) if (ys[i] < ys[i - 1] - 0.5) ok = false;
    check('正文区域内按 y 递增（顺序正确）', ok);
  }

  /* 边注区域应包含 CC 与日期 */
  const noteRegion = regions.find(r => r.lines.some(l => txtOf2(l).indexOf('Creative Commons') >= 0));
  check('边注单独成一个区域', !!noteRegion);
}

console.log('\n=== 2) 平衡双栏（原行为，不能被破坏）===');
{
  const regions = L.analyzePage(mkBalancedPage(), {});
  console.log('    区域数: ' + regions.length);
  check('仍然切成 ≥2 个区域', regions.length >= 2, '实际 ' + regions.length);
  const t3 = l => (l.items || []).map(i => i.str).join('');
  const left = regions.find(r => r.lines.some(l => t3(l).indexOf('Left column') >= 0));
  const right = regions.find(r => r.lines.some(l => t3(l).indexOf('Right column') >= 0));
  check('左栏独立成区（15 行）', !!left && left.lines.length === 15, left ? String(left.lines.length) : '无');
  check('右栏独立成区（15 行）', !!right && right.lines.length === 15, right ? String(right.lines.length) : '无');
  check('左右不混在同一区域', !regions.some(r =>
    r.lines.some(l => t3(l).indexOf('Left column') >= 0) && r.lines.some(l => t3(l).indexOf('Right column') >= 0)));
}

console.log('\n=== 3) 真单栏（必须保持单栏）===');
{
  const regions = L.analyzePage(mkSingleColumnPage(), {});
  console.log('    区域数: ' + regions.length + '   行数: ' + (regions[0] ? regions[0].lines.length : 0));
  check('保持 1 个区域', regions.length === 1, '实际 ' + regions.length);
  check('全部 24 行都在该区域内', regions[0] && regions[0].lines.length >= 24,
    regions[0] ? String(regions[0].lines.length) : '无');
}

console.log('\n=== 4) 边注在右侧时同样要切开 ===');
{
  const items = [];
  for (let i = 0; i < 10; i++) items.push(item('Side note right side ' + (i + 1), 400, 100 + i * 12, 7));
  for (let i = 0; i < 26; i++) items.push(item('Main body line number ' + (i + 1) + ' in the wide left column', 50, 90 + i * 13, 10.5));
  const regions = L.analyzePage(items, {});
  console.log('    区域数: ' + regions.length);
  const t4 = l => (l.items || []).map(i => i.str).join('');
  const mixed = regions.some(r =>
    r.lines.some(l => t4(l).indexOf('Side note') >= 0) && r.lines.some(l => t4(l).indexOf('Main body') >= 0));
  check('右侧边注不与正文混排', !mixed);
  check('切成 ≥2 个区域', regions.length >= 2, '实际 ' + regions.length);
}

console.log('\n====================================================');
console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
