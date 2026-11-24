/* engine-fallback.test.js — 引擎额度用完时必须"自动换引擎"，而不是静默输出原文
 * 用法: node test/engine-fallback.test.js
 *
 * 真实事故（2026-11-24）：用户选了「普通翻译（腾讯云）」翻译一篇 25 页论文，
 * 腾讯云当月 500 万字符免费额度已用完，云函数对每个请求返回
 *   HTTP 500 {"code":-1,"result":"所有引擎均失败 → tencent: service free amount of this month has been used up"}
 * 旧代码把这个当普通失败 → 逐段兜底也全失败 → **生成了一份 10 万英文字符、0 个中文字符的 docx**，
 * 界面上没有任何错误提示。用户只能看到"翻译没成功"。
 *
 * 现在要求：
 *   1) 识别"额度/鉴权"这类致命错误
 *   2) 自动切换下一个引擎继续翻（百度/DeepSeek 当时都是好的）
 *   3) 所有引擎都不可用 → 抛错，绝不产出假完成
 */
'use strict';
const path = require('path');
const tr = require(path.join(__dirname, '..', 'src', 'translate.js'));

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { console.log('  \u2713 ' + n); pass++; }
  else { console.log('  \u2717 ' + n + (extra ? '  → ' + extra : '')); fail++; }
};

const QUOTA = '所有引擎均失败 → tencent: service free amount of this month has been used up';

/* 造一个假 fetch：按 engine 决定成功还是返回 500 */
function mkFetch(rules) {
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ engine: body.engine, text: body.text });
    const rule = rules[body.engine] || rules['*'];
    const out = typeof rule === 'function' ? rule(body) : rule;
    if (out && out.error) {
      return {
        status: out.status || 500,
        text: async () => JSON.stringify({ code: -1, result: out.error })
      };
    }
    /* 正常返回：把所有英文单词换成「中文」，但**一个标记都不动**
     * （真实引擎能保留标记时就是这样），这样才能走到"标记完整"的快路径。
     * 注意 `(^|[^#A-Za-z])` 这个前缀保护：标记形如 ##V0## 或 ##0##，
     * 不能把标记里的字母 V 也换成中文。 */
    const translated = String(body.text).replace(/(^|[^#A-Za-z])[A-Za-z]{2,}/g, '$1\u4e2d\u6587');
    return {
      status: 200,
      text: async () => JSON.stringify({ code: 0, result: translated, engine: body.engine })
    };
  };
  f.calls = calls;
  return f;
}

function mkIR() {
  const blocks = [
    { id: 'b0', type: 'paragraph', runs: [{ t: 'Chronic stress drives oligoasthenozoospermia.' }] },
    { id: 'b1', type: 'paragraph', runs: [{ t: 'Gut microbiota and vitamin pathway are involved.' }] }
  ];
  return { blocks: blocks, bodySize: 10, page: { width: 595, height: 842 } };
}

const TEXT = ir => ir.blocks.map(b => (b.runs || []).map(r => r.t).join('')).join(' | ');

(async () => {
  console.log('=== 1) 腾讯云额度用完 → 自动切换，仍要翻出中文 ===');
  {
    const fetchImpl = mkFetch({
      tencent: { error: QUOTA },
      deepseek: { error: QUOTA },          // 假设 DeepSeek 也不可用
      baidu: { ok: true }                  // 百度可用
    });
    const ir = mkIR();
    const res = await tr.translateIR(ir, {
      apiUrl: 'https://example.test', target: 'zh-CN', engine: 'tencent',
      fetchImpl: fetchImpl, useTM: false, protectSymbols: false, delay: 0, retries: 0
    });
    console.log('    stat: translated=' + res.translated + ' fallback=' + res.fallback +
      ' engine=' + res.engine + ' switched=' + res.engineSwitched);
    check('两段都翻成了', res.translated === 2, 'translated=' + res.translated);
    check('实际用的是百度', res.engine === 'baidu', String(res.engine));
    check('发生了 2 次引擎切换', res.engineSwitched === 2, String(res.engineSwitched));
    check('记录了失败原因', (res.engineFailures || []).length === 2,
      JSON.stringify(res.engineFailures || []));
    check('译文里出现中文', /中文/.test(TEXT(ir)), TEXT(ir).slice(0, 120));
  }

  console.log('\n=== 2) 首选引擎可用 → 不切换 ===');
  {
    const fetchImpl = mkFetch({ tencent: { ok: true }, '*': { error: '不该被调用' } });
    const ir = mkIR();
    const res = await tr.translateIR(ir, {
      apiUrl: 'https://example.test', target: 'zh-CN', engine: 'tencent',
      fetchImpl: fetchImpl, useTM: false, protectSymbols: false, delay: 0, retries: 0
    });
    check('两段都翻成了', res.translated === 2, String(res.translated));
    check('没有切换引擎', !res.engineSwitched, String(res.engineSwitched));
    check('只用了腾讯云', fetchImpl.calls.every(c => c.engine === 'tencent'),
      fetchImpl.calls.map(c => c.engine).join(','));
  }

  console.log('\n=== 3) 所有引擎都不可用 → 必须抛错，不许假装成功 ===');
  {
    const fetchImpl = mkFetch({ '*': { error: QUOTA } });
    const ir = mkIR();
    let err = null;
    try {
      await tr.translateIR(ir, {
        apiUrl: 'https://example.test', target: 'zh-CN', engine: 'tencent',
        fetchImpl: fetchImpl, useTM: false, protectSymbols: false, delay: 0, retries: 0
      });
    } catch (e) { err = e; }
    check('抛出了错误', !!err, err ? '' : '没有抛错 → 会静默输出原文');
    if (err) {
      console.log('    错误信息: ' + String(err.message).slice(0, 120));
      check('错误被标记为致命', err.fatal === true, String(err.fatal));
      check('错误信息里提示换引擎/额度', /引擎|额度/.test(err.message), err.message.slice(0, 80));
    }
    check('原文没有被当成译文写入', !/中文/.test(TEXT(ir)), TEXT(ir).slice(0, 80));
  }

  console.log('\n=== 4) 网络完全不可达 → 也是致命错误 ===');
  {
    const boom = async () => { throw new Error('Failed to fetch'); };
    const ir = mkIR();
    let err = null;
    try {
      await tr.translateIR(ir, {
        apiUrl: 'https://example.test', target: 'zh-CN', engine: 'tencent',
        fetchImpl: boom, useTM: false, protectSymbols: false, delay: 0, retries: 0
      });
    } catch (e) { err = e; }
    check('抛出了错误', !!err, '没有抛错');
    if (err) check('提示无法连接', /无法连接|不可用|额度|引擎/.test(err.message), err.message.slice(0, 80));
  }

  console.log('\n====================================================');
  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
