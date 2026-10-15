/* 术语库 + 符号保护 + 翻译记忆 单元测试
 * 运行：node test/glossary.test.js
 */
'use strict';
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'src');
const core = require(path.join(SRC, 'core.js'));
const G = require(path.join(SRC, 'glossary.js'));
const TMM = require(path.join(SRC, 'tm.js'));

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '  →  ' + e.message); fail++; }
}
const roundTrip = (s, terms) => {
  const p = G.protect(s, { terms: terms || [] });
  const r = G.restore(p.text, p.items);
  return { p, r, ok: r.text === s, bad: G.verifySymbols(r.text, p.items) };
};

console.log('\n[1] 符号保护：数字 / 单位 / 统计量 往返一致');
{
  const cases = [
    'P<0.001，95%CI 1.030~1.074，OR=1.052',
    '共纳入4441例，年龄20~59岁，中位年龄32（28，35）岁',
    'BMI（kg/m²）与精子浓度（×10⁶/mL）呈负相关[1,2]',
    '见表1、图2，采用Kruskal-Wallis H检验（α=0.05）',
    '37 ℃液化，3000 r/min 离心10 min，取上清液',
    'r=−0.269，β=0.229，χ²=152.36，P=0.012',
    '精子DNA碎片化指数（DFI）≥30%组2938例（66.2%）',
    '采用R 4.3.2软件分析，P<0.05为差异有统计学意义'
  ];
  for (const s of cases) {
    check('往返一致: ' + (s.length > 30 ? s.slice(0, 28) + '…' : s), () => {
      const { ok, bad, p } = roundTrip(s);
      assert.ok(p.text.indexOf('⟦P') >= 0 || p.text.indexOf('⟦T') >= 0, '没保护任何片段');
      assert.deepStrictEqual(bad, [], '符号丢失: ' + bad.join(','));
      assert.ok(ok, '还原后与原文不一致');
    });
  }
  check('数字范围被完整保护（不会把 20~59 拆成两半）', () => {
    const { p, r, ok } = roundTrip('年龄20~59岁');
    assert.strictEqual(p.items.length, 1, '片段数=' + p.items.length + ' → ' + p.text);
    assert.strictEqual(p.items[0].text, '20~59');
    assert.ok(ok, '还原不一致: ' + r.text);
  });
  check('希腊字母与上下标单位被保护', () => {
    const { p } = roundTrip('α=0.05，kg/m²，×10⁶/mL');
    const texts = p.items.map(i => i.text).join('|');
    assert(/α/.test(texts) && /kg\/m²/.test(texts) && /10⁶\/mL/.test(texts), '实际: ' + texts);
  });
  check('参考文献编号被保护（[1,2] / ［3-5］）', () => {
    const { p } = roundTrip('见文献[1,2]与[3-5]');
    assert.strictEqual(p.items.length, 2, '片段数=' + p.items.length + ' → ' + p.text);
  });
}

