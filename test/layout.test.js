/* 版式算法单元测试（合成数据，位置完全可控）
 * 覆盖：行聚类、分栏检测、阅读顺序、表格识别与行列顺序、页边距
 * 运行：node lingyi/test/layout.test.js
 */
'use strict';
const path = require('path');
const assert = require('assert');
const SRC = path.join(__dirname, '..', 'src');
const core = require(path.join(SRC, 'core.js'));
const layout = require(path.join(SRC, 'layout.js'));
const px = require(path.join(SRC, 'pdf-extract.js'));

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '  →  ' + e.message); fail++; }
}

/* 造一个 item：文本、左边界、基线 y、字号 */
function it(str, x, y, size, opts) {
  opts = opts || {};
  const w = (opts.w != null) ? opts.w : str.length * size * (core.hasCJK(str) ? 1 : 0.5);
  return {
    str: str, x0: x, x1: x + w,
    y0: y - size * 0.25, y1: y + size * 0.85,
    size: size, font: opts.font || 'SimSun', hasEOL: false, dir: 'ltr'
  };
}

console.log('\n[1] 行聚类与段落合并');
{
  const items = [
    it('第一行文字内容', 100, 100, 10),
    it('第二行文字内容', 100, 116, 10),
    it('第三行文字内容', 100, 132, 10),
    it('另一段的开头', 120, 160, 10),   // 间距大 + 缩进 → 新段落
    it('另一段第二行', 100, 176, 10)
  ];
  const lines = layout.groupLines(items);
  check('按基线聚成 5 行', () => assert.strictEqual(lines.length, 5, '行数=' + lines.length));
  check('行按 y 从小到大（自上而下）排列', () => {
    for (let i = 1; i < lines.length; i++) assert(lines[i].y0 >= lines[i - 1].y0, '第 ' + i + ' 行顺序错');
  });
  const paras = px.linesToParagraphs(lines);
  check('段落合并：3 行正文 + 2 行新段落 = 2 段', () => {
    assert.strictEqual(paras.length, 2, '段数=' + paras.length);
    assert(/第一行文字内容第二行文字内容第三行文字内容/.test(paras[0].text), '第1段: ' + paras[0].text);
    assert(/另一段的开头另一段第二行/.test(paras[1].text), '第2段: ' + paras[1].text);
  });
}

console.log('\n[2] 双栏检测与阅读顺序（左栏先、再右栏）');
{
  const items = [];
  // 通栏标题（居中，宽度接近整版 —— 真实论文标题都是这个形态）
  items.push(it('这是通栏大标题这是通栏大标题', 100, 60, 14, { w: 400 }));
  // 左栏 6 行（中文字号 10pt → 每字约 10pt）
  for (let i = 0; i < 6; i++) items.push(it('左栏第' + (i + 1) + '行内容', 62, 120 + i * 16, 10, { w: 90 }));
  // 右栏 6 行
  for (let i = 0; i < 6; i++) items.push(it('右栏第' + (i + 1) + '行内容', 320, 120 + i * 16, 10, { w: 90 }));

  check('能检出分栏走廊（约在 x=152~320）', () => {
    const cor = layout.findColumnCorridor(items, { minGap: 12 });
    assert(cor, '没找到分栏走廊');
    assert(cor.x0 >= 150 && cor.x1 <= 330 && (cor.x1 - cor.x0) > 100, '走廊位置=' + cor.x0 + '~' + cor.x1);
    assert(cor.coverage > 0.8, '覆盖率=' + cor.coverage);
  });
  const regions = layout.analyzePage(items, {});
  const text = regions.map(r => r.lines.map(l => l.items.map(x => x.str).join('')).join('')).join('|');
  check('阅读顺序：通栏标题 → 左栏全部 → 右栏全部', () => {
    const iTitle = text.indexOf('通栏大标题');
    const iL1 = text.indexOf('左栏第1行');
    const iL6 = text.indexOf('左栏第6行');
    const iR1 = text.indexOf('右栏第1行');
    assert(iTitle >= 0 && iL1 > iTitle, '标题未在最前');
    assert(iL6 > iL1 && iR1 > iL6, '左栏未整体先于右栏: ' + [iTitle, iL1, iL6, iR1].join(','));
  });
  check('左右栏被识别为独立区域（不会交错）', () => {
    const txt = r => r.lines.map(l => l.items.map(x => x.str).join('')).join('');
    const leftRegion = regions.find(r => /左栏第1行/.test(txt(r)));
    const rightRegion = regions.find(r => /右栏第1行/.test(txt(r)));
    assert(leftRegion && rightRegion && leftRegion !== rightRegion, '左右栏落在同一区域');
  });
  check('同一行不会被合并成"左栏+右栏"（分行正确）', () => {
    const bad = [];
    regions.forEach(r => r.lines.forEach(l => {
      const s = l.items.map(x => x.str).join('');
      if (/左栏/.test(s) && /右栏/.test(s)) bad.push(s);
    }));
    assert.strictEqual(bad.length, 0, '被错误合并的行: ' + bad.join(' / '));
  });
}

