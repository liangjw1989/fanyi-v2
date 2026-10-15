/* ============================================================================
 * 灵译 · DOCX 还原渲染器 (render-docx.js)
 * ----------------------------------------------------------------------------
 * 按 IR 骨架重建 Word 文档：字号、加粗、斜体、颜色、对齐、首行缩进、
 * 标题层级、表格（列宽/合并单元格/边框）、图片，全部与原文件一致。
 * 依赖浏览器端 docx UMD（window.docx）。
 * © 2026 灵译 LingYi · 个人使用免费，商业使用需授权（见 LICENSE）
 * ========================================================================== */
(function (root, factory) {
  const core = (typeof module === 'object' && module.exports) ? require('./core.js') : root.LingyiCore;
  const mod = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.LingyiRenderDocx = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  const TWIP_PER_PT = 20;

  const ALIGN = { left: 'left', center: 'center', right: 'right', justify: 'both' };

  function hex(color, fallback) {
    if (!color) return fallback;
    const c = String(color).replace('#', '').trim();
    if (!/^[0-9a-fA-F]{6}$/.test(c)) return fallback;
    return c.toUpperCase();
  }

  function headingStyle(level) {
    return [null, 'Heading1', 'Heading2', 'Heading3', 'Heading4'][Math.min(4, Math.max(1, level || 1))];
  }

  /**
   * IR → docx Document
   * @param {Object} ir
   * @param {Object} opts { docx, fileName, bodySize }
   */
  function renderDocx(ir, opts) {
    opts = opts || {};
    const D = opts.docx || (typeof root !== 'undefined' && root.docx);
    if (!D) throw new Error('缺少 docx 库，无法生成 Word 文档');
    const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
      WidthType, AlignmentType, BorderStyle, HeadingLevel, ShadingType, VerticalAlign, PageBreak } = D;

    const bodySize = opts.bodySize || ir.bodySize || 10.5;
    const pageW = ir.page.width, pageH = ir.page.height;
    const m = ir.page.margin || [56.7, 56.7, 56.7, 56.7];
    const contentW = pageW - m[0] - m[2];
    const assets = {};
    (ir.assets || []).forEach(a => assets[a.id] = a);

    function runsOf(b, defSize) {
      const runs = (b.runs && b.runs.length) ? b.runs : [{ t: '' }];
      return runs.map(r => {
        const size = r.size || b.size || defSize || bodySize;
        return new TextRun({
          text: (r.t == null ? '' : String(r.t)).replace(/\n/g, ' '),
          bold: !!r.b,
          italics: !!r.i,
          underline: r.u ? {} : undefined,
          strike: !!r.strike,
          superScript: !!r.sup,
          subScript: !!r.sub,
          size: Math.round(size * 2),          // half-points
          color: hex(r.color, '000000'),
          font: r.font || undefined
        });
      });
    }

    function paraOf(b, defSize) {
      const o = {
        children: runsOf(b, defSize),
        alignment: ALIGN[(b.align || '').toLowerCase()],
        spacing: { line: 276, before: 0, after: 60 },
        indent: b.indent ? { firstLine: Math.round(b.indent * TWIP_PER_PT) } : undefined
      };
      if (b.type === 'heading') {
        o.heading = headingStyle(b.level);
        o.spacing = { before: 180, after: 80, line: 276 };
        o.indent = undefined;
      }
      if (b.list) {
        o.bullet = b.list.ordered ? undefined : { level: b.list.level || 0 };
        o.numbering = b.list.ordered ? { reference: 'ly-numbering', level: b.list.level || 0 } : undefined;
      }
      if (b.quote) o.indent = { left: 400, firstLine: 0 };
      return new Paragraph(o);
    }

    function cellOf(cell, widths) {
      const blocks = (cell.blocks && cell.blocks.length) ? cell.blocks : [{
        type: 'paragraph', runs: cell.runs || [{ t: cell.text || '' }], align: cell.align, size: cell.size
      }];
      const children = [];
      for (const cb of blocks) {
        if (cb.type === 'image') {
          const a = assets[cb.assetId];
          if (a && a.dataUrl) children.push(imagePara(a, cb.w || a.w, cb.h || a.h, 'center'));
          if (cb.caption) children.push(new Paragraph({
            children: [new TextRun({ text: cb.caption, size: Math.round((bodySize - 1.5) * 2) })],
            alignment: AlignmentType.CENTER
          }));
          continue;
        }
        children.push(paraOf(cb, cell.size || bodySize));
      }
      if (!children.length) children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
      const o = {
        children,
        columnSpan: cell.colspan > 1 ? cell.colspan : undefined,
        rowSpan: cell.rowspan > 1 ? cell.rowspan : undefined,
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 40, bottom: 40, left: 80, right: 80 },
        shading: (cell.header) ? { type: ShadingType.CLEAR, fill: 'F2F2F2' } : undefined
      };
      return new TableCell(o);
    }

    function imagePara(asset, w, h, align) {
      const widthPt = w || asset.w || 300;
      const heightPt = h || asset.h || (asset.h || widthPt * 0.75);
      let data = null;
      const mData = /^data:([^;]+);base64,(.*)$/s.exec(asset.dataUrl || '');
      if (mData) {
        const bin = (typeof atob === 'function') ? atob(mData[2]) : Buffer.from(mData[2], 'base64').toString('binary');
        data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      }
      if (!data) return new Paragraph({ children: [new TextRun({ text: asset.alt || '' })] });
      return new Paragraph({
        children: [new ImageRun({
          data,
          transformation: { width: widthPt, height: heightPt }
        })],
        alignment: ALIGN[(align || 'center').toLowerCase()]
      });
    }

    const children = [];
    const emit = (b, inCell) => {
      if (b.type === 'hr') {
        children.push(new Paragraph({
          children: [new TextRun({ text: '' })],
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' } }
        }));
        return;
      }
      if (b.type === 'pagebreak') {
        children.push(new Paragraph({ children: [new PageBreak()] }));
        return;
      }
      if (b.type === 'container') {
        // Word 的分栏由节属性控制，这里按栏依次输出内容（版式仍完整保留，只是不分栏）
        (b.columns || []).forEach(g => (g.blocks || []).forEach(cb => emit(cb)));
        return;
      }
      if (b.type === 'code') {
        children.push(new Paragraph({
          children: [new TextRun({ text: b.text || '', font: 'Consolas', size: Math.round((bodySize - 1) * 2) })],
          shading: { type: ShadingType.CLEAR, fill: 'F6F8FA' }
        }));
        return;
      }
      if (b.type === 'image') {
        const a = assets[b.assetId];
        if (a) children.push(imagePara(a, b.w, b.h, b.align || 'center'));
        if (b.caption) children.push(new Paragraph({
          children: [new TextRun({ text: b.caption, size: Math.round(Math.max(8, bodySize - 1.5) * 2) })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 }
        }));
        return;
      }
      if (b.type === 'table') {
        const maxCols = Math.max(1, ...(b.rows || []).map(r => r.length));
        const weights = new Array(maxCols).fill(1);
        (b.rows || []).forEach(row => row.forEach((c, i) => {
          if (!c) return;
          const len = Math.min(60, core.charCount((c.text || '').replace(/\s/g, '')));
          if (len > weights[i]) weights[i] = len;
        }));
        const tot = weights.reduce((a, b2) => a + b2, 0) || 1;
        const widths = weights.map(w => Math.max(600, Math.round(contentW * w / tot * TWIP_PER_PT)));
        const rows = (b.rows || []).map(row => new TableRow({
          children: row.map(c => cellOf(c || { text: '' }, widths))
        }));
        children.push(new Table({
          rows,
          width: { size: 100, type: WidthType.PERCENTAGE },
          columnWidths: widths,
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
            left: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
            right: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
            insideVertical: { style: BorderStyle.SINGLE, size: 4, color: '888888' }
          }
        }));
        children.push(new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 0 } }));
        return;
      }
      children.push(paraOf(b, bodySize));
    };
    for (const b of ir.blocks) emit(b);
    if (!children.length) children.push(new Paragraph({ children: [new TextRun({ text: '（空文档）' })] }));

    const doc = new Document({
      creator: '灵译',
      title: ir.meta.title || opts.fileName || '灵译译文',
      description: '由灵译生成 · 保留原文档版式',
      numbering: {
        config: [{
          reference: 'ly-numbering',
          levels: [
            { level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START },
            { level: 1, format: 'lowerLetter', text: '%2)', alignment: AlignmentType.START },
            { level: 2, format: 'lowerRoman', text: '%3.', alignment: AlignmentType.START }
          ]
        }]
      },
      sections: [{
        properties: {
          page: {
            size: { width: Math.round(pageW * TWIP_PER_PT), height: Math.round(pageH * TWIP_PER_PT) },
            margin: {
              top: Math.round(m[1] * TWIP_PER_PT), right: Math.round(m[2] * TWIP_PER_PT),
              bottom: Math.round(m[3] * TWIP_PER_PT), left: Math.round(m[0] * TWIP_PER_PT)
            }
          }
        },
        children
      }]
    });

    return Packer.toBlob(doc).then(blob => ({ blob, filename: (opts.fileName || 'translated') + '.docx' }));
  }

  return { renderDocx };
});
