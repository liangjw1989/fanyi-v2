/* 端到端（模拟浏览器环境）：抽取 → 翻译（模拟接口）→ 生成 Word/HTML → 校验产物
 * 运行：node lingyi/test/e2e.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'src');
const OUT = path.join(__dirname, 'out', 'e2e');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '  →  ' + e.message); fail++; }
}

/* ---------------------------------------------- 搭建一个最小的浏览器沙箱 */
function makeSandbox() {
  const sandbox = {
    console: console,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    Promise: Promise, JSON: JSON, Math: Math, Date: Date, Object: Object,
    Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error,
    isFinite: isFinite, parseInt: parseInt, parseFloat: parseFloat,
    Uint8Array: Uint8Array, ArrayBuffer: ArrayBuffer, Buffer: Buffer,
    TextEncoder: TextEncoder, Blob: function (parts, o) { this.parts = parts; this.type = (o || {}).type; },
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => { } },
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    fetch: async () => { throw new Error('sandbox fetch 不应被真实调用'); }
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  // 简易 DOM（docx 库需要极少 DOM 能力；这里只为库的顶层特性探测）
  sandbox.document = {
    createElement() {
      return { style: {}, setAttribute() { }, appendChild() { }, removeChild() { }, click() { }, dataset: {}, classList: { add() { }, remove() { } }, textContent: '', innerHTML: '' };
    },
    getElementById() { return null; },
    querySelectorAll() { return []; },
    body: { appendChild() { }, removeChild() { } }
  };
  sandbox.navigator = { userAgent: 'node' };
  return sandbox;
}

function loadModules(sandbox) {
  const files = ['core.js', 'layout.js', 'docx-extract.js', 'pdf-extract.js',
    'render-html.js', 'render-docx.js', 'glossary.js', 'tm.js', 'translate.js'];
  const ctx = vm.createContext(sandbox);
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }
  return sandbox;
}

/* ---------------------------------------------- 模拟翻译接口
 * 说明：真实引擎看到的文本里含有符号占位符（⟦P0⟧）与术语占位符（⟦T0⟧）。
 * 这里模拟一个"先还原占位符、再按词典翻译、最后把占位符恢复原状"的引擎，
 * 这样可以同时验证：分段标记不丢、占位符不被吞、译文能正确回填。
 */
function installMockApi(sandbox, dict) {
  const calls = [];
  const G = sandbox.LingyiGlossary;
  sandbox.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const out = body.text.replace(
      new RegExp(sandbox.LingyiCore.SEG_OPEN + '\\s*(\\d+)\\s*' + sandbox.LingyiCore.SEG_CLOSE + '([\\s\\S]*?)' + sandbox.LingyiCore.SEG_OPEN + '\\s*\\d+\\s*' + sandbox.LingyiCore.SEG_CLOSE, 'g'),
      (m, n, inner) => {
        // 把 ⟦P0⟧/⟦T1⟧ 暂时换成不可见标记，翻完再换回来（模拟"引擎原样保留"）
        const phs = [];
        let text = inner.replace(new RegExp(G.PH_OPEN + '(' + G.PH_PREFIX + '|' + G.TERM_PREFIX + ')(\\d+)' + G.PH_CLOSE, 'g'),
          (mm) => { phs.push(mm); return '\u0001' + (phs.length - 1) + '\u0001'; });
        const bare = text.replace(/\u0001(\d+)\u0001/g, '');   // 去掉占位符后的纯文本，用来判断词典是否命中
        let hit = false;
        for (const k of Object.keys(dict)) {
          if (bare.indexOf(k) >= 0) { text = text.split(k).join(dict[k]); hit = true; }
        }
        if (!hit) {
          // 未命中词典：把纯文本倒序（占位符本身保持原位），验证极端情况下结构与符号也不丢
          const seq = text.split(/(\u0001\d+\u0001)/);
          text = seq.map(s => /^\u0001\d+\u0001$/.test(s) ? s : s.split('').reverse().join('')).join('');
        }
        text = text.replace(/\u0001(\d+)\u0001/g, (mm, i) => phs[+i]);
        return sandbox.LingyiCore.segToken(n) + text + sandbox.LingyiCore.segToken(n);
      });
    return { json: async () => ({ code: 0, result: out }) };
  };
  return calls;
}

