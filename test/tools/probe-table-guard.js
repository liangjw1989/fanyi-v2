/* probe-table-guard.js — 找出"正文被误判为表格"的判据阈值
 * 用法: node test/tools/probe-table-guard.js
 *
 * 目的：用真实形态的双栏论文"列块"喂给 detectTable，看它是否会误判；
 *      并测出"单元格文本长度"这个判据应该在什么位置设卡。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = path.join(__dirname, '..', '..', 'src');
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
const layout = sb.LingyiLayout;

/** 把一行文字按"大空白"切成 items（模拟 pdf.js 给出的碎片） */
function mkLine(x, y, parts, size) {
  const items = [];
  let cx = x;
  for (const p of parts) {
    items.push({ str: p, x0: cx, x1: cx + p.length * 3.6, y0: y, y1: y + 7.5, size: size || 7.5 });
    cx += p.length * 3.6 + 6;   // 词间小空白
  }
  return { id: 'L' + x + '_' + y, x: x, y: y, w: cx - x, h: size || 7.5, size: size || 7.5, items: items };
}

/* --- 场景 A：真实的四列表格（应当识别为表格） --- */
function sceneRealTable() {
  const rows = [
    ['Method', 'OR', '95% CI', 'P value'],
    ['IVW', '0.832', '0.69-1.00', '0.047'],
    ['MR Egger', '0.741', '0.52-1.05', '0.112'],
    ['Weighted median', '0.592', '0.42-0.83', '0.003'],
    ['Simple mode', '0.715', '0.44-1.16', '0.180'],
    ['Weighted mode', '0.688', '0.46-1.03', '0.075']
  ];
  const lines = [];
  rows.forEach((r, i) => {
    const parts = [];
    r.forEach((cell, c) => parts.push(cell));
    lines.push(mkLine(60, 600 + i * 12, parts, 7.5));
  });
  return lines;
}

/* --- 场景 B：双栏正文被拍平（左栏一行 + 右栏一行交错），模拟误判情形 --- */
function sceneProseInterleaved() {
  const left = [
    'Mendelian randomization uses genetic variants as instruments',
    'to assess causal effects of exposures on outcomes and reduces',
    'confounding and reverse causation common in observational',
    'studies of male infertility risk and plasma lipidome traits',
    'We selected single nucleotide polymorphisms associated with',
    'lipid traits at genome wide significance and estimated the',
    'causal effects using inverse variance weighting MR Egger',
    'and weighted median methods across all lipid species'
  ];
  const right = [
    'Sensitivity analyses included Cochran Q tests for heterogeneity',
    'and MR Egger intercept tests for horizontal pleiotropy plus',
    'leave one out analyses to identify influential variants',
    'All analyses were performed in R version four using the',
    'TwoSampleMR package and results were considered significant',
    'after Bonferroni correction for multiple testing across the',
    'full set of lipid species evaluated in this study of men',
    'with infertility risk factors from the UK Biobank cohort'
  ];
  const lines = [];
  for (let i = 0; i < left.length; i++) {
    // 左栏行：在 x≈50 处，被切成 2 个"列块"（模拟行内大空白）
    lines.push(mkLine(50, 150 + i * 22, [left[i].slice(0, 28), left[i].slice(28)], 7.5));
    // 右栏行：在 x≈316 处
    lines.push(mkLine(316, 161 + i * 22, [right[i].slice(0, 28), right[i].slice(28)], 7.5));
  }
  return lines;
}

function report(name, lines) {
  const t = layout.detectTable(lines, { minCols: 2, minRows: 2 });
  console.log('  ' + name);
  if (!t) { console.log('    → 未被判为表格 ✓'); return null; }
  // 统计单元格文本长度
  const lens = [];
  (t.rows || []).forEach(r => (r || []).forEach(c => { if (c && c.text) lens.push(c.text.trim().length); }));
  lens.sort((a, b) => a - b);
  const avg = lens.length ? (lens.reduce((a, b) => a + b, 0) / lens.length) : 0;
  const over12 = lens.filter(x => x > 12).length;
  console.log('    → ⚠ 被判为表格: ' + t.colCount + ' 列, ' + (t.rows ? t.rows.length : '?') + ' 行, quality=' + t.quality);
  console.log('      单元格文本长度: 最短 ' + (lens[0] || 0) + ' / 中位 ' + (lens[Math.floor(lens.length / 2)] || 0) +
    ' / 最长 ' + (lens[lens.length - 1] || 0) + ' / 平均 ' + avg.toFixed(1));
  console.log('      超过 12 字的格子: ' + over12 + '/' + lens.length + ' (' + (lens.length ? (over12 / lens.length * 100).toFixed(0) : 0) + '%)');
  return t;
}

console.log('=== 场景 A：真正的 4 列表格 ===');
report('真表格', sceneRealTable());

console.log('\n=== 场景 B：双栏正文被拍平（不该是表格）===');
report('正文', sceneProseInterleaved());

console.log('\n=== 结论 ===');
console.log('  真表格的"每个格子"很短（表格单元格），正文的"列块"很长（整句/半句）。');
console.log('  用"单元格长度"做卡口即可区分：真表格应当绝大多数格子 ≤ 12 字。');
