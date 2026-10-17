/* verify-cloud.js — 用真实云函数验证"标记不丢"这条生命线
 * 用法: node test/tools/verify-cloud.js [云函数地址] [引擎]
 *
 * 验证内容：
 *   1) 传输层 encode/decode 是否正确（⟦V3⟧ ⇄ ##V3##）
 *   2) 走完整 translateIR（含术语保护 + 符号保护）后，占位符是否零丢失
 *   3) 引擎丢标记时，是否自动降级为「逐段翻译」并且最终仍然零丢失
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const URL = process.argv[2] || 'https://1430386389-cd8v5r6ng0.ap-beijing.tencentscf.com';
const ENGINE = process.argv[3] || 'tencent';
const SRC = path.join(__dirname, '..', '..', 'src');

const sandbox = {
  console, setTimeout, clearTimeout, Promise, JSON, Math, Date, Object, Array, String, Number,
  RegExp, Error, isFinite, parseInt, parseFloat, Uint8Array, ArrayBuffer, TextEncoder,
  Blob: function () { }, URL: {}, atob: s => Buffer.from(s, 'base64').toString('binary'),
  fetch: fetch
};
sandbox.globalThis = sandbox; sandbox.window = sandbox;
sandbox.document = { createElement: () => ({ style: {}, textContent: '', innerHTML: '' }) };
const ctx = vm.createContext(sandbox);
for (const f of ['core.js', 'layout.js', 'docx-extract.js', 'pdf-extract.js',
  'render-html.js', 'render-docx.js', 'glossary.js', 'tm.js', 'translate.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const core = sandbox.LingyiCore, dx = sandbox.LingyiDocx, tr = sandbox.LingyiTranslate;
const gloss = sandbox.LingyiGlossary;

let bad = 0;
const ok = s => console.log('  \u2713 ' + s);
const no = s => { bad++; console.log('  \u2717 ' + s); };

/* 贴近真实论文的一段稿子 */
const HTML = `<html><body>
<h1>先天性心脏病患儿围手术期护理质量评价指标体系的构建</h1>
<p style="text-align:center">张三，李四，王五</p>
<p style="font-size:10.5pt;text-align:justify;text-indent:21pt">【摘要】目的 构建评价指标体系。方法 采用德尔菲法对 30 名专家进行两轮函询，年龄 20~59 岁，BMI（kg/m²）为 23.1。结果 P&lt;0.001，95%CI 1.030~1.074，OR=1.052。结论 该体系科学实用[1,2]。</p>
<p style="font-size:12pt;font-weight:bold">1 对象与方法</p>
<p style="font-size:10.5pt;text-align:justify;text-indent:21pt">共纳入 4441 例不育男性，精子DNA碎片化指数（DFI）≥30% 者占 6.8%，见表 1 与图 2。</p>
<p style="text-align:center;font-weight:bold">表 1 两组基线特征比较</p>
<table>
<tr><th>变量</th><th>第一组</th><th>第二组</th><th>P值</th></tr>
<tr><td>年龄（岁）</td><td>32.5</td><td>34.1</td><td>&lt;0.001</td></tr>
<tr><td>BMI（kg/m²）</td><td>23.1</td><td>23.6</td><td>0.012</td></tr>
</table>
<p style="font-size:9pt">[1] 王某某. 儿科护理质量评价研究[J]. 中华护理杂志, 2023, 58(12): 1495-1500.</p>
</body></html>`;