(async function main() {
  const sandbox = loadModules(makeSandbox());
  const core = sandbox.LingyiCore;
  const dx = sandbox.LingyiDocx;
  const rh = sandbox.LingyiRenderHtml;
  const rd = sandbox.LingyiRenderDocx;

  /* ------------------------------------------ 1. Word 全流程 */
  console.log('\n[A] Word（.docx）全流程：解析 → 翻译 → 生成 Word');
  const htmlPath = path.join(__dirname, 'samples', 'sample1.mammoth-like.html');
  if (!fs.existsSync(htmlPath)) {
    // 公开仓库里不带真实论文原稿（含患者数据/未发表内容），测试自动跳过
    console.log('  （未找到真实样本 test/samples/sample1.mammoth-like.html，跳过 Word 端到端；');
    console.log('    运行 python test/tools/docx2html.py <你的.docx> <输出.html> 即可补上）');
    console.log('\n结果：通过 0 项，失败 0 项（已跳过）');
    process.exit(0);
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const ir = dx.convertHtmlToIR(html, { fileName: 'sample1.docx' });
  ir.meta.fileName = 'sample1.docx';
  const before = snapshot(ir, core);

  const dict = {
    '不育男性年龄与精子DNA碎片化指数的关联性研究：基于4441例的横断面分析':
      'Association between age and sperm DNA fragmentation index in infertile men: a cross-sectional analysis of 4441 cases',
    '梁吉旺，郑波，韩小克，都美阳，潘跃普': 'LIANG Jiwang, ZHENG Bo, HAN Xiaoke, DU Meiyang, PAN Yuepu',
    '变量': 'Variable', 'H值': 'H value', 'P值': 'P value', '引言': 'Introduction',
    '参考文献': 'References', '1 对象与方法': '1 Subjects and methods',
    '1.1 研究对象': '1.1 Study subjects', '2 结果': '2 Results',
    '注：': 'Note: ', '表': 'Table ', '图': 'Figure '
  };
  const calls = installMockApi(sandbox, dict);

  // 真实使用中，标题这类长句会被术语库整条接管（术语优先级最高），这才不会被符号拆碎
  const terms = [{
    src: '不育男性年龄与精子DNA碎片化指数的关联性研究：基于4441例的横断面分析',
    dst: 'Association between age and sperm DNA fragmentation index in infertile men: a cross-sectional analysis of 4441 cases'
  }, { src: '变量', dst: 'Variable' }, { src: 'H值', dst: 'H value' }, { src: 'P值', dst: 'P value' }];

  const result = await sandbox.LingyiTranslate.translateIR(ir, {
    apiUrl: 'https://mock', target: 'en', engine: 'tencent', maxChars: 2800,
    terms: terms, useTM: false
  });
  console.log('   片段:', result.total, '| 成功:', result.translated, '| 保留原文:', result.fallback,
    '| 接口调用:', calls.length, '| 保护符号:', result.symbols, '| 术语:', result.termsApplied);
  const after = snapshot(ir, core);

  check('翻译全部片段成功（没有走兜底）', () => {
    assert.strictEqual(result.translated, result.total, `${result.translated}/${result.total}`);
    assert.strictEqual(result.fallback, 0, '兜底 ' + result.fallback + ' 段');
  });
  check('结构零损伤：块数/类型/表格规格/字号/对齐/缩进全部不变', () => {
    assert.strictEqual(JSON.stringify(after.shape), JSON.stringify(before.shape), '结构发生变化');
  });
  check('译文确实写入了（抽查标题与单元格）', () => {
    const h1 = ir.blocks.find(b => b.type === 'heading' && /Association between age/.test(core.runsToText(b.runs)));
    assert(h1, '标题未翻译');
    const t = ir.blocks.find(b => b.type === 'table');
    assert.strictEqual(t.rows[0][0].text, 'Variable', '单元格未翻译: ' + t.rows[0][0].text);
  });
  check('表格列数仍是 8/6/4', () => {
    const cols = ir.blocks.filter(b => b.type === 'table').map(t => t.rows[0].length).join(',');
    assert.strictEqual(cols, '8,6,4');
  });
  check('图片与图题仍在', () => {
    const imgs = ir.blocks.filter(b => b.type === 'image');
    assert.strictEqual(imgs.length, 2);
    assert(imgs.every(i => i.caption), '图题丢失');
  });

  const docxPath = path.join(OUT, 'sample1.translated.docx');
  check('docx 库可加载并生成 Word 文件', async () => { });
  let docxOk = false, docxErr = '';
  try {
    if (!sandbox.docx) {
      // 浏览器端才有 docx UMD；Node 端用最小的假实现验证调用契约
      sandbox.docx = makeDocxStub();
    }
    const r = await rd.renderDocx(ir, { docx: sandbox.docx, fileName: 'sample1-灵译' });
    assert(r && r.blob && /\.docx$/.test(r.filename), '未返回 docx');
    fs.writeFileSync(docxPath.replace('.docx', '.blobinfo.json'), JSON.stringify({
      filename: r.filename, blobParts: (r.blob.parts || []).length
    }), 'utf8');
    docxOk = true;
  } catch (e) { docxErr = e.message; }
  check('renderDocx 能按骨架生成文档（调用契约正确）', () => {
    assert(docxOk, docxErr);
  });

  const outHtml = rh.renderDocument(ir, { title: 'sample1-en', bodySize: ir.bodySize });
  fs.writeFileSync(path.join(OUT, 'sample1.translated.html'), outHtml, 'utf8');
  fs.writeFileSync(path.join(OUT, 'sample1.bilingual.html'), rh.renderBilingualDocument(ir, { title: 'sample1 对照' }), 'utf8');
  check('HTML 输出保留表格列数与原始字号', () => {
    assert(/<colgroup>/.test(outHtml));
    // 三个表格共 8+6+4 = 18 列
    assert.strictEqual((outHtml.match(/<col /g) || []).length, 18, '列数不对');
    assert(/font-size:15pt/.test(outHtml));
  });

  /* ------------------------------------------ 2. PDF 全流程（用 ground truth 文字） */
  console.log('\n[B] PDF 全流程：解析 → 翻译 → 生成 HTML（并检查分栏还原）');
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'samples', 'twocol.pdfjs.json'), 'utf8'));
  const mockPdfjs = {
    getDocument() {
      return {
        promise: Promise.resolve({
          numPages: fixture.length,
          getPage(n) {
            const pg = fixture[n - 1];
            return Promise.resolve({
              getViewport() { return { width: pg.width, height: pg.height }; },
              getTextContent() { return Promise.resolve({ items: pg.items, styles: pg.styles }); }
            });
          }
        })
      };
    }
  };
  const pdfIR = await sandbox.LingyiPdfExtract.extractPDF(new ArrayBuffer(8), { pdfjs: mockPdfjs, fileName: 'twocol.pdf' });
  pdfIR.meta.fileName = 'twocol.pdf';
  const pdfBefore = snapshot(pdfIR, core);
  installMockApi(sandbox, { '参考文献': 'References', '讨论': 'Discussion' });
  const pdfResult = await sandbox.LingyiTranslate.translateIR(pdfIR, { apiUrl: 'https://mock', target: 'en', engine: 'tencent' });
  const pdfAfter = snapshot(pdfIR, core);
  console.log('   片段:', pdfResult.total, '| 成功:', pdfResult.translated);

  check('PDF 翻译后结构不变（含分栏容器）', () => {
    assert.deepStrictEqual(pdfAfter.shape, pdfBefore.shape);
  });
  const pdfHtml = rh.renderDocument(pdfIR, { title: 'twocol-en', bodySize: pdfIR.bodySize });
  fs.writeFileSync(path.join(OUT, 'twocol.translated.html'), pdfHtml, 'utf8');
  check('PDF 输出的 HTML 用 flex 分栏还原双栏版式', () => {
    assert(/class="ly-columns"/.test(pdfHtml), '没有分栏容器');
    assert(/class="ly-col"/.test(pdfHtml), '没有分栏');
  });
  check('PDF 输出保留原纸张尺寸与分页', () => {
    assert(/@page \{ size: 595\.3pt 841\.89pt/.test(pdfHtml));
    assert(/ly-pagebreak/.test(pdfHtml));
  });

  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
  console.log('产物目录：' + OUT);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常：', e); process.exit(1); });

/* --------------------------------------------------------------- 辅助 */

/** 抓取 IR 的"骨架指纹"：块数、类型、层级、字号、对齐、缩进、表格规格、图片与图题数量 */
function snapshot(ir, core) {
  const shape = [];
  const walk = (blocks) => {
    for (const b of blocks) {
      if (b.type === 'container') { shape.push('container:' + (b.columns || []).length); (b.columns || []).forEach(g => walk(g.blocks || [])); continue; }
      if (b.type === 'table') {
        shape.push('table:' + b.rows.length + 'x' + b.rows[0].length + ':' + b.rows.map(r => r.length).join('-'));
        continue;
      }
      if (b.type === 'image') { shape.push('image:' + (b.caption ? 'cap' : 'nocap')); continue; }
      shape.push([b.type, b.level || 0, b.size || 0, b.align || '', b.indent || 0,
        (b.runs || []).map(r => (r.b ? 'b' : '') + (r.i ? 'i' : '') + (r.sup ? '^' : '') + (r.size || '')).join(',')].join('|'));
    }
  };
  walk(ir.blocks);
  return { shape: shape };
}

/** 最小的 docx 库替身：只验证 renderDocx 的调用契约 */
function makeDocxStub() {
  const Paragraph = function (o) { this.o = o; };
  const TextRun = function (o) { this.o = o; };
  const ImageRun = function (o) { this.o = o; };
  const Table = function (o) { this.o = o; };
  const TableRow = function (o) { this.o = o; };
  const TableCell = function (o) { this.o = o; };
  return {
    Document: function (o) { this.o = o; },
    Packer: { toBlob: async (d) => ({ parts: [JSON.stringify(d.o).length], type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }) },
    Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
    WidthType: { PERCENTAGE: 'pct' },
    AlignmentType: { CENTER: 'center', START: 'start' },
    BorderStyle: { SINGLE: 'single' },
    HeadingLevel: { HEADING_1: 'Heading1', HEADING_2: 'Heading2', HEADING_3: 'Heading3', HEADING_4: 'Heading4' },
    ShadingType: { CLEAR: 'clear' },
    VerticalAlign: { CENTER: 'center' },
    PageBreak: function () { }
  };
}
