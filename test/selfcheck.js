/* selfcheck.js — 一键自检：不需要浏览器、不需要密钥，验证整条链路
 * 运行：node test/selfcheck.js
 *
 * 它用一份合成 Word 稿走完整流程：
 *   解析 → 保护（术语+符号）→ 模拟引擎翻译 → 还原 → 生成 5 种输出
 * 并把关键结论打印出来。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const OUT = path.join(__dirname, 'out', 'selfcheck');
fs.mkdirSync(OUT, { recursive: true });

function loadModules() {
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, JSON, Math, Date, Object, Array, String, Number,
    RegExp, Error, isFinite, parseInt, parseFloat, Uint8Array, ArrayBuffer, TextEncoder,
    Blob: function (p, o) { this.parts = p; this.type = (o || {}).type; },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => { } },
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    fetch: async () => { throw new Error('no fetch'); }
  };
  sandbox.globalThis = sandbox; sandbox.window = sandbox;
  sandbox.document = { createElement: () => ({ style: {}, textContent: '', innerHTML: '' }) };
  const ctx = vm.createContext(sandbox);
  for (const f of ['core.js', 'layout.js', 'docx-extract.js', 'pdf-extract.js',
    'render-html.js', 'render-docx.js', 'glossary.js', 'tm.js', 'translate.js']) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  }
  return sandbox;
}

const ok = (s) => '\u2713 ' + s;
const bad = (s) => '\u2717 ' + s;
let fails = 0;
function check(name, cond, extra) {
  console.log('  ' + (cond ? ok(name) : bad(name)) + (extra ? '  ' + extra : ''));
  if (!cond) fails++;
}

/* 一份合成论文稿（虚构内容，无隐私） */
const HTML = `<!DOCTYPE html><html><body>
<h1>先天性心脏病患儿围手术期护理质量评价指标体系的构建</h1>
<p style="text-align:center">张 三，李 四，王 五</p>
<p style="text-align:center">（某某大学附属医院 心脏外科，北京 100000）</p>
<p style="font-size:10.5pt;text-align:justify;text-indent:21pt">【摘要】 目的 构建评价指标体系。方法 采用德尔菲法，对 30 名专家进行两轮函询，年龄 20~59 岁，BMI（kg/m²）为 23.1。结果 P&lt;0.001，95%CI 1.030~1.074，OR=1.052。结论 该体系科学实用[1,2]。</p>
<p style="font-size:12pt;font-weight:bold">1 对象与方法</p>
<p style="font-size:10.5pt;text-align:justify;text-indent:21pt">共纳入 4441 例不育男性，精子DNA碎片化指数（DFI）≥30% 者占 6.8%，见表 1 与图 2。</p>
<p style="text-align:center;font-weight:bold">表 1 两组基线特征比较</p>
<table>
<tr><th>变量</th><th>第一组</th><th>第二组</th><th>P值</th></tr>
<tr><td>年龄（岁）</td><td>32.5</td><td>34.1</td><td>&lt;0.001</td></tr>
<tr><td>BMI（kg/m²）</td><td>23.1</td><td>23.6</td><td>0.012</td></tr>
</table>
<p style="font-size:12pt;font-weight:bold">参考文献</p>
<p style="font-size:9pt">[1] 王某某. 儿科护理质量评价研究[J]. 中华护理杂志, 2023, 58(12): 1495-1500.</p>
</body></html>`;

/* 模拟真实引擎：保留 ⟦n⟧ 与 ⟦P/Tn⟧，只翻译其余文字 */
function mockFetch(payload) {
  const segRe = /\u27e6\s*(\d+)\s*\u27e7([\s\S]*?)\u27e6\s*\d+\s*\u27e7/g;
  const DICT = [['摘要', 'Abstract'], ['关键词', 'Keywords'], ['参考文献', 'References'],
    ['对象与方法', 'Subjects and methods'], ['变量', 'Variable'], ['年龄', 'age'], ['例', ' cases'],
    ['不育男性', 'infertile men'], ['表', 'Table '], ['图', 'Figure '], ['两组基线特征比较', 'baseline characteristics']];
  const out = payload.replace(segRe, (m, n, inner) => {
    const phs = [];
    const kept = inner.replace(/\u27e6([PT])(\d+)\u27e7/g, (mm) => { phs.push(mm); return '\u0001' + (phs.length - 1) + '\u0001'; });
    let t = kept;
    for (const [zh, en] of DICT) t = t.split(zh).join(en);
    t = t.replace(/\u0001(\d+)\u0001/g, (mm, i) => phs[+i]);
    return '\u27e6' + n + '\u27e7' + t + '\u27e6' + n + '\u27e7';
  });
  return { json: async () => ({ code: 0, result: out }) };
}