(async () => {
  console.log('云函数:', URL);
  console.log('引擎  :', ENGINE, '\n');

  console.log('[1] 传输层 encode/decode');
  const enc = tr.encodeMarkers(core.segToken(3) + '文本' + core.segToken(3) + core.SEG_OPEN + 'P0' + core.SEG_CLOSE);
  console.log('    encode:', JSON.stringify(enc));
  const dec = tr.decodeMarkers(enc);
  console.log('    decode:', JSON.stringify(dec));
  if (/##V3##/.test(enc) && /##P0##/.test(enc)) ok('⟦⟧ → ##n## 正确');
  else no('encode 结果不符合预期');
  if (/⟦3⟧/.test(dec) && /⟦P0⟧/.test(dec)) ok('##n## → ⟦⟧ 正确');
  else no('decode 结果不符合预期');

  console.log('\n[2] 完整链路翻译（术语 + 符号保护）');
  const ir = dx.convertHtmlToIR(HTML, { fileName: 'verify.docx' });
  ir.meta.fileName = 'verify.docx';
  const terms = gloss.parseTerms('不育男性 = infertile men\n精子DNA碎片化指数 = sperm DNA fragmentation index\n参考文献 = References');
  const t0 = Date.now();
  const stat = await tr.translateIR(ir, {
    apiUrl: URL, target: 'en', engine: ENGINE,
    terms: terms, useTM: false, protectSymbols: true,
    delay: 220            // 腾讯云限 5 次/秒；云函数新版已内置节流，这里留保守间隔
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`    片段 ${stat.total} / 翻译 ${stat.translated} / 兜底 ${stat.fallback} / 接口调用 ${stat.calls}`);
  console.log(`    保护符号 ${stat.symbols} / 术语 ${stat.termsApplied} / 占位符丢失 ${stat.missingSymbols.length}`);
  console.log(`    引擎丢标记批次 ${stat.markerLoss} / 逐段兜底片段 ${stat.perSegmentFallback} / 耗时 ${secs}s`);

  if (stat.missingSymbols.length === 0) ok('占位符（数字/单位/上下标/术语）零丢失');
  else no('占位符丢失: ' + stat.missingSymbols.slice(0, 8).join(' '));

  if (stat.translated === stat.total) ok('全部片段都拿到了译文');
  else no(`${stat.translated}/${stat.total} 段有译文，有 ${stat.fallback} 段保留原文`);

  if (stat.markerLoss > 0) {
    console.log(`    （引擎曾丢弃标记 ${stat.markerLoss} 次，已自动改用逐段翻译补救 —— 这正是兜底机制在工作）`);
  }

  console.log('\n[3] 抽查译文与原始标记是否还在正确位置');
  const blocks = ir.blocks.filter(b => b.type === 'paragraph' || b.type === 'heading');
  let shown = 0;
  for (const b of blocks) {
    const txt = core.runsToText(b.runs || []);
    if (!txt || shown >= 4) continue;
    if (/[\u4e00-\u9fa5]{4,}/.test(txt)) {
      no('疑似未被翻译（仍是整段中文）: ' + JSON.stringify(txt.slice(0, 60)));
    }
    console.log('    · ' + JSON.stringify(txt.slice(0, 96)));
    shown++;
  }

  console.log('\n[4] 关键符号是否原样出现在译文里');
  const allText = core.eachTextUnit(ir).map(u => core.runsToText(u.runs || [])).join('\n');
  const mustKeep = ['4441', '0.001', '95%CI 1.030~1.074', 'OR=1.052', 'kg/m²', '[1,2]', 'DFI', '20~59'];
  const missing = mustKeep.filter(s => {
    // 允许引擎在数字周围加空格，做归一化比较
    const norm = s.replace(/\s+/g, '');
    return allText.replace(/\s+/g, '').indexOf(norm) < 0;
  });
  if (missing.length === 0) ok('抽查的 8 类符号全部原样保留：' + mustKeep.join(' / '));
  else no('下列符号未原样出现: ' + missing.join(' '));

  /* ---- 关键：检查译文里是否残留"标记垃圾" ----
   * 真实故障：腾讯云把 ##P0## 输出成 "## P0 ##"，旧的解码正则
   * 只认 "##V12##"（无空格），导致残留 "#P0 ##" 这类字符混进正文。
   * 之前只检查"符号有没有回来"，没检查"垃圾字符有没有留下"，所以漏检了。 */
  console.log('\n[4b] 译文里是否残留标记垃圾（#P0# / ##P1 ## / ⟦P2⟧ 未还原）');
  const garbage = [];
  const patterns = [
    { re: /#{1,2}\s*[VPT]?\s*\d+\s*#{0,2}/g, name: '井号标记残留' },
    { re: /\u27e6\s*[VPT]?\s*\d+\s*\u27e7/g, name: '⟦⟧ 占位符未还原' }
  ];
  for (const p of patterns) {
    const hits = allText.match(p.re);
    if (hits) garbage.push(p.name + ': ' + [...new Set(hits)].slice(0, 6).join(' '));
  }
  if (!garbage.length) ok('没有任何标记垃圾残留');
  else no('发现标记垃圾 → ' + garbage.join('；'));

  console.log('\n[5] 表格结构');
  const tb = ir.blocks.find(b => b.type === 'table');
  if (tb) {
    const cols = tb.rows[0].length;
    if (cols === 4 && tb.rows.length === 3) ok(`表格保持 4 列 × 3 行`);
    else no(`表格变成 ${cols} 列 × ${tb.rows.length} 行`);
    tb.rows.forEach(r => console.log('      | ' + r.map(c => (c.text || '').slice(0, 18)).join(' | ') + ' |'));
  } else no('表格丢失');

  console.log('\n' + (bad === 0 ? '全部通过 ✓ 排版与符号在真实引擎下守住了' : `有 ${bad} 项未通过 ✗`));
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('验证异常:', e); process.exit(1); });
