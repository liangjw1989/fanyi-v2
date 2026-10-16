/* merge-table.test.js — 表格碎片合并的单元测试
 * 用法: node test/merge-table.test.js
 *
 * 背景：PDF 里表格只能靠坐标推断，原实现遇到"列数变化"就断开，
 * 于是一张表被切成很多"2 行"碎片（实测某论文 20 个表格全是碎片）。
 * 这里验证合并规则：该合的合、不该合的不合。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');

/* 造一个假 layout，让 detectTable 按我们给的"碎片"返回结果 */
function mkSandbox(fragments) {
  const sb = {
    console, setTimeout, clearTimeout, Promise, JSON, Math, Date, Object, Array, String, Number,
    RegExp, Error, isFinite, parseInt, parseFloat, Uint8Array, ArrayBuffer, TextEncoder,
    Blob: function () { }, URL: {}, atob: s => Buffer.from(s, 'base64').toString('binary')
  };
  sb.globalThis = sb; sb.window = sb;
  sb.document = { createElement: () => ({ style: {}, textContent: '', innerHTML: '' }) };
  const ctx = vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'core.js'), 'utf8'), ctx, { filename: 'core.js' });

  /* 假的 layout：把"当前 cand 恰好等于某个碎片"当作识别成功 */
  const fakeLayout = {
    detectTable(cand) {
      for (const f of fragments) {
        if (cand.length !== f.lines || cand[0] !== f.first) continue;
        return {
          rows: f.rows.map(r => r.map(t => ({ text: t }))),
          colCount: f.cols, quality: 0.95, grid: []
        };
      }
      return null;
    }
  };
  sb.LingyiLayout = fakeLayout;
  /* pdf-extract 里用到 layout 的其他函数，给个空壳避免报错 */
  sb.LingyiRenderHtml = {};

  vm.runInContext(fs.readFileSync(path.join(SRC, 'pdf-extract.js'), 'utf8'), ctx, { filename: 'pdf-extract.js' });
  return sb.LingyiPdfExtract;
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  \u2713 ' + name); pass++; }
  else { console.log('  \u2717 ' + name + (extra ? '  → ' + extra : '')); fail++; }
}

/* 构造行对象：只有 text 参与合并判断，用唯一对象做 identity */
function ln(text) { return { text: text || '', items: [], x: 0, y: 0 }; }

console.log('=== 场景 1：一张 6 行的表被切成 3 个 2 行碎片（应当合并成 1 张）===');
{
  const L = [];
  const frags = [];
  /* 3 个碎片，每个 2 行，列数都是 4 */
  for (let f = 0; f < 3; f++) {
    const rows = [
      ['Method' + f, 'OR', '95% CI', 'P'],
      ['IVW' + f, '0.83', '0.69-1.00', '0.05']
    ];
    const start = L.length;
    const lines = [];
    rows.forEach(r => { const l = ln(r.join(' ')); lines.push(l); L.push(l); });
    frags.push({ lines: lines.length, first: lines[0], rows: rows, cols: 4 });
  }
  const api = mkSandbox(frags);
  const segs = api.segmentTableAndText(L);
  const tables = segs.filter(s => s.kind === 'table');
  const totalRows = tables.reduce((a, t) => a + t.table.rows.length, 0);
  check('合并为 1 个表格', tables.length === 1, '实际 ' + tables.length + ' 个');
  check('行数累加为 6 行', totalRows === 6, '实际 ' + totalRows);
}

console.log('\n=== 场景 2：两张不同的表，中间夹着表格标题行（不该合并）===');
{
  const cap = ln('Table 2 Baseline characteristics');
  const L = [];
  const frags = [];
  for (let f = 0; f < 2; f++) {
    const rows = [['A' + f, 'B', 'C', 'D'], ['x' + f, '1', '2', '3']];
    const start = L.length;
    if (f === 1) L.push(cap);
    const lines = [];
    rows.forEach(r => { const l = ln(r.join(' ')); lines.push(l); L.push(l); });
    frags.push({ lines: lines.length, first: lines[0], rows: rows, cols: 4 });
  }
  const api = mkSandbox(frags);
  const segs = api.segmentTableAndText(L);
  const tables = segs.filter(s => s.kind === 'table');
  check('保持为 2 个表格（标题行阻止合并）', tables.length === 2, '实际 ' + tables.length + ' 个');
}

console.log('\n=== 场景 3：两个表格碎片之间夹着正文行（不该合并）===');
{
  const prose = ln('This is a normal paragraph of body text.');
  const L = [];
  const frags = [];
  for (let f = 0; f < 2; f++) {
    const rows = [['A' + f, 'B', 'C'], ['x' + f, '1', '2']];
    if (f === 1) L.push(prose);
    const lines = [];
    rows.forEach(r => { const l = ln(r.join(' ')); lines.push(l); L.push(l); });
    frags.push({ lines: lines.length, first: lines[0], rows: rows, cols: 3 });
  }
  const api = mkSandbox(frags);
  const segs = api.segmentTableAndText(L);
  const tables = segs.filter(s => s.kind === 'table');
  check('保持为 2 个表格（正文阻止合并）', tables.length === 2, '实际 ' + tables.length + ' 个');
}

console.log('\n=== 场景 4：列数差异过大（4 列 vs 8 列，不该合并）===');
{
  const L = [];
  const frags = [];
  const specs = [
    [['a', 'b', 'c', 'd'], ['a2', 'b2', 'c2', 'd2']],
    [['1', '2', '3', '4', '5', '6', '7', '8'], ['11', '22', '33', '44', '55', '66', '77', '88']]
  ];
  specs.forEach((rows, i) => {
    const lines = rows.map(r => { const l = ln(r.join(' ')); L.push(l); return l; });
    frags.push({ lines: lines.length, first: lines[0], rows: rows, cols: i === 0 ? 4 : 8 });
  });
  const api = mkSandbox(frags);
  const segs = api.segmentTableAndText(L);
  const tables = segs.filter(s => s.kind === 'table');
  check('保持为 2 个表格（列数差 > 2 阻止合并）', tables.length === 2, '实际 ' + tables.length + ' 个');
}

console.log('\n=== 场景 5：纯数字行夹在中间（可以合并）===');
{
  const L = [];
  const frags = [];
  for (let f = 0; f < 2; f++) {
    const rows = [['A' + f, 'B', 'C', 'D'], ['v' + f, '1', '2', '3']];
    if (f === 1) L.push(ln('0.251 2.755 0.769'));
    const lines = rows.map(r => { const l = ln(r.join(' ')); L.push(l); return l; });
    frags.push({ lines: lines.length, first: lines[0], rows: rows, cols: 4 });
  }
  const api = mkSandbox(frags);
  const segs = api.segmentTableAndText(L);
  const tables = segs.filter(s => s.kind === 'table');
  check('合并为 1 个表格（纯数字行不阻止合并）', tables.length === 1, '实际 ' + tables.length + ' 个');
}

console.log('\n====================================================');
console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
console.log('====================================================');
process.exit(fail ? 1 : 0);