console.log('\n[2] 术语库：强制统一译名');
{
  const terms = [
    { src: '精子DNA碎片化指数', dst: 'sperm DNA fragmentation index' },
    { src: '不育男性', dst: 'infertile men' },
    { src: '德尔菲法', dst: 'Delphi method' }
  ];
  check('术语被替换成占位符，还原后是目标译文', () => {
    const { p, r } = roundTrip('精子DNA碎片化指数与不育男性', terms);
    assert.strictEqual(p.items.filter(i => i.kind === 'term').length, 2, '术语数=' + p.items.length);
    assert.ok(/sperm DNA fragmentation index/.test(r.text), '实际: ' + r.text);
    assert.ok(/infertile men/.test(r.text), '实际: ' + r.text);
  });
  check('长术语优先（不会只替换到"精子DNA"）', () => {
    const t2 = terms.concat([{ src: '精子DNA', dst: 'sperm DNA' }]);
    const { r } = roundTrip('精子DNA碎片化指数', t2);
    assert.ok(/sperm DNA fragmentation index/.test(r.text), '实际: ' + r.text);
  });
  check('术语内部不再拆出符号（整条术语作为一个整体替换）', () => {
    const t3 = [{ src: '不育男性年龄与精子DNA碎片化指数的关联性研究：基于4441例的横断面分析', dst: 'Association between age and sperm DNA fragmentation index in infertile men: a cross-sectional analysis of 4441 cases' }];
    const { p, r } = roundTrip('不育男性年龄与精子DNA碎片化指数的关联性研究：基于4441例的横断面分析', t3);
    assert.strictEqual(p.items.length, 1, '被拆成了 ' + p.items.length + ' 段: ' + p.text);
    assert.strictEqual(p.items[0].kind, 'term');
    assert.ok(/Association between age/.test(r.text), '实际: ' + r.text);
  });
  check('术语与符号混排时条数正确', () => {
    const { p } = roundTrip('不育男性4441例，DFI≥30%', terms);
    assert.strictEqual(p.items.filter(i => i.kind === 'term').length, 1, JSON.stringify(p.items.map(i => i.text)));
    assert.strictEqual(p.items.filter(i => i.kind === 'symbol').length, 3, JSON.stringify(p.items.map(i => i.text)));
  });
  check('术语表文本可解析（= / Tab / 逗号 / 竖线）', () => {
    const parsed = G.parseTerms([
      '# 注释行会被忽略',
      '精子DNA碎片化指数 = sperm DNA fragmentation index',
      '不育男性\tinfertile men',
      '德尔菲法,Delphi method',
      '年龄|age'
    ].join('\n'));
    assert.strictEqual(parsed.length, 4, '解析出 ' + parsed.length + ' 条');
    assert.strictEqual(parsed[0].src, '精子DNA碎片化指数');
    assert.strictEqual(parsed[3].dst, 'age');
  });
  check('术语表可导出再导入，内容不丢', () => {
    const txt = G.serializeTerms([{ src: 'A', dst: 'B' }, { src: 'C', dst: 'D' }]);
    const back = G.parseTerms(txt);
    assert.strictEqual(back.length, 2);
    assert.strictEqual(back[1].src, 'C');
  });
}

console.log('\n[3] 模型把占位符写成别的括号也能还原');
{
  check('⟦P0⟧ 被写成 [P0] / 【P0】 / （P0） 都能还原', () => {
    const { p } = roundTrip('P<0.001');
    const ph = p.items[0].ph;
    for (const variant of ['[' + ph.slice(1, -1) + ']', '【' + ph.slice(1, -1) + '】', '（' + ph.slice(1, -1) + '）']) {
      const r = G.restore('正文 ' + variant + ' 结束', p.items);
      assert.strictEqual(r.text, '正文 P<0.001 结束', variant + ' → ' + r.text);
      assert.deepStrictEqual(r.missing, []);
    }
  });
  check('占位符整个丢失时会被记录（供界面告警）', () => {
    const { p } = roundTrip('P<0.001');
    const r = G.restore('模型把占位符吃了', p.items);
    assert.strictEqual(r.missing.length, 1, '未记录丢失');
  });
  check('符号被模型改动时能被校验发现', () => {
    const { p, r } = roundTrip('P<0.001，β=0.229');
    // 模拟模型把 β 改成了 beta
    const tampered = r.text.replace('β', 'beta');
    const bad = G.verifySymbols(tampered, p.items);
    assert.ok(bad.indexOf('β') >= 0, '没发现 β 被改动: ' + JSON.stringify(bad));
  });
}

