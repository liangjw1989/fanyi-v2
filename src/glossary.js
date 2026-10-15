/* ============================================================================
 * 灵译 · 术语库与符号保护 (glossary.js)   © 2026 灵译 LingYi
 * ----------------------------------------------------------------------------
 * 解决的问题：翻译文献/科研论文时，下面这些东西**绝对不能交给翻译引擎自由发挥**：
 *   · 数字与统计量      P<0.001、95%CI 1.030~1.074、OR=1.052、n=4441
 *   · 上下标与单位      kg/m²、×10⁶/mL、37 ℃、10 年以上
 *   · 希腊字母与符号    β、χ²、±、≤、≥、~、−、×、°
 *   · 参考文献编号      [1,2]、[3-5]、［1］
 *   · 图表编号          图1、表2、Fig.1、Table 3
 *   · 专有名词/缩写     DNA、DFI、BMI、PR、Kruskal-Wallis H
 *   · 用户自定义术语    精子DNA碎片化指数 → sperm DNA fragmentation index
 *
 * 做法：翻译前把这些片段"挖出来"换成占位符 ⟦P0⟧ / ⟦T1⟧，翻完再填回去。
 *   占位符与分段标记 ⟦n⟧（纯数字）靠前缀字母区分，互不干扰。
 * ==========================================================================*/
