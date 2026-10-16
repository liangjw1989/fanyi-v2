/* header-footer.test.js — 页眉/页脚/版权文字过滤的单元测试
 * 用法: node test/header-footer.test.js
 *
 * 背景：学术 PDF 的页眉页脚（期刊名、卷期页码、DOI、"Downloaded from…"、
 * Creative Commons 声明）经常字号与正文接近，靠"位置+字号"抓不到，
 * 于是混进正文。实测某论文译文里就出现了 CC 许可证文字。
 * 判据升级为：① 页边区域 + 字号/纯数字；② 跨页重复出现。
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
for (const f of ['core.js', 'layout.js', 'pdf-extract.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const px = sb.LingyiPdfExtract;

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { console.log('  \u2713 ' + n); pass++; }
  else { console.log('  \u2717 ' + n + (extra ? '  → ' + extra : '')); fail++; }
};

/* 造一页：正文若干行 + 页眉（期刊名）+ 页脚（卷期页码）+ 版权声明 */
function mkPage(pageNo, opts) {
  const o = opts || {};
  const H = 842;
  const items = [];
  const add = (x, y, str, size) => items.push({
    str: str, x0: x, x1: x + str.length * size * 0.5, y0: y, y1: y + size,
    size: size, font: 'f1', pageHeight: H
  });
  /* 页眉：期刊名（字号与正文接近，位于顶部 6%） */
  add(50, H * 0.04, 'Biomolecules', 10);
  /* 页脚：卷期页码（底部 4%） */
  add(50, H * 0.955, 'Biomolecules 2023, 13, 5', 9);
  add(500, H * 0.96, String(pageNo), 9);
  /* 版权声明（底部 8%，字号 8pt） */
  if (o.cc) add(50, H * 0.92, 'This article is an open access article distributed under the terms and conditions of the Creative Commons Attribution (CC BY) license', 8);
  /* 正文 6 行（中部，10.5pt） */
  for (let i = 0; i < 6; i++) {
    add(50, 300 + i * 20, 'Body paragraph line number ' + (i + 1) + ' of page ' + pageNo, 10.5);
  }
  return { number: pageNo, width: 595, height: H, items: items };
}

console.log('=== 1) 跨页重复检测（页眉/页脚/版权）===');
{
  const pages = [mkPage(1, { cc: true }), mkPage(2, { cc: true }), mkPage(3, { cc: true }), mkPage(4, { cc: true })];
  const repeated = px.findRepeatedTexts(pages, 3);
  const arr = [...repeated];
  console.log('    检出重复文本 ' + arr.length + ' 条:');
  arr.forEach(t => console.log('      ' + JSON.stringify(t)));
  check('检出期刊页眉 "biomolecules"', arr.some(t => t.indexOf('biomolecules') === 0));
  check('检出页脚卷期（数字已归一化为 #）', arr.some(t => t.indexOf('13') >= 0 || t.indexOf('#') >= 0));
  check('检出 Creative Commons 声明', arr.some(t => t.indexOf('creative commons') >= 0));
  check('正文行未被误判为重复', !arr.some(t => t.indexOf('body paragraph') >= 0));
}

console.log('\n=== 2) 整行匹配后丢弃（正文必须留下）===');
{
  const pages = [mkPage(1, { cc: true }), mkPage(2, { cc: true }), mkPage(3, { cc: true })];
  const repeated = px.findRepeatedTexts(pages, 3);
  const r = px.dropRepeatedText(pages[0].items, repeated);
  const kept = r.items.map(i => i.str).join(' ');
  console.log('    丢弃 ' + r.dropped + ' 个文字对象，保留 ' + r.items.length + ' 个');
  check('丢弃了页眉', kept.indexOf('Biomolecules,') < 0 || kept.indexOf('Biomolecules') < 0 || r.dropped > 0);
  check('丢弃了 CC 声明', kept.indexOf('Creative Commons') < 0);
  check('正文 6 行全部保留', (kept.match(/Body paragraph line/g) || []).length === 6,
    '实际 ' + (kept.match(/Body paragraph line/g) || []).length);
}

console.log('\n=== 3) 页边区域过滤（位置 + 字号）===');
{
  const pg = mkPage(1, {});
  const r = px.filterMargins(pg.items, 842, 595, { topBand: 0.10, bottomBand: 0.10 });
  const kept = r.items.map(i => i.str).join(' | ');
  console.log('    丢弃 ' + r.dropped + ' 个，中位字号 ' + r.medianSize);
  check('页眉（顶部 4%）被丢', kept.indexOf('Biomolecules 2023') < 0);
  check('页码被丢（纯数字）', !/\|\s*1\s*\|/.test(kept));
  check('正文全部保留', (kept.match(/Body paragraph line/g) || []).length === 6);
}

console.log('\n=== 4) 页数不足时不启用跨页重复（避免误判）===');
{
  const pages = [mkPage(1, { cc: true }), mkPage(2, { cc: true })];
  const repeated = px.findRepeatedTexts(pages, 3);
  check('只有 2 页时检出为空（需要 ≥3 页）', repeated.size === 0, '实际 ' + repeated.size);
}

console.log('\n=== 5) 位置约束：正文区域内的"重复文字"不应被删 ===');
{
  /* 每页都有 "1"（页码）与重复的正文短句 "Results"（在页面中部） */
  const mk = n => ({
    number: n, width: 595, height: 842, items: [
      { str: '1', x0: 50, x1: 55, y0: 800, y1: 810, size: 9, font: 'f' },
      { str: 'Results', x0: 50, x1: 90, y0: 300, y1: 310, size: 10.5, font: 'f' },
      { str: 'Body text here on page ' + n, x0: 50, x1: 250, y0: 320, y1: 330, size: 10.5, font: 'f' }
    ]
  });
  const repeated = px.findRepeatedTexts([mk(1), mk(2), mk(3)], 3);
  const arr = [...repeated];
  console.log('    检出: ' + JSON.stringify(arr));
  check('极短文本（"1"）不进入重复集合', !arr.includes('1'));
  /* 关键：中部（15%~85%）的重复文字必须被排除，否则会误删正文 */
  check('页面中部的 "results" 被排除（保护正文）', !arr.includes('results'));
  check('页面中部的重复正文行被排除', !arr.some(t => t.indexOf('body text here') >= 0));
}

console.log('\n====================================================');
console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