console.log('\n[4] 与分段标记共存（⟦12⟧ 是分段，⟦P0⟧ 是保护）');
{
  check('parseSegments 不会把 ⟦P0⟧/⟦T1⟧ 误认成分段标记', () => {
    const text = core.segToken(0) + '\n共纳入⟦P0⟧，见⟦T1⟧\n' + core.segToken(0) + '\n' +
      core.segToken(1) + '\n年龄⟦P0⟧岁\n' + core.segToken(1) + '\n';
    const segs = core.parseSegments(text, 2);
    assert.strictEqual(segs[0], '共纳入⟦P0⟧，见⟦T1⟧', '第1段: ' + segs[0]);
    assert.strictEqual(segs[1], '年龄⟦P0⟧岁', '第2段: ' + segs[1]);
  });
  check('保护后的文本能正常分批、无占位符被截断', () => {
    const prot = G.protect('共纳入4441例，年龄20~59岁，P<0.001，95%CI 1.030~1.074', { terms: [] });
    const units = [{ text: prot.text, original: 'x' }];
    const batches = core.buildBatches(units, 2600);
    assert.strictEqual(batches.length, 1);
    const segs = core.parseSegments(batches[0].text, 1);
    assert.strictEqual(segs[0], prot.text);
  });
}

console.log('\n[5] 翻译记忆：命中、复用、导出导入');
{
  // Node 环境下给 tm 一个最小的 localStorage 替身
  const store = {};
  global.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  TMM.TM.clear();

  const src = '共纳入 4441 例不育男性，年龄 20~59 岁。';
  check('未翻译过时查不到', () => assert.strictEqual(TMM.TM.get(src, 'en', 'tencent'), null));
  check('写入后能命中', () => {
    TMM.TM.set(src, 'en', 'tencent', 'A total of 4441 infertile men aged 20-59 years were enrolled.');
    const hit = TMM.TM.get(src, 'en', 'tencent');
    assert.ok(/4441 infertile men/.test(hit), '命中内容: ' + hit);
  });
  check('空白/换行差异不影响命中', () => {
    const variant = '共纳入   4441 例不育男性，\n年龄 20~59 岁。';
    assert.ok(TMM.TM.get(variant, 'en', 'tencent'), '未命中近似文本');
  });
  check('不同目标语言互不干扰', () => {
    assert.strictEqual(TMM.TM.get(src, 'ja', 'tencent'), null);
  });
  check('不同引擎之间可复用（回退到 any）', () => {
    TMM.TM.set(src, 'en', 'any', 'A total of 4441 infertile men aged 20-59 years were enrolled.');
    assert.ok(TMM.TM.get(src, 'en', 'deepseek'), '未回退命中');
  });
  check('统计信息可用（条数/命中次数）', () => {
    const s = TMM.TM.stats();
    assert.ok(s.entries >= 1, '条数=' + s.entries);
    assert.ok(s.hits >= 1, '命中=' + s.hits);
  });
  check('导出 JSON → 清空 → 导入后仍能命中', () => {
    const json = TMM.TM.exportJSON();
    TMM.TM.clear();
    assert.strictEqual(TMM.TM.get(src, 'en', 'tencent'), null, '清空失败');
    const r = TMM.TM.importJSON(json, true);
    assert.ok(r.added >= 1, '导入条数=' + r.added);
    assert.ok(TMM.TM.get(src, 'en', 'tencent'), '导入后未命中');
  });
  check('容量上限会淘汰最久未用的条目', () => {
    const oldMax = TMM.TM.max;
    TMM.TM.max = 3;
    TMM.TM.clear();
    for (let i = 0; i < 6; i++) TMM.TM.set('句子' + i + '内容', 'en', 'any', 'S' + i);
    assert.ok(TMM.TM.stats().entries <= 3, '条数=' + TMM.TM.stats().entries);
    TMM.TM.max = oldMax;
  });
}

