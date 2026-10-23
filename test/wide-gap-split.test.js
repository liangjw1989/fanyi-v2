/* wide-gap-split.test.js — "横跨两栏的行"必须被拆开（否则正文与边注拼接）
 * 用法: node test/wide-gap-split.test.js
 *
 * 背景（来自真实诊断报告）：
 *   期刊的窄左边注栏（x≈36）与宽正文栏（x≈166）常落在同一基线上，
 *   groupLines 只看 y 就合并成一条行，文本变成：
 *     "Licensee MDPI, Basel, Switzerland.are not discussed"
 *     "Copyright: © 2023 by the authors.expression profiles"
 *   这就是用户看到"句子被截断"的真正原因。
 *
 * 为什么不在 groupLines 里加水平判据：表格单元格之间本来就有大空白，
 * 在那里加会破坏表格识别（实测 9 项失败）。所以只在"分栏判定失败"时按需拆分。
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
const txt = ln => (ln.items || []).map(i => i.str).join('');
const item = (str, x, y, size) => ({
  str: str, x0: x, x1: x + str.length * size * 0.5, y0: y, y1: y + size,
  size: size, font: 'f', pageHeight: 842
});

console.log('=== 1) 合并了"边注 + 正文"的行必须被拆开 ===');
{
  /* 真实几何：左边注很窄（x 36~101），正文从 166 一直到右侧（x1≈500）。
     这种"左边一小块 + 右边一大块"才是跨栏合并的典型形态，
     整行宽度才够"像跨两栏"。 */
  const merged = [
    item('Licensee MDPI', 36, 100, 7),                                 // x 36~101
    item('are not discussed in this review, but they will be covered in the next section of this paper', 166, 100, 10)
  ];
  const lines = L.groupLines(merged);
  console.log('    groupLines 后行数: ' + lines.length + '（预期 1，说明确实被合并了）');
  check('前提成立：被合并成 1 条行', lines.length === 1, '实际 ' + lines.length);
  if (lines.length === 1) {
    const full = txt(lines[0]);
    console.log('    合并后文本: ' + JSON.stringify(full.slice(0, 70)));
    check('合并后文本确实把两栏拼在一起', full.indexOf('MDIPare') >= 0 || full.indexOf('MDPIare') >= 0, full.slice(0, 40));
    console.log('    行宽: ' + Math.round(lines[0].x1 - lines[0].x0) + 'pt');

    /* 内容宽取 500（近似单页正文宽） */
    const split = L.splitWideGapLines(lines, 500, 20);
    console.log('    拆开后行数: ' + split.length);
    split.forEach((l, i) => console.log('      ' + i + '. x=' + Math.round(l.x0) + '~' +
      Math.round(l.x1) + ' ' + JSON.stringify(txt(l).slice(0, 52))));
    check('拆成 2 条行', split.length === 2, '实际 ' + split.length);
    check('左边注独占一条', split.some(l => txt(l).indexOf('Licensee') >= 0 && txt(l).indexOf('are not') < 0));
    check('右正文独占一条', split.some(l => txt(l).indexOf('are not discussed') >= 0 && txt(l).indexOf('Licensee') < 0));
    check('不再出现跨栏拼接', !split.some(l => txt(l).indexOf('MDPIare') >= 0));
  }
}

console.log('\n=== 2) 同一栏内的正常行不能被拆 ===');
{
  /* 一行内的词间距只有几个 pt，远小于 45pt 门槛 */
  const words = ['This', 'is', 'a', 'normal', 'line', 'of', 'body', 'text', 'with', 'spaces'];
  const items = [];
  let x = 166;
  words.forEach(w => { items.push(item(w, x, 200, 10)); x += w.length * 5 + 3; });
  const lines = L.groupLines(items);
  check('前提：是 1 条行', lines.length === 1, '实际 ' + lines.length);
  const split = L.splitWideGapLines(lines, 500, 45);
  check('正常行不被拆（仍是 1 条）', split.length === 1, '实际 ' + split.length);
}

