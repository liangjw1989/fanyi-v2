/* ============================================================================
 * 灵译 · 翻译引擎 (translate.js)   © 2026 灵译 LingYi
 * ----------------------------------------------------------------------------
 * 完整流水线（每一步都可单独关闭）：
 *   ① 结构化分段    每段包上 ⟦n⟧，保证结构不被翻译引擎重排
 *   ② 翻译记忆      命中缓存直接复用 → 0 次接口调用
 *   ③ 术语库        用户术语替换成 ⟦T1⟧ 占位符 → 强制统一译名
 *   ④ 符号保护      数字/单位/上下标/希腊字母/参考文献编号 → ⟦P0⟧ 占位符
 *   ⑤ 调用引擎      腾讯云（普通翻译）或 DeepSeek（AI 智能翻译）
 *   ⑥ 还原 + 校验   填回占位符，并检查符号是否被模型改动
 *
 * 说明：占位符与分段标记靠前缀区分——分段标记是纯数字 ⟦12⟧，
 *       符号/术语占位符带前缀字母 ⟦P0⟧ / ⟦T1⟧，互不干扰。
 * ==========================================================================*/
(function (root, factory) {
  const core = (typeof module === 'object' && module.exports) ? require('./core.js') : root.LingyiCore;
  const glossary = (typeof module === 'object' && module.exports) ? require('./glossary.js') : root.LingyiGlossary;
  const tmMod = (typeof module === 'object' && module.exports) ? require('./tm.js') : root.LingyiTM;
  const mod = factory(core, glossary, tmMod);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.LingyiTranslate = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, glossary, tmMod) {
  'use strict';

  const LANG_NAME = {
    'zh-CN': 'Chinese', 'zh': 'Chinese', 'en': 'English', 'ja': 'Japanese',
    'ko': 'Korean', 'fr': 'French', 'de': 'German', 'es': 'Spanish',
    'ru': 'Russian', 'pt': 'Portuguese', 'it': 'Italian', 'ar': 'Arabic',
    'th': 'Thai', 'vi': 'Vietnamese'
  };
  const TENCENT_CODE = {
    'zh-CN': 'zh', 'zh': 'zh', 'en': 'en', 'ja': 'ja', 'ko': 'ko',
    'fr': 'fr', 'de': 'de', 'es': 'es', 'ru': 'ru', 'pt': 'pt',
    'it': 'it', 'ar': 'ar', 'th': 'th', 'vi': 'vi'
  };

  const TM = tmMod ? tmMod.TM : null;

  /** 批量翻译时给大模型的系统提示：只翻译，绝不改动结构与占位符 */
  function buildSystemPrompt(target, mode) {
    const lang = LANG_NAME[target] || target;
    const rules = [
      '你是一名专业学术文献翻译排版引擎。你的唯一任务是把用户给出的片段翻译成 ' + lang + '。',
      '',
      '严格遵守以下规则：',
      '1. 输入由若干片段组成，每个片段用 ⟦数字⟧ 标记包裹（首尾各一次）。',
      '   输出必须包含完全相同的标记：数量一致、编号一致、顺序一致，一个都不能少、不能多。',
      '   绝对不要翻译、改写、删除、重排这些标记，也不要自己新增标记。',
      '2. 片段内部可能出现 ⟦P0⟧ ⟦T1⟧ 这类占位符，它们代表数字、单位、公式、参考文献编号、',
      '   图表编号、希腊字母或已定术语。必须原样保留，不能翻译、不能改成别的写法、不能移动位置。',
      '3. 每个片段独立翻译，不要跨片段合并句子，不要输出任何解释、标题或多余文字。',
      '4. 保持片段内部的换行与分句结构；学术语气，术语前后统一。',
      '5. 上下标、括号、标点与原文形式对应（中文用全角，英文用半角）。'
    ];
    if (mode === 'polish') {
      rules.push('6. 在忠实原文的前提下润色译文，使其通顺、专业，但不得改动任何占位符。');
    }
    return rules.join('\n');
  }

  async function callOnce(opts) {
    const f = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) throw new Error('当前环境不支持 fetch');
    const body = {
      text: opts.text,
      target: TENCENT_CODE[opts.target] || opts.target,
      engine: opts.engine || 'tencent'
    };
    if (opts.engine === 'deepseek') body.system = opts.system;
    const res = await f(opts.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data || data.code !== 0) throw new Error((data && data.result) || '翻译接口返回错误');
    return data.result;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /** 逐片段兜底翻译（批量标记被破坏时使用） */
  async function translateOneByOne(units, opts, onProgress) {
    const out = [];
    for (let i = 0; i < units.length; i++) {
      let text = null;
      try {
        text = await callOnce(Object.assign({}, opts, {
          text: units[i].payload != null ? units[i].payload : units[i].text,
          engine: opts.fallbackEngine || 'tencent'
        }));
      } catch (e) { text = null; }
      out.push(text);
      if (onProgress) onProgress(i + 1, units.length);
      await sleep(opts.delay == null ? 260 : opts.delay);
    }
    return out;
  }

  /* --------------------------------------------------- 与翻译记忆/术语库协作 */

  function tmLookup(unit, opts) {
    if (!TM || opts.useTM === false) return null;
    return TM.get(unit.text, opts.target, opts.engine);
  }

  function tmStore(unit, opts, translated) {
    if (!TM || opts.useTM === false) return;
    TM.set(unit.original, opts.target, opts.engine, translated);
  }

  /**
   * 主流程：翻译整份 IR
   * @param {Object} ir 中间表示
   * @param {Object} opts {
   *   apiUrl, target, engine('tencent'|'deepseek'), mode('normal'|'polish'),
   *   maxChars, delay, retries, fetchImpl,
   *   terms: [{src,dst,lang,caseSensitive}],  术语库
   *   useTM: true,                            是否使用翻译记忆
   *   protectSymbols: true,                   是否保护符号
   *   onProgress(done,total,msg)
   * }
   */
  async function translateIR(ir, opts) {
    opts = opts || {};
    const units = core.eachTextUnit(ir);
    const stat = {
      total: units.length, translated: 0, fallback: 0, fromCache: 0,
      termsApplied: 0, symbols: 0, tmSaved: 0, missingSymbols: [], calls: 0
    };
    if (!units.length) return stat;

    const useGlossary = opts.protectSymbols !== false || (opts.terms && opts.terms.length);
    const terms = (opts.terms || []).filter(t => !t.lang || t.lang === opts.target || t.lang === 'auto');

    if (opts.onProgress) opts.onProgress(0, units.length, '准备翻译…');

    /* ---- 1) 翻译记忆 + 占位符保护 ---- */
    const todo = [];
    for (const u of units) {
      u.original = u.text;

      const cached = tmLookup(u, opts);
      if (cached != null) {
        core.applyTranslation(ir, u, cached);
        stat.fromCache++; stat.translated++;
        continue;
      }

      if (useGlossary) {
        const p = glossary.protect(u.text, { terms: terms, targetLang: opts.target });
        u.payload = p.text;
        u.items = p.items;
        stat.termsApplied += p.items.filter(x => x.kind === 'term').length;
        stat.symbols += p.items.filter(x => x.kind === 'symbol').length;
      } else {
        u.payload = u.text;
        u.items = [];
      }
      todo.push(u);
    }

    if (!todo.length) {
      if (opts.onProgress) opts.onProgress(units.length, units.length, '全部命中翻译记忆，零调用');
      saveTM();
      return stat;
    }

    /* ---- 2) 按保护后的长度分批 ---- */
    const batches = core.buildBatches(todo.map(u => ({ text: u.payload, ref: u })), opts.maxChars || 2600);

    const system = buildSystemPrompt(opts.target, opts.mode);
    const engine = opts.engine || 'tencent';

    /* ---- 3) 逐批翻译 ---- */
    let done = stat.fromCache;
    for (const batch of batches) {
      const refs = batch.items.map(x => x.ref);
      let payloads = null;
      let attempt = 0;
      const retries = opts.retries == null ? 2 : opts.retries;

      while (attempt <= retries && !payloads) {
        try {
          const raw = await callOnce({
            apiUrl: opts.apiUrl, text: batch.text, target: opts.target,
            engine: engine, system: system, fetchImpl: opts.fetchImpl
          });
          stat.calls++;
          const parsed = core.parseSegments(raw, batch.items.length);
          const got = parsed.filter(x => x != null && x !== '').length;
          if (got >= Math.max(1, Math.ceil(batch.items.length * 0.9))) payloads = parsed;
        } catch (e) {
          await sleep(600 * (attempt + 1));
        }
        attempt++;
      }

      if (!payloads) {
        payloads = await translateOneByOne(refs, {
          apiUrl: opts.apiUrl, target: opts.target, system: system,
          engine: engine, fetchImpl: opts.fetchImpl, delay: opts.delay, fallbackEngine: engine
        }, null);
        stat.calls += refs.length;
      }

      refs.forEach((u, i) => {
        const raw = payloads[i];
        if (raw == null || raw === '') {
          core.applyTranslation(ir, u, null);
          stat.fallback++; done++;
          return;
        }
        let text = raw;
        if (u.items && u.items.length) {
          const r = glossary.restore(raw, u.items);
          text = r.text;
          if (r.missing.length) stat.missingSymbols = stat.missingSymbols.concat(r.missing);
        }
        core.applyTranslation(ir, u, text);
        tmStore(u, opts, text);
        stat.tmSaved++;
        stat.translated++; done++;
      });

      if (opts.onProgress) opts.onProgress(done, units.length, '已翻译 ' + done + '/' + units.length + ' 段');
      await sleep(opts.delay == null ? 200 : opts.delay);
    }

    saveTM();
    return stat;
  }

  let _saveTimer = null;
  function saveTM() {
    if (!TM) return;
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => TM.save(), 400);
  }

  return {
    translateIR, callOnce, buildSystemPrompt, translateOneByOne,
    LANG_NAME, TENCENT_CODE
  };
});