console.log('\n[3] 表格识别（表头必须在第一行、列数必须完整）');
{
  const cells = [
    ['变量', '第一组', '第二组', 'P值'],
    ['年龄', '32.5', '34.1', '<0.001'],
    ['BMI', '23.1', '23.6', '0.012'],
    ['精子浓度', '35.2', '29.8', '<0.001']
  ];
  const colX = [70, 160, 250, 340];
  const items = [];
  cells.forEach((row, ri) => row.forEach((c, ci) => {
    items.push(it(c, colX[ci], 200 + ri * 16, 9, { w: Math.max(20, c.length * 9 * 0.55) }));
  }));
  const lines = layout.groupLines(items);
  const t = layout.detectTable(lines, { minCols: 2, minRows: 2 });
  check('识别为表格且列数=4', () => {
    assert(t, '未识别为表格');
    assert.strictEqual(t.colCount, 4, '列数=' + t.colCount);
  });
  check('行数=4', () => assert.strictEqual(t.grid.length, 4, '行数=' + t.grid.length));
  check('表头在第一行（变量/第一组/第二组/P值）', () => {
    const head = t.grid[0].map(c => c ? c.items.map(x => x.str).join('') : '').join('|');
    assert(/变量/.test(head) && /第一组/.test(head) && /P值/.test(head), '表头: ' + head);
  });
  check('每行单元格与原表一致', () => {
    const rows = t.grid.map(r => r.map(c => c ? c.items.map(x => x.str).join('') : ''));
    assert.strictEqual(rows[1][0], '年龄');
    assert.strictEqual(rows[1][2], '34.1');
    assert.strictEqual(rows[3][3], '<0.001');
  });
}

console.log('\n[4] 反例：普通正文不应被误判成表格');
{
  // 正文里有零散大空白（首行缩进、行末短），不应识别为表格
  const items = [
    it('本研究采用便利抽样法，选取', 62, 100, 10, { w: 200 }),
    it('216', 270, 100, 10, { w: 20 }),
    it('例作为研究对象。纳入标准：', 300, 100, 10, { w: 150 }),
    it('（1）年龄 0～14 岁；', 62, 116, 10, { w: 130 }),
    it('（2）经超声心动图确诊。', 200, 116, 10, { w: 130 })
  ];
  const lines = layout.groupLines(items);
  const t = layout.detectTable(lines, { minCols: 2, minRows: 2 });
  check('正文不会被误判为表格', () => assert(!t, '被误判了：' + JSON.stringify(t && t.colCount)));
}

console.log('\n[5] 页内边距估算（用版面上下的最大留白）');
{
  const pages = [{
    width: 595, height: 842,
    items: [
      it('标题', 62, 70, 15, { w: 300 }),
      it('正文第一行', 62, 100, 10, { w: 460 }),
      it('正文第二行', 62, 116, 10, { w: 460 }),
      it('正文第三行', 62, 132, 10, { w: 460 })
    ]
  }];
  const m = px.estimateMargins(pages);
  check('上边距接近标题顶端（≈65pt）', () => assert(m[1] > 40 && m[1] < 100, '上=' + m[1]));
  check('左边距接近 62pt', () => assert(Math.abs(m[0] - 62) < 6, '左=' + m[0]));
}

console.log('\n[6] 标题层级判定（中文论文常见形态）');
{
  const mk = (text, size, bold, align) => ({ type: 'paragraph', runs: [{ t: text }], size: size, bold: bold, align: align });
  const env = { bodySize: 10.5, sizes: [15, 12, 10.5, 9] };
  check('主标题（15pt 居中加粗）判为 1 级', () => {
    // 主标题的"1 级"由 applyHeadingLevels 结合版式位置确定
    const ir = { bodySize: 10.5, fontSizes: [15, 12, 10.5], blocks: [mk('某某研究', 15, true, 'center')] };
    core.applyHeadingLevels(ir, {});
    assert.strictEqual(ir.blocks[0].type, 'heading');
    assert.strictEqual(ir.blocks[0].level, 1, '层级=' + ir.blocks[0].level);
  });
  check('"1 对象与方法"（12pt 加粗）判为 1 级', () => {
    assert.strictEqual(core.classifyHeading(mk('1 对象与方法', 12, true, null), env), 1);
  });
  check('"2.3 各变量与DFI的相关性" 判为 2 级', () => {
    assert.strictEqual(core.classifyHeading(mk('2.3 各变量与DFI的相关性', 10.5, true, null), env), 2);
  });
  check('"参考文献" 判为 1 级', () => {
    assert.strictEqual(core.classifyHeading(mk('参考文献', 12, true, null), env), 1);
  });
  check('普通长句不会被误判为标题', () => {
    assert.strictEqual(core.classifyHeading(mk('本研究采用便利抽样法，选取 216 例患者作为研究对象，纳入标准如下。', 10.5, false, null), env), 0);
  });
  check('表格标题（表1 ...）不判为标题', () => {
    assert.strictEqual(core.classifyHeading(mk('表1 两组基线特征比较', 10.5, true, 'center'), env), 0);
  });
}

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
