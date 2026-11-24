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

  /** 引擎是否会保留分段标记的记忆（key = apiUrl + '|' + engine）
   *  true = 会保留（可批量）；false = 会改动（只能逐段）。会话内有效。 */
  const ENGINE_MARKER_RELIABLE = {};

  /* ==========================================================================
   * 传输层标记：⟦…⟧ 与引擎之间必须换一种"引擎不会吃掉"的写法
   * --------------------------------------------------------------------------
   * 实测（腾讯云机器翻译）：
   *   ⟦0⟧ / [[0]] / {{0}} / <0>  →  句首的标记会被直接丢弃
   *   ##0##                      →  绝大多数场景保留，但句首+上标符号(²)等场景仍会丢
   * 结论：**不能依赖引擎保留任何带内标记**。
   *   1) 先把 ⟦V12⟧/⟦P3⟧/⟦T4⟧ 换成 ##V12## 这类引擎友好写法（提高成功率）
   *   2) 翻译后逐批校验标记数量；一旦发现丢失，该批改用"逐段单独翻译"兜底
   *      —— 逐段翻译时没有标记，物理上不可能丢。
   * ======================================================================== */
  const MT_OPEN = '##', MT_CLOSE = '##';
  const TOKEN_RE = new RegExp(core.SEG_OPEN + '([VPT]?)(\\d+)' + core.SEG_CLOSE, 'g');

  /** 发送前：⟦V12⟧ → ##V12##（无字母前缀视为分段标记 V） */
  function encodeMarkers(text) {
    return String(text == null ? '' : text).replace(TOKEN_RE, (m, kind, num) => MT_OPEN + (kind || 'V') + num + MT_CLOSE);
  }
  /** 收到后：##V12## → ⟦12⟧，##P3## → ⟦P3⟧
   * 【健壮性】机器翻译会在标记内部插空格，实测腾讯云把 ##P0## 输出成
   * "## P0 ##"。旧正则只匹配 "##V12##" 这种无空格形式，导致
   * "##P0##" 只被替换掉半边，正文里残留 "#P0 ##" 这样的垃圾字符。
   * 这里允许 ## 与字母、字母与数字之间出现空白。 */
  function decodeMarkers(text) {
    return String(text == null ? '' : text)
      .replace(/##\s*V\s*(\d+)\s*##/g, (m, n) => core.SEG_OPEN + n + core.SEG_CLOSE)
      .replace(/##\s*([PT])\s*(\d+)\s*##/g, (m, k, n) => core.SEG_OPEN + k + n + core.SEG_CLOSE)
      /* 兜底：只剩半边 ## 的残缺标记（如 "#P0 ##"、"##P0 #"）直接清掉，
         避免脏字符进入译文。这些位置本来就是要被占位符替换的。 */
      .replace(/#{1,2}\s*([PT])\s*(\d+)\s*#*/g, (m, k, n) => core.SEG_OPEN + k + n + core.SEG_CLOSE);
  }
  /** 统计一段文本里所有标记的数量（用于发现引擎丢标记） */
  function countMarkers(text) {
    const m = String(text == null ? '' : text).match(/##\s*[VPT]?\d+\s*##/g);
    return m ? m.length : 0;
  }
  /** 取出一段文本里的所有标记（含编号），用于精确比对 */
  function listMarkers(text) {
    return String(text == null ? '' : text).match(/##\s*[VPT]?\d+\s*##/g) || [];
  }

  /** 批量翻译时给大模型的系统提示：只翻译，绝不改动结构与占位符 */
  function buildSystemPrompt(target, mode) {
    const lang = LANG_NAME[target] || target;
    const rules = [
      '你是一名专业学术文献翻译排版引擎。你的唯一任务是把用户给出的片段翻译成 ' + lang + '。',
      '',
      '严格遵守以下规则：',
      '1. 输入由若干片段组成，每个片段用 ##V数字## 标记包裹（首尾各一次）。',
      '   输出必须包含完全相同的标记：数量一致、编号一致、顺序一致，一个都不能少、不能多。',
      '   绝对不要翻译、改写、删除、重排这些标记，也不要自己新增标记。',
      '   特别注意：**开头那一个标记也必须原样出现在输出的最前面**。',
      '2. 片段内部可能出现 ##P0## ##T1## 这类占位符，它们代表数字、单位、公式、参考文献编号、',
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

  /* 这些字样代表"这个引擎整体不可用"（额度用完 / 鉴权失败 / 欠费），
   * 重试没有意义，只能换引擎。
   * 真实故障：腾讯云 2026-11 免费额度耗尽，云函数返回
   *   {"code":-1,"result":"所有引擎均失败 → tencent: service free amount of this month has been used up"}
   * 旧代码把它当普通失败 → 逐段兜底也全失败 → 静默输出**全文未翻译**的文件。 */
  const FATAL_RE = /free amount|used up|quota|额度|欠费|余额|UNAUTHORIZED|Unauthorized|AUTH_FAILED|invalid.*(key|credential|secret)|验证失败|鉴权|not authorized|insufficient/i;

  function isFatalMessage(msg) {
    return FATAL_RE.test(String(msg || ''));
  }

  /* 云函数自己也会做引擎降级（请求的引擎挂了就用别的兜底），
   * 并把实际使用的引擎写在响应里。记下来，最后告诉用户"实际用的是哪个"。 */
  let lastServerEngine = null;
  let lastServerFellBack = false;

  async function callOnce(opts) {
    const f = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) throw new Error('当前环境不支持 fetch');
    const eng = opts.engine || 'tencent';
    const body = {
      text: encodeMarkers(opts.text),          // ⟦V3⟧ → ##V3##（引擎友好写法）
      target: TENCENT_CODE[opts.target] || opts.target,
      engine: eng
    };
    if (eng === 'deepseek') body.system = opts.system;

    let res;
    try {
      res = await f(opts.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (netErr) {
      const e = new Error('无法连接翻译服务：' + (netErr && netErr.message || netErr));
      e.fatal = true;                       // 网络断了/地址错 → 换引擎也没用，但要停下来
      e.network = true;
      throw e;
    }

    /* 先把正文读成文本，再解析：500 时 body 里往往带着真实原因
     * （"额度用完"就写在这里），旧代码直接 res.json() 会把它丢掉。
     * 兼容只提供 json() 的测试替身。 */
    let rawText = '';
    let data = null;
    if (typeof res.text === 'function') {
      rawText = await res.text();
      try { data = rawText ? JSON.parse(rawText) : null; } catch (e) { data = null; }
    } else if (typeof res.json === 'function') {
      try { data = await res.json(); } catch (e) { data = null; }
      rawText = data ? JSON.stringify(data) : '';
    } else {
      data = null;
    }

    if (data && data.code === 0 && typeof data.result === 'string') {
      if (data.engine) {
        lastServerEngine = data.engine;
        if (data.fellBack) lastServerFellBack = true;
      }
      return decodeMarkers(data.result);     // ##V3## → ⟦3⟧
    }

    const msg = (data && data.result) || ('HTTP ' + res.status + ' ' + String(rawText || '').slice(0, 200)) || '翻译接口返回错误';
    const e = new Error(msg);
    e.status = res.status;
    e.engine = eng;
    /* HTTP 5xx / 429 / 鉴权类错误都视为"引擎不可用" */
    e.fatal = !!isFatalMessage(msg) || res.status >= 500 || res.status === 429 || res.status === 401 || res.status === 403;
    throw e;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /** 逐片段兜底翻译（批量标记被破坏时使用） */
  async function translateOneByOne(units, opts, onProgress) {
    const out = [];
    let fatalCount = 0;
    for (let i = 0; i < units.length; i++) {
      let text = null;
      try {
        text = await callOnce(Object.assign({}, opts, {
          text: units[i].payload != null ? units[i].payload : units[i].text,
          engine: opts.fallbackEngine || 'tencent'
        }));
        fatalCount = 0;
      } catch (e) {
        text = null;
        /* 致命错误（额度用完/鉴权失败）不要一段一段地重试几百次 ——
         * 那样只是把"静默输出原文"拖得更久。连续 3 段都致命就向上抛，
         * 由 translateIR 换引擎或明确报错。 */
        if (e && e.fatal) {
          fatalCount++;
          if (fatalCount >= 3 || units.length === 1) throw e;
        }
      }
      out.push(text);
      if (onProgress) onProgress(i + 1, units.length);
      await sleep(opts.delay == null ? 120 : opts.delay);   // 真正的 QPS 限流在云函数里做
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
      termsApplied: 0, symbols: 0, tmSaved: 0, missingSymbols: [], calls: 0,
      markerLoss: 0, perSegmentFallback: 0, symbolRetries: 0, unitRetries: 0
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
    const batches = core.buildBatches(todo.map(u => ({ text: u.payload, ref: u })), opts.maxChars || 4000);

    const system = buildSystemPrompt(opts.target, opts.mode);
    let engine = opts.engine || 'tencent';

    /* 引擎人话名（界面上要用） */
    const ENGINE_NAME = { tencent: '腾讯云', baidu: '百度翻译', deepseek: 'DeepSeek' };
    const engineName = e => ENGINE_NAME[e] || e;

    /* ---- 3) 逐批翻译 ----
     * 实测：腾讯云机器翻译会随机丢弃句首的标记（⟦⟧ 和 ##n## 都会丢），
     * 一旦标记被丢，这一批的分段就对不上了。处理策略：
     *   · 先按批翻译（快，接口调用少）
     *   · 发现标记丢失 → 该批改用「逐段翻译」（请求里只有一个片段，
     *     标记由程序自己加，物理上不可能丢）
     *   · 若连续两批都丢标记，说明这个引擎不靠谱，后面直接全部逐段，
     *     不再浪费重试时间
     * mode='safe' 时跳过批量，直接逐段（最稳，但调用次数=片段数）
     */
    const safeMode = opts.mode === 'safe';

    /* 引擎可靠性记忆：同一个"地址+引擎"组合只要证明过会破坏标记，
     * 之后的文档直接走逐段，不必再从头踩一遍坑（这是"翻译偏慢"的主因之一）。 */
    let relKey = String(opts.apiUrl || '') + '|' + String(engine);
    let knownBad = ENGINE_MARKER_RELIABLE[relKey] === false;
    let reliable = !safeMode && !knownBad;
    if (safeMode || knownBad) {
      if (opts.onProgress) {
        opts.onProgress(0, units.length, safeMode
          ? '安全模式：逐段翻译（最稳）'
          : '该引擎已知会改动分段标记，直接逐段翻译（更稳）');
      }
    }
    let consecutiveLoss = 0;

    let done = stat.fromCache;
    const finishedUnits = new Set();

    /* 单个引擎的一整轮翻译。致命错误（额度/鉴权）向上抛，交给下面的换引擎逻辑。 */
    async function runBatchPass() {
    const beforeTranslated = stat.translated;
    const pendingAtStart = units.filter(u => !finishedUnits.has(u)).length;
    let lastErr = null;          /* 这一轮里最有说服力的失败原因（用于报错文案） */
    for (const batch of batches) {
      /* 换引擎重跑时，已经翻好的批直接跳过，不重复烧额度 */
      if (batch.items.every(x => finishedUnits.has(x.ref))) continue;
      const refs = batch.items.map(x => x.ref);
      /* 这批理应带回的标记（分段标记 + 占位符），用于发现引擎"吃掉"标记 */
      const wantMarkers = batch.items.reduce(
        (a, x) => a + 2 + ((x.ref && x.ref.items) ? x.ref.items.length : 0), 0);
      let payloads = null;
      let attempt = 0;
      /* 重试次数：批量失败时的重试是有价值的（实测随机性），但不宜多。
       * 因为"标记+占位符紧邻"（##V0####P0##）这种形态丢标记概率明显更高，
       * 反复重试只会白等，所以默认只重试 1 次。 */
      const retries = reliable ? (opts.retries == null ? 1 : opts.retries) : 0;
      let lostMarkers = false;

      while (reliable && attempt <= retries && !payloads) {
        try {
          const raw = await callOnce({
            apiUrl: opts.apiUrl, text: batch.text, target: opts.target,
            engine: engine, system: system, fetchImpl: opts.fetchImpl
          });
          stat.calls++;
          /* 标记少了 → 这一批不可信。注意：实测丢失是随机的（同一批重发多数能好），
           * 所以先重试同一批；只有反复失败才降级为逐段翻译。 */
          if (wantMarkers > 0 && listMarkers(raw).length < wantMarkers) {
            stat.markerLoss++;
            lostMarkers = true;
            throw new Error('引擎丢失标记（期望 ' + wantMarkers + ' 个，返回 ' + listMarkers(raw).length + ' 个）');
          }
          const parsed = core.parseSegments(raw, batch.items.length);
          const got = parsed.filter(x => x != null && x !== '').length;
          if (got >= Math.max(1, Math.ceil(batch.items.length * 0.9))) payloads = parsed;
        } catch (e) {
          if (e && e.fatal) lastErr = e;
          if (!lostMarkers) await sleep(600 * (attempt + 1));
        }
        attempt++;
      }

      if (lostMarkers) {
        consecutiveLoss++;
        /* 实测：标记丢失是"随机"的，同一批重发多数能成功（10/10 通过）。
         * 所以策略是"批量为主、重试纠正"：
         *   · 单批重试仍失败 → 只把这一批降级为逐段，继续尝试批量翻译（快）
         *   · 累计失败批次过多 → 才判定该引擎整体不可靠，后续全逐段
         * 这样既不牺牲速度，也不会丢符号。 */
        const giveUp = opts.batchLossLimit == null ? 2 : opts.batchLossLimit;
        if (consecutiveLoss >= giveUp && reliable) {
          reliable = false;
          ENGINE_MARKER_RELIABLE[relKey] = false;
          if (opts.onProgress) {
            opts.onProgress(done, units.length,
              '当前引擎较易改动分段标记，后续改为逐段翻译（更稳，速度稍慢）');
          }
        }
      } else if (payloads) {
        consecutiveLoss = 0;
        if (ENGINE_MARKER_RELIABLE[relKey] === undefined) ENGINE_MARKER_RELIABLE[relKey] = true;
      }

      if (!payloads) {
        /* 逐段单独翻译：请求里只有一个片段，标记由程序自己包，物理上不可能丢 */
        payloads = await translateOneByOne(refs, {
          apiUrl: opts.apiUrl, target: opts.target, system: system,
          engine: engine, fetchImpl: opts.fetchImpl, delay: opts.delay, fallbackEngine: engine
        }, null);
        stat.calls += refs.length;
        stat.perSegmentFallback += refs.length;
      }

      /* 逐段处理：发现占位符被引擎吞掉时，单独重译这一段。
       * 实测这类丢失是随机的（同一段重发往往就能保住），所以重试非常有效。 */
      for (let i = 0; i < refs.length; i++) {
        const u = refs[i];
        const raw = payloads[i];
        let text = null;
        let lost = [];

        if (raw != null && raw !== '') {
          if (u.items && u.items.length) {
            const r0 = glossary.restore(raw, u.items);
            text = r0.text;
            lost = r0.missing || [];
          } else {
            /* 没开保护时也可能残留 ##Tn## 形态，稳妥起见再解一次 */
            text = decodeMarkers(raw);
          }
        }

        let tries = 0;
        const maxUnitRetry = (u.items && u.items.length) ? (opts.unitRetries == null ? 4 : opts.unitRetries) : 0;
        while (lost.length && tries < maxUnitRetry) {
          tries++;
          try {
            const again = await translateOneByOne([u], {
              apiUrl: opts.apiUrl, target: opts.target, system: system,
              engine: engine, fetchImpl: opts.fetchImpl, delay: opts.delay, fallbackEngine: engine
            }, null);
            stat.calls++;
            if (again[0] != null && again[0] !== '') {
              const r2 = glossary.restore(again[0], u.items);
              /* 只有这次丢得更少才采用，避免越试越差 */
              if ((r2.missing || []).length < lost.length) {
                text = r2.text;
                lost = r2.missing || [];
              }
            }
          } catch (e) { /* 忽略，保留已有结果 */ }
        }
        stat.symbolRetries += tries;
        stat.unitRetries += tries;

        if (text == null || text === '') {
          core.applyTranslation(ir, u, null);
          stat.fallback++; done++;
          /* 注意：**失败不要标记 finishedUnits** —— 换引擎重跑时必须重试这一段。
           * （曾经的 bug：不分成败都 add，导致第二个引擎整批被跳过、
           *   一段都没翻却"顺利跑完"，最后报"没有任何译文"。） */
        } else {
          if (lost.length) stat.missingSymbols = stat.missingSymbols.concat(lost);
          core.applyTranslation(ir, u, text);
          tmStore(u, opts, text);
          stat.tmSaved++;
          stat.translated++; done++;
          finishedUnits.add(u);
        }
      }

      if (opts.onProgress) opts.onProgress(done, units.length, '已翻译 ' + done + '/' + units.length + ' 段');
      await sleep(opts.delay == null ? 200 : opts.delay);
    }

    /* 这一轮该翻的段落一段都没翻出来 → 判定"该引擎不可用"，
     * 抛致命错误交给上层换引擎。
     * 这一步是这次事故（腾讯云额度用完 → 静默输出 0 中文 docx）的关键：
     * 旧代码把"每段都失败"当成正常的 fallback，于是整轮"顺利跑完"。 */
    if (pendingAtStart > 0 && stat.translated === beforeTranslated) {
      const err = lastErr || new Error('该引擎没有返回任何译文');
      err.fatal = true;
      throw err;
    }
    }

    /* ---- 4) 引擎自动切换 ----
     * 真实故障（2026-11）：腾讯云当月 500 万字符免费额度用完，云函数对每个
     * 翻译请求都返回 HTTP 500 duration "service free amount of this month has
     * been used up"。旧逻辑把失败当"保留原文"，于是一份 25 页的论文被
     * 静默输出成 0 个中文字符的 docx —— 用户以为"翻译没成功"却看不到原因。
     *
     * 现在：
     *   · 致命错误（额度/鉴权/5xx）→ 自动换成下一个可用引擎继续翻
     *   · 全部引擎都不可用 → 抛错，由界面明确提示（绝不输出假装完成的原文）
     */
    const ENGINE_ORDER = ['deepseek', 'baidu', 'tencent'];
    const engineQueue = [engine].concat(ENGINE_ORDER.filter(e => e !== engine));
    const shortMsg = m => String(m || '').replace(/\s+/g, ' ').slice(0, 90);

    for (let ei = 0; ei < engineQueue.length; ei++) {
      const eng = engineQueue[ei];
      engine = eng;
      relKey = String(opts.apiUrl || '') + '|' + String(eng);
      knownBad = ENGINE_MARKER_RELIABLE[relKey] === false;
      reliable = !safeMode && !knownBad;
      stat.engine = eng;
      try {
        await runBatchPass();
        break;                                   // 顺利跑完，不再换引擎
      } catch (e) {
        const last = (ei === engineQueue.length - 1);
        if (!e || !e.fatal || last) {
          /* 换不动了：把"已经翻好多少"讲清楚，然后中止，让界面报错 */
          const err = new Error(
            '翻译服务不可用：' + shortMsg(e && e.message) +
            (stat.translated ? '（已翻译 ' + stat.translated + ' / ' + units.length + ' 段）' : '') +
            '。请更换引擎（推荐 DeepSeek 或百度翻译），或检查云函数额度。'
          );
          err.fatal = true;
          err.engine = eng;
          err.stat = stat;
          throw err;
        }
        stat.engineFailures = (stat.engineFailures || []).concat([{ engine: eng, message: shortMsg(e.message) }]);
        stat.engineSwitched = (stat.engineSwitched || 0) + 1;
        if (opts.onProgress) {
          opts.onProgress(done, units.length,
            '「' + engineName(eng) + '」不可用（' + shortMsg(e.message) + '），自动切换为「' +
            engineName(engineQueue[ei + 1]) + '」继续翻译');
        }
      }
    }

    /* ---- 5) 兜底校验：一段都没翻成，就绝不能当成功 ----
     * 这条断言是这次事故的护栏：宁可报错，也不产出"看着完成了、其实全是原文"的文件。 */
    if (!stat.translated && units.length) {
      const err = new Error('翻译没有产生任何译文（' + units.length + ' 段全部失败）。' +
        '常见原因：腾讯云/百度当月免费额度用完、密钥失效、或网络被拦截。请更换引擎后重试。');
      err.fatal = true;
      err.stat = stat;
      throw err;
    }

    /* 云函数端的降级结果：告诉用户实际是哪个引擎翻的 */
    if (lastServerEngine) stat.serverEngine = lastServerEngine;
    if (lastServerFellBack) stat.serverFellBack = true;

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
    encodeMarkers, decodeMarkers, countMarkers, listMarkers,
    LANG_NAME, TENCENT_CODE
  };
});
