/* diagnostics.js — 导出"解析结构 + 版式判断"诊断报告，用于远程定位排版问题
 * © 2026 灵译 LingYi · 个人使用免费，商业使用需授权（见 LICENSE）
 * ----------------------------------------------------------------------------
 * 为什么需要它：PDF 没有段落/分栏/表格的语义，只能靠坐标推断。
 * 出问题时（句子被截断、顺序错乱、表格碎裂），必须看到"pdf.js 实际给出的
 * 坐标 + 我们推断出的块结构"才能定位。这个模块把这两部分一起导出成 JSON，
 * 用户下载后发给开发者即可复现问题。
 *
 * 报告内容（不含原文以外的新信息，也不含密钥）：
 *   · 每页尺寸与行数、每行坐标与文字
 *   · 每页推断出的分栏走廊
 *   · 每个块的类型、字号、对齐、缩进、文字（截断）
 *   · 表格的行列规格
 */
(function (root, factory) {
  const mod = factory(
    typeof require === 'function' ? require('./core.js') : root.LingyiCore
  );
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.LingyiDiagnostics = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  const MAX_TEXT = 220;

  function clip(s) {
    const t = String(s == null ? '' : s);
    return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '…(' + t.length + '字)' : t;
  }

  /** 把一个 IR 块描述成可读的摘要（对异常结构保持健壮，绝不抛错） */
  function describeBlock(b, i) {
    if (!b || typeof b !== 'object') return { i: i, type: '(空块)' };
    const base = { i: i, type: b.type || '(无类型)' };
    if (b.type === 'table') {
      const rows = b.rows || [];
      base.table = {
        rows: rows.length,
        cols: (rows[0] || []).length,
        colCounts: rows.slice(0, 12).map(r => (r || []).length),
        firstRow: (rows[0] || []).map(c => clip((c && c.text) || '')).slice(0, 8),
        sample: rows.slice(0, 3).map(r => (r || []).map(c => clip((c && c.text) || '')).slice(0, 6))
      };
      return base;
    }
    if (b.type === 'container') {
      const cols = (b.columns || []).filter(g => g && typeof g === 'object');
      base.columns = (b.columns || []).length;
      base.columnX = (b.columns || []).map(g => (g && g.x != null) ? Math.round(g.x) : null);
      base.blocks = [];
      cols.forEach((g, ci) => {
        (g.blocks || []).filter(Boolean).slice(0, 40).forEach((cb, bi) => {
          if (cb.type === 'table') {
            /* 表格可能"碎裂"（一张表被切成很多 2 行小表），
               所以必须记录行列规格与每行列数，才能判断。 */
            const trows = cb.rows || [];
            base.blocks.push({
              col: ci, i: bi, type: 'table',
              rows: trows.length,
              cols: (trows[0] || []).length,
              colCounts: trows.slice(0, 12).map(r => (r || []).length),
              firstRow: (trows[0] || []).map(c => clip((c && c.text) || '')).slice(0, 6)
            });
            return;
          }
          base.blocks.push({
            col: ci, i: bi, type: cb.type,
            size: cb.size, align: cb.align, indent: cb.indent,
            text: clip(core.runsToText(cb.runs || []))
          });
        });
      });
      /* 容器内的表格汇总：一眼看出"是否被拆成很多小表" */
      const innerTables = base.blocks.filter(x => x.type === 'table');
      if (innerTables.length) {
        base.tableCount = innerTables.length;
        base.tableRows = innerTables.reduce((a, t) => a + (t.rows || 0), 0);
        base.tableCols = innerTables.map(t => t.cols);
      }
      return base;
    }
    base.size = b.size;
    base.align = b.align;
    base.indent = b.indent;
    base.bold = !!b.bold;
    if (b.type === 'image') { base.caption = clip(b.caption || ''); base.w = b.w; base.h = b.h; return base; }
    base.text = clip(core.runsToText(b.runs || []));
    return base;
  }

  /** 递归统计各类块的数量（含容器内部） */
  function countTypes(blocks, acc) {
    acc = acc || {};
    for (const b of (blocks || [])) {
      if (!b || typeof b !== 'object') continue;
      acc[b.type || '(无类型)'] = (acc[b.type || '(无类型)'] || 0) + 1;
      if (b.type === 'container') {
        (b.columns || []).filter(Boolean).forEach(g => countTypes(g.blocks, acc));
      }
    }
    return acc;
  }

  /**
   * 生成诊断报告
   * @param {Object} ir  解析出的 IR
   * @param {Object} extra { fileName, version, pageLines, corridors, engine, target }
   * @returns {Object} 可直接 JSON.stringify 的报告
   */
  function build(ir, extra) {
    const e = extra || {};
    ir = ir || {};
    const blocks = (ir.blocks || []).filter(Boolean).map(describeBlock);
    const stats = countTypes(ir.blocks);
    const sizeHist = {};
    const alignHist = {};
    (function walk(bs) {
      for (const b of (bs || [])) {
        if (!b || typeof b !== 'object') continue;
        if (b.size) sizeHist[b.size] = (sizeHist[b.size] || 0) + 1;
        const k = b.align || '(未设置)';
        alignHist[k] = (alignHist[k] || 0) + 1;
        if (b.type === 'container') {
          (b.columns || []).filter(Boolean).forEach(g => walk(g.blocks));
        }
      }
    })(ir.blocks);

    return {
      generatedAt: new Date().toISOString(),
      app: { name: '灵译 LingYi', version: e.version || '?' },
      file: {
        name: e.fileName || (ir.meta && ir.meta.fileName) || '?',
        type: e.fileType || (ir.meta && ir.meta.source) || '?',
        pages: (ir.pages || []).length || 1
      },
      translate: { engine: e.engine || null, target: e.target || null },
      summary: {
        blockCount: (ir.blocks || []).length,
        byType: stats,
        bodySize: ir.bodySize,
        sizeHistogram: sizeHist,
        alignHistogram: alignHist,
        pageSize: ir.page ? { w: Math.round(ir.page.width), h: Math.round(ir.page.height), margins: ir.page.margins } : null
      },
      /* 每页的行与分栏走廊（判断"阅读顺序错乱"的关键证据） */
      pages: (ir.pages || []).map(p => ({
        number: p.number,
        w: Math.round(p.width),
        h: Math.round(p.height),
        columns: p.columns ? p.columns.map(c => ({ x: Math.round(c.x), x1: c.x1 != null ? Math.round(c.x1) : null })) : null,
        lineCount: p.lines ? p.lines.length : (p.lineCount || null),
        lines: (p.lines || []).slice(0, 80).map(l => ({
          x: Math.round(l.x != null ? l.x : (l.x0 || 0)),
          /* 行尾 x1 也要带上：判断"窄边注栏是否与正文重叠"必须靠它 */
          x1: Math.round(l.x1 != null ? l.x1 : ((l.x != null ? l.x : (l.x0 || 0)) + 1)),
          y: Math.round(l.y != null ? l.y : (l.y0 || 0)),
          size: l.size,
          text: clip(l.text || (l.items ? l.items.map(i => i.str).join('') : ''))
        })),
        /* 原始文字项坐标与 x 直方图：定位"中缝在哪"最直接的证据。
           解析层 pageMeta 里已经记录了，但这里忘了输出，导致报告缺字段。 */
        itemCount: p.itemCount,
        xHistogram: p.xHistogram || null,
        itemSamples: p.itemSamples || null
      })),
      blocks: blocks
    };
  }

  /** 生成一个便于发送的纯文本摘要（前 200 行） */
  function toText(report) {
    const L = [];
    L.push('灵译诊断报告  ' + report.generatedAt);
    L.push('文件: ' + report.file.name + '   页数: ' + report.file.pages);
    L.push('应用版本: ' + report.app.version);
    L.push('');
    L.push('块统计: ' + JSON.stringify(report.summary.byType));
    L.push('正文字号: ' + report.summary.bodySize);
    L.push('字号分布: ' + JSON.stringify(report.summary.sizeHistogram));
    L.push('对齐分布: ' + JSON.stringify(report.summary.alignHistogram));
    L.push('页面: ' + JSON.stringify(report.summary.pageSize));
    L.push('');
    L.push('=== 每页分栏 ===');
    (report.pages || []).forEach(p => {
      L.push('  page ' + p.number + '  ' + p.w + 'x' + p.h +
        '  分栏: ' + (p.columns ? JSON.stringify(p.columns) : '无') +
        '  行数: ' + (p.lineCount == null ? '?' : p.lineCount));
    });
    L.push('');
    L.push('=== 每页前若干行的坐标与文字（看阅读顺序）===');
    (report.pages || []).slice(0, 4).forEach(p => {
      L.push('--- page ' + p.number + ' ---');
      (p.lines || []).slice(0, 24).forEach(l => {
        L.push('   x=' + l.x + ' y=' + l.y + ' sz=' + l.size + '  ' + JSON.stringify(l.text));
      });
    });
    L.push('');
    L.push('=== 块结构（前 60 个）===');
    (report.blocks || []).slice(0, 60).forEach(b => {
      if (b.type === 'container') {
        L.push('[' + b.i + '] container ' + b.columns + ' 栏  x=' + JSON.stringify(b.columnX));
        (b.blocks || []).slice(0, 16).forEach(cb => {
          L.push('      col' + cb.col + ' [' + cb.type + ' sz=' + cb.size + ' ' + (cb.align || '') +
            '] ' + JSON.stringify(cb.text || ('表格 ' + cb.rows + ' 行')));
        });
      } else if (b.type === 'table') {
        L.push('[' + b.i + '] table ' + b.table.rows + '行 x ' + b.table.cols + '列  首行: ' + JSON.stringify(b.table.firstRow));
      } else {
        L.push('[' + b.i + '] ' + b.type + ' sz=' + b.size + ' ' + (b.align || '') +
          (b.indent ? ' ind=' + b.indent : '') + '  ' + JSON.stringify(b.text || b.caption || ''));
      }
    });
    return L.join('\n');
  }

  return { build, toText, describeBlock, countTypes, clip };
});
