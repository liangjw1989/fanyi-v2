/* read-diag.js — 解读诊断报告，指出排版问题所在
 * 用法: node test/tools/read-diag.js <诊断报告.json>
 */
'use strict';
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.log('用法: node test/tools/read-diag.js <诊断报告.json>'); process.exit(1); }
let rep;
try { rep = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
catch (e) { console.log('不是合法 JSON: ' + e.message); process.exit(1); }

console.log('文件: ' + path.basename(file));
console.log('原文件: ' + rep.file.name + '   页数: ' + rep.file.pages + '   应用版本: ' + rep.app.version);
console.log('');

console.log('=== 1) 块统计 ===');
console.log('  总数: ' + rep.summary.blockCount);
console.log('  分类: ' + JSON.stringify(rep.summary.byType));
console.log('  正文字号: ' + rep.summary.bodySize);
console.log('  字号分布: ' + JSON.stringify(rep.summary.sizeHistogram));
console.log('  对齐分布: ' + JSON.stringify(rep.summary.alignHistogram));
console.log('  页面: ' + JSON.stringify(rep.summary.pageSize));
console.log('');

console.log('=== 2) 每页行数与分栏 ===');
(rep.pages || []).slice(0, 25).forEach(p => {
  const cols = p.columns || [];
  const spanning = cols.filter(c => c.spanning).length;
  const normal = cols.length - spanning;
  console.log('  page ' + String(p.number).padStart(2) + ': ' + p.w + 'x' + p.h +
    '  行数=' + String(p.lineCount == null ? (p.lines || []).length : p.lineCount).padStart(4) +
    '  分栏区域=' + cols.length + '（通栏 ' + spanning + ' / 栏 ' + normal + '）' +
    (cols.length && cols.length <= 6 ? '  x=' + cols.map(c => (c.x != null ? c.x : '?') + '~' + (c.x1 != null ? c.x1 : '?')).join(',') : ''));
});
console.log('');

console.log('=== 3) 阅读顺序检查（左右栏 y 是否交错）===');
/* 新版报告带 itemSamples（原始文字项坐标）与 xHistogram，优先用它判断中缝 */
const p1 = (rep.pages || [])[0];
if (p1 && p1.xHistogram) {
  console.log('  page 1 文字项 x 起点分布（20pt 一档，★=峰值）:');
  const hist = p1.xHistogram;
  const max = Math.max.apply(null, Object.keys(hist).map(k => hist[k]));
  Object.keys(hist).map(Number).sort((a, b) => a - b).forEach(b => {
    const n = hist[b];
    console.log('    x=' + String(b).padStart(4) + '~' + String(b + 19).padStart(4) + '  ' +
      '█'.repeat(Math.max(1, Math.round(n / max * 40))) + ' ' + n + (n === max ? ' ★' : ''));
  });
  /* 找"空白走廊"：直方图为 0 或极少的连续区间 */
  const keys = Object.keys(hist).map(Number).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < keys.length; i++) {
    const gap = keys[i] - keys[i - 1] - 20;
    if (gap >= 20) gaps.push({ from: keys[i - 1] + 20, to: keys[i], width: gap, left: hist[keys[i - 1]], right: hist[keys[i]] });
  }
  if (gaps.length) {
    console.log('  可能的竖直走廊（无文字的区间）:');
    gaps.forEach(g => console.log('    x=' + g.from + '~' + g.to + '（宽 ' + g.width + 'pt）'));
  } else {
    console.log('  未发现明显空档（说明文字布满整行宽度，或分栏切分方式不同）');
  }
}
if (p1 && p1.itemSamples) {
  console.log('');
  console.log('  page 1 原始文字项样本（x, x1, y, size, 文字）:');
  p1.itemSamples.slice(0, 30).forEach(it => {
    console.log('    x=' + String(it.x).padStart(6) + ' x1=' + String(it.x1).padStart(6) +
      ' y=' + String(it.y).padStart(7) + ' sz=' + String(it.size).padStart(5) + '  ' +
      JSON.stringify(String(it.s || '').slice(0, 44)));
  });
}
console.log('');
/* 若报告的 x 全为 0，说明是旧版报告（坐标字段 bug 已修） */
const allZeroX = (p1 && (p1.lines || []).length) ? (p1.lines || []).every(l => l.x === 0) : false;
if (allZeroX) {
  console.log('  ⚠ 本报告是旧版导出的（行 x 全为 0，属于已修复的 bug）。');
  console.log('    请用新版重新导出一次，才能定位分栏问题。');
  console.log('');
}

