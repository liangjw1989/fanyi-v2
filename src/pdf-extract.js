/* ============================================================================
 * 灵译 · PDF 结构抽取 (pdf-extract.js)
 * ----------------------------------------------------------------------------
 * 不再把 PDF 压成一行行纯文本！而是还原出：
 *   · 分栏（单栏/双栏/通栏标题）与阅读顺序
 *   · 每个段落的字号、加粗、对齐、首行缩进
 *   · 表格（列数、单元格、合并）
 *   · 页码/页眉页脚过滤
 * 依赖 pdf.js（pdfjsLib）。
 * © 2026 灵译 LingYi · 个人使用免费，商业使用需授权（见 LICENSE）
 * ========================================================================== */
(function (root, factory) {
  const core = (typeof module === 'object' && module.exports) ? require('./core.js') : root.LingyiCore;
  const layout = (typeof module === 'object' && module.exports) ? require('./layout.js') : root.LingyiLayout;
  const mod = factory(core, layout);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.LingyiPdfExtract = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, layout) {
  'use strict';

  /* ------------------------------------------------------------ 字体样式推断 */

  function inferStyle(fontName, size, bodySize) {
    const f = String(fontName || '');
    const r = { size: Math.round(size * 10) / 10 };
    if (/bold|black|heavy|semibold|demibold|-bd\b|[,+]B(?![a-z])/i.test(f)) r.b = true;
    if (/italic|oblique|-it\b/i.test(f)) r.i = true;
    if (/mono|courier|consol|typewriter|menlo/i.test(f)) r.mono = true;
    if (/serif|times|georgia|song|ming|garamond|book/i.test(f) && !/sans/i.test(f)) r.serif = true;
    return r;
  }

  function fontsCompat(fontName) {
    // pdf.js 常用 FontName 形如 "ABCDEF+Times-Bold"，去掉子集前缀
    return String(fontName || '').replace(/^[A-Z]{6}\+/, '');
  }

  /**
   * 去掉"重复文字层"：不少 PDF（尤其是经过 OCR/二次排版的）会在同一位置放两层文字
   * （一层可见正文，一层不可见的检索层）。这里按位置聚类后保留信息量最大的那一层，
   * 否则会出现"中国优生X与I遗EY传，杂OU志YA"这种交错乱码。
   */
  function dedupeTextLayers(items) {
    if (items.length < 4) return items;
    const sorted = items.slice().sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));
    const used = new Array(sorted.length).fill(false);
    const out = [];
    const cjkCount = s => (String(s).match(/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/g) || []).length;
    for (let i = 0; i < sorted.length; i++) {
      if (used[i]) continue;
      const a = sorted[i];
      const group = [a];
      used[i] = true;
      const tol = Math.max(2.5, (a.size || 10) * 0.6);
      for (let j = i + 1; j < sorted.length; j++) {
        if (used[j]) continue;
        const b = sorted[j];
        if (b.y0 - a.y0 > tol) break;                       // 已越过同一行
        const xOverlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const union = Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0);
        const overlapping = xOverlap > 1 && union > 0 && xOverlap / union > 0.45;
        const nearLeft = Math.abs(a.x0 - b.x0) < Math.max(3, (a.size || 10) * 0.5);
        if (overlapping || nearLeft) { group.push(b); used[j] = true; }
      }
      if (group.length === 1) { out.push(a); continue; }
      group.sort((p, q) => {                                 // 同一位置多层：留信息量最大的
        const cq = cjkCount(q.str), cp = cjkCount(p.str);
        if (cq !== cp) return cq - cp;
        if (q.str.length !== p.str.length) return q.str.length - p.str.length;
        return (q.size || 0) - (p.size || 0);
      });
      out.push(group[0]);
    }
    return out.sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));
  }

  /* ---------------------------------------------------------- 单个片段的构造 */

  function makeItem(textContentItem, styles) {
    const tr = textContentItem.transform || [1, 0, 0, 1, 0, 0];
    const fontName = (styles && styles[textContentItem.fontName] && styles[textContentItem.fontName].fontFamily) || textContentItem.fontName || '';
    // 字号：优先用 transform 的缩放（pdf.js 习惯），回退到 height
    const scale = Math.hypot(tr[2], tr[3]) || Math.abs(tr[3]) || 1;
    const size = scale > 0.01 ? scale : (Math.abs(textContentItem.height) || 10);
    const h = textContentItem.height != null ? Math.abs(textContentItem.height) : size;
    // pdf.js 的 transform[5] 是"基线 y"，且 y 轴向上；统一翻成屏幕坐标（y 轴向下）
    const baseline = textContentItem.pageHeight != null ? (textContentItem.pageHeight - tr[5]) : tr[5];    // 宽度：pdf.js 的 item.width 已经包含了变换后的缩放
    let w = textContentItem.width;
    if (w == null || !isFinite(w)) w = size * 0.5 * String(textContentItem.str || '').length;
    return {
      str: textContentItem.str == null ? '' : String(textContentItem.str),
      x0: tr[4],
      y0: baseline - (h || size) * 0.25,
      x1: tr[4] + Math.abs(w),
      y1: baseline + (h || size) * 0.85,
      size: size,
      font: fontsCompat(fontName),
      hasEOL: !!textContentItem.hasEOL,
      dir: textContentItem.dir || 'ltr'
    };
  }

  /**
   * 坐标系归一化：有些 PDF 的正文在 Form XObject 中，带有额外的变换矩阵，
   * 抽出来的坐标会跑到页外。这里用"仿射拟合"把它映射回页面坐标。
   */
  function normalizePageCoords(items, pageW, pageH) {
    if (!items.length) return items;
    const xs = items.map(i => i.x0), ys = items.map(i => i.y0);
    const xr = [Math.min(...xs), Math.max(...xs)];
    const yr = [Math.min(...ys), Math.max(...ys)];
    const xSpan = xr[1] - xr[0], ySpan = yr[1] - yr[0];
    const outOfRange = xr[0] < -2 || yr[0] < -2 ||
      xr[1] > pageW * 1.05 || yr[1] > pageH * 1.05;
    const scaleMismatch = (xSpan > pageW * 1.1 && xSpan > 40) || (ySpan > pageH * 1.1 && ySpan > 40);
    if (!outOfRange && !scaleMismatch) return items;
    // 目标：左右留 6%，上下留 5%
    const tx0 = pageW * 0.06, tx1 = pageW * 0.94;
    const ty0 = pageH * 0.95, ty1 = pageH * 0.05;   // y 轴向下
    const sx = xSpan > 1 ? (tx1 - tx0) / xSpan : 1;
    const sy = ySpan > 1 ? (ty0 - ty1) / ySpan : 1;
    const s = Math.min(sx, sy);
    return items.map(it => {
      const x = tx0 + (it.x0 - xr[0]) * s;          // 新左边界
      const y = ty0 - (it.y0 - yr[0]) * s;          // 新基线（y 向下）
      const w = (it.x1 - it.x0) * s;
      const h = (it.y1 - it.y0) * s;
      return Object.assign({}, it, {
        x0: x, x1: x + w,
        y0: y - h * 0.65, y1: y + h * 0.35,
        size: it.size * s
      });
    });
  }

  /* ------------------------------------------------------------ 页眉页脚过滤 */

  /**
   * 跨页重复文字检测：学术 PDF 的页眉/页脚（期刊名、卷期页码、DOI、
   * "Downloaded from…"、Creative Commons 声明）会在多页重复出现。
   * 这是比"位置 + 字号"更可靠的判据，能抓出位置/字号都像正文的页脚。
   * @param {Array} pages [{ number, items }]
   * @param {number} minPages 至少出现在几页才算"重复"（默认 3）
   * @returns {Set<string>} 需要丢弃的规范化文本
   */
  function findRepeatedTexts(pages, minPages, o) {
    const min = minPages || 3;
    const band = (o && o.band != null) ? o.band : 0.15;
    if (!pages || pages.length < min) return new Set();
    const norm = t => String(t || '').replace(/\s+/g, ' ').replace(/\d+/g, '#').trim().toLowerCase();
    const counter = new Map();
    for (const pg of pages) {
      const H = pg.height || 842;
      const seen = new Set();                       // 同一页内只算一次
      /* 先把每页的文字项按行粗分：这里只关心"整行文本" */
      const byLine = new Map();
      for (const it of (pg.items || [])) {
        /* 【安全约束】只统计页面上/下"页边带"内的行。
         * 否则"每页都相同的正文"（重复表头、模板化句子）会被误删。 */
        if (!inBand(it, H, band)) continue;
        const key = Math.round(it.y0 / 2);
        if (!byLine.has(key)) byLine.set(key, []);
        byLine.get(key).push(it);
      }
      for (const arr of byLine.values()) {
        const lineText = arr.sort((a, b) => a.x0 - b.x0).map(i => i.str).join('');
        const k = norm(lineText);
        if (k.length < 6) continue;                 // 太短的不算（避免"1""2"误判）
        if (seen.has(k)) continue;
        seen.add(k);
        counter.set(k, (counter.get(k) || 0) + 1);
      }
    }
    const out = new Set();
    for (const [k, n] of counter) if (n >= min) out.add(k);
    return out;
  }

  /**
   * 页边区域过滤 + 跨页重复文字过滤。
   * 原实现只丢"上下 8.5% 且（字号偏小 或 纯数字）"，太保守：
   * 期刊的页脚（卷期页码、DOI、版权声明）常常字号与正文接近，会漏进正文。
   */
  function filterMargins(items, pageH, pageW, opts) {
    const o = opts || {};
    /* 返回结构保持向后兼容：调用方按 .items 使用 */
    if (items.length < 8) return { items: items, headerLine: null, footerLine: null, dropped: 0 };
    const sorted = items.slice().sort((a, b) => a.y0 - b.y0);
    const topBand = o.topBand || 0.10;              // 上边 10%
    const bottomBand = o.bottomBand || 0.10;        // 下边 10%
    const topItems = sorted.filter(it => it.y0 < pageH * topBand);
    const bottomItems = sorted.filter(it => it.y0 > pageH * (1 - bottomBand));
    const bodySizes = sorted.map(it => it.size).sort((a, b) => a - b);
    const med = bodySizes[Math.floor(bodySizes.length / 2)] || 10;

    const drop = new Set();
    /* 上/下区域内：字号明显小、纯数字、或极短（页码/页眉标记）→ 丢弃 */
    for (const it of topItems.concat(bottomItems)) {
      const t = String(it.str || '').trim();
      if (it.size <= med * 0.95) { drop.add(it); continue; }
      if (/^\d{1,4}$/.test(t)) { drop.add(it); continue; }
      if (t.length <= 2 && /^[\d\W]+$/.test(t)) { drop.add(it); continue; }
    }
    return {
      items: items.filter(it => !drop.has(it)),
      dropped: drop.size,
      medianSize: med
    };
  }

  /** 文字对象是否落在页面上/下页边带内（y 轴向下） */
  function inBand(it, pageH, band) {
    const y = it.y0;
    if (typeof y !== 'number') return false;
    return y < pageH * band || y > pageH * (1 - band);
  }

  /** 按跨页重复文字丢弃（在 filterMargins 之后调用，作为第二道网） */
  function dropRepeatedText(items, repeated, o) {
    if (!repeated || !repeated.size) return { items: items, dropped: 0 };
    const band = (o && o.band != null) ? o.band : 0.15;
    const H = (o && o.pageHeight) || 842;
    const norm = t => String(t || '').replace(/\s+/g, ' ').replace(/\d+/g, '#').trim().toLowerCase();
    /* 按行分组后整行匹配：整行的规范化文本命中"重复集合"才丢，
       且只丢页边带内的行（安全约束，见 findRepeatedTexts 注释） */
    const byLine = new Map();
    for (const it of items) {
      const key = Math.round(it.y0 / 2);
      if (!byLine.has(key)) byLine.set(key, []);
      byLine.get(key).push(it);
    }
    const drop = new Set();
    for (const arr of byLine.values()) {
      arr.sort((a, b) => a.x0 - b.x0);
      /* 只处理页边带内的行 */
      if (!inBand(arr[0], H, band)) continue;
      const lineText = arr.map(i => i.str).join('');
      const k = norm(lineText);
      if (k.length >= 6 && repeated.has(k)) for (const it of arr) drop.add(it);
    }
    return { items: items.filter(it => !drop.has(it)), dropped: drop.size };
  }

  /* -------------------------------------------------------------- 行 → 段落 */

  const PARA_END = /[。！？；.!?;:：]["'”’)\]]?$/;
  const CJK_CHAR = /[\u2E80-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;

  function linesToDocText(items) {
    return core.smartJoin(items.map(i => i.str));
  }

  /**
   * 把区域内的行合并成段落
   * @param {Array} lines layout.groupLines 的输出
   */
  function linesToParagraphs(lines) {
    const paras = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const text = core.normSpace(linesToDocText(ln.items));
      if (!text.trim()) continue;
      const leftEdge = Math.min(...ln.items.map(it => it.x0));
      const prev = i > 0 ? lines[i - 1] : null;
      const gap = prev ? (ln.y0 - prev.y1) : 0;
      const lineH = Math.max(1, ln.y1 - ln.y0);
      let newPara = false;
      if (!cur) newPara = true;
      else {
        // 竖向间距过大 → 新段落
        if (prev && gap > Math.max(lineH * 0.72, ln.size * 0.8)) newPara = true;
        // 上一行已句末 + 当前行有缩进 → 新段落
        if (prev) {
          const prevText = core.normSpace(linesToDocText(prev.items));
          const indent = leftEdge - Math.min(...prev.items.map(it => it.x0));
          if (PARA_END.test(prevText) && indent > ln.size * 0.6) newPara = true;
        }
        // 首行缩进（空两格）本身是段落起点
        if (leftEdge - cur.leftEdge > ln.size * 0.6) newPara = true;
        // 字号突变（标题→正文）→ 新段落
        if (Math.abs(ln.size - cur.size) > Math.max(1.2, cur.size * 0.12)) newPara = true;
      }
      if (newPara) {
        cur = { lines: [ln], leftEdge: leftEdge, rightEdge: Math.max(...ln.items.map(it => it.x1)), size: ln.size, text: text };
        paras.push(cur);
      } else {
        cur.lines.push(ln);
        cur.text = joinParagraph(cur.text, text);
        cur.size = Math.max(cur.size, ln.size);
        cur.rightEdge = Math.max(cur.rightEdge, Math.max(...ln.items.map(it => it.x1)));
      }
    }
    return paras;

    function joinParagraph(a, b) {
      return core.smartJoin([a, b]);
    }
  }

  /* -------------------------------------------------- 行块 → 表格（表格优先） */

  /** 表格标题行（"表 1 …" / "Table 1 …"）：合并碎片时遇到它就停下 */
  function isTableCaption(line) {
    const t = String((line && line.text) || '').trim();
    return /^(表|图|圖|Table|TABLE|Tab\.)\s*\d/.test(t);
  }

  /**
   * 能否把当前表格碎片并进上一个表格碎片。
   * 背景：PDF 里表格没有结构，只能靠坐标推断；原实现遇到"列数变化"就断开，
   * 于是一张 6 行的表会被切成 3 个"2 行"碎片（实测一篇论文 20 个表格里
   * 19 个都是 2 行碎片 + 1 个 39 行巨表）。这里做保守合并：
   *   · 两块必须紧挨着（中间没有正文行、没有表格标题行）
   *   · 列数相差不超过 2（4 列表格不会和正文段拼在一起）
   *   · 合并后总行数不超过上限
   * 目标：把"一张表被切碎"还原回来，又不把"两张真表"误粘。
   */
  function canMergeTable(prev, cur, lines) {
    if (!prev || !cur || !prev.table || !cur.table) return false;
    const pc = prev.table.colCount || 0, cc = cur.table.colCount || 0;
    if (!pc || !cc) return false;
    if (Math.abs(pc - cc) > 2) return false;
    const between = lines.slice(prev.endIndex, cur.startIndex);
    for (const ln of between) {
      if (!ln) continue;
      if (isTableCaption(ln)) return false;
      const txt = String(ln.text || '').trim();
      // 非空、又不像"零星数字/符号" → 视为正文，不合并
      if (txt && txt.length > 3 && !/^[\d\s.,%\-–—()]+$/.test(txt)) return false;
    }
    const prevRows = (prev.table.rows || []).length;
    const curRows = (cur.table.rows || []).length;
    if (prevRows + curRows > 120) return false;
    return true;
  }

  /** 拼接两个表格碎片（列数不同时按较宽的一侧保留） */
  function mergeTables(a, b) {
    return {
      rows: (a.rows || []).concat(b.rows || []),
      colCount: Math.max(a.colCount || 0, b.colCount || 0),
      quality: Math.min(a.quality == null ? 1 : a.quality, b.quality == null ? 1 : b.quality),
      merged: true
    };
  }

  /**
   * 在区域内找出连续的表格行，切开成表格块 / 段落块。
   * 相邻的表格碎片会按 canMergeTable 的规则合并回一张表。
   */
  function segmentTableAndText(lines) {
    const out = [];
    let lastTable = null;      // 最近一个表格段（可能被 text 段隔开，仍可尝试合并）
    let i = 0;
    while (i < lines.length) {
      let found = null;
      // 优先取"从 i 开始最长且成立"的表格
      for (let j = lines.length; j >= i + 2; j--) {
        const cand = lines.slice(i, j);
        const t = layout.detectTable(cand, { minCols: 2, minRows: 2 });
        if (t && t.quality >= 0.8 && t.colCount >= 2) { found = { t: t, lines: cand }; break; }
      }
      if (found) {
        const seg = {
          kind: 'table', table: found.t, lines: found.lines,
          startIndex: i, endIndex: i + found.lines.length
        };
        /* 尝试并入"上一个表格段"（中间可能夹着被单独判成 text 的
         * 数字行 / 空白行——它们不应当阻止合并，由 canMergeTable 判定）。 */
        const prev = lastTable;
        if (prev && prev.endIndex <= seg.startIndex && canMergeTable(prev, seg, lines)) {
          prev.table = mergeTables(prev.table, seg.table);
          prev.lines = prev.lines.concat(seg.lines);
          prev.endIndex = seg.endIndex;
          prev.mergedCount = (prev.mergedCount || 1) + 1;
        } else {
          out.push(seg);
          lastTable = seg;
        }
        i += found.lines.length;
        continue;
      }
      // 否则并入文本行
      if (out.length && out[out.length - 1].kind === 'text') out[out.length - 1].lines.push(lines[i]);
      else out.push({ kind: 'text', lines: [lines[i]] });
      i++;
    }
    return out;
  }

  /* ---------------------------------------------------------------- 主流程 */

  /**
   * @param {File|ArrayBuffer} file
   * @param {Object} opts { pdfjs, maxPages, fileName, onProgress }
   */
  async function extractPDF(file, opts) {
    opts = opts || {};
    const pdfjs = opts.pdfjs || (typeof root !== 'undefined' && root.pdfjsLib);
    if (!pdfjs) throw new Error('缺少 pdf.js 库，无法解析 PDF');

    const data = file instanceof ArrayBuffer ? new Uint8Array(file) : await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: data }).promise;
    const maxPages = Math.min(pdf.numPages, opts.maxPages || 200);

    const pages = [];
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      let items = textContent.items
        .filter(it => it && it.str !== undefined && String(it.str).length)
        .map(it => makeItem(it, textContent.styles));
      const filtered = filterMargins(items, viewport.height, viewport.width, {
        topBand: opts.topBand, bottomBand: opts.bottomBand
      });
      // 双重文字层去重是"有风险但有用"的启发式，默认关闭，可在调用时打开
      const deduped = opts.dedupeTextLayers ? dedupeTextLayers(filtered.items) : filtered.items;
      pages.push({
        number: p, width: viewport.width, height: viewport.height,
        items: normalizePageCoords(deduped, viewport.width, viewport.height),
        medianSize: filtered.medianSize,
        droppedByMargin: filtered.dropped || 0
      });
      if (opts.onProgress) opts.onProgress(p, maxPages);
    }

    /* ---- 第二道网：跨页重复文字（页眉/页脚/版权声明）----
     * 位置与字号都像正文的页脚（期刊名、卷期页码、DOI、CC 声明）靠
     * filterMargins 抓不到，但它们必然在多页重复出现，所以按"重复"丢弃。
     * 默认开启（opts.dropRepeatedLines !== false），可用 minRepeatPages 调整。 */
    let droppedRepeated = 0;
    if (opts.dropRepeatedLines !== false && pages.length >= 3) {
      const repeated = findRepeatedTexts(pages, opts.minRepeatPages || 3, { band: opts.repeatBand });
      if (repeated.size) {
        for (const pg of pages) {
          const r = dropRepeatedText(pg.items, repeated, { pageHeight: pg.height, band: opts.repeatBand });
          pg.items = r.items;
          droppedRepeated += r.dropped;
        }
      }
    }

    // 正文字号 = 全篇字符数加权的中位数
    const sizeHist = new Map();
    for (const pg of pages) for (const it of pg.items) {
      const key = Math.round(it.size * 2) / 2;
      sizeHist.set(key, (sizeHist.get(key) || 0) + it.str.length);
    }
    const bodySize = (() => {
      let best = 10.5, bestN = -1;
      for (const [s, n] of sizeHist) {
        // 只考虑 7~20pt 之间的字号，避免被大标题或小注脚带偏
        if (s < 7 || s > 20) continue;
        if (n > bestN) { bestN = n; best = s; }
      }
      return best;
    })();

    const assets = [];
    const blocks = [];
    /* 每页的"版式诊断信息"：行聚类结果与分栏推断。
     * 这是定位"阅读顺序错乱/句子被截断"问题的关键证据，
     * 之前没有保留，导致诊断报告里 pages 为空、无法定位问题。 */
    const pageMeta = [];
    pages.forEach(function (pg, pageIdx) {
      if (!pg.items.length) {
        pageMeta.push({ number: pg.number, width: pg.width, height: pg.height, columns: [], lines: [], lineCount: 0 });
        return;
      }
      const regions = layout.analyzePage(pg.items, {});
      /* 汇总本页所有区域的行与分栏，供诊断使用 */
      const allLines = [];
      (regions || []).forEach(r => {
        (r.lines || []).forEach(ln => {
          allLines.push({
            x: Math.round((ln.x != null ? ln.x : (ln.leftEdge || 0)) * 10) / 10,
            y: Math.round((ln.y != null ? ln.y : 0) * 10) / 10,
            size: ln.size,
            text: String(ln.text || (ln.items ? ln.items.map(i => i.str).join('') : '')).slice(0, 400),
            region: { x0: Math.round(r.box.x0), x1: Math.round(r.box.x1), spanning: !!r.spanning }
          });
        });
      });
      pageMeta.push({
        number: pg.number,
        width: pg.width,
        height: pg.height,
        columns: (regions || []).map(r => ({
          x: Math.round(r.box.x0),
          x1: Math.round(r.box.x1),
          spanning: !!r.spanning,
          lineCount: (r.lines || []).length
        })),
        lines: allLines,
        lineCount: allLines.length
      });
      // 同一"栏带"内的区域（左栏/右栏）合并成一个分栏容器，输出时才能保住双栏版式
      let pendingBand = null;
      const flushBand = () => {
        if (!pendingBand) return;
        if (pendingBand.groups.length === 1) blocks.push(...pendingBand.groups[0].blocks);
        else blocks.push({ id: core.uid('c'), type: 'container', columns: pendingBand.groups });
        pendingBand = null;
      };
      regions.forEach(function (region) {
        const regionBlocks = [];
        const segs = segmentTableAndText(region.lines);
        for (const seg of segs) {
          if (seg.kind === 'table') {
            const block = tableToIR(seg.table, bodySize);
            if (block) regionBlocks.push(block);
            continue;
          }
          const paras = linesToParagraphs(seg.lines);
          for (const para of paras) {
            const b = paragraphToIR(para, bodySize, region);
            if (b) regionBlocks.push(b);
          }
        }
        if (!regionBlocks.length) return;
        const isWide = region.spanning || (region.box.x1 - region.box.x0) > pg.width * 0.82;
        if (isWide) {
          flushBand();
          blocks.push(...regionBlocks);                 // 通栏内容直接平铺
          return;
        }
        if (!pendingBand) pendingBand = { groups: [] };
        pendingBand.groups.push({ width: Math.round((region.box.x1 - region.box.x0) * 10) / 10, blocks: regionBlocks });
      });
      flushBand();
      // 页与页之间保留分页（保证打印/导出后分页位置与原 PDF 一致）
      if (pageIdx < pages.length - 1 && blocks.length) {
        blocks.push({ id: core.uid('b'), type: 'pagebreak' });
      }
    });

    const ir = core.newIR({
      source: 'pdf',
      fileName: opts.fileName || '',
      page: {
        width: pages[0] ? Math.round(pages[0].width * 100) / 100 : 595.28,
        height: pages[0] ? Math.round(pages[0].height * 100) / 100 : 841.89,
        margin: estimateMargins(pages)
      },
      assets: assets
    });
    ir.blocks = blocks;
    ir.pages = pageMeta;                 // 版式诊断用：每页的行与分栏
    while (ir.blocks.length && ir.blocks[ir.blocks.length - 1].type === 'pagebreak') ir.blocks.pop();
    ir.bodySize = bodySize;
    ir.fontSizes = [...new Set(pages.flatMap(p => p.items.map(i => Math.round(i.size * 2) / 2)))].sort((a, b) => b - a);
    // 标题层级判定（与 Word 路径共用同一套规则）
    core.applyHeadingLevels(ir, {});
    delete ir.messages;
    return ir;
  }

  function regionIndex(regions, region) {
    const i = regions.indexOf(region);
    return i < 0 ? 0 : i;
  }

  function estimateMargins(pages) {
    const lefts = [], rights = [], tops = [], bottoms = [], gaps = [];
    for (const pg of pages) {
      for (const it of pg.items) {
        lefts.push(it.x0); rights.push(pg.width - it.x1);
        tops.push(it.y0); bottoms.push(pg.height - it.y1);
      }
      // 版面上下的大块留白比"5% 分位"更能代表真实页边距
      const lines = layout.groupLines(pg.items);
      const sizes = lines.map(l => l.size || 10).sort((a, b) => a - b);
      const medSize = sizes[Math.floor(sizes.length / 2)] || 10;
      for (let i = 1; i < lines.length; i++) {
        const g = lines[i].y0 - lines[i - 1].y1;
        if (g > medSize * 2.2) gaps.push({ gap: g, after: lines[i - 1].y1, before: lines[i].y0 });
      }
    }
    const q = (arr, p) => {
      if (!arr.length) return 56.7;
      const a = arr.slice().sort((x, y) => x - y);
      return a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)))];
    };
    // 取最大的纵向留白作为页边距（页面最上方/最下方）
    let top = q(tops, 0.05), bottom = q(bottoms, 0.05);
    if (gaps.length) {
      gaps.sort((a, b) => b.gap - a.gap);
      const g = gaps[0];
      top = Math.min(top, g.after);
      // 底部留白
      const bottomsFromGap = pages.map(pg => pg.height - g.before);
      bottom = Math.min(bottom, Math.min(...bottomsFromGap));
    }
    const clamp = v => Math.max(18, Math.min(140, Math.round(v * 10) / 10));
    return [clamp(q(lefts, 0.05)), clamp(top), clamp(q(rights, 0.05)), clamp(bottom)];
  }

  /**
   * 表格区域 → IR 表格块
   */
  function tableToIR(t, bodySize) {
    if (!t || !t.grid || !t.grid.length) return null;
    const rows = t.grid.map(row => row.map(cell => {
      if (!cell) return { text: '', runs: [], colspan: 1, rowspan: 1 };
      const items = cell.items.slice().sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));
      const text = core.smartJoin(items.map(i => i.str)).trim();
      const size = items.length ? Math.round(items[0].size * 10) / 10 : null;
      const bold = items.length ? items.filter(i => /bold|black|heavy|semibold/i.test(i.font)).length > items.length / 2 : false;
      const numeric = /^[\d.,%±<>≤≥~\-–—\s()]+$/.test(text);
      const runs = [{ t: text }];
      if (size) runs[0].size = size;
      if (bold) runs[0].b = true;
      return {
        text: text, runs: runs, colspan: 1, rowspan: 1,
        size: size,
        align: numeric ? 'center' : null
      };
    }));
    return {
      id: core.uid('t'), type: 'table', rows: rows,
      headerRows: 1,
      source: 'pdf', columnCount: t.colCount
    };
  }

  /**
   * 段落 → IR 段落块（保留字号、加粗、缩进、对齐）
   */
  function paragraphToIR(para, bodySize, region) {
    const allItems = para.lines.flatMap(l => l.items);
    if (!allItems.length) return null;
    const text = core.normSpace(para.text);
    if (!text.trim()) return null;

    const sizes = allItems.map(i => i.size).sort((a, b) => a - b);
    const size = Math.round(sizes[Math.floor(sizes.length / 2)] * 10) / 10;
    const boldCount = allItems.filter(i => /bold|black|heavy|semibold|demibold/i.test(i.font)).length;
    const bold = boldCount > allItems.length * 0.6;
    const mono = allItems.filter(i => /mono|courier|consol/i.test(i.font)).length > allItems.length * 0.6;

    // 对齐推断：比较左右边界与区域边界
    const rBox = region ? region.box : layout.unionBox(allItems);
    const leftGap = Math.min(...allItems.map(i => i.x0)) - rBox.x0;
    const rightGap = rBox.x1 - Math.max(...allItems.map(i => i.x1));
    const lineWidths = para.lines.map(l => Math.max(...l.items.map(i => i.x1)) - Math.min(...l.items.map(i => i.x0)));
    const avgW = lineWidths.reduce((a, b) => a + b, 0) / Math.max(1, lineWidths.length);
    const regionW = rBox.x1 - rBox.x0;
    let align = null;
    if (para.lines.length === 1 && avgW < regionW * 0.72) {
      if (Math.abs(leftGap - rightGap) < Math.max(8, regionW * 0.08)) align = 'center';
      else if (rightGap < leftGap * 0.4) align = 'right';
    } else if (para.lines.length > 1) {
      const rights = para.lines.map(l => Math.max(...l.items.map(i => i.x1)));
      const spread = Math.max(...rights) - Math.min(...rights);
      if (spread < size * 1.2 && avgW > regionW * 0.8) align = 'justify';
    }

    // 首行缩进
    let indent = null;
    if (para.lines.length > 1) {
      const first = para.lines[0], rest = para.lines.slice(1);
      const fLeft = Math.min(...first.items.map(i => i.x0));
      const rLeft = Math.min(...rest.flatMap(l => l.items.map(i => i.x0)));
      const d = fLeft - rLeft;
      if (d > size * 0.5 && d < size * 4) indent = Math.round(d * 10) / 10;
    } else {
      const d = Math.min(...allItems.map(i => i.x0)) - rBox.x0;
      if (d > size * 0.5 && d < size * 4) indent = Math.round(d * 10) / 10;
    }

    // 行距估算
    let lineHeight = null;
    if (para.lines.length > 1) {
      const baselines = para.lines.map(l => l.cy);
      const diffs = [];
      for (let i = 1; i < baselines.length; i++) diffs.push(baselines[i] - baselines[i - 1]);
      diffs.sort((a, b) => a - b);
      const med = diffs[Math.floor(diffs.length / 2)];
      if (med && size) lineHeight = Math.round((med / size) * 100) / 100;
    }

    const runs = [];
    // 保留文字内部的样式差异（粗体词、斜体词）
    for (const item of allItems) {
      const st = inferStyle(item.font, item.size, bodySize);
      const t = item.str;
      if (!t) continue;
      const last = runs[runs.length - 1];
      const sameStyle = last && !!last.b === !!st.b && !!last.i === !!st.i &&
        Math.abs((last.size || size) - (st.size || size)) < 0.3;
      if (sameStyle) last.t = core.smartJoin([last.t, t]);
      else runs.push(Object.assign({ t: t }, st, { size: st.size }));
    }
    // 合并后统一字号：与中位字号差异很小的直接用中位字号，减少噪声
    for (const r of runs) if (r.size && Math.abs(r.size - size) < 0.4) r.size = size;

    return {
      id: core.uid('b'),
      type: 'paragraph',
      runs: runs.length ? runs : [{ t: text, size: size }],
      size: size,
      bold: bold,
      mono: mono || undefined,
      align: align,
      indent: indent,
      lineHeight: lineHeight,
      source: 'pdf',
      __para: true
    };
  }

  return {
    extractPDF, makeItem, filterMargins, findRepeatedTexts, dropRepeatedText, linesToParagraphs, segmentTableAndText,
    tableToIR, paragraphToIR, inferStyle, fontsCompat, normalizePageCoords,
    estimateMargins, dedupeTextLayers
  };
});