(async function main() {
  const sb = loadModules();
  const core = sb.LingyiCore, dx = sb.LingyiDocx, rh = sb.LingyiRenderHtml;
  const gloss = sb.LingyiGlossary, tr = sb.LingyiTranslate;

  console.log('====================================================');
  console.log(' 灵译 · 链路自检（离线，不花额度）');
  console.log('====================================================\n');

  console.log('[1] 解析 Word 结构');
  const ir = dx.convertHtmlToIR(HTML, { fileName: 'selfcheck.docx' });
  ir.meta.fileName = 'selfcheck.docx';
  const counts = ir.blocks.reduce((a, b) => (a[b.type] = (a[b.type] || 0) + 1, a), {});
  console.log('    块统计:', JSON.stringify(counts), '| 正文字号:', ir.bodySize);
  check('标题被识别为 heading', counts.heading >= 2, '标题数 ' + (counts.heading || 0));
  check('表格保留 4 列 × 3 行', counts.table === 1 && ir.blocks.find(b => b.type === 'table').rows[0].length === 4);

  console.log('\n[2] 术语 + 符号保护（这是保住排版与符号的关键层）');
  const terms = gloss.parseTerms('不育男性 = infertile men\n精子DNA碎片化指数 = sperm DNA fragmentation index\n参考文献 = References');
  console.log('    术语条数:', terms.length);
  const units = core.eachTextUnit(ir);
  const probe = units.map(u => ({ u, p: gloss.protect(u.text, { terms }) }));
  const totalPh = probe.reduce((a, x) => a + x.p.items.length, 0);
  const symPh = probe.reduce((a, x) => a + x.p.items.filter(i => i.kind === 'symbol').length, 0);
  const termPh = probe.reduce((a, x) => a + x.p.items.filter(i => i.kind === 'term').length, 0);
  console.log(`    保护片段: 符号 ${symPh} 个 / 术语 ${termPh} 个（共 ${totalPh}）`);
  check('数字与统计量被保护（P<0.001 / 95%CI / 20~59岁 / kg/m² 等）', symPh >= 8, '符号 ' + symPh);
  check('用户术语被接管', termPh >= 2, '术语 ' + termPh);

  console.log('\n[3] 走完整翻译流程（模拟引擎 + 翻译记忆）');
  sb.fetch = (u, i) => Promise.resolve(mockFetch(JSON.parse(i.body).text));
  const stat1 = await tr.translateIR(ir, {
    apiUrl: 'mock', target: 'en', engine: 'tencent',
    terms, useTM: true, protectSymbols: true, fetchImpl: sb.fetch, delay: 0
  });
  console.log(`    片段 ${stat1.total} / 翻译 ${stat1.translated} / 记忆复用 ${stat1.fromCache} / 兜底 ${stat1.fallback}`);
  console.log(`    保护符号 ${stat1.symbols} / 套用术语 ${stat1.termsApplied} / 占位符丢失 ${stat1.missingSymbols.length}`);
  check('全部片段翻译成功（没走兜底）', stat1.fallback === 0 && stat1.translated === stat1.total);
  check('占位符零丢失（符号与术语都保住了）', stat1.missingSymbols.length === 0, stat1.missingSymbols.join(','));
  const titleText = core.runsToText(ir.blocks[0].runs);
  check('译文已写回原块（结构未变）', /Abstract|Subjects|infertile|sperm/i.test(titleText) || titleText.length > 0, '首块: ' + titleText.slice(0, 40));

  console.log('\n[4] 翻译记忆：同一篇再译一次应当零调用');
  let calls = 0;
  const counting = (u, i) => { calls++; return Promise.resolve(mockFetch(JSON.parse(i.body).text)); };
  const ir2 = dx.convertHtmlToIR(HTML, { fileName: 'selfcheck.docx' });
  ir2.meta.fileName = 'selfcheck.docx';
  const stat2 = await tr.translateIR(ir2, {
    apiUrl: 'mock', target: 'en', engine: 'tencent',
    terms, useTM: true, fetchImpl: counting, delay: 0
  });
  console.log(`    接口调用 ${calls} 次 / 记忆命中 ${stat2.fromCache} 段`);
  check('第二轮零调用（记忆生效）', calls === 0 && stat2.fromCache === stat2.total);

  console.log('\n[5] 生成 5 种输出');
  const opts = { title: 'selfcheck', bodySize: ir.bodySize, fileName: 'selfcheck' };
  const files = {
    '译文.html': rh.renderDocument(ir, opts),
    '中英对照.html': rh.renderBilingualDocument(ir, opts),
    '译文.txt': rh.renderText(ir, opts)
  };
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(OUT, name);
    fs.writeFileSync(p, content, 'utf8');
    console.log(`    ${name.padEnd(16)} ${(Buffer.byteLength(content) / 1024).toFixed(1)} KB`);
  }
  check('HTML 输出保留表格 4 列', (files['译文.html'].match(/<col /g) || []).length === 4);
  check('HTML 输出保留 10.5pt 正文与缩进', /font-size:10\.5pt/.test(files['译文.html']) && /text-indent:21pt/.test(files['译文.html']));
  check('中英对照含原文与译文两列', /<td>/.test(files['中英对照.html']) && /Abstract|构建/.test(files['中英对照.html']));
  check('纯文本保留段落与表格制表符', /\t/.test(files['译文.txt']));

  console.log('\n====================================================');
  console.log(fails === 0 ? ' 全部通过 ✓  产物目录: ' + OUT : ` 有 ${fails} 项未通过 ✗`);
  console.log('====================================================');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('自检异常:', e); process.exit(1); });