console.log('\n=== 3) 表格行不能被拆（关键：表格单元格之间本来就有大空白）===');
{
  /* 4 列表格的一行：单元格间距 40pt（接近门槛）*/
  const cells = [
    item('Method', 60, 300, 9),
    item('OR', 160, 300, 9),
    item('95% CI', 240, 300, 9),
    item('P', 360, 300, 9)
  ];
  const lines = L.groupLines(cells);
  console.log('    行数: ' + lines.length + '  文本: ' + JSON.stringify(lines.length ? txt(lines[0]) : ''));
  const split = L.splitWideGapLines(lines, 500, 45);
  /* 表格行总宽 60~372 = 312 < 500*0.6=300？临界。这里断言"不因拆分而混乱" */
  check('表格行拆分后不丢失内容', split.map(txt).join('').indexOf('Method') >= 0 &&
    split.map(txt).join('').indexOf('95% CI') >= 0);
}

console.log('\n=== 4) 窄行（总宽 < 60% 内容宽）不参与拆分 ===');
{
  /* 一条只占 1/3 宽的行，即便中间有大空档也不拆（可能只是对齐） */
  const short = [
    item('Year', 500, 400, 9),
    item('2023', 570, 400, 9)
  ];
  const lines = L.groupLines(short);
  const split = L.splitWideGapLines(lines, 900, 45);
  check('窄行保持原样', split.length === 1, '实际 ' + split.length);
}

console.log('\n=== 6) 空档很小但起始位置大幅跳变（真实 MDPI 情形）===');
{
  /* 真实数据：边注 x1≈153，正文 x≈166 → 空档只有 13pt（小于 20pt 门槛），
     但起始位置从 35.7 跳到 166（跳变 130pt）。必须靠"起始跳变"判据拆开。 */
  const items = [];
  items.push({ str: 'Citation:', x0: 35.7, x1: 63.4, y0: 329.7, y1: 336.7, size: 7, font: 'f', pageHeight: 842 });
  items.push({ str: 'Kyrgiafini, M.-A.; Mamuris,', x0: 65.6, x1: 151.6, y0: 329.7, y1: 336.7, size: 7, font: 'f', pageHeight: 842 });
  items.push({
    str: 'the main body text continues here and spans the wide right column of the page',
    x0: 166, x1: 559, y0: 329.7, y1: 339.7, size: 10, font: 'f', pageHeight: 842
  });
  const lines = L.groupLines(items);
  console.log('    groupLines → ' + lines.length + ' 行');
  check('前提：被合并成 1 行（同基线）', lines.length === 1, '实际 ' + lines.length);
  if (lines.length === 1) {
    const merged = txt(lines[0]);
    console.log('    空档 ' + Math.round((166 - 151.6) * 10) / 10 + 'pt   起始跳变 ' +
      Math.round((166 - 35.7) * 10) / 10 + 'pt');
    const split = L.splitWideGapLines(lines, 526, undefined);
    console.log('    拆开后: ' + split.length + ' 行');
    split.forEach((l, i) => console.log('      ' + i + '. x=' + Math.round(l.x0) + '~' +
      Math.round(l.x1) + ' ' + JSON.stringify(txt(l).slice(0, 46))));
    check('被拆成 2 行（靠起始跳变判据）', split.length === 2, '实际 ' + split.length);
    check('边注行不含正文', split.some(l => txt(l).indexOf('Citation') >= 0 && txt(l).indexOf('main body') < 0));
    check('正文行不含边注', split.some(l => txt(l).indexOf('main body text') >= 0 && txt(l).indexOf('Citation') < 0));
  }
}

console.log('\n=== 5) 整页端到端：拆行后边注与正文分开 ===');
{
  /* MDPI 式整页：边注与正文同行（y 相同）→ 必须拆开后归入不同区域 */
  const items = [];
  const notes = ['Open access', 'Copyright 2023', 'MDPI, Basel', 'CC BY license',
    'Received: 24 Apr', 'Revised: 20 Jun', 'Accepted: 27 Jun', 'Published: 27 Jun'];
  notes.forEach((t, i) => {
    const y = 100 + i * 14;
    items.push(item(t, 36, y, 7));                                  // 左边注
    if (i < 6) items.push(item('Body line ' + (i + 1) + ' of the wide column', 166, y + 2, 10));  // 同基线正文
  });
  for (let i = 6; i < 20; i++) items.push(item('Body line ' + (i + 1) + ' of the wide column', 166, 100 + i * 14, 10));
  const regions = L.analyzePage(items, { pageWidth: 595 });
  console.log('    区域数: ' + regions.length);
  regions.forEach((r, i) => console.log('      区域' + i + ': x=' + Math.round(r.box.x0) + '~' +
    Math.round(r.box.x1) + ' 行数=' + r.lines.length + ' 首行=' + JSON.stringify(txt(r.lines[0]).slice(0, 40))));
  check('切成 ≥2 个区域', regions.length >= 2, '实际 ' + regions.length);
  const mixed = regions.filter(r => {
    const t = r.lines.map(txt).join(' ');
    return t.indexOf('MDPI') >= 0 && t.indexOf('Body line') >= 0;
  }).length;
  check('没有区域同时含边注与正文', mixed === 0, mixed + ' 个区域混排');
  const body = regions.find(r => r.lines.some(l => txt(l).indexOf('Body line') >= 0));
  check('正文区域行数 ≥ 14', !!body && body.lines.length >= 14, body ? String(body.lines.length) : '无');
}

