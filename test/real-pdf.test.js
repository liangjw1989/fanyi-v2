/* 真实 PDF 回归测试（ground truth：LibreOffice 生成的双栏期刊版式）
 * 把 python 端抽取的真实 PDF 文字（pdf.js 等价结构）喂给 JS 抽取器，
 * 验证：分栏阅读顺序、段落合并、字号、首行缩进、表格还原、翻译回填。
 * 运行：node lingyi/test/real-pdf.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'src');
const core = require(path.join(SRC, 'core.js'));
const layout = require(path.join(SRC, 'layout.js'));
const px = require(path.join(SRC, 'pdf-extract.js'));
const rh = require(path.join(SRC, 'render-html.js'));

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '  →  ' + e.message); fail++; }
}

const fixPath = (function pickFixture() {
  // 优先用真实论文 PDF 抽出的向量（含隐私，公开仓库里不会有）；
  // 没有就用 make_pdf_fixture.py 生成的合成向量（版式已知，同样能验证算法）。
  const real = path.join(__dirname, 'samples', 'twocol.pdfjs.json');
  const synthetic = path.join(__dirname, 'samples', 'twocol.synthetic.pdfjs.json');
  if (fs.existsSync(real)) return real;
  if (fs.existsSync(synthetic)) return synthetic;
  return real;
})();
if (!fs.existsSync(fixPath)) {
  console.log('缺少 PDF 测试素材，跳过 real-pdf.test.js');
  console.log('（可运行：python test/tools/make_pdf_fixture.py 生成合成向量）');
  process.exit(0);
}
const usingSynthetic = /synthetic/.test(fixPath);
console.log('测试素材:', path.basename(fixPath) + (usingSynthetic ? '（合成向量）' : '（真实论文）'));
const fixture = JSON.parse(fs.readFileSync(fixPath, 'utf8'));
const sourceText = fixture.reduce((a, pg) => a + pg.items.map(i => i.str).join(''), '');
const sourceChars = sourceText.replace(/\s/g, '').length;

/** 把块树（含分栏容器）压成纯文本 */
function flatText(blocks) {
  const out = [];
  (function walk(bs) {
    for (const b of bs) {
      if (b.type === 'container') { (b.columns || []).forEach(g => walk(g.blocks || [])); continue; }
      if (b.type === 'table') { (b.rows || []).forEach(r => r.forEach(c => out.push(c.text || ''))); continue; }
      if (b.type === 'pagebreak' || b.type === 'hr' || b.type === 'code') continue;
      out.push(core.runsToText(b.runs || []));
    }
  })(blocks);
  return out.join('|');
}

function mockPdfjs(pages) {
  return {
    getDocument() {
      return {
        promise: Promise.resolve({
          numPages: pages.length,
          getPage(n) {
            const pg = pages[n - 1];
            return Promise.resolve({
              getViewport() { return { width: pg.width, height: pg.height }; },
              getTextContent() { return Promise.resolve({ items: pg.items, styles: pg.styles }); }
            });
          }
        })
      };
    }
  };
}