/* 取一个多栏页，检查其行的 x 分布：若 x 在两簇之间来回跳，说明阅读顺序可能乱 */
const multi = (rep.pages || []).find(p => (p.columns || []).filter(c => !c.spanning).length >= 2);
if (!multi) {
  console.log('  没有检出多栏页面');
} else {
  console.log('  检查 page ' + multi.number + '（' + multi.columns.length + ' 个区域）');
  const lines = (multi.lines || []).slice(0, 60);
  /* 按 x 聚类成"左/右" */
  const xs = lines.map(l => l.x).sort((a, b) => a - b);
  const mid = xs[Math.floor(xs.length / 2)];
  let switches = 0, prevSide = null;
  const seq = [];
  lines.forEach(l => {
    const side = l.x < mid ? 'L' : 'R';
    if (prevSide && side !== prevSide) switches++;
    prevSide = side;
    seq.push(side);
  });
  console.log('    行左右归属序列（前 60）: ' + seq.join(''));
  console.log('    左右切换次数: ' + switches + (switches > Math.max(3, lines.length * 0.15)
    ? '   ← 偏多，阅读顺序可能错乱' : '   ← 正常'));
  console.log('    前 12 行的坐标与内容:');
  lines.slice(0, 12).forEach(l => {
    console.log('      x=' + String(l.x).padStart(6) + ' y=' + String(l.y).padStart(6) +
      ' sz=' + String(l.size).padStart(5) + '  ' + JSON.stringify(String(l.text || '').slice(0, 62)));
  });
}
console.log('');

console.log('=== 4) 表格规格（判断是否被拆碎）===');
const tables = [];
(function walk(bs) {
  (bs || []).forEach(b => {
    if (!b) return;
    if (b.type === 'table') tables.push({ rows: b.table ? b.table.rows : b.rows, cols: b.table ? b.table.cols : b.cols, colCounts: b.table ? b.table.colCounts : b.colCounts, first: b.table ? b.table.firstRow : b.firstRow });
    if (b.type === 'container') (b.blocks || []).forEach(() => { });
    if (b.type === 'container' && b.tableCount) {
      /* 容器内的表格已汇总 */
    }
  });
})(rep.blocks);
const inner = [];
(rep.blocks || []).forEach(b => {
  if (b && b.type === 'container') (b.blocks || []).forEach(x => { if (x.type === 'table') inner.push(x); });
});
const allTables = tables.concat(inner);
console.log('  顶层表格: ' + tables.length + '   容器内表格: ' + inner.length);
allTables.slice(0, 25).forEach((t, i) => {
  console.log('    表' + (i + 1) + ': ' + t.rows + ' 行 × ' + t.cols + ' 列   每行列数=' +
    JSON.stringify((t.colCounts || []).slice(0, 8)) + '   首行=' + JSON.stringify((t.first || []).slice(0, 4)));
});
if (allTables.length > 3 && allTables.filter(t => t.rows <= 2).length > allTables.length * 0.6) {
  console.log('  ⚠ 多数表格只有 ≤2 行 → 表格被切成碎片（需要继续调合并规则）');
}
console.log('');

console.log('=== 5) 块列表抽样（前 30）===');
(rep.blocks || []).slice(0, 30).forEach(b => {
  if (b.type === 'container') {
    console.log('  [' + b.i + '] container ' + b.columns + ' 栏' +
      (b.tableCount ? '  内含表格 ' + b.tableCount + ' 个（共 ' + b.tableRows + ' 行）' : ''));
    (b.blocks || []).slice(0, 10).forEach(cb => {
      console.log('        col' + cb.col + ' [' + cb.type + (cb.size ? ' sz=' + cb.size : '') +
        (cb.align ? ' ' + cb.align : '') + '] ' +
        (cb.type === 'table' ? ('表格 ' + cb.rows + '×' + cb.cols) : JSON.stringify(String(cb.text || '').slice(0, 52))));
    });
  } else if (b.type === 'table') {
    console.log('  [' + b.i + '] table ' + b.table.rows + '行×' + b.table.cols + '列');
  } else {
    console.log('  [' + b.i + '] ' + b.type + (b.size ? ' sz=' + b.size : '') +
      (b.align ? ' ' + b.align : '') + (b.indent ? ' ind=' + b.indent : '') +
      '  ' + JSON.stringify(String(b.text || b.caption || '').slice(0, 66)));
  }
});
