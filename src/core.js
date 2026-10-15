/* ============================================================================
 * 灵译 · 核心层 (core.js)
 * ----------------------------------------------------------------------------
 * 设计原则：翻译不重建排版，而是"在原有版式骨架上替换文字"。
 *   1) 抽取：把原文解析成结构化中间表示 IR（段落/标题/表格/图片 + 字号/对齐/缩进）
 *   2) 翻译：只翻译"文本片段"，用哨兵标记保护分段，绝不重排结构
 *   3) 回填：按 IR 骨架生成 PDF/DOCX/HTML，字号、对齐、缩进、表格列数与原文件一致
 * © 2026 灵译 LingYi · 个人使用免费，商业使用需授权（见 LICENSE）
 * ========================================================================== */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.LingyiCore = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '2.0.0';

  /* ---------------------------------------------------------------- 文本工具 */

  const CJK = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/;

  function hasCJK(s) { return CJK.test(s || ''); }

  /** 合并 PDF/HTML 抽取出来的碎片文本，避免中英文之间被硬塞空格 */
  function smartJoin(parts) {
    let out = '';
    for (const raw of parts) {
      const p = raw == null ? '' : String(raw);
      if (!p) continue;
      if (!out) { out = p; continue; }
      const a = out[out.length - 1], b = p[0];
      if (CJK.test(a) || CJK.test(b)) out += p;          // 中文之间不留空格
      else if (/[\s\-–—/(]$/.test(a) || /^[\s,.;:!?%)]/.test(b)) out += p;
      else out += ' ' + p;
    }
    return out;
  }

  /** 归一化空白：折叠多余空格，去掉零宽字符 */
  function normSpace(s) {
    return String(s == null ? '' : s)
      .replace(/\u200b|\ufeff/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\u00a0/g, ' ');
  }

  /** 段落文字：把 run 数组拼成纯文本 */
  function runsToText(runs) {
    if (!runs) return '';
    return runs.map(r => (typeof r === 'string' ? r : r.t || r.o || '')).join('');
  }

  function charCount(str) { return (str || '').length; }

  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  function uid(prefix) {
    uid._n = (uid._n || 0) + 1;
    return (prefix || 'id') + '_' + uid._n.toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  /* ------------------------------------------------------- IR 构造与遍历工具 */

  function newIR(meta) {
    return {
      version: VERSION,
      source: (meta && meta.source) || 'unknown',
      meta: Object.assign({
        fileName: '', title: '', author: '', subject: '', keywords: '', creator: ''
      }, (meta && meta.meta) || {}),
      page: Object.assign({
        // 默认 A4，单位 pt（与 pdfmake 一致）
        width: 595.28, height: 841.89,
        margin: [56.7, 56.7, 56.7, 56.7] // 与 Word 默认 2cm 一致
      }, (meta && meta.page) || {}),
      assets: (meta && meta.assets) || [],   // [{id, dataUrl, w, h}]
      styles: (meta && meta.styles) || {},   // 样式表：normal / h1 / h2 / caption ...
      blocks: (meta && meta.blocks) || []
    };
  }

  /**
   * 遍历 IR 中所有"可翻译文本单元"，回调 (unit, ctx)
   * unit = { id, text, kind, ref }，ref 指向 IR 中真实节点，供回填
   */
  function eachTextUnit(ir, visit) {
    const out = [];
    function para(block, kind) {
      if (!block.runs || !block.runs.length) return;
      // 整个段落作为一个翻译单元，保留 run 级样式，回填时按 run 切分
      const unit = {
        id: uid('p'),
        kind: kind || 'para',
        blockId: block.id,
        text: runsToText(block.runs),
        runs: block.runs.map(r => ({ t: r.t, b: r.b, i: r.i, u: r.u, sup: r.sup, sub: r.sub, size: r.size, color: r.color, font: r.font }))
      };
      block.unitId = unit.id;
      out.push(unit);
      if (visit) visit(unit, { block: block, ir: ir });
      return unit;
    }

    for (const b of ir.blocks || []) {
      if (b.type === 'table') {
        (b.rows || []).forEach((row, ri) => row.forEach((cell, ci) => {
          const cellRef = { tableId: b.id, row: ri, col: ci };
          if (cell.blocks && cell.blocks.length) {
            cell.blocks.forEach(cb => {
              if (cb.type === 'image') { imageUnit(cb, cellRef); return; }
              para(cb, 'cell');
            });
          } else if (cell.text) {
            const unit = { id: uid('c'), kind: 'cell', tableId: b.id, row: ri, col: ci, text: cell.text, runs: cell.runs };
            cell.unitId = unit.id;
            out.push(unit);
            if (visit) visit(unit, { cell: cell, table: b, ir: ir });
          }
        }));
      } else if (b.type === 'image') {
        imageUnit(b, null);
      } else if (b.type === 'container') {
        // 分栏容器：递归处理其中的分栏（保持每个分栏内部的独立翻译单元）
        for (const group of b.columns || []) {
          for (const cb of group.blocks || []) {
            if (cb.type === 'table') {
              (cb.rows || []).forEach((row, ri) => row.forEach((cell, ci) => {
                if (cell.blocks && cell.blocks.length) {
                  cell.blocks.forEach(x => para(x, 'cell'));
                } else if (cell.text) {
                  const unit = { id: uid('c'), kind: 'cell', tableId: cb.id, row: ri, col: ci, text: cell.text, runs: cell.runs };
                  cell.unitId = unit.id;
                  out.push(unit);
                  if (visit) visit(unit, { cell: cell, table: cb, ir: ir });
                }
              }));
            } else if (cb.type === 'image') {
              imageUnit(cb, null);
            } else {
              para(cb, 'para');
            }
          }
        }
      } else if (b.type === 'code') {
        /* 代码块不翻译 */
      } else {
        para(b, b.type === 'heading' ? 'heading' : 'para');
      }
    }

    function imageUnit(b, cellRef) {
      // 图片说明文字（图 1 ...）可翻译；OCR 文本单独处理
      if (b.caption) {
        const unit = { id: uid('cap'), kind: 'caption', blockId: b.id, text: b.caption, runs: [{ t: b.caption }] };
        b.captionUnitId = unit.id;
        out.push(unit);
        if (visit) visit(unit, { block: b, ir: ir });
      }
    }

    return out;
  }

  /** 按 id 找到翻译单元（用于回填） */
  function applyTranslation(ir, unit, translated) {
    const text = translated == null ? unit.text : translated;
    if (unit.kind === 'cell') {
      for (const b of ir.blocks) {
        if (b.type !== 'table' || b.id !== unit.tableId) continue;
        const cell = b.rows[unit.row][unit.col];
        cell.o = cell.text;
        cell.text = text;
        cell.translated = true;
        return true;
      }
      return false;
    }
    if (unit.kind === 'caption') {
      const b = findBlock(ir, unit.blockId);
      if (!b) return false;
      b.captionO = b.caption; b.caption = text; b.captionTranslated = true;
      return true;
    }
    const b = findBlock(ir, unit.blockId);
    if (!b) return false;
    b.o = runsToText(b.runs);
    b.runs = redistributeRuns(b.runs, text);
    b.translated = true;
    return true;
  }

  function findBlock(ir, id) {
    for (const b of ir.blocks) {
      if (b.id === id) return b;
      if (b.type === 'container') {
        for (const g of b.columns || []) for (const cb of g.blocks || []) {
          if (cb.id === id) return cb;
          if (cb.type === 'table' && cb.rows) {
            for (const row of cb.rows) for (const cell of row) {
              if (cell.blocks) for (const x of cell.blocks) if (x.id === id) return x;
            }
          }
        }
        continue;
      }
      if (b.type === 'table' && b.rows) {
        for (const row of b.rows) for (const cell of row) {
          if (cell.blocks) for (const cb of cell.blocks) if (cb.id === id) return cb;
        }
      }
    }
    return null;
  }

  /**
   * 把翻译后的整段文字重新分配到原有 run 上，保持粗体/斜体/上下标等行内样式。
   * 策略：按原 run 字符长度比例切分译文；只有一个 run 时直接整体替换。
   * 对"标签+内容"型段落（如【摘要】xxx）尽量让标签样式不变。
   */
  function redistributeRuns(runs, newText) {
    if (!runs || !runs.length) return [{ t: newText || '' }];
    if (runs.length === 1) return [Object.assign({}, runs[0], { t: newText || '' })];

    const weights = runs.map(r => Math.max(1, (r.t || '').replace(/\s/g, '').length));
    const total = weights.reduce((a, b) => a + b, 0);
    const text = newText || '';
    const out = [];
    let pos = 0;
    for (let i = 0; i < runs.length; i++) {
      let take;
      if (i === runs.length - 1) take = text.length - pos;
      else take = Math.round(text.length * weights[i] / total);
      take = Math.max(0, Math.min(take, text.length - pos));
      out.push(Object.assign({}, runs[i], { t: text.substr(pos, take) }));
      pos += take;
    }
    if (pos < text.length) out[out.length - 1].t += text.slice(pos);
    return out;
  }

  /* --------------------------------------------------------- 翻译分段与批处理 */

  const SEG_OPEN = '\u27e6';   // ⟦
  const SEG_CLOSE = '\u27e7';  // ⟧

  function segToken(n) { return SEG_OPEN + n + SEG_CLOSE; }

  /**
   * 把翻译单元分组成批次。每批大小受 maxChars 限制。
   * 每个片段用哨兵标记包裹，保证结构在翻译后仍可还原。
   */
  function buildBatches(units, maxChars) {
    maxChars = maxChars || 2800;
    const batches = [];
    let cur = { items: [], size: 0, text: '' };
    for (const u of units) {
      const piece = segToken(batches.length + cur.items.length) + '\n' + u.text + '\n' + segToken(batches.length + cur.items.length) + '\n';
      // 单个超长片段：独占一批并做切分
      if (u.text.length > maxChars) {
        if (cur.items.length) { batches.push(cur); cur = { items: [], size: 0, text: '' }; }
        batches.push({ items: [u], size: u.text.length, text: segToken(0) + '\n' + u.text + '\n' + segToken(0) + '\n', oversized: true, baseIndex: 0 });
        continue;
      }
      if (cur.size + piece.length > maxChars && cur.items.length) {
        batches.push(cur);
        cur = { items: [], size: 0, text: '' };
      }
      const idx = cur.items.length;
      cur.items.push(u);
      cur.size += piece.length;
      cur.text += segToken(idx) + '\n' + u.text + '\n' + segToken(idx) + '\n';
      u._batchIndex = idx;
    }
    if (cur.items.length) batches.push(cur);
    return batches;
  }

  /** 从译文里解析出各片段（容忍标记变形/丢失） */
  function parseSegments(translated, count) {
    const res = new Array(count).fill(null);
    if (!translated) return res;

    // 1) 标准标记
    const tokens = [];
    const re = new RegExp(SEG_OPEN + '\\s*(\\d+)\\s*' + SEG_CLOSE, 'g');
    let m;
    while ((m = re.exec(translated)) !== null) tokens.push({ n: parseInt(m[1], 10), start: m.index, end: re.lastIndex });
    // 2) 退化标记（模型把 ⟦⟧ 换成别的括号，或加了空格）
    if (tokens.length < count) {
      const re2 = /[\[【(（]\s*(\d{1,3})\s*[\]】)）]/g;
      let m2, cand = [];
      while ((m2 = re2.exec(translated)) !== null) cand.push({ n: parseInt(m2[1], 10), start: m2.index, end: re2.lastIndex });
      // 只接受形如 0,1,2... 递增且数量足够的候选，避免把正文里的 [1] 之类误当标记
      const seq = []; let expect = 0;
      for (const c of cand) { if (c.n === expect) { seq.push(c); expect++; } }
      if (seq.length >= 2 && seq.length >= count - 1) return sliceTokens(translated, seq, count);
    }
    return sliceTokens(translated, tokens, count);
  }

  function sliceTokens(translated, tokens, count) {
    const res = new Array(count).fill(null);
    if (!tokens.length) return res;
    // 可能同一编号出现两次（开/闭标记），取"第一个"作为起点
    const firstSeen = new Map();
    for (const tk of tokens) if (!firstSeen.has(tk.n)) firstSeen.set(tk.n, tk);
    const ordered = [...firstSeen.values()].sort((a, b) => a.start - b.start);
    for (let i = 0; i < ordered.length; i++) {
      const start = ordered[i].end;
      const end = i + 1 < ordered.length ? ordered[i + 1].start : translated.length;
      const body = translated.slice(start, end).replace(new RegExp(SEG_OPEN + '\\s*\\d+\\s*' + SEG_CLOSE, 'g'), '').trim();
      if (ordered[i].n < count) res[ordered[i].n] = body;
    }
    return res;
  }

  /* ---------------------------------------------------------------- 通用工具 */

  /** 用于给后端提示的保护规则（翻译时不要动这些东西） */
  const PROTECT_RULES = [
    '保留所有 ⟦数字⟧ 形式的标记，数量、顺序必须与原文完全一致，不能增删、不能翻译标记本身。',
    '保留数字、单位、公式、参考文献编号（如 [1,2]）、图表编号（图1/表2）原样。',
    '保持每个片段与原文一一对应，不要合并或拆分片段，不要输出多余的解释。',
    '保留原文中的换行结构。'
  ];

  function splitParagraphs(text) {
    return String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  }

  function isProbablyHeading(line) {
    const s = (line || '').trim();
    if (!s || s.length > 60) return false;
    if (/^\d+(\.\d+)*[\s、.]/.test(s)) return true;
    if (/^(第[一二三四五六七八九十]+[章节部分]|摘\s*要|Abstract|关键词|参考文献|References|引\s*言|结\s*论|讨论|材料与方法)/i.test(s)) return true;
    if (/^#{1,6}\s/.test(s)) return true;
    return false;
  }

  /* ------------------------------------------------------- 标题层级统一判定 */

  /**
   * 判定一个段落块是不是标题，并给出层级 1..4（0 = 不是标题）。
   * 中英文论文的常见形态：编号式（1 / 1.1 / 一、）、关键词式（摘要/引言/参考文献）、
   * 字号放大式、加粗式。
   * @param {Object} b 段落块 {type,runs,size,bold,align}
   * @param {Object} env {bodySize, sizes:降序字号数组, firstBlocks:是否文档开头}
   */
  function classifyHeading(b, env) {
    env = env || {};
    const body = env.bodySize || 10.5;
    const sizes = env.sizes || [];
    const text = runsToText(b.runs || []).trim();
    if (!text || text.length > 90) return 0;
    if (/[。；;]$/.test(text)) return 0;
    if (/^[\[（(]?(图|表|Fig|Table)/i.test(text)) return 0;      // 图表题另处理

    const size = b.size || body;
    const boldLike = !!b.bold;
    const centered = (b.align || '') === 'center';
    const numMatch = /^(\d+(?:\.\d+)*)\s*[、.．]?\s+\S/.exec(text) || /^(\d+(?:\.\d+)*)[、.．]\s*\S/.exec(text);
    const cnNum = /^[一二三四五六七八九十]+[、.．]\s*\S/.test(text);
    const keyword = /^(摘\s*要|Abstract|摘　要|关键词|Key\s*words?|引\s*言|前\s*言|结\s*论|讨\s*论|参考文献|References|致\s*谢|材料与方法|对象与方法|统计学方法|资料与方法|结果|方法)/i.test(text);
    const afterNum = numMatch ? text.slice(numMatch[0].length) : text.replace(/^[一二三四五六七八九十]+[、.．]\s*/, '');
    const looksLikeHeadingTail = afterNum.length <= 28;
    const cnHeading = cnNum && afterNum.length <= 28;

    let level = 0;
    if (size > body + 1.5) level = Math.max(1, sizes.indexOf(size) + 1);
    if (boldLike && text.length <= 60 &&
        ((numMatch && looksLikeHeadingTail) || cnHeading || keyword || size >= body + 0.4)) {
      const byNum = numMatch ? Math.min(4, numMatch[1].split('.').length) : (cnHeading ? 1 : 2);
      level = Math.max(level, numMatch || cnHeading ? byNum : 2);
    }
    if (/[。；;]/.test(text) && text.length > 30) level = 0;      // 长句不是标题
    if (/(参考文献|References)/i.test(text) && text.length < 24) level = 1;
    else if (/(结\s*论|讨\s*论|致\s*谢)/i.test(text) && text.length < 24 && level > 2) level = 2;
    return Math.min(4, Math.max(0, level));
  }

  /** 把 IR 里的段落块批量标记为 heading（就地修改，含分栏容器内部） */
  function applyHeadingLevels(ir, opts) {
    opts = opts || {};
    const all = [];
    (function walk(bs) {
      for (const b of bs) {
        if (b.type === 'container') { (b.columns || []).forEach(g => walk(g.blocks || [])); continue; }
        all.push(b);
      }
    })(ir.blocks || []);
    const body = ir.bodySize || 10.5;
    const sizes = (ir.fontSizes && ir.fontSizes.length ? ir.fontSizes : [...new Set(
      all.filter(b => b.type === 'paragraph' && b.size).map(b => b.size)
    )]).slice().sort((a, b) => b - a);
    const maxSize = sizes.length ? sizes[0] : body;
    let firstSeen = false;
    let seenBlocks = 0;
    const isBoldBlock = b => !!b.bold || (b.runs || []).some(r => r.b);
    for (const b of all) {
      if (b.type !== 'paragraph') { seenBlocks++; continue; }
      const level = classifyHeading(b, { bodySize: body, sizes: sizes });
      if (level > 0) {
        b.type = 'heading';
        b.level = level;
        const text = runsToText(b.runs);
        // 文档最开头、字号最大、居中加粗 → 主标题
        if (!firstSeen && b.align === 'center' && isBoldBlock(b) && (b.size || body) >= maxSize - 0.2 &&
            text.length > 3 && text.length <= 90 && seenBlocks < 3) {
          b.level = 1;
          firstSeen = true;
        }
      }
      seenBlocks++;
    }
    return ir;
  }

  return {
    VERSION, CJK, hasCJK, smartJoin, normSpace, runsToText, charCount, deepClone, uid,
    newIR, eachTextUnit, applyTranslation, redistributeRuns, findBlock,
    SEG_OPEN, SEG_CLOSE, segToken, buildBatches, parseSegments, PROTECT_RULES,
    splitParagraphs, isProbablyHeading, classifyHeading, applyHeadingLevels
  };
});
