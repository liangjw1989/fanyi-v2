/* render-pdf-overlay.js — 原图叠加：在原 PDF 页面上覆盖译文，导出图片型 PDF
 *
 * 为什么需要它（过渡方案）：
 *   让 PDF 忠实还原版式是"PDF→结构重建"这条路的死穴 —— PDF 里只有字形坐标，
 *   没有栏/表/段的概念，任何一种启发式都会在复杂期刊版式上出错。
 *
 *   叠加方案绕开这个问题：**直接把原 PDF 每页画成图**，版式天然 100% 保真
 *   （表格、图、公式、页眉页脚都在原位置），然后在原文字位置涂白、写译文。
 *
 * 代价：译文是画在像素上的，不可选中/搜索；文件较大。
 * 因此它是过渡方案；真正的长期方案是"原位替换文字 + 嵌入中文字体子集"
 * （见 docs/PDF版式还原的技术路线.md）。
 */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- 工具 */

  /** 估算一行文字宽度（按字符类型加权：中文=1em，西文≈0.5em） */
  function measure(text, size) {
    let w = 0;
    for (const ch of String(text || '')) {
      const c = ch.codePointAt(0);
      if (c >= 0x2e80) w += size;                 // CJK / 全角
      else if (ch === ' ') w += size * 0.28;
      else w += size * 0.52;
    }
    return w;
  }

  /** 按最大宽度折行（中文按字断行，西文按词断行；输出会去掉行尾空白） */
  function wrapText(text, size, maxW) {
    const out = [];
    let line = '';
    let w = 0;
    const tokens = String(text || '').match(/[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]|[^\s\u2e80-\u9fff]+|\s+/g) || [];
    for (const tk of tokens) {
      const tw = measure(tk, size);
      if (w + tw > maxW && line.trim()) {
        out.push(line.replace(/\s+$/, ''));
        line = tk.trim() ? tk : '';
        w = tk.trim() ? tw : 0;
      } else {
        line += tk;
        w += tw;
      }
    }
    if (line.trim()) out.push(line.replace(/\s+$/, ''));
    return out.length ? out : [''];
  }

  /* ------------------------------------------------ 极简 PDF（JPEG 图片） */

  /**
   * 用 JPEG 图片生成 PDF（无需任何字体，因此中文一定正确）。
   * @param {Array<{w:number,h:number,jpeg:Uint8Array}>} pages 每页一张 JPEG
   * @param {Object} meta { title }
   * @returns {Uint8Array}
   */
  function buildImagePdf(pages, meta) {
    meta = meta || {};
    const enc = new TextEncoder();
    const chunks = [];
    let size = 0;
    const push = (data) => {
      const b = (data instanceof Uint8Array) ? data : enc.encode(String(data));
      chunks.push(b);
      size += b.length;
    };
    /* 记录每个对象在文件中的字节偏移，供 xref 使用。
     * 注意：必须用 size（已写入字节数）作为偏移，不能另设一个从不更新的
     * 计数器 —— 那样 xref 全部指向错误位置，PDF 阅读器会报文件损坏。 */
    const offsets = {};
    const markObj = (n) => { offsets[n] = size; };
    const pushObj = (n, head, body) => {
      markObj(n);
      push(enc.encode(head));
      if (body) push(body);
      push('\n');
    };

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    /* 对象编号：1=Catalog, 2=Pages, 3=Info,
       之后每页 4 个对象：Page, Contents, ImageXObject, 以及字体不需要 */
    const objBase = 4;
    const pageObj = (i) => objBase + i * 3;
    const contentObj = (i) => objBase + i * 3 + 1;
    const imageObj = (i) => objBase + i * 3 + 2;

    pushObj(1, '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    const kids = pages.map((p, i) => pageObj(i) + ' 0 R').join(' ');
    pushObj(2, '2 0 obj\n<< /Type /Pages /Count ' + pages.length + ' /Kids [' + kids + '] >>\nendobj\n');
    const title = String(meta.title || 'PDF').replace(/[()\\]/g, ' ');
    pushObj(3, '3 0 obj\n<< /Title (' + title + ') /Producer (LingYi) >>\nendobj\n');

    pages.forEach((p, i) => {
      const w = Math.round(p.w), h = Math.round(p.h);
      /* Page */
      pushObj(pageObj(i),
        pageObj(i) + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + h + ']' +
        ' /Resources << /XObject << /Im0 ' + imageObj(i) + ' 0 R >> >>' +
        ' /Contents ' + contentObj(i) + ' 0 R >>\nendobj\n');
      /* Contents：把整页图片铺满 */
      const cs = 'q\n' + w + ' 0 0 ' + h + ' 0 0 cm\n/Im0 Do\nQ\n';
      const csBytes = enc.encode(cs);
      pushObj(contentObj(i),
        contentObj(i) + ' 0 obj\n<< /Length ' + csBytes.length + ' >>\nstream\n');
      push(csBytes);
      push('endstream\nendobj\n');
      /* Image XObject（JPEG 直接用 DCTDecode，不需要重新编码） */
      pushObj(imageObj(i),
        imageObj(i) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + p.pxW +
        ' /Height ' + p.pxH + ' /ColorSpace /DeviceRGB /BitsPerComponent 8' +
        ' /Filter /DCTDecode /Length ' + p.jpeg.length + ' >>\nstream\n');
      push(p.jpeg);
      push('\nendstream\nendobj\n');
    });

    /* xref */
    const total = objBase + pages.length * 3;
    const xrefPos = size;
    let xref = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (let n = 1; n < total; n++) {
      const off = offsets[n] || 0;
      xref += String(off).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);
    push('trailer\n<< /Size ' + total + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }

  /* ------------------------------------------------------------ 主流程 */

  /**
   * 生成"原图 + 译文叠加"的 PDF。
   *
   * @param {Object} o
   * @param {Uint8Array} o.pdfBytes 原始 PDF 字节
   * @param {Object}   o.pdfjs    已加载的 pdf.js 库
   * @param {Array}    o.pages    每页的待覆盖文字块：
   *        [{ number, width, height, blocks: [{ x, y, w, h, size, text }] }]
   *        （坐标原点在左上角，单位与 viewport 一致；内部会按 scale 缩放）
   * @param {number}  [o.scale=2]  渲染倍率（2 = 约 144dpi，清晰且体积可控）
   * @param {number}  [o.quality=0.85] JPEG 质量
   * @param {string}  [o.fontFamily] canvas 字体（默认用系统中文字体栈）
   * @param {Function}[o.onProgress] (done, total)
   * @returns {Promise<{ bytes: Uint8Array, pageCount: number }>}
   */
  async function renderOverlay(o) {
    const pdfjs = o.pdfjs;
    if (!pdfjs) throw new Error('缺少 pdf.js');
    const scale = o.scale || 2;
    const quality = o.quality == null ? 0.85 : o.quality;
    const fontFamily = o.fontFamily ||
      '"Microsoft YaHei","PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Source Han Sans SC",sans-serif';

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
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const info = metaByNum.get(n);
      if (info && info.blocks && info.blocks.length) {
        for (const b of info.blocks) {
          const x = b.x * scale, y = b.y * scale;
          const w = Math.max(4, (b.w || 200) * scale);
          const h = Math.max(4, (b.h || (b.size || 10)) * scale);
          /* 涂白原文（略微外扩，盖住抗锯齿边缘） */
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
          /* 写译文：字号按块高自适应，长度超宽则缩字号 */
          const size = Math.max(4, (b.size || 10) * scale);
          const lines = wrapText(b.text || '', size, w);
          let useSize = size;
          /* 行数放不下就逐步缩字号 */
          const maxLines = Math.max(1, Math.floor(h / (useSize * 1.25)));
          if (lines.length > maxLines) {
            const k = Math.max(0.55, (h / (lines.length * 1.25)) / useSize);
            useSize = Math.max(4, size * k);
          }
          ctx.font = useSize + 'px ' + fontFamily;
          ctx.textBaseline = 'top';
          ctx.fillStyle = '#000';
          const wrapped = wrapText(b.text || '', useSize, w);
          const lh = useSize * 1.22;
          let yy = y;
          for (let li = 0; li < wrapped.length; li++) {
            if (yy + lh > y + h + lh * 0.6) break;   // 超出块高就停，避免压到下一块
            ctx.fillText(wrapped[li], x, yy);
            yy += lh;
          }
        }
      }

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const bin = atob(b64);
      const jpeg = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i);
      outPages.push({
        w: info ? info.width : vp.width / scale,
        h: info ? info.height : vp.height / scale,
        pxW: canvas.width, pxH: canvas.height, jpeg: jpeg
      });
      if (o.onProgress) o.onProgress(n, total);
    }

    if (doc.destroy) { try { doc.destroy(); } catch (e) { } }
    return { bytes: buildImagePdf(outPages, { title: o.title }), pageCount: outPages.length };
  }

  root.LingyiPdfOverlay = {
    renderOverlay: renderOverlay,
    buildImagePdf: buildImagePdf,
    wrapText: wrapText,
    measure: measure
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
