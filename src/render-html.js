/* ============================================================================
 * 灵译 · HTML 渲染器 (render-html.js)
 * ----------------------------------------------------------------------------
 * 把 IR 骨架渲染成"像素级还原"的 HTML 页面：
 *   · 多栏排版（学术论文双栏）
 *   · 段落字号/对齐/首行缩进/行距
 *   · 表格列宽（按内容比例）、合并单元格
 *   · 图片按原尺寸
 *   · 对照模式：左右双语并排
 * 该 HTML 既能在浏览器预览，也能直接用浏览器"打印为 PDF"（矢量、可选中）。
 * © 2026 灵译 LingYi · 个人使用免费，商业使用需授权（见 LICENSE）
 * ========================================================================== */
(function (root, factory) {
  const core = (typeof module === 'object' && module.exports) ? require('./core.js') : root.LingyiCore;
  const mod = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.LingyiRenderHtml = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  const PT_TO_PX = 96 / 72;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function runsToHtml(runs, defaultSize) {
    if (!runs || !runs.length) return '';
    return runs.map(r => {
      let t = esc(r.t == null ? '' : r.t).replace(/\n/g, '<br>');
      if (t === '') return '';
      let style = '';
      if (r.size && defaultSize && Math.abs(r.size - defaultSize) > 0.05) style += `font-size:${r.size}pt;`;
      if (r.color) style += `color:${r.color};`;
      if (r.font) style += `font-family:'${String(r.font).replace(/'/g, '')}',inherit;`;
      let inner = t;
      if (r.i) inner = `<em>${inner}</em>`;
      if (r.b) inner = `<strong>${inner}</strong>`;
      if (r.u) inner = `<u>${inner}</u>`;
      if (r.strike) inner = `<s>${inner}</s>`;
      if (r.sup) inner = `<sup>${inner}</sup>`;
      if (r.sub) inner = `<sub>${inner}</sub>`;
      return style ? `<span style="${style}">${inner}</span>` : inner;
    }).join('');
  }

  function textOf(b) {
    if (b.type === 'image') return b.caption || '';
    return core.runsToText(b.runs);
  }

  /** 表格列宽：按各列最大字符数分配，最少 5% */
  function computeColWidths(rows, maxCols) {
    const weights = new Array(maxCols).fill(1);
    for (const row of rows) {
      for (let i = 0; i < maxCols; i++) {
        const cell = row[i];
        if (!cell) continue;
        const len = Math.min(60, core.charCount((cell.text || '').replace(/\s/g, '')));
        if (len > weights[i]) weights[i] = len;
      }
    }
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    return weights.map(w => Math.max(5, Math.round(w / total * 1000) / 10));
  }

  function tableToHtml(t, opts) {
    const maxCols = Math.max(1, ...(t.rows || []).map(r => r.length));
    const widths = computeColWidths(t.rows || [], maxCols);
    const used = [];
    let html = `<table class="ly-table"><colgroup>${widths.map(w => `<col style="width:${w}%">`).join('')}</colgroup>`;
    (t.rows || []).forEach((row, ri) => {
      if (!used[ri]) used[ri] = [];
      html += '<tr>';
      for (let ci = 0; ci < row.length; ci++) {
        if (used[ri][ci]) continue;
        const cell = row[ci] || {};
        const cs = cell.colspan || 1, rs = cell.rowspan || 1;
        for (let r = ri; r < ri + rs; r++) {
          used[r] = used[r] || [];
          for (let c = ci; c < ci + cs; c++) used[r][c] = true;
        }
        const isHeader = cell.header || (t.headerRows && ri < t.headerRows);
        const tag = isHeader ? 'th' : 'td';
        const style = [];
        if (cell.align) style.push(`text-align:${cell.align}`);
        else if (isHeader || /^[\d.\-\s%±<>≤≥~，,]+$/.test(cell.text || '')) style.push('text-align:center');
        if (cell.size && opts && opts.bodySize && Math.abs(cell.size - opts.bodySize) > 0.05) style.push(`font-size:${cell.size}pt`);
        const attrs = [
          cs > 1 ? `colspan="${cs}"` : '', rs > 1 ? `rowspan="${rs}"` : '',
          style.length ? `style="${style.join(';')}"` : ''
        ].filter(Boolean).join(' ');
        let body = runsToHtml(cell.runs, cell.size) || esc(cell.text || '');
        if (cell.image && cell.image.dataUrl) {
          const w = cell.image.w ? `width:${(cell.image.w * PT_TO_PX).toFixed(0)}px;` : 'max-width:100%;';
          body = `<img src="${cell.image.dataUrl}" style="${w}">` + (body ? '<br>' + body : '');
        }
        html += `<${tag} ${attrs}>${body}</${tag}>`;
      }
      html += '</tr>';
    });
    return html + '</table>';
  }

  /**
   * 渲染单个块（段落/标题/表格/图片/分隔线/代码）
   */
  function renderBlock(b, ctx) {
    const bodySize = ctx.bodySize || 10.5;
    const assets = ctx.assets || {};
    if (b.type === 'table') return `<div class="ly-tablewrap">${tableToHtml(b, { bodySize })}</div>`;
    if (b.type === 'hr') return '<hr class="ly-hr">';
    if (b.type === 'code') return `<pre class="ly-code">${esc(b.text)}</pre>`;
    if (b.type === 'image') {
      const a = assets[b.assetId];
      const widthPt = b.w || (a && a.w) || 300;
      const style = b.align === 'left' ? 'text-align:left' : b.align === 'right' ? 'text-align:right' : 'text-align:center';
      let out = `<div class="ly-image" style="${style}">`;
      if (a && a.dataUrl) out += `<img src="${a.dataUrl}" style="width:${(widthPt * PT_TO_PX).toFixed(0)}px">`;
      if (b.caption) out += `<div class="ly-caption" style="font-size:${Math.max(8, bodySize - 1.5)}pt">${runsToHtml(b.captionRuns || [{ t: b.caption }], bodySize)}</div>`;
      return out + '</div>';
    }
    const cls = b.type === 'heading' ? `ly-h ly-h${b.level}` : 'ly-p';
    const style = [];
    const size = b.size || defaultHeadingSize(b, bodySize) || bodySize;
    style.push(`font-size:${size}pt`);
    if (b.align) style.push(`text-align:${b.align}`);
    if (b.type === 'heading') {
      style.push(`font-weight:${b.bold !== false ? 700 : 400}`);
      if (b.level === 1) style.push('margin:14pt 0 8pt');
      else if (b.level === 2) style.push('margin:12pt 0 6pt');
      else style.push('margin:10pt 0 5pt');
    } else {
      style.push(`font-weight:${b.bold ? 700 : 400}`);
      if (b.indent) style.push(`text-indent:${b.indent}pt`);
      if (b.align === 'justify' || !b.align) style.push('text-align:justify');
      style.push(`margin:0 0 ${Math.max(2, bodySize * 0.35).toFixed(1)}pt`);
    }
    if (b.lineHeight && b.lineHeight > 0.8 && b.lineHeight < 3) style.push(`line-height:${b.lineHeight}`);
    const o = b.o || (b.translated ? core.runsToText(b.runs) : '');
    const tAttr = o ? ` data-original="${esc(o).slice(0, 4000)}"` : '';
    let inner = runsToHtml(b.runs, bodySize);
    if (!inner && b.translated) inner = esc(core.runsToText(b.runs));
    return `<div class="${cls}" style="${style.join(';')}"${tAttr}>${inner}</div>`;
  }

  /**
   * IR → 页面 HTML 字符串（含分栏容器还原）
   * @param {Object} ir
   * @param {Object} opts { bodySize }
   */
  function renderPages(ir, opts) {
    opts = opts || {};
    const bodySize = opts.bodySize || ir.bodySize || 10.5;
    const assets = {};
    (ir.assets || []).forEach(a => assets[a.id] = a);
    const ctx = { bodySize, assets };

    let html = '';
    for (const b of ir.blocks) {
      if (b.type === 'pagebreak' || b.pageBreakBefore) { html += '<div class="ly-pagebreak"></div>'; if (b.type === 'pagebreak') continue; }
      if (b.type === 'container') {
        // 分栏容器：percent 宽度按各栏原宽比例分配，尽量还原原分栏比例
        const groups = (b.columns || []).filter(g => (g.blocks || []).length);
        if (!groups.length) continue;
        const widths = groups.map(g => g.width || 1);
        const total = widths.reduce((a, x) => a + x, 0) || 1;
        const cols = groups.map((g, i) => {
          const pct = ((widths[i] / total) * 100).toFixed(2);
          const inner = g.blocks.map(cb => renderBlock(cb, ctx)).join('');
          return `<div class="ly-col" style="width:${pct}%">${inner}</div>`;
        }).join('');
        html += `<div class="ly-columns">${cols}</div>`;
        continue;
      }
      html += renderBlock(b, ctx);
    }
    return html;
  }

  function defaultHeadingSize(b, bodySize) {
    if (b.type !== 'heading') return null;
    const l = b.level || 1;
    return [bodySize + 6, bodySize + 3.5, bodySize + 1.5, bodySize + 0.5][Math.min(3, l - 1)];
  }

  /**
   * 完整可独立打开的 HTML 文档（含分页样式，可用于打印导出 PDF）
   */
  function renderDocument(ir, opts) {
    opts = opts || {};
    const pw = ir.page.width, ph = ir.page.height;
    const m = ir.page.margin || [56.7, 56.7, 56.7, 56.7];
    const fontStack = opts.fontStack || "'Source Han Serif SC','Noto Serif SC',SimSun,'Songti SC',serif";
    const title = opts.title || ir.meta.title || ir.meta.fileName || '灵译';
    const body = renderPages(ir, opts);
    const css = `
  @page { size: ${pw}pt ${ph}pt; margin: ${m[1]}pt ${m[2]}pt ${m[3]}pt ${m[0]}pt; }
  html,body{margin:0;padding:0;background:#eef1f6;}
  body{font-family:${fontStack};color:#000;font-size:${(opts.bodySize || ir.bodySize || 10.5)}pt;line-height:1.5;}
  .ly-doc{width:${pw}pt;margin:0 auto;}
  .ly-page{width:${pw}pt;min-height:${ph}pt;box-sizing:border-box;background:#fff;
           padding:${m[1]}pt ${m[2]}pt ${m[3]}pt ${m[0]}pt;margin:0 auto 14px;box-shadow:0 2px 10px rgba(0,0,0,.12);}
  .ly-p{margin:0;}
  .ly-h{margin:12pt 0 6pt;}
  .ly-table{width:100%;border-collapse:collapse;table-layout:fixed;margin:6pt 0;}
  .ly-table th,.ly-table td{border:1px solid #888;padding:2pt 4pt;vertical-align:middle;word-wrap:break-word;overflow-wrap:anywhere;}
  .ly-table th{font-weight:700;background:#f5f5f5;}
  .ly-image{margin:8pt 0;}
  .ly-image img{max-width:100%;}
  .ly-caption{margin-top:4pt;}
  .ly-hr{border:0;border-top:1px solid #999;margin:8pt 0;}
  .ly-code{font-family:Consolas,monospace;font-size:9pt;background:#f6f8fa;padding:6pt;white-space:pre-wrap;}
  .ly-pagebreak{page-break-after:always;break-after:page;}
  .ly-bilingual{border-collapse:collapse;width:100%;}
  .ly-bilingual td{width:50%;vertical-align:top;padding:0 6pt;border:0;}
  .ly-bilingual tr.row{border-bottom:1px dashed #ddd;}
  .ly-table,.ly-image{page-break-inside:avoid;break-inside:avoid;}
  .ly-h{page-break-after:avoid;break-after:avoid;}
  /* 分栏还原：模拟原 PDF 的双栏排版 */
  .ly-columns{display:flex;gap:12pt;align-items:flex-start;margin:2pt 0 4pt;}
  .ly-col{min-width:0;overflow-wrap:anywhere;}
  /* 打印时页边距完全交给 @page 处理，容器不能再有内边距，否则会双重缩进 */
  @media print{
    body{background:#fff;font-size:${(opts.bodySize || ir.bodySize || 10.5)}pt;}
    .ly-page{box-shadow:none;margin:0;padding:0;width:auto;min-height:0;}
    .ly-doc{width:auto;margin:0;}
  }
  @media screen { .ly-toolbar{position:sticky;top:0;z-index:9;background:#1e293b;color:#fff;padding:8px 14px;font-family:system-ui,sans-serif;font-size:13px;display:flex;gap:12px;align-items:center;} .ly-toolbar button{background:#4f6ef7;border:0;color:#fff;padding:5px 12px;border-radius:14px;cursor:pointer;font-size:13px;} }
  @media print { .ly-toolbar{display:none !important;} }
`;
    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>${esc(title)}</title>
<style>${css}</style></head>
<body>
<div class="ly-toolbar"><span>灵译 · 版式还原预览</span>
  <button onclick="window.print()">打印 / 导出 PDF</button>
  <button onclick="document.body.classList.toggle('orig');document.querySelectorAll('.ly-p,.ly-h').forEach(function(e){var t=e.dataset.original;if(!t)return;var cur=e.innerHTML;e.innerHTML=t;e.dataset.original=cur;})">原文/译文切换</button>
</div>
<div class="ly-doc"><div class="ly-page">${body}</div></div>
</body></html>`;
  }

  /** 双语对照 HTML（左右并排，按段落对齐） */
  function renderBilingualDocument(ir, opts) {
    opts = opts || {};
    const rows = [];
    const push = (o, t, heading) => {
      if (!o && !t) return;
      const tag = heading ? 'strong' : 'span';
      rows.push(`<tr class="row"><td><${tag}>${esc(o)}</${tag}></td><td><${tag}>${esc(t)}</${tag}></td></tr>`);
    };
    const walk = (blocks) => {
      for (const b of blocks) {
        if (b.type === 'table') { push(tableText(b, 'o'), tableText(b, 'text')); continue; }
        if (b.type === 'image') { if (b.caption) push(b.captionO || b.caption, b.caption); continue; }
        if (b.type === 'hr' || b.type === 'code' || b.type === 'pagebreak') continue;
        if (b.type === 'container') { (b.columns || []).forEach(g => walk(g.blocks || [])); continue; }
        push(b.o || '', core.runsToText(b.runs), b.type === 'heading');
      }
    };
    walk(ir.blocks || []);
    const title = opts.title || ('双语对照 · ' + (ir.meta.fileName || ''));
    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>${esc(title)}</title>
<style>
 body{margin:0;font-family:'Source Han Serif SC',SimSun,serif;font-size:10.5pt;line-height:1.6;background:#eef1f6;}
 .wrap{max-width:1100px;margin:0 auto;background:#fff;padding:24pt 28pt;box-shadow:0 2px 12px rgba(0,0,0,.1);}
 h1{font-size:14pt;text-align:center;margin:0 0 16pt;}
 table{border-collapse:collapse;width:100%;}
 td{width:50%;vertical-align:top;padding:5pt 8pt;border-bottom:1px solid #e5e7eb;}
 td:first-child{color:#334155;border-right:1px solid #e5e7eb;}
 @media print{ body{background:#fff;} .wrap{box-shadow:none;max-width:none;padding:0;} }
</style></head><body><div class="wrap"><h1>${esc(title)}</h1><table>${rows.join('')}</table></div></body></html>`;
  }

  function tableText(t, key) {
    return (t.rows || []).map(row => row.map(c => (key === 'o' ? (c.o || '') : (c.text || ''))).join(' | ')).join('\n');
  }

  /** 纯文本导出（保留段落换行与表格制表符） */
  function renderText(ir, opts) {
    opts = opts || {};
    const lines = [];
    const walk = (blocks) => {
      for (const b of blocks) {
        if (b.type === 'table') {
          (b.rows || []).forEach(row => lines.push(row.map(c => c.text || '').join('\t')));
          lines.push('');
          continue;
        }
        if (b.type === 'image') { if (b.caption) lines.push(b.caption); continue; }
        if (b.type === 'hr') { lines.push('---'); continue; }
        if (b.type === 'code') { lines.push(b.text || ''); continue; }
        if (b.type === 'pagebreak') { lines.push(''); continue; }
        if (b.type === 'container') { (b.columns || []).forEach(g => { walk(g.blocks || []); lines.push(''); }); continue; }
        const indent = b.indent ? '\u3000\u3000' : '';
        lines.push(indent + core.runsToText(b.runs));
        if (b.type === 'heading') lines.push('');
      }
    };
    walk(ir.blocks || []);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  return { renderPages, renderDocument, renderBilingualDocument, renderText, renderBlock, runsToHtml, computeColWidths, tableToHtml };
});
