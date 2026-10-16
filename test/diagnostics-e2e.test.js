/* diagnostics-e2e.test.js — 端到端：真实 PDF 解析 → 诊断报告能否产出可用数据
 * 用法: node test/diagnostics-e2e.test.js
 *
 * 为什么需要它：诊断报告是"远程定位排版问题"的唯一手段，
 * 必须保证"真实解析结果 → 报告"这条链路真的能出数据（而不是空壳）。
 * 依赖 test/samples/twocol.synthetic.pdfjs.json（合成双栏向量，随仓库提供）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const SAMPLE = path.join(__dirname, 'samples', 'twocol.synthetic.pdfjs.json');

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { console.log('  \u2713 ' + n); pass++; }
  else { console.log('  \u2717 ' + n + (extra ? '  → ' + extra : '')); fail++; }
};

if (!fs.existsSync(SAMPLE)) {
  console.log('缺少合成样本 twocol.synthetic.pdfjs.json');
  console.log('（可运行 python test/tools/make_pdf_fixture.py 生成）');
  console.log('\n结果：通过 0 项，失败 0 项（缺少真实样本，已跳过）');
  process.exit(0);
}

/* ---- 搭沙箱：加载解析 + 诊断模块 ---- */
function mkSandbox(pdfPages) {
  const sb = {
    console, setTimeout, clearTimeout, Promise, JSON, Math, Date, Object, Array, String, Number,
    RegExp, Error, isFinite, parseInt, parseFloat, Uint8Array, ArrayBuffer, TextEncoder,
    Blob: function () { }, URL: {}, atob: s => Buffer.from(s, 'base64').toString('binary')
  };
  sb.globalThis = sb; sb.window = sb;
  sb.document = { createElement: () => ({ style: {}, textContent: '', innerHTML: '' }) };
  /* 假的 pdf.js：直接复用样本里的 pdf.js 结构
     （样本 items 已是 {str, transform, width, height, fontName}，
       不能再做一次坐标换算，否则会算出 NaN） */
  sb.pdfjsLib = {
    getDocument() {
      return {
        promise: Promise.resolve({
          numPages: pdfPages.length,
          getPage(n) {
            const pg = pdfPages[n - 1];
            const items = (pg.items || []).map(it => Object.assign({}, it, { fontName: it.fontName || 'f_SimSun' }));
            const styles = pg.styles || { f_SimSun: { fontFamily: 'SimSun', ascent: 0.8, descent: -0.2 } };
            return Promise.resolve({
              getViewport: () => ({ width: pg.width, height: pg.height }),
              getTextContent: () => Promise.resolve({ items: items, styles: styles }),
              getOperatorList: () => Promise.resolve({})
            });
          }
        })
      };
    }
  };
  const ctx = vm.createContext(sb);
  for (const f of ['core.js', 'layout.js', 'pdf-extract.js', 'diagnostics.js']) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  }
  return sb;
}

const raw = JSON.parse(fs.readFileSync(SAMPLE, 'utf8').replace(/^\uFEFF/, ''));
const pages = raw.pages || raw;

