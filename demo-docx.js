/* demo-docx.js — Word 原稿 vs 译文（保版式）对比演示
 * 原文用 sample1.docx（中文论文原稿），译文把中文换成英文，结构必须完全不变。
 * 运行：node lingyi/demo-docx.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'test', 'out', 'demo-docx');
fs.mkdirSync(OUT, { recursive: true });

const sandbox = {
  console, setTimeout, clearTimeout, Promise, JSON, Math, Date, Object, Array, String, Number,
  RegExp, Error, isFinite, parseInt, parseFloat, Uint8Array, ArrayBuffer, TextEncoder,
  Blob: function (p, o) { this.parts = p; }, URL: {}, fetch: async () => { throw new Error('no'); },
  atob: s => Buffer.from(s, 'base64').toString('binary')
};
sandbox.globalThis = sandbox; sandbox.window = sandbox;
sandbox.document = { createElement: () => ({ style: {}, textContent: '', innerHTML: '' }) };
const ctx = vm.createContext(sandbox);
for (const f of ['core.js', 'layout.js', 'docx-extract.js', 'pdf-extract.js', 'render-html.js', 'render-docx.js', 'translate.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const core = sandbox.LingyiCore;
const dx = sandbox.LingyiDocx;
const rh = sandbox.LingyiRenderHtml;

/* 中文 → 英文（只覆盖首字母/标题/表头等"看得出版式"的部分；
   其余中文按句替换为英文，长度变化大，正好检验版式是否稳住） */
const DICT = [
  ['不育男性年龄与精子DNA碎片化指数的关联性研究：基于4441例的横断面分析',
    'Association between age and sperm DNA fragmentation index in infertile men: a cross-sectional analysis of 4441 cases'],
  ['梁吉旺，郑波*，韩小克，都美阳，潘跃普', 'LIANG Jiwang, ZHENG Bo*, HAN Xiaoke, DU Meiyang, PAN Yuepu'],
  ['邢台美和生殖与遗传医院生殖男科，河北 邢台 054001',
    'Department of Reproductive Andrology, Xingtai Meihe Reproductive and Genetic Hospital, Xingtai 054001, China'],
  ['通信作者：郑波，Email：326696097@qq.com', 'Corresponding author: ZHENG Bo, Email: 326696097@qq.com'],
  ['引言', 'Introduction'], ['1 对象与方法', '1 Subjects and methods'], ['1.1 研究对象', '1.1 Study subjects'],
  ['1.2 资料收集与分组', '1.2 Data collection and grouping'],
  ['1.3 精液分析与DFI检测', '1.3 Semen analysis and DFI detection'],
  ['1.4 统计学方法', '1.4 Statistical methods'], ['2 结果', '2 Results'],
  ['2.1 不同年龄组基线特征', '2.1 Baseline characteristics by age group'],
  ['2.2 不同DFI分级组基线特征', '2.2 Baseline characteristics by DFI grade'],
  ['2.3 各变量与DFI的相关性', '2.3 Correlation of variables with DFI'],
  ['2.4 年龄与DFI的独立效应及非线性检验', '2.4 Independent effect and non-linearity test'],
  ['2.5 阈值探索', '2.5 Threshold exploration'],
  ['2.6 年龄对DFI不同分位点的影响', '2.6 Effect of age across DFI percentiles'],
  ['2.7 DFI≥30%的风险及敏感性分析', '2.7 Risk of DFI>=30% and sensitivity analysis'],
  ['3 讨论', '3 Discussion'], ['参考文献', 'References'],
  ['变量', 'Variable'], ['H值', 'H value'], ['P值', 'P value'],
  ['注：', 'Note: '], ['摘要', 'Abstract'], ['关键词', 'Keywords'],
  ['目的', 'Objective'], ['方法', 'Methods'], ['结果', 'Results'], ['结论', 'Conclusion']
];

function translate(text) {
  let t = text;
  for (const [zh, en] of DICT) t = t.split(zh).join(en);
  // 未被词典覆盖的中文（长句）用"中文→英文占位"的方式体现：长度变化明显，用来检验版式稳定性
  if (/[\u4e00-\u9fff]/.test(t)) {
    t = t.replace(/[\u4e00-\u9fff]+/g, (m) => {
      const words = ['This', 'study', 'analysed', 'the', 'association', 'between', 'age', 'and', 'sperm', 'DNA',
        'fragmentation', 'index', 'in', 'infertile', 'men', 'using', 'regression', 'models', 'with', 'results'];
      return m.split('').map((_, i) => words[i % words.length]).join(' ').slice(0, Math.max(4, m.length));
    });
  }
  return t;
}

function installMockApi() {
  sandbox.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const out = body.text.replace(
      new RegExp(core.SEG_OPEN + '\\s*(\\d+)\\s*' + core.SEG_CLOSE + '([\\s\\S]*?)' + core.SEG_OPEN + '\\s*\\d+\\s*' + core.SEG_CLOSE, 'g'),
      (m, n, inner) => core.segToken(n) + translate(inner) + core.segToken(n)
    );
    return { json: async () => ({ code: 0, result: out }) };
  };
}

(async function main() {
  const html = fs.readFileSync(path.join(__dirname, 'test', 'samples', 'sample1.mammoth-like.html'), 'utf8');

  const irOrig = dx.convertHtmlToIR(html, { fileName: 'sample1.docx' });
  irOrig.meta.fileName = 'sample1.docx';
  fs.writeFileSync(path.join(OUT, 'original.html'),
    rh.renderDocument(irOrig, { title: '原文', bodySize: irOrig.bodySize }), 'utf8');

  const ir = dx.convertHtmlToIR(html, { fileName: 'sample1.docx' });
  ir.meta.fileName = 'sample1.docx';
  installMockApi();
  const res = await sandbox.LingyiTranslate.translateIR(ir, { apiUrl: 'mock', target: 'en', engine: 'tencent' });
  fs.writeFileSync(path.join(OUT, 'translated.html'),
    rh.renderDocument(ir, { title: '译文', bodySize: ir.bodySize }), 'utf8');

  // 结构指纹对比
  const snap = (irr) => {
    const out = [];
    (function walk(bs) {
      for (const b of bs) {
        if (b.type === 'container') { out.push('container:' + b.columns.length); b.columns.forEach(g => walk(g.blocks)); continue; }
        if (b.type === 'table') { out.push('table:' + b.rows.length + 'x' + b.rows[0].length); continue; }
        if (b.type === 'image') { out.push('image:' + (b.caption ? 'cap' : '')); continue; }
        out.push([b.type, b.level || 0, b.size || 0, b.align || '', b.indent || 0].join('|'));
      }
    })(irr.blocks);
    return out.join(';');
  };
  const same = snap(irOrig) === snap(ir);
  console.log('结构指纹一致：', same ? '✅ 完全一致（块数/标题层级/字号/对齐/缩进/表格规格）' : '❌ 有差异');
  console.log('翻译片段：', res.total, '成功：', res.translated);
  console.log('产物：', OUT);
})();
