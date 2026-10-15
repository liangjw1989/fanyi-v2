/* ============================================================================
 * 灵译 · 版面几何工具 (layout.js)
 * ----------------------------------------------------------------------------
 * 供 PDF 结构抽取使用：行聚类、空白割缝分析、区域树（阅读顺序）、表格栅格识别。
 * 纯数学工具，无外部依赖，可在 Node 与浏览器中运行。
 * © 2026 灵译 LingYi · 个人使用免费，商业使用需授权（见 LICENSE）
 * ========================================================================== */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.LingyiLayout = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPS = 0.4;

  /* ------------------------------------------------------------------ 基础 */

  function width(it) { return it.x1 - it.x0; }
  function height(it) { return it.y1 - it.y0; }
  function centerY(it) { return (it.y0 + it.y1) / 2; }
  function centerX(it) { return (it.x0 + it.x1) / 2; }

  function unionBox(items) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of items) {
      if (it.x0 < x0) x0 = it.x0;
      if (it.y0 < y0) y0 = it.y0;
      if (it.x1 > x1) x1 = it.x1;
      if (it.y1 > y1) y1 = it.y1;
    }
    return { x0, y0, x1, y1 };
  }

  /** 两个区间重叠长度 */
  function overlap1d(a0, a1, b0, b1) {
    return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  }

  /**
   * 一行有多少字"横跨" [gx0, gx1] 这个竖直切口
   * 重叠超过行高 60% 才认为真的跨栏（避免标点/边界误差）
   */
  function crossingCount(items, gx0, gx1) {
    let n = 0;
    for (const it of items) {
      const ov = overlap1d(it.x0, it.x1, gx0, gx1);
      if (ov > 0 && ov > Math.min(width(it), (gx1 - gx0)) * 0.6) n++;
      else if (ov > 0 && it.x0 < gx0 && it.x1 > gx1) n++;
    }
    return n;
  }

  /* -------------------------------------------------------------- 1. 行聚类 */

  /**
   * 把文本片段按基线聚成行
   * @returns {Array<{items:Array,y0,y1,cy,size,x0,x1}>}
   */
  function groupLines(items) {
    const sorted = items.slice().sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));
    const lines = [];
    let cur = [];
    let curKey = null;                    // 当前行参考的中心线
    let curSize = 0;
    for (const it of sorted) {
      const h = Math.max(0.5, height(it));
      const sz = it.size || h;
      if (!cur.length) { cur = [it]; curKey = it.y0 + h * 0.72; curSize = sz; continue; }
      const ref = curKey;
      const tol = Math.max(1.6, Math.min(curSize, sz) * 0.45, h * 0.35);
      const key = it.y0 + h * 0.72;
      if (Math.abs(key - ref) <= tol) {
        cur.push(it);
        curSize = Math.max(curSize, sz);
        // 用高度加权平均更新基线，长片段权重更大
        const wsum = cur.reduce((a, x) => a + Math.max(1, width(x)), 0);
        curKey = cur.reduce((a, x) => a + (x.y0 + Math.max(0.5, height(x)) * 0.72) * Math.max(1, width(x)), 0) / wsum;
      } else {
        lines.push(finishLine(cur, curSize));
        cur = [it]; curKey = key; curSize = sz;
      }
    }
    if (cur.length) lines.push(finishLine(cur, curSize));
    lines.sort((a, b) => a.y0 - b.y0);
    return lines;
  }

  function finishLine(items, size) {
    const s = items.slice().sort((a, b) => a.x0 - b.x0);
    const box = unionBox(s);
    const sz = s.map(x => x.size || height(x)).sort((a, b) => b - a)[Math.floor(s.length / 3)] || size;
    const gap = lineMaxGap(s);
    return {
      items: s, y0: box.y0, y1: box.y1, cy: (box.y0 + box.y1) / 2,
      x0: box.x0, x1: box.x1, size: sz, gaps: gap
    };
  }

  /** 行内最大空白间隔（用于表格/多栏识别） */
  function lineMaxGap(items, minGap) {
    minGap = minGap == null ? 2 : minGap;
    let maxGap = 0, at = null;
    for (let i = 1; i < items.length; i++) {
      const g = items[i].x0 - items[i - 1].x1;
      if (g > maxGap) { maxGap = g; at = items[i - 1].x1; }
    }
    return { size: maxGap >= minGap ? maxGap : 0, at: at };
  }

  /** 行内所有 >= minGap 的空白段（用于切分单元格） */
  function lineGaps(items, minGap) {
    const gaps = [];
    for (let i = 1; i < items.length; i++) {
      const g = items[i].x0 - items[i - 1].x1;
      if (g >= (minGap == null ? 3 : minGap)) gaps.push({ from: items[i - 1].x1, to: items[i].x0, size: g, index: i });
    }
    return gaps;
  }

  /* -------------------------------------------------------- 2. 竖直切口检测 */

  /**
   * 找出竖直空白走廊（候选分栏中缝）。
   * 做法：把"有文字覆盖的 x 区间"合并，区间之间的空隙就是走廊。
   * 判据：走廊两侧都要有足够内容；被通栏标题挡住的部分按覆盖率折算权重。
   * @returns {Array<{x0,x1,width,coverage,score,mid,leftCount,rightCount}>}
   */
  function findVerticalGutters(items, opts) {
    opts = opts || {};
    const minGap = opts.minGap || 8;
    const minItems = opts.minItems || 2;
    if (!items.length) return [];

    // 1) 合并覆盖区间（合并后必须按 x 排序，否则空隙会算错）
    const sorted = items.slice().sort((a, b) => a.x0 - b.x0);
    const segs = [];
    for (const it of sorted) {
      const last = segs[segs.length - 1];
      if (last && it.x0 <= last.x1 + 0.01) { if (it.x1 > last.x1) last.x1 = it.x1; }
      else segs.push({ x0: it.x0, x1: it.x1 });
    }
    segs.sort((a, b) => a.x0 - b.x0);

    let yTop = Infinity, yBot = -Infinity, wsum = 0;
    for (const it of items) {
      if (it.y0 < yTop) yTop = it.y0;
      if (it.y1 > yBot) yBot = it.y1;
      wsum += (it.x1 - it.x0);
    }
    const totalH = Math.max(1, yBot - yTop);
    const lineH = Math.max(4, (wsum / items.length) * 0.14);

    // 2) 相邻覆盖区间之间就是候选走廊
    const candidates = [];
    for (let i = 0; i < segs.length - 1; i++) {
      const a = segs[i].x1, b = segs[i + 1].x0;
      if (b - a >= minGap) candidates.push({ x0: a, x1: b, width: b - a });
    }
    if (!candidates.length) return [];
    // 只评估最宽的若干个，避免在正文里挑出无意义的细小空隙
    candidates.sort((p, q) => q.width - p.width);
    const top = candidates.slice(0, 16);

    const out = [];
    for (const c of top) {
      const mid = (c.x0 + c.x1) / 2;
      const left = items.filter(it => it.x1 <= c.x0 + 0.5);
      const right = items.filter(it => it.x0 >= c.x1 - 0.5);
      if (left.length < minItems || right.length < minItems) continue;
      // 走廊之外的片段必须是"完整落在某一侧"，否则说明还有内容穿插
      if (left.length + right.length !== items.length) continue;
      // 覆盖率：不落在任何一侧、却横跨走廊中央的通栏内容会降低覆盖率
      let blockedH = 0;
      for (const it of items) {
        if (it.x0 < mid && it.x1 > mid) blockedH += Math.max(lineH, it.y1 - it.y0);
      }
      const coverage = Math.max(0, 1 - blockedH / totalH);
      const balance = Math.min(left.length, right.length) / Math.max(left.length, right.length);
      out.push({
        x0: c.x0, x1: c.x1, width: c.width, mid: mid,
        coverage: coverage, balance: balance,
        score: coverage * 4 + balance * 2 + Math.min(1, c.width / 60),
        leftCount: left.length, rightCount: right.length
      });
    }
    out.sort((p, q) => q.score - p.score);
    return out;
  }

  /* ------------------------------------------------------ 3. 区域树（阅读顺序） */

  /**
   * 分析一页的阅读顺序（支持"通栏标题 + 双栏正文"）：
   *   1) 先用中缝把内容切成 [栏带] 与 [通栏块]（允许少量通栏内容横跨中缝）
   *   2) 栏带内按 左栏 → 右栏 阅读
   *   3) 通栏块按它在页面上的纵向位置插回正确位置
   * @returns {Array<{lines, box, spanning, depth}>} 按阅读顺序排列的区域
   */
  function analyzePage(items, opts) {
    opts = opts || {};
    if (!items.length) return [];
    const initialLines = groupLines(items);
    if (initialLines.length < 6) return [mkLineRegion(initialLines, 0)];

    // 在"片段级"找竖直走廊：分栏排版里，中缝上横跨的片段极少（通常只有通栏标题/公式）。
    const corridor = findColumnCorridor(items, opts);
    if (!corridor) return [mkLineRegion(initialLines, 0)];

    // 按走廊把片段分成 左 / 右 / 通栏
    const leftItems = [], rightItems = [], spanItems = [];
    for (const it of items) {
      const c = (it.x0 + it.x1) / 2;
      const leftPart = Math.max(0, Math.min(it.x1, corridor.x1) - Math.max(it.x0, corridor.x0));
      const w = Math.max(1, it.x1 - it.x0);
      if (leftPart / w > 0.25 && leftPart / w < 0.75) { spanItems.push(it); continue; }  // 明确横跨中缝
      if (c < corridor.x0) leftItems.push(it);
      else if (c > corridor.x1) rightItems.push(it);
      else spanItems.push(it);
    }
    const leftLines = groupLines(leftItems);
    const rightLines = groupLines(rightItems);
    if (leftLines.length < 3 || rightLines.length < 3) return [mkLineRegion(initialLines, 0)];
    const ratio = Math.min(leftLines.length, rightLines.length) / Math.max(leftLines.length, rightLines.length);
    if (ratio < 0.2) return [mkLineRegion(initialLines, 0)];

    // 通栏片段单独成行（按基线聚合）
    const spanLines = groupLines(spanItems);
    const box = unionBox(items);
    const colW = Math.max(
      Math.max.apply(null, leftItems.map(i => i.x1).concat([0])) - Math.min.apply(null, leftItems.map(i => i.x0).concat([Infinity])),
      Math.max.apply(null, rightItems.map(i => i.x1).concat([0])) - Math.min.apply(null, rightItems.map(i => i.x0).concat([Infinity]))
    );
    const out = [];
    const topLimit = box.y0 + (box.y1 - box.y0) * 0.06 + 6;
    const topSpans = spanLines.filter(l => l.y0 <= topLimit).sort((a, b) => a.y0 - b.y0);
    const midSpans = spanLines.filter(l => l.y0 > topLimit).sort((a, b) => a.y0 - b.y0);
    for (const l of topSpans) out.push(mkLineRegion([l], 0, true));

    const splitAt = midSpans.length ? midSpans[0].y0 : Infinity;
    for (const colLines of [leftLines, rightLines]) {
      let cur = [];
      for (const l of colLines) {
        if (l.y0 >= splitAt && cur.length) { out.push(mkLineRegion(cur, 0)); cur = []; }
        cur.push(l);
      }
      if (cur.length) out.push(mkLineRegion(cur, 0));
    }
    for (const l of midSpans) out.push(mkLineRegion([l], 0, true));
    return out.length ? out : [mkLineRegion(initialLines, 0)];
  }

  /**
   * 找"分栏走廊"：一条竖直带，横跨它的片段数量最少。
   * 用覆盖率（走廊在纵向上的空白比例）与两侧平衡度打分。
   */
  function findColumnCorridor(items, opts) {
    opts = opts || {};
    if (items.length < 12) return null;
    // 候选：所有片段的左/右边界之间的空隙
    const pts = new Set();
    for (const it of items) { pts.add(it.x0); pts.add(it.x1); }
    const xs = [...pts].sort((a, b) => a - b);
    const minGap = opts.minGap || 12;

    let yTop = Infinity, yBot = -Infinity, wsum = 0;
    for (const it of items) {
      if (it.y0 < yTop) yTop = it.y0;
      if (it.y1 > yBot) yBot = it.y1;
      wsum += (it.x1 - it.x0);
    }
    const totalH = Math.max(1, yBot - yTop);
    const lineH = Math.max(4, (wsum / items.length) * 0.14);

    let best = null;
    // 依次放宽条件：先找"标准双栏"，找不到再找"一栏内容较少"的排版
    const passes = [
      { minCov: 0.55, minBal: 0.2 },
      { minCov: 0.42, minBal: 0.1 }
    ];
    for (const pass of passes) {
      for (let i = 0; i < xs.length - 1; i++) {
        const a = xs[i], b = xs[i + 1];
        if (b - a < minGap) continue;
        const mid = (a + b) / 2;
        let crossH = 0, crossN = 0, leftN = 0, rightN = 0;
        for (const it of items) {
          const c = (it.x0 + it.x1) / 2;
          if (it.x0 < mid && it.x1 > mid) { crossN++; crossH += Math.max(lineH, it.y1 - it.y0); }
          else if (c < mid) leftN++;
          else rightN++;
        }
        if (leftN < 4 || rightN < 4) continue;
        const coverage = Math.max(0, 1 - crossH / totalH);
        if (coverage < pass.minCov) continue;
        const balance = Math.min(leftN, rightN) / Math.max(leftN, rightN);
        if (balance < pass.minBal) continue;
        const score = coverage * 3 + balance * 1.5 - Math.min(1, crossN / 6);
        if (!best || score > best.score) {
          best = { x0: a, x1: b, mid: mid, coverage: coverage, balance: balance, crossN: crossN, score: score };
        }
      }
      if (best) break;
    }
    return best;
  }

  function analyzeLines(lines, depth, opts) {
    return analyzePage(lines.reduce((a, l) => a.concat(l.items), []), opts);
  }

  function mkLineRegion(lines, depth, spanning) {
    const items = lines.reduce((a, l) => a.concat(l.items), []);
    const box = items.length ? unionBox(items) : { x0: 0, y0: 0, x1: 0, y1: 0 };
    return {
      lines: lines, items: items, box: box, depth: depth || 0,
      spanning: !!spanning, columnCount: 1,
      width: box.x1 - box.x0, height: box.y1 - box.y0
    };
  }

  /**
   * 兼容旧接口：区域内递归切分（保留给外部调用）
   */
  function regionize(items, depth, maxDepth) {
    return analyzePage(items, {});
  }

  /**
   * 通栏块与栏内块的顺序修正（analyzePage 已处理，保留给兼容调用）
   */
  function orderRegionsByFlow(regions) {
    return regions;
  }

  /* ------------------------------------------------------------ 4. 表格栅格 */

  /**
   * 判断一组行是否构成表格，若构成则生成 rows
   * 条件：≥2 行，每行 ≥2 个"列块"，且各行的列块左边界在容差内对齐
   */
  function detectTable(lines, opts) {
    opts = opts || {};
    const minCols = opts.minCols || 2;
    const minRows = opts.minRows || 2;
    if (lines.length < minRows) return null;

    // 每行按大空白切分成"列块"
    const rowsCells = [];
    for (const line of lines) {
      const gaps = lineGaps(line.items, Math.max(6, (line.size || 10) * 0.9));
      if (!gaps.length) return null;
      const cells = [];
      let start = 0;
      for (const g of gaps) {
        cells.push(line.items.slice(start, g.index));
        start = g.index;
      }
      cells.push(line.items.slice(start));
      if (cells.length < minCols) return null;
      rowsCells.push(cells);
    }

    // 表格特征：大多数行都是多列，且每格文字较短（正文的"大空白"不是这样）
    const multiCount = rowsCells.filter(c => c.length >= minCols).length;
    if (multiCount < Math.ceil(rowsCells.length * 0.75)) return null;
    let totalCells = 0, longCells = 0;
    for (const cells of rowsCells) {
      for (const c of cells) {
        totalCells++;
        if (c.map(x => x.str).join('').trim().length > 22) longCells++;
      }
    }
    if (totalCells && longCells / totalCells > 0.35) return null;

    // 列边界聚类：用所有单元格的左边界
    const lefts = [];
    for (const cells of rowsCells) for (const c of cells) lefts.push(c[0].x0);
    lefts.sort((a, b) => a - b);
    const clusters = [];
    for (const x of lefts) {
      const last = clusters[clusters.length - 1];
      if (last && Math.abs(last.mean - x) <= Math.max(4, (opts.tol || 6))) {
        last.vals.push(x); last.mean = last.vals.reduce((a, b) => a + b, 0) / last.vals.length;
      } else clusters.push({ mean: x, vals: [x] });
    }
    const colCount = clusters.length;
    if (colCount < minCols) return null;
    // 列数必须 ≥ 每行平均列块数
    const avgCells = rowsCells.reduce((a, c) => a + c.length, 0) / rowsCells.length;
    if (avgCells < minCols) return null;

    // 真实表格的每行列块数应当稳定；正文行被大空白切开时列数会剧烈变化
    const counts = rowsCells.map(c => c.length);
    const cMin = Math.min(...counts), cMax = Math.max(...counts);
    if (cMax - cMin > 2) return null;
    const multiRows = counts.filter(c => c >= minCols).length;
    if (multiRows < Math.max(minRows, Math.ceil(rowsCells.length * 0.75))) return null;

    // 按列中心分配单元格
    const grid = [];
    let avgAligned = 0;
    for (const cells of rowsCells) {
      const row = new Array(colCount).fill(null);
      let aligned = 0;
      for (const c of cells) {
        const cx = c[0].x0;
        let bi = 0, bd = Infinity;
        clusters.forEach((cl, i) => { const d = Math.abs(cl.mean - cx); if (d < bd) { bd = d; bi = i; } });
        if (bd <= Math.max(6, (opts.tol || 6))) aligned++;
        if (!row[bi]) row[bi] = c; else row[bi] = row[bi].concat(c);
      }
      avgAligned += aligned / cells.length;
      grid.push(row.map(c => c ? { items: c } : null));
    }
    avgAligned /= rowsCells.length;
    if (avgAligned < 0.8) return null;
    // 网格不应大面积空缺（否则是把正文误判为表格）
    let empty = 0;
    for (const row of grid) for (let i = 0; i < colCount; i++) if (!row[i]) empty++;
    const fillRatio = 1 - empty / (grid.length * colCount);
    if (fillRatio < 0.6) return null;

    return { colCount, grid, rowCount: rowsCells.length, quality: avgAligned, fillRatio };
  }

  /* ---------------------------------------------------------------- 导出 */

  return {
    EPS, width, height, centerX, centerY, unionBox, overlap1d, crossingCount,
    groupLines, lineMaxGap, lineGaps, findVerticalGutters, findColumnCorridor,
    analyzePage, analyzeLines, mkLineRegion, regionize, orderRegionsByFlow,
    detectTable
  };
});