(function (root, factory) {
  const core = (typeof module === 'object' && module.exports) ? require('./core.js') : root.LingyiCore;
  const mod = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.LingyiGlossary = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  /* ---------------------------------------------------------------- 常量 */

  /** 内置学术/医学术语库（与 src/glossary-academic.txt 内容一致，避免 file:// 下取不到文件） */
  const ACADEMIC_TERMS_TEXT = "# 灵译 · 学术/医学常用术语库（内置）\n# ---------------------------------------------------------------\n# 用法：\n#   1) 程序里\"术语库\"面板直接粘贴下面内容即可启用\n#   2) 也可以自己增删：每行一条，格式为  源词 = 目标译法\n#   3) # 开头的是注释，不会生效\n#\n# 说明：这里放的是\"翻译引擎容易译错、或前后译名不统一\"的词。\n#       通用词（如\"结果\"\"方法\"）交给引擎即可，不必列进来。\n\n# ===== 通用学术 =====\n摘要 = Abstract\n关键词 = Keywords\n参考文献 = References\n引言 = Introduction\n材料与方法 = Materials and methods\n对象与方法 = Subjects and methods\n结果 = Results\n讨论 = Discussion\n结论 = Conclusion\n致谢 = Acknowledgements\n作者贡献声明 = Author contributions\n利益冲突 = Conflict of interest\n伦理审批 = ethical approval\n知情同意 = informed consent\n纳入标准 = inclusion criteria\n排除标准 = exclusion criteria\n回顾性研究 = retrospective study\n前瞻性研究 = prospective study\n横断面研究 = cross-sectional study\n队列研究 = cohort study\n病例对照研究 = case-control study\n随机对照试验 = randomized controlled trial\n多中心研究 = multicenter study\n样本量 = sample size\n统计学意义 = statistical significance\n差异有统计学意义 = the difference was statistically significant\n敏感性分析 = sensitivity analysis\n亚组分析 = subgroup analysis\n多因素回归分析 = multivariate regression analysis\nlogistic回归 = logistic regression\n线性回归 = linear regression\n相关分析 = correlation analysis\n单因素方差分析 = one-way analysis of variance\n非参数检验 = nonparametric test\n正态性检验 = normality test\n中位数 = median\n四分位数 = quartile\n四分位距 = interquartile range\n标准差 = standard deviation\n标准误 = standard error\n均值 = mean\n置信区间 = confidence interval\n优势比 = odds ratio\n风险比 = hazard ratio\n相对危险度 = relative risk\n受试者工作特征曲线 = receiver operating characteristic curve\n曲线下面积 = area under the curve\n组内相关系数 = intraclass correlation coefficient\n变异系数 = coefficient of variation\n阈值 = threshold\n截断值 = cutoff value\n剂量-反应关系 = dose-response relationship\n非线性关系 = non-linear relationship\n混杂因素 = confounding factor\n校正后 = after adjustment\n倾向性评分匹配 = propensity score matching\n\n# ===== 生殖医学 / 男科 =====\n不育症 = infertility\n男性不育 = male infertility\n不育男性 = infertile men\n精子 = sperm\n精液 = semen\n精液分析 = semen analysis\n精液参数 = semen parameters\n精子浓度 = sperm concentration\n精子总数 = total sperm count\n精子活力 = sperm motility\n前向运动精子 = progressive motile sperm\n精子形态 = sperm morphology\n正常形态精子率 = normal sperm morphology rate\n精子DNA碎片化指数 = sperm DNA fragmentation index\n精子DNA完整性 = sperm DNA integrity\n精浆 = seminal plasma\n禁欲时间 = abstinence duration\n取精 = semen collection\n液化时间 = liquefaction time\n精索静脉曲张 = varicocele\n少精子症 = oligozoospermia\n弱精子症 = asthenozoospermia\n畸形精子症 = teratozoospermia\n无精子症 = azoospermia\n辅助生殖技术 = assisted reproductive technology\n体外受精 = in vitro fertilization\n卵胞浆内单精子注射 = intracytoplasmic sperm injection\n胚胎移植 = embryo transfer\n临床妊娠率 = clinical pregnancy rate\n流产率 = miscarriage rate\n活产率 = live birth rate\n复发性流产 = recurrent pregnancy loss\n染色体 = chromosome\n染色体核型 = karyotype\n染色体倒位 = chromosomal inversion\n染色体多态性 = chromosomal polymorphism\n臂间倒位 = pericentric inversion\n臂内倒位 = paracentric inversion\n易位 = translocation\n缺失 = deletion\n重复 = duplication\n嵌合体 = mosaicism\n非整倍体 = aneuploidy\n外周血淋巴细胞培养 = peripheral blood lymphocyte culture\nG显带 = G-banding\n核型分析 = karyotype analysis\n遗传咨询 = genetic counseling\n产前诊断 = prenatal diagnosis\n\n# ===== 指标与缩写（保持原样，不做翻译）=====\nDNA = DNA\nRNA = RNA\nBMI = BMI\nDFI = DFI\nWHO = WHO\nSPSS = SPSS\nR语言 = R software\nP值 = P value\nH值 = H value\nW值 = W value\nχ²值 = χ² value\n\n# ===== 单位与统计符号（通常由程序自动保护，写进来更保险）=====\nkg/m² = kg/m²\n×10⁶/mL = ×10⁶/mL\nmL = mL\nμL = μL\nr/min = r/min\n℃ = ℃\n";


  const PH_OPEN = '\u27e6';    // ⟦
  const PH_CLOSE = '\u27e7';   // ⟧
  const PH_PREFIX = 'P';       // 符号/术语占位符前缀（分段标记是纯数字，天然区分）
  const TERM_PREFIX = 'T';

  /** 需要原样保留的高价值模式（顺序=优先级，长模式在前） */
  const PROTECT_PATTERNS = [
    // 置信区间：95%CI 1.030~1.074 / 95% CI: 0.116-0.215 / (95%CI：1.030～1.074)
    /[（(]?\s*(?:95|99|90)?\s*%\s*CI\s*[:：]?\s*[-\d.]+\s*[~～\-–—]\s*[-\d.]+\s*[)）]?/gi,
    // 统计显著性：P<0.001、P = 0.05、P＞0.05
    /\bP\s*[<>=≤≥＜＞]\s*0?\.\d+/gi,
    // 相关系数/回归系数/比值比：r=−0.269、β=0.229、OR=1.052、HR（95%CI）…
    /\b(?:r|β|OR|HR|RR|W|H|χ2|χ²|t|F|Z)\s*[=＝]\s*[-−]?\d+(?:\.\d+)?/g,
    // 统计学写法：均数±标准差、中位数（四分位数）
    /[（(]\s*\d+(?:\.\d+)?\s*±\s*\d+(?:\.\d+)?\s*[)）]/g,
    /\d+(?:\.\d+)?\s*[（(]\s*\d+(?:\.\d+)?\s*[，,]\s*\d+(?:\.\d+)?\s*[)）]/g,
    // 复合单位（写在数字前或紧跟数字）：kg/m²、cmH2O、mL/min、μg/mL、×10⁶/mL、10⁹/L
    /[×x]?\s*10[⁰¹²³⁴⁵⁶⁷⁸⁹\u2070-\u209f]*\s*\/\s*[A-Za-zμ]+/g,
    /[A-Za-zμ]{1,4}(?:\/[A-Za-zμ]{1,4})+[²³]?/g,
    // 区间/范围（含单位后缀）：1.030~1.074、20~59 岁、<15%、≥30%
    /[<>≤≥＜＞]?\s*\d+(?:\.\d+)?\s*(?:[~～\-–—]\s*\d+(?:\.\d+)?\s*)/g,
    /[<>≤≥＜＞]\s*\d+(?:\.\d+)?\s*%?/g,
    // 带单位的数值：4441 例、10.5 mg、37 ℃、12 个月、5 年、≤30%
    /\d+(?:\.\d+)?\s*(?:%|‰|℃|℉|mg|g|kg|mL|ml|L|μL|uL|cm|mm|μm|um|nm|mol|mmol|μmol|rpm|min|h|s|d|岁|例|项|篇|名|年|月|日|天|小时|分钟|秒|次|倍|个|组|条|株|型|级|分)/g,
    // 参考文献编号：[1,2]、[3-5]、［1］、[1-3,6]
    /[\[［]\s*\d+(?:\s*[-,，、]\s*\d+)*\s*[\]］]/g,
    // 图表编号：图 1、表2、Fig.1、Table 3、式(1)
    /(?:图|表|附图|附表|式)\s*[（(]?\s*\d+(?:[.\-–]\d+)*\s*[)）]?/g,
    /(?:\u89c1|\u5982)\s*(?:图|表)\s*\d+/g,
    /\b(?:Fig|Figure|Table|Tab|Eq|Equation)\.?\s*\d+(?:[.\-–]\d+)*/gi,
    // 温度 / 离心条件 / 常用实验参数：37 ℃、3000 r/min、4 ℃
    /\d{2,5}\s*(?:r\/min|g|×g|rpm)/g
  ];

  /** 希腊字母与数学符号：整体保留（翻译引擎常把它们转成英文单词） */
  const GREEK = 'αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΦΨΩ';
  const MATH_SYMBOLS = '±×÷≤≥≠≈≡∞√∑∏∫∂Δ∇°′″‰‰→←↑↓↔⇒⇔∈∉⊂⊃∪∩−';

  /** 常见"必须原样保留"的英文缩写（不翻译） */
  const KEEP_ABBR = [
    'DNA', 'RNA', 'mRNA', 'miRNA', 'PCR', 'qPCR', 'RT-PCR', 'ELISA', 'BMI', 'DFI', 'PR',
    'CI', 'OR', 'HR', 'RR', 'SD', 'SEM', 'IQR', 'ROC', 'AUC', 'SPSS', 'ANOVA', 'Kruskal-Wallis',
    'Mann-Whitney', 'Spearman', 'Pearson', 'Logistic', 'Cox', 'ICC', 'CV', 'WHO', 'IVF', 'ICSI',
    'ICD', 'CT', 'MRI', 'ECG', 'WBC', 'RBC', 'Hb', 'PLT', 'ALT', 'AST', 'Cr', 'BUN'
  ];

  /* ------------------------------------------------------------ 术语库索引 */

  /**
   * 建索引：源语言 → 按长度降序的术语数组（长词优先，避免"精子DNA"被"精子"抢先匹配）
   * @param {Array<{src, dst, lang, caseSensitive, note}>} terms
   */
  function buildIndex(terms) {
    const byLang = new Map();
    for (const t of (terms || [])) {
      if (!t || !t.src || !t.dst) continue;
      const lang = t.lang || 'auto';
      if (!byLang.has(lang)) byLang.set(lang, []);
      byLang.get(lang).push({
        src: String(t.src),
        dst: String(t.dst),
        caseSensitive: !!t.caseSensitive,
        note: t.note || ''
      });
    }
    for (const list of byLang.values()) list.sort((a, b) => b.src.length - a.src.length);
    return byLang;
  }

  /** 把术语表文本解析成条目（每行：源 = 目标，或 源<TAB>目标，或 源,目标） */
  function parseTerms(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;
      let parts = null;
      if (line.includes('=>')) parts = line.split('=>');
      else if (line.includes('=')) parts = line.split('=');
      else if (line.includes('\t')) parts = line.split('\t');
      else if (line.includes('|')) parts = line.split('|');
      else if (line.includes('，')) parts = line.split('，');
      else if (line.includes(',')) parts = line.split(',');
      if (!parts || parts.length < 2) continue;
      const src = parts[0].trim();
      const dst = parts.slice(1).join(line.includes(',') ? ',' : '=').trim();
      if (src && dst) out.push({ src: src, dst: dst });
    }
    return out;
  }

  /** 术语表 → 文本（导出） */
  function serializeTerms(terms) {
    return (terms || []).map(t => t.src + ' = ' + t.dst).join('\n');
  }

  /* ------------------------------------------------- 扫描：找出所有要保护的片段 */

  /**
   * 在文本里扫描"需要保护"的区间，返回 [{start, end, text, kind, dst?}]
   * kind: 'symbol'（原样保留） | 'term'（按术语库替换）
   */
  function scanSpans(text, terms, targetLang) {
    const s = String(text || '');
    const spans = [];
    const taken = new Array(s.length).fill(false);
    const termRanges = [];   // 术语占用的区间：里面的数字/缩写不再单独拆出来保护

    const claim = (start, end, kind, dst, label) => {
      if (start < 0 || end > s.length || end <= start) return false;
      for (let i = start; i < end; i++) if (taken[i]) return false;
      for (let i = start; i < end; i++) taken[i] = true;
      spans.push({ start: start, end: end, text: s.slice(start, end), kind: kind, dst: dst, label: label });
      if (kind === 'term') termRanges.push([start, end]);
      return true;
    };
    /** 该区间是否落在已认领的术语内部（避免把术语里的 DNA / 4441 例再拆开） */
    const insideTerm = (start, end) => termRanges.some(r => start >= r[0] && end <= r[1] && !(start === r[0] && end === r[1]));

    // 1) 用户术语库（最长优先）
    for (const term of (terms || [])) {
      const needle = term.src;
      if (!needle) continue;
      if (term.caseSensitive) {
        let idx = s.indexOf(needle);
        while (idx >= 0) {
          claim(idx, idx + needle.length, 'term', term.dst, needle);
          idx = s.indexOf(needle, idx + needle.length);
        }
      } else {
        const low = s.toLowerCase(), nl = needle.toLowerCase();
        let idx = low.indexOf(nl);
        while (idx >= 0) {
          claim(idx, idx + needle.length, 'term', term.dst, needle);
          idx = low.indexOf(nl, idx + needle.length);
        }
      }
    }

    // 2) 高价值符号模式
    for (const re of PROTECT_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s)) !== null) {
        if (!m[0]) { re.lastIndex++; continue; }
        if (!insideTerm(m.index, m.index + m[0].length)) {
          claim(m.index, m.index + m[0].length, 'symbol', null, m[0]);
        }
        if (re.lastIndex <= m.index) re.lastIndex = m.index + 1;
      }
    }

    // 3) 希腊字母 / 数学符号（单个字符）
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (GREEK.indexOf(ch) >= 0 || MATH_SYMBOLS.indexOf(ch) >= 0) {
        if (!insideTerm(i, i + 1)) claim(i, i + 1, 'symbol', null, ch);
      }
    }

    // 4) 常见缩写（整体保留）
    for (const abbr of KEEP_ABBR) {
      const re = new RegExp('(^|[^A-Za-z])(' + abbr.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + ')(?![A-Za-z])', 'g');
      let m;
      while ((m = re.exec(s)) !== null) {
        const start = m.index + m[1].length;
        if (!insideTerm(start, start + m[2].length)) claim(start, start + m[2].length, 'symbol', null, m[2]);
      }
    }

    return spans.sort((a, b) => a.start - b.start);
  }

  /* ------------------------------------------------------------ 保护 / 还原 */

  /**
   * 保护一段文本：把要保留的片段替换成占位符
   * @returns {{text, items}} items 供 restore 使用
   */
  function protect(text, opts) {
    opts = opts || {};
    const terms = opts.terms || [];
    const spans = scanSpans(text, terms, opts.targetLang);
    if (!spans.length) return { text: String(text || ''), items: [] };

    const items = [];
    let out = '';
    let cursor = 0;
    let pi = 0, ti = 0;
    for (const sp of spans) {
      out += text.slice(cursor, sp.start);
      const idx = sp.kind === 'term' ? ti++ : pi++;
      const prefix = sp.kind === 'term' ? TERM_PREFIX : PH_PREFIX;
      const ph = PH_OPEN + prefix + idx + PH_CLOSE;
      // 术语直接换成目标译文（= 强制术语一致），符号原样保留在项目里
      out += ph;
      items.push({ ph: ph, text: sp.kind === 'term' ? sp.dst : sp.text, kind: sp.kind, label: sp.label });
      cursor = sp.end;
    }
    out += text.slice(cursor);
    return { text: out, items: items };
  }

  /**
   * 还原占位符。容忍模型把 ⟦P0⟧ 写成 [P0]、【P0】等变形。
   * @returns {{text, missing}} missing = 没被还原（占位符丢失）的原文列表
   */
  function restore(text, items) {
    let out = String(text == null ? '' : text);
    const missing = [];
    for (const it of items) {
      const body = it.ph.slice(1, -1);          // 如 P0 / T1
      const loose = new RegExp('[\\[【(（]\\s*' + body + '\\s*[\\]】)）]', 'g');
      const found = out.indexOf(it.ph) >= 0 || loose.test(out);
      if (found) {
        out = out.split(it.ph).join(it.text);
        out = out.replace(new RegExp('[\\[【(（]\\s*' + body + '\\s*[\\]】)）]', 'g'), it.text);
      } else {
        missing.push(it.label || it.text);
      }
    }
    return { text: out, missing: missing };
  }

  /** 统计一段文本里会被保护多少个片段（用于界面提示，不改变文本） */
  function audit(text, terms) {
    const spans = scanSpans(text, terms || [], null);
    const byKind = { symbol: 0, term: 0 };
    for (const sp of spans) byKind[sp.kind]++;
    return { total: spans.length, symbol: byKind.symbol, term: byKind.term, spans: spans };
  }

  /** 还原后自检：符号类片段必须逐字出现（否则说明模型改动了它们） */
  function verifySymbols(text, items) {
    const bad = [];
    for (const it of items) {
      if (it.kind !== 'symbol') continue;
      if (String(text).indexOf(it.text) < 0) bad.push(it.text);
    }
    return bad;
  }

  return {
    PH_OPEN, PH_CLOSE, PH_PREFIX, TERM_PREFIX,
    PROTECT_PATTERNS, KEEP_ABBR, GREEK, MATH_SYMBOLS,
    ACADEMIC_TERMS_TEXT,
    buildIndex, parseTerms, serializeTerms, scanSpans, protect, restore, audit, verifySymbols
  };
});
