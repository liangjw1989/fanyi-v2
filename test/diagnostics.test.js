/* diagnostics.test.js — 验证诊断报告能正确生成并可序列化
 * 用法: node test/diagnostics.test.js
 *
 * 诊断报告是"远程定位排版问题"的载体：必须包含坐标、分栏、块结构，
 * 且不能因为遇到奇怪结构就崩掉。
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
for (const f of ['core.js', 'diagnostics.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const core = sb.LingyiCore, diag = sb.LingyiDiagnostics;

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { console.log('  \u2713 ' + n); pass++; }
  else { console.log('  \u2717 ' + n + (extra ? '  → ' + extra : '')); fail++; }
};

/* 构造一个有代表性的 IR：标题 + 双栏容器 + 表格 + 图片 + 长段落 */
const P = (t, o) => Object.assign({ id: 'p' + Math.random(), type: 'paragraph', runs: [{ t: t }], size: 10.5 }, o || {});
const ir = {
  meta: { fileName: 'test.docx', source: 'pdf' },
  bodySize: 10.5,
  page: { width: 595, height: 842, margins: [50, 50, 55, 55] },
  pages: [
    { number: 1, width: 595, height: 842, columns: [{ x: 50 }, { x: 316 }], lines: [
      { x: 50, y: 120, size: 10.5, text: 'Left column first line' },
      { x: 316, y: 122, size: 10.5, text: 'Right column first line' },
      { x: 50, y: 132, size: 10.5, text: 'Left column second line' }
    ] },
    { number: 2, width: 595, height: 842, columns: null, lines: [
      { x: 50, y: 100, size: 12, text: 'Table 1 Baseline characteristics' }
    ] }
  ],
  blocks: [
    P('大标题', { type: 'heading', level: 1, align: 'center', size: 15, bold: true }),
    {
      id: 'c1', type: 'container', columns: [
        { x: 50, blocks: [P('左栏第一段', { indent: 21, align: 'justify' }), P('左栏第二段')] },
        { x: 316, blocks: [P('右栏第一段'), { id: 't0', type: 'table', rows: [[{ text: '变量' }, { text: 'OR' }], [{ text: 'MR Egger' }, { text: '0.832' }]] }] }
      ]
    },
    { id: 't1', type: 'table', rows: [[{ text: 'A' }, { text: 'B' }, { text: 'C' }], [{ text: '1' }, { text: '2' }, { text: '3' }]] },
    { id: 'i1', type: 'image', assetId: 'a1', w: 200, h: 120, caption: '图 1 研究流程图' },
    P('这是一段很长的正文，用来验证诊断报告里的文字截断是否生效。'.repeat(12))
  ]
};

console.log('=== 1) 生成报告 ===');
let report = null;
try {
  report = diag.build(ir, { version: '2.3.0', fileName: 'test.pdf', fileType: 'pdf', engine: 'deepseek', target: 'zh-CN' });
  check('不抛异常', true);
} catch (e) {
  check('不抛异常', false, e.message);
}
if (report) {
  check('包含版本与应用名', report.app && report.app.version === '2.3.0');
  check('包含文件信息', report.file && report.file.name === 'test.pdf' && report.file.pages === 2);
  check('包含块统计', report.summary && report.summary.byType &&
    report.summary.byType.heading === 1 && report.summary.byType.table === 2 && report.summary.byType.container === 1);
  check('统计字号分布', report.summary.sizeHistogram && Object.keys(report.summary.sizeHistogram).length > 0,
    JSON.stringify(report.summary.sizeHistogram));
  check('统计对齐分布', report.summary.alignHistogram && report.summary.alignHistogram.center === 1,
    JSON.stringify(report.summary.alignHistogram));

  console.log('\n=== 2) 每页坐标与分栏（定位阅读顺序的关键证据）===');
  check('导出 2 页', report.pages.length === 2);
  check('第 1 页含分栏坐标', report.pages[0].columns && report.pages[0].columns.length === 2);
  check('第 1 页含行坐标与文字', report.pages[0].lines.length === 3 &&
    typeof report.pages[0].lines[0].x === 'number' && !!report.pages[0].lines[0].text);

  console.log('\n=== 3) 块结构 ===');
  const container = report.blocks.find(b => b.type === 'container');
  check('识别出 container 及其栏数', !!container && container.columns === 2);
  check('container 内含每栏块明细', !!container && container.blocks.length >= 3);
  check('container 内表格被标注行列', !!container &&
    container.blocks.some(b => b.type === 'table'));
  const heading = report.blocks.find(b => b.type === 'heading');
  check('标题含字号/对齐/加粗', !!heading && heading.size === 15 && heading.align === 'center' && heading.bold === true);
  const img = report.blocks.find(b => b.type === 'image');
  check('图片含题注与尺寸', !!img && img.caption === '图 1 研究流程图' && img.w === 200);
  const longP = report.blocks.filter(Boolean).filter(b => b.type === 'paragraph').find(b => b.text && b.text.indexOf('…(') >= 0);
  check('超长文字被截断并标注原长', !!longP, longP ? longP.text.slice(-20) : '未找到被截断的段落');

  console.log('\n=== 4) 可序列化与纯文本摘要 ===');
  let json = '';
  try { json = JSON.stringify(report); check('JSON.stringify 成功', true); }
  catch (e) { check('JSON.stringify 成功', false, e.message); }
  check('JSON 体积合理', json.length > 500 && json.length < 400000, json.length + ' 字节');

  let txt = '';
  try { txt = diag.toText(report); check('toText 成功', true); }
  catch (e) { check('toText 成功', false, e.message); }
  check('摘要含块统计', txt.indexOf('块统计') >= 0);
  check('摘要含每页分栏', txt.indexOf('每页分栏') >= 0);
  check('摘要含行坐标', txt.indexOf('x=') >= 0);
  check('摘要含表格规格', txt.indexOf('table') >= 0 || txt.indexOf('表格') >= 0);
}

console.log('\n=== 5) 边界情况（空 IR / 缺字段）===');
try {
  const r2 = diag.build({ blocks: [], pages: [] }, {});
  check('空 IR 不崩', true);
  check('空 IR 的块数为 0', r2.summary.blockCount === 0);
} catch (e) { check('空 IR 不崩', false, e.message); }
try {
  diag.build({ blocks: [null, { type: 'paragraph' }, { type: 'table' }] }, {});
  check('含 null/缺字段的块不崩', true);
} catch (e) { check('含 null/缺字段的块不崩', false, e.message); }
try {
  const r3 = diag.build({
    blocks: [{ type: 'container', columns: [{ blocks: [{ type: 'paragraph', runs: [{ t: 'x' }] }] }, null] }]
  }, {});
  check('container 里有 null 栏不崩', true);
} catch (e) { check('container 里有 null 栏不崩', false, e.message); }

console.log('\n====================================================');
console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
