/* render-pdf-inplace.js — 原版式 + 可选中矢量译文（路线 C）
 *
 * 思路（不解析原 PDF，避免 xref/对象流的坑）：
 *   ① 用 pdf.js 把原 PDF 每页画成图片 → 作为新 PDF 的**整页底图**
 *      → 版式 100% 保真（图、表、公式、页眉页脚都在原位）
 *   ② 在每个原文字块上盖一个白色矩形（盖掉原文）
 *   ③ 在**同一位置**用真正的文字对象写译文，字体内嵌（Identity-H）
 *      → 译文可选中、可搜索、可复制
 *
 * 与"图片型叠加"的区别：译文不是画在像素上，而是 PDF 文字对象，
 * 所以能选中/搜索；与"结构重建"的区别：完全不做分栏/表格推断。
 *
 * 依赖：pdf-font.js（TTF 解析 + PDF 字体对象）、浏览器 canvas、pdf.js
 */
(function (root) {
  'use strict';

  function enc(str) {
    const s = String(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  /**
   * 把每页的"行"合并成"段落块"，并把坐标统一成 **y 轴向下（从页面顶部算）**。
   *
   * 【坐标系·必读】pdf-extract 产出的行坐标是 **y 轴向上（从页面底部算）**：
   * pdf.js 的 textContent item 没有 pageHeight 字段，makeItem 走的是
   * `baseline = tr[5]` 分支，也就是 PDF 原始坐标。
   * 而 canvas 绘制与 PDF 内容流在这里都按 y 轴向下处理，所以必须转换一次：
   *     top = 页高 - (y + 字号)
   * 不转换的后果（真实故障，已用渲染截图确认）：
   *   · 整页内容上下翻转（页面底部的版权声明跑到顶部）
   *   · 分块逻辑失效 → 整页被合并成一个巨大块 → 译文全部叠在一起
   *
   * 合并条件（保守）：同一起始 x（±6pt）、垂直间距 < 1.15 倍字号。
   * 块有两个用途：① 翻译单元（整段翻译质量远好于逐行）
   *               ② 涂白 / 写译文的位置框
   */
  function buildBlocks(pages) {
    return (pages || []).map(p => {
      const H = p.height || 842;
      const lines = (p.lines || [])
        .filter(l => l && l.text && String(l.text).trim())
        .map(l => {
          const size = l.size || 10;
          const x1 = (l.x1 != null) ? l.x1 : (l.x + Math.max(40, String(l.text).length * size * 0.5));
          return { x: l.x, top: H - (l.y + size), size: size, x1: x1, text: String(l.text).trim() };
        })
        .sort((a, b) => (a.top - b.top) || (a.x - b.x));

      const blocks = [];
      let cur = null;
      for (const l of lines) {
        if (cur) {
          const sameIndent = Math.abs(l.x - cur.x) <= 6;
          /* 首行缩进：后续行比首行更靠左、且首行已经排到接近右边界，
             说明它们属于同一段（期刊首行缩进 1~2 个字）。
             不合并的话段落会被切成一块块，译文只能塞进一两行而被截断。 */
          const indentBack = (l.x < cur.x) && (cur.x - l.x) <= Math.max(12, cur.size * 2.6) &&
            (cur.x1 >= cur.maxRight - Math.max(6, cur.size * 2.2));
          const closeY = (l.top - cur.yEnd) < Math.max(3.2, l.size * 1.15);
          if (closeY && (sameIndent || indentBack)) {
            const prev = cur.text;
            const next = l.text;
            const needSpace = /[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9(]/.test(next);
            cur.text = prev + (needSpace ? ' ' : '') + next;
            cur.yEnd = l.top + l.size;
            cur.x1 = Math.max(cur.x1, l.x1);
            cur.maxRight = Math.max(cur.maxRight, l.x1);
            /* 合并后块左边界取更靠左的那个（正文左边界） */
            if (l.x < cur.x) cur.x = l.x;
            continue;
          }
          blocks.push(cur);
        }
        cur = {
          x: Math.round(l.x * 10) / 10,
          y: Math.round(l.top * 10) / 10,
          yEnd: l.top + l.size,
          x1: l.x1,
          maxRight: l.x1,
          size: l.size,
          text: l.text
        };
      }
      if (cur) blocks.push(cur);

      return {
        number: p.number,
        width: p.width,
        height: p.height,
        blocks: blocks.map(b => ({
          x: b.x, y: b.y,
          w: Math.max(40, b.x1 - b.x),
          h: Math.max(b.size * 1.1, b.yEnd - b.y),
          size: b.size,
          text: b.text
        }))
      };
    });
  }

  /**
   * 由"段落块"生成绘制指令（白底矩形 + 每行文字）。
   *
   * 输入块的坐标是 **y 轴向下（从页面顶部算）**（由 buildBlocks 保证）；
   * PDF 内容流是 **y 轴向上（从页面底部算）**，所以这里做一次转换：
   *   矩形底边  = 页高 - (块顶 + 块高)
   *   首行基线  = 页高 - 块顶 - 0.92×字号（略微下沉，让字形落在框内）
   * 之后每行基线减去行高（在 PDF 里就是往下走）。
   *
   * @param {Object} info 单页 { blocks:[{x,y,w,h,size,text}] }
   * @param {number} pageH 页高（pt）
   * @param {Object} F     LingyiPdfFont
   * @param {Object} font  parseTtf 结果
   * @param {Map}    used  字形使用记录（会被填充）
   * @returns {Array} ops
   */
  function buildOps(info, pageH, F, font, used) {
    const ops = [];
    if (!info || !info.blocks) return ops;

    /* 先按纵向排序，并预先算出"当前块向下还能用到哪里"（下一个同列块的顶）。
     * 为什么需要：译文放不下时如果一味缩字号，缩到下限仍放不下就会**继续往下画**，
     * 压到下一块上，出现文字重叠（真实故障，已用渲染截图确认）。
     * 正确做法：允许向下方空白处延伸，但不越过下一个块；实在放不下再缩字号。 */
    const blocks = info.blocks
      .filter(b => b && b.text && String(b.text).trim())
      .slice()
      .sort((a, b) => a.y - b.y);

    const limitFor = (b, idx) => {
      let limit = pageH - 2;                       // 页面底部（y 向下坐标）
      for (let j = idx + 1; j < blocks.length; j++) {
        const nb = blocks[j];
        if (nb.y <= b.y) continue;
        const ox = Math.min(b.x + (b.w || 0), nb.x + (nb.w || 0)) - Math.max(b.x, nb.x);
        if (ox <= 2) continue;                     // 不同列，不算阻挡
        limit = Math.min(limit, nb.y - 1);
        break;
      }
      return Math.max(b.y + (b.size || 10), limit);
    };

    for (let idx = 0; idx < blocks.length; idx++) {
      const b = blocks[idx];
      const bw = Math.max(12, b.w || 120);
      const bh = Math.max(4, b.h || (b.size || 10));
      const availBottom = limitFor(b, idx);
      const availH = Math.max(bh, availBottom - b.y);

      /* 白底：只盖原文字块本身 */
      ops.push({
        kind: 'rect',
        x: b.x - 0.6,
        y: pageH - (b.y + bh) - 0.6,
        w: bw + 1.2,
        h: bh + 1.2
      });

      /* 字号自适应：先利用下方空白，仍放不下再缩（不小于原字号 55%）*/
      let size = Math.max(1, b.size || 10);
      let lines = null;
      for (let attempt = 0; attempt < 7; attempt++) {
        lines = wrapWithFont(F, font, b.text, size, bw, used);
        const lh = size * 1.16;
        if (lines.length * lh <= availH + lh * 0.35) break;
        const next = size * 0.92;
        if (next < (b.size || 10) * 0.55) { size = next; lines = wrapWithFont(F, font, b.text, size, bw, used); break; }
        size = next;
      }
      const lh = size * 1.16;
      let baseline = pageH - b.y - size * 0.92;
      let drawn = 0;
      for (const ln of lines) {
        /* 到底线就停：宁可截断也不画到下一个块上（重叠比截断更糟）*/
        if (drawn > 0 && (b.y + size + drawn * lh) > availBottom + 2) break;
        if (ln && ln.trim()) {
          ops.push({
            kind: 'text',
            x: b.x,
            y: baseline,
            size: size,
            hex: F.encodeText(font, ln, used)
          });
        }
        baseline -= lh;
        drawn++;
      }
    }
    return ops;
  }

  /**
   * 用真实字体度量折行（中文按字、西文按词），返回 { lines, width }
   */
  function wrapWithFont(F, font, text, size, maxW, used) {
    const out = [];
    let line = '';
    let lineW = 0;
    const tokens = String(text || '').match(/[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]|[^\s\u2e80-\u9fff]+|\s+/g) || [];
    for (const tk of tokens) {
      const tw = F.textWidth(font, tk, size, used);
      if (lineW + tw > maxW && line.trim()) {
        out.push(line.replace(/\s+$/, ''));
        line = tk.trim() ? tk : '';
        lineW = tk.trim() ? tw : 0;
      } else {
        line += tk;
        lineW += tw;
      }
    }
    if (line.trim()) out.push(line.replace(/\s+$/, ''));
    return out.length ? out : [];
  }

  /**
   * 生成 PDF。
   * @param {Object} o
   * @param {Array}  o.pages  每页：{ width, height, pxW, pxH, jpeg, ops:[...] }
   *        ops: { kind:'rect', x,y,w,h } | { kind:'text', x,y,size,hex }
   * @param {Object} o.fontObjs buildFontObjects 的返回值
   * @param {string} [o.title]
   */
  function buildPdf(o) {
    const pages = o.pages;
    const fo = o.fontObjs;
    const chunks = [];
    let size = 0;
    const push = (d) => {
      const b = (d instanceof Uint8Array) ? d : enc(d);
      chunks.push(b);
      size += b.length;
    };
    const offsets = {};
    const markObj = (n) => { offsets[n] = size; };
    const beginObj = (n, dict) => { markObj(n); push(n + ' 0 obj\n' + dict); };
    const endObj = () => push('\nendobj\n');
    const streamObj = (n, dict, data) => {
      beginObj(n, dict.replace('__LEN__', String(data.length)));
      push('\nstream\n'); push(data); push('\nendstream'); endObj();
    };

    /* 对象编号
       1 Catalog, 2 Pages, 3 Info,
       4 Type0, 5 CIDFont, 6 Descriptor, 7 ToUnicode, 8 FontFile2,
       之后每页 3 个：Page / Contents / Image */
    const P0 = 9;
    const pageObj = i => P0 + i * 3;
    const contentObj = i => P0 + i * 3 + 1;
    const imageObj = i => P0 + i * 3 + 2;

    push('%PDF-1.5\n%\xE2\xE3\xCF\xD3\n');

    beginObj(1, '<< /Type /Catalog /Pages 2 0 R >>'); endObj();
    const kids = pages.map((p, i) => pageObj(i) + ' 0 R').join(' ');
    beginObj(2, '<< /Type /Pages /Count ' + pages.length + ' /Kids [' + kids + '] >>'); endObj();
    const title = String(o.title || 'PDF').replace(/[()\\]/g, ' ');
    beginObj(3, '<< /Title (' + title + ') /Producer (LingYi) >>'); endObj();

    /* --- 字体对象 --- */
    beginObj(4, fo.type0.replace('CIDFONT', '5').replace('TOUNI', '7')); endObj();
    beginObj(5, fo.cidFont.replace('FDFONT', '6')); endObj();
    beginObj(6, fo.descriptor.replace('FFILE', '8')); endObj();
    streamObj(7, '<< /Length __LEN__ >>', fo.toUnicode);
    /* FontFile2：/Length1 是**未压缩**字体长度（PDF 规范要求），
       若用 FlateDecode 压缩，还要加 /Filter。 */
    const fs = o.fontStream || { data: fo.fontFile2, filter: '' };
    streamObj(8,
      '<< /Length __LEN__ /Length1 ' + fo.fontFile2.length + ' ' + (fs.filter || '') + ' >>',
      fs.data);

    /* --- 每页 --- */
    pages.forEach((p, i) => {
      const W = Math.round(p.width), H = Math.round(p.height);
      beginObj(pageObj(i),
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + ']' +
        ' /Resources << /XObject << /Im0 ' + imageObj(i) + ' 0 R >>' +
        ' /Font << /F1 4 0 R >> >>' +
        ' /Contents ' + contentObj(i) + ' 0 R >>');
      endObj();

      /* 内容流：先铺底图，再画白底与译文 */
      let cs = 'q\n' + W + ' 0 0 ' + H + ' 0 0 cm\n/Im0 Do\nQ\n';
      const rects = [];
      const texts = [];
      for (const op of (p.ops || [])) {
        if (op.kind === 'rect') rects.push(op);
        else if (op.kind === 'text') texts.push(op);
      }
      if (rects.length) {
        cs += 'q\n1 1 1 rg\n';
        for (const r of rects) {
          cs += num(r.x) + ' ' + num(r.y) + ' ' + num(r.w) + ' ' + num(r.h) + ' re\n';
        }
        cs += 'f\nQ\n';
      }
      if (texts.length) {
        cs += 'BT\n';
        let lastSize = null;
        for (const t of texts) {
          if (t.size !== lastSize) { cs += '/F1 ' + num(t.size) + ' Tf\n'; lastSize = t.size; }
          cs += '1 0 0 1 ' + num(t.x) + ' ' + num(t.y) + ' Tm\n<' + t.hex + '> Tj\n';
        }
        cs += 'ET\n';
      }
      const csBytes = enc(cs);
      streamObj(contentObj(i), '<< /Length __LEN__ >>', csBytes);

      /* 底图（JPEG 直接 DCTDecode） */
      streamObj(imageObj(i),
        '<< /Type /XObject /Subtype /Image /Width ' + p.pxW + ' /Height ' + p.pxH +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length __LEN__ >>',
        p.jpeg);
    });

    const total = P0 + pages.length * 3;
    const xrefPos = size;
    let xref = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (let n = 1; n < total; n++) {
      xref += String(offsets[n] || 0).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);
    push('trailer\n<< /Size ' + total + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }

  function num(v) {
    const n = Number(v);
    if (!isFinite(n)) return '0';
    return (Math.round(n * 100) / 100).toString();
  }

  /**
   * 用 Deflate 压缩字节（浏览器 CompressionStream）。
   * 字体 9.3MB 压完通常 5~6MB；不可用时返回 null，调用方退回未压缩。
   */
  async function deflate(bytes) {
    try {
      if (typeof CompressionStream === 'undefined') return null;
      const cs = new CompressionStream('deflate');
      const stream = new Blob([bytes]).stream().pipeThrough(cs);
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) { return null; }
  }

  /**
   * 主流程：生成"原版式 + 可选中译文"PDF
   *
   * @param {Object} o
   * @param {Uint8Array} o.pdfBytes 原 PDF
   * @param {Object}   o.pdfjs
   * @param {Array}    o.pages  [{ number, width, height, blocks:[{x,y,w,h,size,text}] }]
   * @param {Uint8Array} o.fontBytes 字体文件（用户选择，如 simhei.ttf）
   * @param {number}   [o.scale=1.6]
   * @param {number}   [o.quality=0.8]
   * @param {boolean}  [o.compressFont=true]
   * @param {Function} [o.onProgress]
   */
  async function renderInPlace(o) {
    const F = root.LingyiPdfFont;
    if (!F) throw new Error('缺少 pdf-font 模块');
    const pdfjs = o.pdfjs;
    if (!pdfjs) throw new Error('缺少 pdf.js');
    if (!o.fontBytes) throw new Error('缺少字体文件：请选择一个中文字体（如 C:\\Windows\\Fonts\\simhei.ttf）');

    const font = F.parseTtf(o.fontBytes, o.fontFace || 0);
    const used = new Map();
    const scale = o.scale || 1.6;
    const quality = o.quality == null ? 0.8 : o.quality;

    const doc = await pdfjs.getDocument({ data: o.pdfBytes.slice(0) }).promise;
    const total = doc.numPages;
    const metaByNum = new Map((o.pages || []).map(p => [p.number, p]));
    const outPages = [];

    for (let n = 1; n <= total; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const info = metaByNum.get(n);
      const pageW = info ? info.width : vp.width / scale;
      const pageH = info ? info.height : vp.height / scale;
      const ops = buildOps(info, pageH, F, font, used);

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const bin = atob(b64);
      const jpeg = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i);

      outPages.push({
        width: pageW, height: pageH,
        pxW: canvas.width, pxH: canvas.height,
        jpeg: jpeg, ops: ops
      });
      if (o.onProgress) o.onProgress(n, total);
    }
    if (doc.destroy) { try { doc.destroy(); } catch (e) { } }

    const fontObjs = F.buildFontObjects(font, used);
    /* 字体流压缩：显著减小体积（9.3MB → 约 5~6MB），失败就退回原始字体 */
    let fontStream = { data: fontObjs.fontFile2, filter: '' };
    if (o.compressFont !== false) {
      const z = await deflate(fontObjs.fontFile2);
      if (z && z.length < fontObjs.fontFile2.length * 0.95) {
        fontStream = { data: z, filter: '/Filter /FlateDecode ' };
      }
    }
    const bytes = buildPdf({
      pages: outPages, fontObjs: fontObjs, title: o.title,
      fontStream: fontStream
    });
    return {
      bytes: bytes,
      pageCount: outPages.length,
      usedGlyphs: used.size,
      fontBytes: fontStream.data.length,
      fontRaw: fontObjs.fontFile2.length
    };
  }

  root.LingyiPdfInPlace = {
    renderInPlace: renderInPlace,
    buildBlocks: buildBlocks,
    buildOps: buildOps,
    buildPdf: buildPdf,
    wrapWithFont: wrapWithFont
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
