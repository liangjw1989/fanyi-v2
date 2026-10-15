/* 真实 Word 文档回归测试：sample1.docx（论文原稿，80段/3表/2图）
 * 先由 tools/docx2html.py 转成 mammoth 风格 HTML，再用抽取器还原成 IR，
 * 与 python-docx 直读的原始结构逐项核对。
 * 运行：node lingyi/test/real-docx.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'src');
const core = require(path.join(SRC, 'core.js'));
const dx = require(path.join(SRC, 'docx-extract.js'));
const rh = require(path.join(SRC, 'render-html.js'));

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '  →  ' + e.message); fail++; }
}
const textOf = b => core.runsToText(b.runs);

const htmlPath = path.join(__dirname, 'samples', 'sample1.mammoth-like.html');
const origPath = path.join(__dirname, 'samples', 'sample1.docx-inspect.json');
if (!fs.existsSync(htmlPath) || !fs.existsSync(origPath)) {
  console.log('缺少真实 Word 样本，跳过 real-docx.test.js');
  console.log('（公开仓库里不含真实论文原稿；可用 python test/tools/docx2html.py <你的.docx> <输出.html> 补上）');
  process.exit(0);
}
const html = fs.readFileSync(htmlPath, 'utf8');
const orig = JSON.parse(fs.readFileSync(origPath, 'utf8').replace(/^\uFEFF/, ''));

console.log('\n[A] 真实 Word 稿 → IR');
const ir = dx.convertHtmlToIR(html, { fileName: 'sample1.docx' });
fs.writeFileSync(path.join(OUT, 'ir-sample1.json'), JSON.stringify({
  bodySize: ir.bodySize, fontSizes: ir.fontSizes,
  counts: ir.blocks.reduce((a, b) => (a[b.type] = (a[b.type] || 0) + 1, a), {}),
  blocks: ir.blocks.map(b => ({
    type: b.type, level: b.level, size: b.size, align: b.align, indent: b.indent,
    text: b.type === 'table' ? `[table ${b.rows.length}x${b.rows[0].length}]` :
      (b.type === 'image' ? `[image ${b.w}x${b.h} caption=${b.caption}]` : textOf(b).slice(0, 60)),
    runs: (b.runs || []).length
  }))
}, null, 1), 'utf8');

const counts = ir.blocks.reduce((a, b) => (a[b.type] = (a[b.type] || 0) + 1, a), {});
console.log('   blocks:', JSON.stringify(counts), '| bodySize:', ir.bodySize, '| 字号:', ir.fontSizes.join('/'));

const tables = ir.blocks.filter(b => b.type === 'table');
const heads = ir.blocks.filter(b => b.type === 'heading');
const images = ir.blocks.filter(b => b.type === 'image');
const paras = ir.blocks.filter(b => b.type === 'paragraph');

check('3 个表格全部保留，列数与原稿一致（8 / 6 / 4）', () => {
  assert.strictEqual(tables.length, 3, '表格数：' + tables.length);
  const cols = tables.map(t => t.rows[0].length);
  assert.deepStrictEqual(cols, [8, 6, 4], '列数：' + cols.join(','));
});
check('表格行列数与原稿一致（7/7/11 行）', () => {
  const rows = tables.map(t => t.rows.length);
  assert.deepStrictEqual(rows, [7, 7, 11], '行数：' + rows.join(','));
});
check('2 张图片保留，且图题合并正确', () => {
  assert.strictEqual(images.length, 2, '图片数：' + images.length);
  assert(/图像|图\s*1|图\s*2|Figure/.test(images.map(i => i.caption).join('|')), '图题：' + images.map(i => i.caption).join('|'));
});
check('主标题字号最大且居中加粗', () => {
  const t = ir.blocks[0];
  assert(/不育男性年龄与精子DNA碎片化指数/.test(textOf(t)), '第一块不是主标题: ' + textOf(t).slice(0, 30));
  assert.strictEqual(t.size, 15, '主标题字号: ' + t.size);
  assert.strictEqual(t.align, 'center', '主标题对齐: ' + t.align);
  assert(t.runs.every(r => r.b), '主标题未加粗');
});
check('作者行 10.5pt 居中（与原稿 run 字号一致）', () => {
  const a = ir.blocks.find(b => /梁吉旺/.test(textOf(b)));
  assert(a, '找不到作者行');
  assert.strictEqual(a.size, 10.5, '作者字号: ' + a.size);
  assert.strictEqual(a.align, 'center', '作者对齐: ' + a.align);
});
check('摘要段保留 21pt 首行缩进 + 两端对齐 + 10.5pt', () => {
  const p = ir.blocks.find(b => textOf(b).startsWith('【摘要】'));
  assert(p, '找不到摘要段');
  assert(Math.abs(p.indent - 21) < 0.6, '缩进: ' + p.indent);
  assert.strictEqual(p.align, 'justify', '对齐: ' + p.align);
  assert.strictEqual(p.size, 10.5, '字号: ' + p.size);
});
check('章节标题被识别为 heading（引言 / 1 对象与方法 / 1.1 研究对象 …）', () => {
  const hs = heads.map(textOf);
  assert(hs.includes('引言'), '引言未识别: ' + hs.slice(0, 8).join('|'));
  assert(hs.includes('1 对象与方法'), '一级标题未识别');
  assert(hs.includes('1.1 研究对象'), '二级标题未识别');
  assert(hs.includes('2 结果'), '缺少 2 结果: ' + hs.join('|'));
  assert(hs.includes('参考文献'), '缺少 参考文献');
  const lv1 = heads.filter(b => b.level === 1).length;
  assert(lv1 >= 3, '一级标题数: ' + lv1);
});
check('8pt 表格注释字号被保留（不是被统一成 10.5pt）', () => {
  const n = ir.blocks.find(b => textOf(b).startsWith('注：') && /BMI/.test(textOf(b)));
  assert(n, '找不到表注');
  assert.strictEqual(n.size, 8, '表注字号: ' + n.size);
});
check('表题居中加粗（表1/表2 标题行）', () => {
  const cap = ir.blocks.find(b => /^表\s*1/.test(textOf(b)));
  assert(cap, '找不到表1标题');
  assert.strictEqual(cap.align, 'center', '表题对齐: ' + cap.align);
  assert(cap.runs.every(r => r.b), '表题未加粗');
});
check('段落数量与 python-docx 直读一致（83 段 → 表格/图片被分离后仍无损）', () => {
  const total = paras.length + heads.length + tables.length + images.length;
  assert(total >= orig.paragraph_count, `块数 ${total} < 原稿段落数 ${orig.paragraph_count}`);
});
check('表格单元格文字逐格与原稿一致（抽查表1首行）', () => {
  const t0 = tables[0];
  const head = t0.rows[0].map(c => c.text);
  assert.strictEqual(head[0], '变量');
  assert.strictEqual(head[1], '<25岁（n=253）');
  assert.strictEqual(head[7], 'P值');
  assert(head[2].includes('1206'), '第3列: ' + head[2]);
});
check('单元格内多段落不丢失（原稿单元格含换行的保留）', () => {
  const cellsWithText = tables.reduce((a, t) => a + t.rows.flat().filter(c => (c.text || '').trim()).length, 0);
  assert(cellsWithText > 40, '有内容的单元格：' + cellsWithText);
});
check('关键词/中图分类号等整段文字未被拆断', () => {
  const kw = ir.blocks.find(b => textOf(b).startsWith('【关键词】'));
  assert(kw && textOf(kw).length > 10, '关键词段异常');
  assert(/精子DNA碎片化指数/.test(textOf(kw)));
});

console.log('\n[B] 翻译后重建（模拟接口返回，逐段核对版式不变）');
const units = core.eachTextUnit(ir);
const batches = core.buildBatches(units, 2800);
console.log('   可翻译片段:', units.length, '| 批次:', batches.length);

const idx = new Map();
units.forEach(u => idx.set(u.text, u));
// 模拟翻译引擎：标记原样保留，只把片段正文"翻译"（此处用倒序代替）
function pseudoTranslate(s) {
  return s.replace(new RegExp(core.SEG_OPEN + '\\s*(\\d+)\\s*' + core.SEG_CLOSE + '([\\s\\S]*?)' + core.SEG_OPEN + '\\s*\\1\\s*' + core.SEG_CLOSE, 'g'),
    (m, n, body) => core.segToken(n) + body.split('').reverse().join('') + core.segToken(n));
}
let applied = 0, missed = 0;
for (const batch of batches) {
  const translated = pseudoTranslate(batch.text);
  const segs = core.parseSegments(translated, batch.items.length);
  batch.items.forEach((u, i) => {
    if (segs[i] == null) { missed++; core.applyTranslation(ir, u, null); }
    else { core.applyTranslation(ir, u, segs[i]); applied++; }
  });
}
console.log('   回填成功:', applied, '| 未命中(走兜底):', missed);

check('回填后文档块数与类型完全不变', () => {
  const c2 = ir.blocks.reduce((a, b) => (a[b.type] = (a[b.type] || 0) + 1, a), {});
  assert.deepStrictEqual(c2, counts);
});
check('回填后表格规格不变（8/6/4 列）', () => {
  const cols = ir.blocks.filter(b => b.type === 'table').map(t => t.rows[0].length);
  assert.deepStrictEqual(cols, [8, 6, 4]);
});
check('回填后所有单元格都有内容（没有空掉/错位）', () => {
  for (const t of tables) {
    for (const row of t.rows) {
      for (const c of row) {
        const had = (c.o || '').length > 0;
        const has = (c.text || '').length > 0;
        assert.strictEqual(had, has, '单元格内容错位: ' + JSON.stringify(c.o) + ' → ' + JSON.stringify(c.text));
      }
    }
  }
});
check('回填后段落字号/对齐/缩进原样保持', () => {
  const p = ir.blocks.find(b => b.type === 'paragraph' && b.indent === 21 && b.size === 10.5);
  assert(p && p.align === 'justify');
  const img = ir.blocks.find(b => b.type === 'image');
  assert(img.caption, '图题在回填后丢失');
});

const outHtml = rh.renderDocument(ir, { title: 'sample1-translated', bodySize: ir.bodySize });
fs.writeFileSync(path.join(OUT, 'sample1-real.translated.html'), outHtml, 'utf8');
fs.writeFileSync(path.join(OUT, 'sample1-real.bilingual.html'),
  rh.renderBilingualDocument(ir, { title: 'sample1 双语对照' }), 'utf8');
fs.writeFileSync(path.join(OUT, 'sample1-real.txt'), rh.renderText(ir), 'utf8');

check('输出 HTML 含 3 个表格且列数与原稿一致', () => {
  const tcount = (outHtml.match(/<table class="ly-table">/g) || []).length;
  assert.strictEqual(tcount, 3, 'HTML 表格数: ' + tcount);
  const colgroups = outHtml.match(/<colgroup>[\s\S]*?<\/colgroup>/g) || [];
  assert.deepStrictEqual(colgroups.map(c => (c.match(/<col /g) || []).length), [8, 6, 4]);
});
check('输出 HTML 保留 15pt 主标题、21pt 缩进、8pt 表注', () => {
  assert(/font-size:15pt/.test(outHtml), '15pt 主标题丢失');
  assert(/text-indent:21pt/.test(outHtml), '缩进丢失');
  assert(/font-size:8pt/.test(outHtml), '8pt 表注丢失');
});
check('输出 HTML 图片为内嵌 base64（不依赖外部文件）', () => {
  assert(/data:image\/png;base64,/.test(outHtml), '图片未内嵌');
});
check('双语对照文件同时含原文与译文', () => {
  const bi = fs.readFileSync(path.join(OUT, 'sample1-real.bilingual.html'), 'utf8');
  assert(/不育男性年龄与精子DNA碎片化指数的关联性研究/.test(bi), '对照缺少原文');
  assert(/究研性联关的数指化片碎A N D/.test(bi) === false);
  assert(/梁吉旺/.test(bi) && /旺吉梁/.test(bi), '对照缺少原文或译文');
});

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