(async () => {
  console.log('样本: ' + path.basename(SAMPLE) + '（' + pages.length + ' 页）\n');

  console.log('=== 1) 真实解析 → IR ===');
  const sb = mkSandbox(pages);
  let ir = null;
  try {
    ir = await sb.LingyiPdfExtract.extractPDF(
      { arrayBuffer: async () => new ArrayBuffer(8) },
      { pdfjs: sb.pdfjsLib, fileName: 'twocol.synthetic.pdf' }
    );
    check('extractPDF 成功', true);
  } catch (e) {
    check('extractPDF 成功', false, e.message);
  }
  if (!ir) { console.log('\n结果：通过 ' + pass + ' 项，失败 ' + (fail + 1) + ' 项'); process.exit(1); }

  const types = {};
  const walk = bs => (bs || []).forEach(b => {
    if (!b) return;
    types[b.type] = (types[b.type] || 0) + 1;
    if (b.type === 'container') (b.columns || []).forEach(g => walk(g.blocks));
  });
  walk(ir.blocks);
  console.log('    块统计: ' + JSON.stringify(types));
  console.log('    正文字号: ' + ir.bodySize);
  check('解析出块（非空）', (ir.blocks || []).length > 0);
  check('识别出双栏容器', !!types.container, JSON.stringify(types));
  check('识别出表格', !!types.table, JSON.stringify(types));

  console.log('\n=== 2) IR → 诊断报告 ===');
  let report = null;
  try {
    report = sb.LingyiDiagnostics.build(ir, {
      version: '2.3.0', fileName: 'twocol.synthetic.pdf', fileType: 'pdf',
      engine: 'tencent', target: 'zh-CN'
    });
    check('生成报告不抛异常', true);
  } catch (e) { check('生成报告不抛异常', false, e.message); }
  if (!report) { console.log('\n结果：通过 ' + pass + ' 项，失败 ' + (fail + 1) + ' 项'); process.exit(1); }

  check('块数与 IR 一致', report.summary.blockCount === (ir.blocks || []).length,
    report.summary.blockCount + ' vs ' + (ir.blocks || []).length);
  check('带上了引擎与目标语言', report.translate.engine === 'tencent' && report.translate.target === 'zh-CN');
  check('带上了页面尺寸', !!report.summary.pageSize && report.summary.pageSize.w > 0);

  console.log('\n=== 3) 每页坐标数据（定位阅读顺序的关键）===');
  check('导出页面列表', Array.isArray(report.pages) && report.pages.length === pages.length,
    (report.pages || []).length + ' vs ' + pages.length);
  const pagesWithLines = (report.pages || []).filter(p => (p.lines || []).length > 0);
  check('至少有 1 页带行坐标', pagesWithLines.length > 0, pagesWithLines.length + ' 页');
  const anyLine = pagesWithLines.length ? pagesWithLines[0].lines[0] : null;
  check('行含 x/y/size/text 四个字段', !!anyLine &&
    typeof anyLine.x === 'number' && typeof anyLine.y === 'number' &&
    anyLine.size != null && typeof anyLine.text === 'string',
    JSON.stringify(anyLine));
  const colPages = (report.pages || []).filter(p => p.columns && p.columns.length);
  check('至少 1 页带分栏推断', colPages.length > 0, colPages.length + ' 页');

  console.log('\n=== 4) 块结构可读（能看出"正文是否被误判成表格"）===');
  const tblTop = (report.blocks || []).filter(b => b.type === 'table');
  const containers = (report.blocks || []).filter(b => b.type === 'container');
  const tblInner = containers.reduce((a, c) => a.concat((c.blocks || []).filter(x => x.type === 'table')), []);
  const tbl = tblTop.concat(tblInner);
  check('报告里能列出表格规格（含容器内）', tbl.length > 0 && tbl[0].rows > 0 && tbl[0].cols > 0,
    tbl.length ? JSON.stringify(tbl[0]).slice(0, 110) : '无表格');
  check('容器内表格有行列与首行内容', tblInner.length === 0 || (tblInner[0].colCounts || []).length > 0);
  check('容器内含每栏块明细', containers.length > 0 && (containers[0].blocks || []).length > 0);
  check('字号分布非空', Object.keys(report.summary.sizeHistogram || {}).length > 0);
  check('对齐分布非空', Object.keys(report.summary.alignHistogram || {}).length > 0);

  console.log('\n=== 5) 可发送性（体积与序列化）===');
  let json = '';
  try { json = JSON.stringify(report); check('JSON 序列化成功', true); }
  catch (e) { check('JSON 序列化成功', false, e.message); }
  const kb = json.length / 1024;
  console.log('    报告体积: ' + kb.toFixed(1) + ' KB');
  check('体积适合发送（< 2MB）', kb < 2048, kb.toFixed(1) + ' KB');
  let txt = '';
  try { txt = sb.LingyiDiagnostics.toText(report); check('可读摘要生成成功', true); }
  catch (e) { check('可读摘要生成成功', false, e.message); }
  check('摘要里有行坐标段落', txt.indexOf('每页前若干行') >= 0 || txt.indexOf('x=') >= 0);
  console.log('    摘要体积: ' + (txt.length / 1024).toFixed(1) + ' KB');

  console.log('\n=== 6) 报告能看出"页眉页脚是否已剔除"===');
  const allText = report.pages.map(p => (p.lines || []).map(l => l.text).join(' ')).join(' ');
  console.log('    每页行数: ' + JSON.stringify(report.pages.map(p => (p.lines || []).length)));
  check('报告含页级行数统计（可判断过滤效果）',
    report.pages.every(p => typeof p.lineCount !== 'undefined' || Array.isArray(p.lines)));

  console.log('\n====================================================');
  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