(async function main() {
  console.log('\n[A] 真实 PDF（双栏期刊版式）→ IR');
  const ir = await px.extractPDF(new ArrayBuffer(8), { pdfjs: mockPdfjs(fixture), fileName: 'twocol.pdf' });
  const counts = ir.blocks.reduce((a, b) => (a[b.type] = (a[b.type] || 0) + 1, a), {});
  fs.writeFileSync(path.join(OUT, 'ir-pdf.json'), JSON.stringify({
    bodySize: ir.bodySize, page: ir.page, counts: counts,
    blocks: ir.blocks.map(b => ({
      type: b.type, size: b.size, align: b.align, indent: b.indent, bold: b.bold,
      text: b.type === 'table' ? `[table ${b.rows.length}x${b.rows[0].length}]` :
        (b.type === 'pagebreak' ? '[pagebreak]' : core.runsToText(b.runs).slice(0, 80))
    }))
  }, null, 1), 'utf8');

  console.log('   blocks:', JSON.stringify(counts), '| bodySize:', ir.bodySize);
  console.log('   page:', JSON.stringify(ir.page), '| 字号:', ir.fontSizes.join('/'));
  // 分栏容器内的内容也要一起统计
  const flat = [];
  (function walk(bs) {
    for (const b of bs) {
      if (b.type === 'container') { (b.columns || []).forEach(g => walk(g.blocks || [])); continue; }
      flat.push(b);
    }
  })(ir.blocks);
  const paras = flat.filter(b => b.type === 'paragraph');
  const tables = flat.filter(b => b.type === 'table');

  check('页面尺寸与原 PDF 一致（595.3×841.9）', () => {
    assert(Math.abs(ir.page.width - 595.3) < 1, 'width=' + ir.page.width);
    assert(Math.abs(ir.page.height - 841.9) < 1, 'height=' + ir.page.height);
  });
  check('正文主字号识别为 10.5pt（与原 PDF 一致）', () => {
    assert(Math.abs(ir.bodySize - 10.5) < 0.6, 'bodySize=' + ir.bodySize);
  });
  check('页边距识别在合理范围（左≈62.5）', () => {
    assert(Math.abs(ir.page.margin[0] - 62.5) < 8, '左=' + ir.page.margin[0]);
    // 说明：本测试的文字来自 tests/tools/pdftext.py（纯标准库实现的离线抽取器），
    // 它只能还原近似版式；浏览器里用的是 pdf.js，精度更高。
    assert(ir.page.margin[1] > 30 && ir.page.margin[1] < 200, '上=' + ir.page.margin[1]);
  });
  check('表格被识别（列数≥3、行数≥2）', () => {
    assert(tables.length >= 1, '没有识别到表格');
    const t = tables[0];
    assert(t.rows.length >= 2, '行数=' + t.rows.length);
    assert(t.rows[0].length >= 3, '列数=' + t.rows[0].length);
  });
  check('表格内容来自原表（含表头关键词）', () => {
    const all = tables[0].rows.flat().map(c => c.text || '').join('|');
    assert(/轮次|指标数|肯德尔|第一轮|第二轮|最终/.test(all), '表格内容: ' + all.slice(0, 80));
  });
  check('标题被识别（至少 2 个章节标题）', () => {
    const all = flat.filter(b => b.type === 'heading');
    assert(all.length >= 2, '标题数=' + all.length);
    const texts = all.map(b => core.runsToText(b.runs));
    assert(texts.some(t => /对象与方法|参考文献|讨论|结果/.test(t)), '标题内容: ' + texts.join('|'));
  });
  if (usingSynthetic) {
    check('合成向量：通栏标题区 + 双栏正文被正确分层', () => {
      const containers = ir.blocks.filter(b => b.type === 'container');
      assert.strictEqual(containers.length, 1, '分栏容器数=' + containers.length);
      assert.strictEqual(containers[0].columns.length, 2, '分栏数=' + containers[0].columns.length);
      const txt = flatText(ir.blocks);
      assert(txt.indexOf('对象与方法') >= 0 && txt.indexOf('结果') > txt.indexOf('对象与方法'),
        '左栏未整体先于右栏');
    });
  } else {
    check('阅读顺序正确：第 1 页从"关键词"开始，第 2 页从"讨论"章节开始（左栏优先）', () => {
      const pb = ir.blocks.findIndex(b => b.type === 'pagebreak');
      assert(pb > 0, '没有分页标记');
      const t1 = flatText(ir.blocks.slice(0, pb));
      assert(/关键词/.test(t1), '第 1 页内容异常: ' + t1.slice(0, 60));
      const t2 = flatText(ir.blocks.slice(pb + 1)).slice(0, 80);
      assert(/讨论/.test(t2), '第 2 页开头不是"3 讨论": ' + t2);
    });
    check('左栏内容整体排在右栏之前（右栏末尾是参考文献）', () => {
      const text = flatText(ir.blocks);
      const refIdx = text.indexOf('参考文献');
      const discIdx = text.indexOf('讨论');
      assert(refIdx > 0 && discIdx > 0 && refIdx > discIdx, '参考文献不在讨论之后: disc=' + discIdx + ' ref=' + refIdx);
    });
  }
  check('首行缩进被保留（中文正文空两格 ≈ 21pt）', () => {
    const withIndent = paras.filter(p => p.indent && p.indent > 8 && p.indent < 40);
    if (usingSynthetic) {
      // 合成向量的每行都是左对齐短行，本身没有首行缩进；只要求不误判
      assert(withIndent.length <= 1, '把普通行误判成缩进了: ' + withIndent.length);
    } else {
      assert(withIndent.length >= 3, '有缩进的段落数=' + withIndent.length);
    }
  });
  check('文本覆盖率 ≥ 95%（段落合并没有丢字）', () => {
    const all = flat.map(b => b.type === 'table'
      ? b.rows.flat().map(c => c.text).join('')
      : core.runsToText(b.runs || [])).join('');
    const got = all.replace(/\s/g, '').length;
    const ratio = got / Math.max(1, sourceChars);
    assert(ratio >= 0.95, `覆盖率 ${(ratio * 100).toFixed(1)}% (${got}/${sourceChars})`);
  });
  check('没有把两栏文字交错在一起（不出现栏间乱序片段）', () => {
    const bad = paras.map(p => core.runsToText(p.runs)).filter(t => /^[、。，；]/.test(t) && t.length < 12);
    assert(bad.length <= 2, '可疑碎片段落: ' + JSON.stringify(bad.slice(0, 4)));
  });

  console.log('\n[B] 翻译 → 回填 → 渲染');
  const units = core.eachTextUnit(ir);
  const batches = core.buildBatches(units, 2800);
  let applied = 0, missed = 0;
  for (const batch of batches) {
    const translated = batch.text.replace(
      new RegExp(core.SEG_OPEN + '\\s*(\\d+)\\s*' + core.SEG_CLOSE + '([\\s\\S]*?)' + core.SEG_OPEN + '\\s*\\1\\s*' + core.SEG_CLOSE, 'g'),
      (m, n, body) => core.segToken(n) + body + core.segToken(n));
    const segs = core.parseSegments(translated, batch.items.length);
    batch.items.forEach((u, i) => {
      if (segs[i] == null) { missed++; core.applyTranslation(ir, u, null); }
      else { core.applyTranslation(ir, u, segs[i]); applied++; }
    });
  }
  console.log('   片段:', units.length, '| 批次:', batches.length, '| 回填:', applied, '| 兜底:', missed);

  check('PDF 全部分段都能回填（哨兵标记保护有效）', () => {
    assert.strictEqual(missed, 0, missed + ' 段未回填');
  });
  check('回填后块类型与数量不变', () => {
    const c2 = ir.blocks.reduce((a, b) => (a[b.type] = (a[b.type] || 0) + 1, a), {});
    assert.deepStrictEqual(c2, counts);
  });
  check('回填后表格列数不变', () => {
    const cols = flat.filter(b => b.type === 'table').map(t => t.rows[0].length).join(',');
    assert.strictEqual(cols, tables.map(t => t.rows[0].length).join(','), '列数变化: ' + cols);
  });

  const html = rh.renderDocument(ir, { title: 'twocol 译文', bodySize: ir.bodySize });
  fs.writeFileSync(path.join(OUT, 'twocol.translated.html'), html, 'utf8');
  fs.writeFileSync(path.join(OUT, 'twocol.bilingual.html'), rh.renderBilingualDocument(ir, { title: 'twocol 对照' }), 'utf8');
  fs.writeFileSync(path.join(OUT, 'twocol.txt'), rh.renderText(ir), 'utf8');

  check('输出 HTML 使用与原 PDF 相同的纸张尺寸与页边距', () => {
    const exp = '@page { size: ' + ir.page.width + 'pt ' + ir.page.height + 'pt';
    assert(html.indexOf(exp) >= 0, '缺少原尺寸分页设置：' + exp);
    if (!usingSynthetic) assert(/pagebreak/.test(html), '缺少分页标记');
  });
  check('输出 HTML 保留 10.5pt 正文与 12pt 标题', () => {
    assert(/font-size:10\.5pt/.test(html), '10.5pt 正文丢失');
    assert(/font-size:12pt/.test(html), '12pt 标题丢失');
  });
  check('输出 HTML 含表格且保留柱数', () => {
    assert(/<colgroup>/.test(html), '没有 colgroup');
    const first = /<colgroup>([\s\S]*?)<\/colgroup>/.exec(html);
    const cols = (first[1].match(/<col /g) || []).length;
    assert(cols >= 3, '列数=' + cols);
  });

  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常：', e); process.exit(1); });