console.log('\n=== 7) 整页每一行都是"边注+正文"合并（真实故障）===');
{
  /* 用户实际文档的情况：不是偶尔一行合并，而是**整页**每行都合并。
     早期的表格保护把"每行 ≥2 个块且第二块起始一致"判为表格，
     于是整页被当成"2 列表格" → 完全拒绝拆行 →
     正文与版权声明继续逐段交替（"排版还是不对"）。
     修复后门槛是 ≥3 个块，这种 2 块合并行必须被拆开。 */
  const items = [];
  for (let i = 0; i < 18; i++) {
    const y = 100 + i * 13;
    items.push(item('Licensee MDPI Basel', 35.7, y, 7));
    items.push(item('the main body text of this systematic review continues here', 166, y, 10));
  }
  const raw = L.groupLines(items);
  console.log('    groupLines → ' + raw.length + ' 行，每行 ' + raw[0].items.length + ' 个块');
  check('前提：整页被合并成 18 行', raw.length === 18, String(raw.length));
  check('前提：每行只有 2 个块（像 2 列表格）', raw[0].items.length === 2);

  const contentW = Math.max.apply(null, items.map(i => i.x1)) - Math.min.apply(null, items.map(i => i.x0));
  const split = L.splitWideGapLines(raw, contentW, undefined);
  console.log('    拆行后 → ' + split.length + ' 行');
  check('跨栏合并行被拆开（未被误判为表格）', split.length > raw.length,
    split.length + ' vs ' + raw.length);

  const regions = L.analyzePage(items, { pageWidth: 595 });
  console.log('    analyzePage → ' + regions.length + ' 区域: ' +
    regions.map(r => 'x' + Math.round(r.box.x0) + '~' + Math.round(r.box.x1) + '(' + r.lines.length + '行)').join(' | '));
  check('切成 2 个区域', regions.length === 2, String(regions.length));
  const t = l => (l.items || []).map(i => i.str).join('');
  const mixed = regions.filter(r => {
    const s = r.lines.map(t).join(' ');
    return s.indexOf('MDPI') >= 0 && s.indexOf('main body') >= 0;
  }).length;
  check('没有区域同时含边注与正文', mixed === 0, mixed + ' 个混排');
  const body = regions.find(r => r.lines.some(l => t(l).indexOf('main body') >= 0));
  check('正文 18 行完整在一个区域', !!body && body.lines.length === 18,
    body ? String(body.lines.length) : '无');
}

console.log('\n=== 8) 真 3+ 列表格仍然受保护（不被拆）===');
{
  /* 门槛提高后不能把表格保护弄失效：4 列的行必须原样保留 */
  const items = [];
  const rows = [
    ['变量', '第一组', '第二组', 'P值'],
    ['年龄', '32.5', '34.1', '<0.001'],
    ['BMI', '23.1', '23.6', '0.012'],
    ['DFI', '18.2', '25.7', '0.003']
  ];
  const colx = [60, 170, 280, 390];
  rows.forEach((row, ri) => row.forEach((c, ci) => items.push(item(c, colx[ci], 300 + ri * 16, 9))));
  const lines = L.groupLines(items);
  console.log('    表格行 ' + lines.length + ' 条，每行 ' + lines[0].items.length + ' 个块');
  const split = L.splitWideGapLines(lines, 520, undefined);
  console.log('    拆行后 ' + split.length + ' 条');
  check('4 列表格不被拆开', split.length === lines.length, split.length + ' vs ' + lines.length);
  const allText = split.map(l => (l.items || []).map(i => i.str).join('')).join('');
  check('表格内容完整', allText.indexOf('变量') >= 0 && allText.indexOf('DFI') >= 0 && allText.indexOf('0.003') >= 0);
}

console.log('\n====================================================');
console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
