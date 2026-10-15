/* ============================================================================
 * 灵译 · DOCX / DOC / HTML 结构抽取 (docx-extract.js)
 * ----------------------------------------------------------------------------
 * 不把 Word 压成纯文本！而是解析成带层级、对齐、字号、缩进、表格、图片的 IR。
 * 依赖 mammoth 把 docx 转成语义化 HTML，再用本文件内置的轻量 DOM 解析成 IR。
 * 同时支持直接把 .html/.htm 文件解析成同一套 IR。
 * © 2026 灵译 LingYi · 个人使用免费，商业使用需授权（见 LICENSE）
 * ========================================================================== */
(function (root, factory) {
  const core = (typeof module === 'object' && module.exports) ? require('./core.js') : root.LingyiCore;
  const mod = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.LingyiDocx = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  /* ======================================================================
   * 一、轻量 HTML 解析器（容错、无依赖）
   * ====================================================================*/

  const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'source', 'wbr', 'area', 'base']);

  function decodeEntities(s) {
    if (!s || s.indexOf('&') < 0) return s;
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return String.fromCodePoint(code); } catch (_) { return m; }
      }
      const named = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
        ldquo: '\u201c', rdquo: '\u201d', lsquo: '\u2018', rsquo: '\u2019',
        mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', times: '\u00d7',
        middot: '\u00b7', deg: '\u00b0', plusmn: '\u00b1', le: '\u2264', ge: '\u2265',
        alpha: '\u03b1', beta: '\u03b2', gamma: '\u03b3', mu: '\u03bc', Delta: '\u0394'
      };
      return named[e] !== undefined ? named[e] : m;
    });
  }

  function parseAttrs(str) {
    const attrs = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))|([a-zA-Z_:][-a-zA-Z0-9_:.]*)/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      if (m[1]) attrs[m[1].toLowerCase()] = decodeEntities(m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : m[5]));
      else if (m[6]) attrs[m[6].toLowerCase()] = '';
    }
    return attrs;
  }

  function parseHTML(html) {
    const rootNode = { tag: '#root', attrs: {}, children: [], parent: null };
    const stack = [rootNode];
    const top = () => stack[stack.length - 1];
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/([a-zA-Z][a-zA-Z0-9:-]*)\s*>|<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      if (m[1]) {                                   // 结束标签
        const name = m[1].toLowerCase();
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].tag === name) { stack.length = i; break; }
        }
      } else if (m[2]) {                            // 开始标签
        const name = m[2].toLowerCase();
        const node = { tag: name, attrs: parseAttrs(m[3] || ''), children: [], parent: top() };
        top().children.push(node);
        if (!VOID_TAGS.has(name) && m[4] !== '/') stack.push(node);
      } else if (m[5] !== undefined) {               // 文本
        const t = decodeEntities(m[5]);
        if (t) top().children.push({ tag: '#text', text: t, parent: top() });
      }
    }
    return rootNode;
  }

  /* ======================================================================
   * 二、HTML → IR
   * ====================================================================*/

  const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li',
    'blockquote', 'pre', 'table', 'tr', 'td', 'th', 'ul', 'ol', 'hr', 'section',
    'article', 'header', 'footer', 'figure', 'figcaption', 'tbody', 'thead', 'center']);

  const STYLE_FALLBACK = {
    heading1: { size: 15, bold: true, after: 6 },
    heading2: { size: 12, bold: true, after: 4 },
    heading3: { size: 10.5, bold: true, after: 3 },
    heading4: { size: 10.5, bold: true, after: 3 },
    body: { size: 10.5 },
    caption: { size: 9, italic: false }
  };

  function parseSize(v) {
    if (!v) return null;
    const m = /([\d.]+)\s*(pt|px|em|rem|%)?/i.exec(String(v));
    if (!m) return null;
    let n = parseFloat(m[1]);
    const unit = (m[2] || 'pt').toLowerCase();
    if (unit === 'px') n = n * 0.75;
    else if (unit === 'em' || unit === 'rem') n = n * 12;
    else if (unit === '%') n = n * 0.12;
    return n > 0 && n < 200 ? Math.round(n * 10) / 10 : null;
  }

  function parseStyleAttr(s) {
    const o = {};
    String(s || '').split(';').forEach(part => {
      const i = part.indexOf(':');
      if (i < 0) return;
      const k = part.slice(0, i).trim().toLowerCase();
      const v = part.slice(i + 1).trim();
      if (k && v) o[k] = v;
    });
    return o;
  }

  /**
   * 从"容器节点"（<p>、<td>、<li> 等）自身的 style 里取出可继承的字体属性。
   * Word/mammoth 习惯把字体放在内层 <span>，但也常有 HTML 把 font-size/font-weight
   * 直接写在 <p> 上（手写网页、其它转换器）。不继承就会整段丢失字号与加粗。
   * 内层元素的同名样式优先级更高，会覆盖这里的值。
   */
  function fontCtxOf(node, ctx) {
    const st = parseStyleAttr(node && node.attrs && node.attrs.style);
    if (!st || !Object.keys(st).length) return ctx;
    const fw = String(st['font-weight'] || '').toLowerCase();
    const fs = String(st['font-style'] || '').toLowerCase();
    const deco = String(st['text-decoration'] || '') + ' ' + String(st['text-decoration-line'] || '');
    const vAlign = String(st['vertical-align'] || '').toLowerCase();
    const base = Object.assign({}, ctx);
    if (fw === 'bold' || (/^\d{3,4}$/.test(fw) && parseInt(fw, 10) >= 600)) base.b = true;
    if (fs === 'italic' || fs === 'oblique') base.i = true;
    if (deco.includes('underline')) base.u = true;
    if (deco.includes('line-through')) base.strike = true;
    if (vAlign === 'super' || vAlign === 'text-top') base.sup = true;
    if (vAlign === 'sub') base.sub = true;
    base.size = parseSize(st['font-size']) || ctx.size;
    base.color = normalizeColor(st.color) || ctx.color;
    const fam = (st['font-family'] || '').replace(/["']/g, '').split(',')[0].trim();
    base.font = fam || ctx.font;
    return base;
  }

  /** 把一个行内节点树展开成 runs */
  function collectRuns(node, ctx, runs) {
    ctx = fontCtxOf(node, ctx);
    for (const child of node.children || []) {
      if (child.tag === '#text') {
        const t = ctx.pre ? child.text : core.normSpace(child.text);
        if (t) runs.push(makeRun(t, ctx));
        continue;
      }
      if (child.tag === 'br') { runs.push({ t: '\n', ...ctxFlags(ctx) }); continue; }
      if (child.tag === 'img') { ctx.images.push(imageFromNode(child)); continue; }
      if (child.tag === 'a') {
        // 超链接文字照常保留（不做超链接，保持版式）
        collectRuns(child, ctx, runs);
        continue;
      }
      const st = parseStyleAttr(child.attrs && child.attrs.style);
      const fw = String(st['font-weight'] || '').toLowerCase();
      const fs2 = String(st['font-style'] || '').toLowerCase();
      const deco = String(st['text-decoration'] || '') + ' ' + String(st['text-decoration-line'] || '');
      const vAlign = String(st['vertical-align'] || '').toLowerCase();
      const next = Object.assign({}, ctx, {
        b: ctx.b || child.tag === 'b' || child.tag === 'strong' || fw === 'bold' ||
           (/^\d{3,4}$/.test(fw) && parseInt(fw, 10) >= 600),
        i: ctx.i || child.tag === 'i' || child.tag === 'em' || fs2 === 'italic' || fs2 === 'oblique',
        u: ctx.u || child.tag === 'u' || deco.includes('underline'),
        strike: ctx.strike || child.tag === 's' || child.tag === 'del' || child.tag === 'strike' ||
          deco.includes('line-through'),
        sup: ctx.sup || child.tag === 'sup' || vAlign === 'super' || vAlign === 'text-top',
        sub: ctx.sub || child.tag === 'sub' || vAlign === 'sub',
        size: parseSize(st['font-size']) || ctx.size,
        color: normalizeColor(st.color) || ctx.color,
        font: (st['font-family'] || '').replace(/["']/g, '').split(',')[0].trim() || ctx.font,
        pre: ctx.pre || child.tag === 'pre'
      });
      collectRuns(child, next, runs);
    }
    return runs;
  }

  function ctxFlags(ctx) {
    return { b: ctx.b, i: ctx.i, u: ctx.u, sup: ctx.sup, sub: ctx.sub, size: ctx.size, color: ctx.color, font: ctx.font };
  }

  function makeRun(t, ctx) {
    const r = { t: t };
    if (ctx.b) r.b = true;
    if (ctx.i) r.i = true;
    if (ctx.u) r.u = true;
    if (ctx.sup) r.sup = true;
    if (ctx.sub) r.sub = true;
    if (ctx.strike) r.strike = true;
    if (ctx.size) r.size = ctx.size;
    if (ctx.color) r.color = ctx.color;
    if (ctx.font) r.font = ctx.font;
    return r;
  }

  function normalizeColor(c) {
    if (!c) return null;
    const s = String(c).trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
    if (rgb) return '#' + [1, 2, 3].map(i => (+rgb[i]).toString(16).padStart(2, '0')).join('');
    if (/^[a-z]+$/.test(s) && s !== 'black') return s === 'white' ? '#ffffff' : null;
    if (s === 'black') return '#000000';
    return null;
  }

  function imageFromNode(node) {
    const a = node.attrs || {};
    const src = a.src || '';
    let w = parseFloat(a.width) || null;
    let h = parseFloat(a.height) || null;
    const st = parseStyleAttr(a.style);
    if (st.width) w = parseFloat(st.width) || w;
    if (st.height) h = parseFloat(st.height) || h;
    // px → pt
    if (w && w > 600) w = w * 0.75;
    if (h && h > 800) h = h * 0.75;
    return { dataUrl: src, w: w, h: h, alt: a.alt || '' };
  }

  /** 段落对齐：style / align 属性 */
  function alignOf(node) {
    const st = parseStyleAttr(node.attrs && node.attrs.style);
    const a = (st['text-align'] || (node.attrs && node.attrs.align) || '').toLowerCase();
    if (a.includes('center')) return 'center';
    if (a.includes('right')) return 'right';
    if (a.includes('justify')) return 'justify';
    if (a === 'left') return 'left';
    if (node.tag === 'center') return 'center';
    return null;
  }

  function indentOf(node) {
    const st = parseStyleAttr(node.attrs && node.attrs.style);
    let first = parseFloat(st['text-indent']);
    if (isNaN(first)) first = null;
    else if (Math.abs(first) > 30) first = first * 0.75;   // px → pt
    return { first: first && first > 0 ? Math.round(first * 10) / 10 : null };
  }

  /** 判断是否是图题/表题（"图 1 ..." / "表 2 ..." / "Figure 1" / "Table 1"） */
  function captionKind(text) {
    const s = (text || '').trim();
    if (/^(图|圖|Fig\.?|Figure|FIGURE)\s*[0-9一二三四五六七八九十]/.test(s)) return 'figure';
    if (/^(表|Tab\.?|Table|TABLE)\s*[0-9一二三四五六七八九十]/.test(s)) return 'table';
    return null;
  }

  /**
   * HTML 文档树 → blocks
   */
  function htmlToBlocks(rootNode, opts) {
    opts = opts || {};
    const blocks = [];
    const assets = [];
    const sizes = [];
    const state = { listStack: [], quote: false };

    function textOf(node) {
      const runs = collectRuns(node, { images: [] }, []);
      return core.runsToText(runs);
    }

    function addImages(imgs, paragraphAlign) {
      for (const im of imgs) {
        if (!im.dataUrl) continue;
        const id = core.uid('img');
        assets.push({ id, dataUrl: im.dataUrl, w: im.w, h: im.h, alt: im.alt });
        blocks.push({
          id: core.uid('b'), type: 'image', assetId: id, w: im.w, h: im.h,
          align: paragraphAlign || 'center', caption: '', alt: im.alt || ''
        });
      }
    }

    function visit(node, inherited) {
      const tag = node.tag;
      if (tag === '#text') {
        const t = core.normSpace(node.text);
        if (t.trim()) pushParagraph({ runs: [{ t: t }], tagName: 'p', attrs: node.attrs, inherit: inherited });
        return;
      }
      if (tag === 'table') { blocks.push(tableToIR(node)); return; }
      if (tag === 'ul' || tag === 'ol') {
        state.listStack.push({ ordered: tag === 'ol' });
        for (const c of node.children) visit(c, inherited);
        state.listStack.pop();
        return;
      }
      if (tag === 'hr') { blocks.push({ id: core.uid('b'), type: 'hr' }); return; }
      if (tag === 'figure') {
        for (const c of node.children) visit(c, inherited);
        return;
      }
      if (tag === 'blockquote') {
        const save = state.quote; state.quote = true;
        for (const c of node.children) visit(c, inherited);
        state.quote = save;
        return;
      }
      if (tag === 'pre') {
        const t = core.runsToText(collectRuns(node, { pre: true, images: [] }, []));
        blocks.push({ id: core.uid('b'), type: 'code', text: t });
        return;
      }
      if (tag === 'br') { return; }

      const isBlock = BLOCK_TAGS.has(tag) || tag === 'body' || tag === '#root' || tag === 'html' || tag === 'head';

      if (!isBlock) {
        // 行内容器（span/em/strong/a/img...）：合并成一段
        const runs = [], images = [];
        collectRuns(node, { images: images }, runs);
        if (images.length) addImages(images, 'center');
        if (core.runsToText(runs).trim()) {
          pushParagraph({ runs, tagName: 'p', attrs: node.attrs, inherit: inherited });
        }
        return;
      }

      if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article' ||
        /^h[1-6]$/.test(tag) || tag === 'li' || tag === 'figcaption' || tag === 'center' ||
        tag === 'header' || tag === 'footer' || tag === 'tbody' || tag === 'thead' ||
        tag === 'tr' || tag === 'td' || tag === 'th') {
        const runs = [], images = [];
        collectRuns(node, { images: images }, runs);
        const align = alignOf(node) || inherited;
        if (images.length) addImages(images, align || 'center');
        const hasDirectText = (node.children || []).some(c => c.tag === '#text' && c.text.trim());
        const hasInline = (node.children || []).some(c => c.tag !== '#text' && !BLOCK_TAGS.has(c.tag) && c.tag !== 'img');
        if (core.runsToText(runs).trim() || hasDirectText || hasInline) {
          pushParagraph({ runs, tagName: tag, attrs: node.attrs, inherit: inherited, align: align });
        }
        // 处理嵌套块级子节点（如 div 里套 p、li 里套 ul）
        for (const c of node.children) {
          if (c.tag === '#text') continue;
          if (BLOCK_TAGS.has(c.tag) && c.tag !== 'td' && c.tag !== 'th' && c.tag !== 'tr' && c.tag !== 'tbody' && c.tag !== 'thead') {
            visit(c, align || inherited);
          }
        }
        return;
      }

      for (const c of node.children) visit(c, inherited);
    }

    function pushParagraph(p) {
      let runs = p.runs.filter(r => (r.t != null && r.t !== '') || r.t === '\n');
      if (!runs.length) return;
      // 合并同类 run
      const merged = [];
      for (const r of runs) {
        const last = merged[merged.length - 1];
        const same = last && last.b === r.b && last.i === r.i && last.u === r.u && last.sup === r.sup &&
          last.sub === r.sub && last.size === r.size && last.color === r.color && last.font === r.font;
        if (same) last.t += r.t; else merged.push(Object.assign({}, r));
      }
      const text = core.runsToText(merged);
      if (!text.trim()) return;
      const size = (merged.find(r => r.size) || {}).size || null;
      if (size) sizes.push(size);
      const bold = merged.some(r => r.b) && merged.filter(r => r.b).length / merged.length > 0.6;
      const st = parseStyleAttr(p.attrs && p.attrs.style);
      const indent = indentOf(p);
      const align = p.align || null;
      const listInfo = state.listStack.length ? state.listStack[state.listStack.length - 1] : null;

      const node = {
        id: core.uid('b'),
        type: 'paragraph',
        runs: merged,
        align: align || (listInfo ? 'left' : null),
        indent: indent.first,
        size: size,
        bold: bold,
        styleName: p.tagName,
        list: listInfo ? { ordered: !!listInfo.ordered, level: state.listStack.length - 1 } : null,
        quote: state.quote || undefined
      };
      if (p.tagName === 'figcaption') node.styleName = 'figcaption';
      blocks.push(node);
    }

    visit(rootNode, null);
    return { blocks, assets, sizes };
  }

  /** HTML <table> → IR table（含合并单元格） */
  function tableToIR(tableNode) {
    const rows = [];
    const rowNodes = [];
    (function collectRows(n) {
      for (const c of n.children || []) {
        if (c.tag === 'tr') { rowNodes.push(c); }
        else if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot' || c.tag === 'table') collectRows(c);
      }
    })(tableNode);

    const grid = [];          // 稀疏网格，记录占用
    for (let ri = 0; ri < rowNodes.length; ri++) {
      const tr = rowNodes[ri];
      if (!grid[ri]) grid[ri] = [];
      let ci = 0;
      for (const cell of (tr.children || [])) {
        if (cell.tag !== 'td' && cell.tag !== 'th') continue;
        while (grid[ri][ci]) ci++;
        const cs = Math.max(1, parseInt((cell.attrs && cell.attrs.colspan) || '1', 10) || 1);
        const rs = Math.max(1, parseInt((cell.attrs && cell.attrs.rowspan) || '1', 10) || 1);
        const runs = [], images = [];
        collectRuns(cell, { images: images }, runs);
        if (typeof module === 'object' && module.exports && global.__LY_DEBUG) {
          console.log('[cell]', cell.tag, 'kids=', (cell.children || []).map(c => c.tag).join(','), 'runs=', JSON.stringify(runs));
        }
        const cellIR = {
          text: core.normSpace(core.runsToText(runs)).trim(),
          runs: runs,
          header: cell.tag === 'th',
          align: alignOf(cell),
          colspan: cs, rowspan: rs,
          size: (runs.find(r => r.size) || {}).size || null
        };
        if (images.length && images[0].dataUrl) cellIR.image = images[0];
        for (let r = ri; r < ri + rs; r++) {
          if (!grid[r]) grid[r] = [];
          for (let c = ci; c < ci + cs; c++) grid[r][c] = cellIR;
        }
        ci += cs;
      }
    }
    const maxCols = Math.max(1, ...grid.map(r => r.length));
    for (let ri = 0; ri < grid.length; ri++) {
      const row = [];
      for (let ci = 0; ci < maxCols; ci++) {
        const c = grid[ri][ci];
        row.push(c || { text: '', runs: [], colspan: 1, rowspan: 1 });
      }
      rows.push(row);
    }
    return { id: core.uid('t'), type: 'table', rows, headerRows: rowNodes.length && (rowNodes[0].children || []).some(c => c.tag === 'th') ? 1 : 0 };
  }

  /* ======================================================================
   * 三、抽取结果的后处理：字号统计、标题识别、图题合并
   * ====================================================================*/

  function postProcess(blocks, extras) {
    const sizes = (extras && extras.sizes) || [];
    // 正文字号 = 出现最多的字号
    const freq = new Map();
    sizes.forEach(s => freq.set(s, (freq.get(s) || 0) + 1));
    let body = 10.5, best = -1;
    for (const [s, n] of freq) if (n > best) { best = n; body = s; }
    if (!sizes.length) body = 10.5;

    // 全文字号排序，用于标题分级
    const uniq = [...new Set(sizes)].sort((a, b) => b - a);

    const out = [];
    let figureIndex = 0;
    let firstCenteredBoldSeen = false;
    const maxSize = uniq.length ? uniq[0] : 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type !== 'paragraph') {
        if (b.type === 'image') figureIndex++;
        out.push(b);
        continue;
      }
      const text = core.runsToText(b.runs).trim();
      const size = b.size || body;
      const boldLike = !!b.bold;
      const centered = b.align === 'center';
      // 标题判定：与 PDF 路径共用 core 中的统一规则
      const boldRuns = (b.runs || []).some(r => r.b);
      let level = core.classifyHeading(b, { bodySize: body, sizes: uniq });
      if (!level && (boldLike || boldRuns) && centered && size >= maxSize - 0.2 && text.length > 6 && text.length <= 90 &&
          out.filter(x => x.type !== 'image').length < 2 && !/[。；;]$/.test(text)) {
        level = 1;   // 文档开头、字号最大、居中加粗 → 主标题
      }
      if (!b.bold && boldRuns) b.bold = true;

      // 图题合并到前面的图片上
      const capKind = captionKind(text);
      if (capKind === 'figure' && out.length) {
        for (let k = out.length - 1; k >= 0 && k >= out.length - 3; k--) {
          if (out[k].type === 'image' && !out[k].caption) {
            out[k].caption = text;
            out[k].captionRuns = b.runs;
            level = 0;
            break;
          }
          if (out[k].type === 'paragraph' && core.runsToText(out[k].runs).trim()) break;
        }
      }
      if (level > 0) {
        b.type = 'heading';
        b.level = Math.min(4, Math.max(1, level));
        // 文档最开头、字号最大且居中加粗的块 = 主标题
        if (!firstCenteredBoldSeen && centered && boldLike && size >= maxSize - 0.2 && text.length > 8 &&
            !/[。；;]$/.test(text) && out.filter(x => x.type !== 'image').length < 2) {
          b.level = 1;
          firstCenteredBoldSeen = true;
        }
        b.align = b.align || (b.level === 1 && centered ? 'center' : null);
      }
      out.push(b);
    }

    // 段落间距启发式：标题前后留白
    return { blocks: out, bodySize: body, sizes: uniq };
  }

  /* ======================================================================
   * 四、对外接口
   * ====================================================================*/

  /**
   * 从 docx ArrayBuffer 抽取 IR
   * @param {ArrayBuffer} arrayBuffer
   * @param {Object} opts { mammoth, fileName }
   */
  async function extractDocx(arrayBuffer, opts) {
    opts = opts || {};
    const mammoth = opts.mammoth || (typeof root !== 'undefined' && root.mammoth) || null;
    if (!mammoth) throw new Error('缺少 mammoth 库，无法解析 Word 文档');

    const messages = [];
    const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer }, {
      convertImage: mammoth.images.imgElement(function (image) {
        return image.read('base64').then(function (base64) {
          return { src: 'data:' + (image.contentType || 'image/png') + ';base64,' + base64 };
        });
      }),
      includeDefaultStyleMap: true,
      styleMap: [
        "p[style-name='Title'] => h1.title:fresh",
        "p[style-name='标题'] => h1:fresh",
        "p[style-name='Subtitle'] => p.subtitle:fresh",
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='heading 1'] => h1:fresh",
        "p[style-name='heading 2'] => h2:fresh",
        "p[style-name='heading 3'] => h3:fresh"
      ]
    });
    if (result.messages) result.messages.forEach(m => messages.push(m.message));

    const ir = convertHtmlToIR(result.value, { fileName: opts.fileName || '' });
    ir.source = 'docx';
    ir.messages = messages;
    return ir;
  }

  /** HTML 字符串 → IR（也用于 .html 文件与 mammoth 输出） */
  function convertHtmlToIR(html, opts) {
    opts = opts || {};
    const dom = parseHTML(html);
    const { blocks, assets, sizes } = htmlToBlocks(dom, opts);
    const post = postProcess(blocks, { sizes });
    const ir = core.newIR({
      source: 'docx',
      meta: { fileName: opts.fileName || '' },
      assets: assets
    });
    ir.blocks = post.blocks;
    ir.bodySize = post.bodySize;
    ir.fontSizes = post.sizes;
    // 表格占多数时不采用正文缩进
    return ir;
  }

  return {
    parseHTML, parseStyleAttr, parseSize, normalizeColor, decodeEntities,
    htmlToBlocks, tableToIR, postProcess, captionKind,
    extractDocx, convertHtmlToIR, STYLE_FALLBACK
  };
});