console.log('\n[6] 与翻译引擎串联（模拟接口返回，检查符号与术语不丢）');
{
  const T = require(path.join(SRC, 'translate.js'));
  // 原文（本节的基准，后面两轮都用它，保证"同一篇文献再译一次"的语义）
  const ORIG = [
    '共纳入4441例不育男性，P<0.001，95%CI 1.030~1.074。',
    '精子DNA碎片化指数（DFI）≥30%组2938例。'
  ];
  const buildIR = () => {
    const ir = core.newIR({ source: 'test', fileName: 't.txt' });
    ir.bodySize = 10.5;
    ir.blocks = ORIG.map((t, i) => ({ id: 'b' + i, type: 'paragraph', runs: [{ t: t }], size: 10.5 }));
    return ir;
  };
  // 清掉上一节留下的条目，避免互相干扰
  TMM.TM.clear();

  (async () => {
    const ir = buildIR();
    const seen = [];
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      seen.push(body.text);
      // 模拟引擎：保留所有标记与占位符，并把中文替换成英文
      const out = body.text
        .replace(/共纳入/g, 'A total of ')
        .replace(/不育男性/g, 'infertile men')
        .replace(/例/g, ' cases')
        .replace(/组/g, ' group');
      return { json: async () => ({ code: 0, result: out }) };
    };
    const terms = [{ src: '精子DNA碎片化指数', dst: 'sperm DNA fragmentation index' }];
    const stat = await T.translateIR(ir, {
      apiUrl: 'mock', target: 'en', engine: 'tencent',
      terms: terms, useTM: false, fetchImpl: fetchImpl, delay: 0
    });
    const text1 = core.runsToText(ir.blocks[0].runs);
    const text2 = core.runsToText(ir.blocks[1].runs);
    const okSymbols = /4441/.test(text1) && /P<0\.001/.test(text1) && /95%CI 1\.030~1\.074/.test(text1) &&
      /≥30%/.test(text2) && /2938/.test(text2) && /DFI/.test(text2);
    const okTerms = /sperm DNA fragmentation index/.test(text2);
    console.log('  译文1: ' + text1);
    console.log('  译文2: ' + text2);
    console.log('  送接口的文本样本: ' + seen[0].slice(0, 90).replace(/\n/g, '\\n'));
    try {
      assert.ok(okSymbols, '符号未保住');
      assert.ok(okTerms, '术语未生效');
      assert.deepStrictEqual(stat.missingSymbols, [], '有占位符丢失');
      console.log('  ✓ 符号全部保住、术语生效、无占位符丢失');
      pass++;
    } catch (e) { console.log('  ✗ 符号/术语串联  →  ' + e.message); fail++; }

    /* 翻译记忆复用：同一篇文献再译一次应当零调用 */
    let calls = 0;
    const counting = async (url, init) => { calls++; return fetchImpl(url, init); };
    // 第一轮：开着翻译记忆 → 写入缓存
    const stat1 = await T.translateIR(buildIR(), {
      apiUrl: 'mock', target: 'en', engine: 'tencent',
      terms: terms, useTM: true, fetchImpl: fetchImpl, delay: 0
    });
    // 第二轮：同样原文（全新 IR）→ 应当全部命中
    const ir2 = buildIR();
    const stat2 = await T.translateIR(ir2, {
      apiUrl: 'mock', target: 'en', engine: 'tencent',
      terms: terms, useTM: true, fetchImpl: counting, delay: 0
    });
    console.log(`  第一轮写入记忆 ${stat1.tmSaved} 段；第二轮接口调用 ${calls} 次，命中记忆 ${stat2.fromCache} 段`);
    try {
      assert.strictEqual(calls, 0, '应全部命中记忆，实际调用 ' + calls + ' 次');
      assert.strictEqual(stat2.fromCache, 2, '命中数=' + stat2.fromCache);
      const t2 = core.runsToText(ir2.blocks[1].runs);
      assert.ok(/sperm DNA fragmentation index/.test(t2) && /≥30%/.test(t2), '复用译文异常: ' + t2);
      console.log('  ✓ 翻译记忆生效（零调用复用，且符号与术语仍在）');
      pass++;
    } catch (e) { console.log('  ✗ 翻译记忆复用  →  ' + e.message); fail++; }

    console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
    process.exit(fail ? 1 : 0);
  })();
}
