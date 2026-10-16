/* analyze-columns.js — 用诊断报告的行坐标，判断"分栏为什么没切开"
 * 用法: node test/tools/analyze-columns.js <诊断报告.json> [页号]
 */
'use strict';
const fs = require('fs');

const file = process.argv[2];
const wantPage = parseInt(process.argv[3] || '0', 10);
if (!file || !fs.existsSync(file)) { console.log('用法: node test/tools/analyze-columns.js <诊断报告.json> [页号]'); process.exit(1); }
const rep = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

function analyze(page) {
  const lines = (page.lines || []).filter(l => l.x != null);
  console.log('--- page ' + page.number + '  ' + page.w + 'x' + page.h +
    '  行数 ' + lines.length + '  区域 ' + JSON.stringify(page.columns) + ' ---');

  /* 1) 行首 x 直方图（用行数据算） */
  const hist = {};
  lines.forEach(l => { const b = Math.floor(l.x / 20) * 20; hist[b] = (hist[b] || 0) + 1; });
  const max = Math.max.apply(null, Object.keys(hist).map(k => hist[k]));
  console.log('  行首 x 分布:');
  Object.keys(hist).map(Number).sort((a, b) => a - b).forEach(b => {
    console.log('    x=' + String(b).padStart(4) + '  ' + '█'.repeat(Math.max(1, Math.round(hist[b] / max * 46))) + ' ' + hist[b]);
  });

  /* 2) 找空档（候选走廊） */
  const keys = Object.keys(hist).map(Number).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < keys.length; i++) {
    const w = keys[i] - keys[i - 1] - 20;
    if (w >= 24) gaps.push({ from: keys[i - 1] + 20, to: keys[i], width: w, left: hist[keys[i - 1]], right: hist[keys[i]] });
  }
  console.log('  候选走廊（行首 x 的空档 ≥24pt）: ' +
    (gaps.length ? gaps.map(g => g.from + '~' + g.to + '(' + g.width + 'pt)').join('  ') : '无'));

  /* 3) 按"行文字长度"分两类看位置：短行=边注，长行=正文 */
  const byLen = { short: [], long: [] };
  lines.forEach(l => {
    const t = String(l.text || '');
    (t.length < 34 ? byLen.short : byLen.long).push(l);
  });
  console.log('  长行(≥34字, 正文) ' + byLen.long.length + ' 条   短行(<34字, 边注/页眉) ' + byLen.short.length + ' 条');
  const xsOf = arr => {
    if (!arr.length) return '无';
    const xs = arr.map(l => l.x);
    return 'x ' + Math.min.apply(null, xs) + '~' + Math.max.apply(null, xs) +
      '  常见值 ' + JSON.stringify([...new Set(xs.map(x => Math.round(x / 10) * 10))].sort((a, b) => a - b).slice(0, 8));
  };
  console.log('    长行位置: ' + xsOf(byLen.long));
  console.log('    短行位置: ' + xsOf(byLen.short));

  /* 4) 结论：若长行与短行的 x 区间重叠，说明是"同栏内混排"；分离则说明是两栏 */
  if (byLen.long.length && byLen.short.length) {
    const lx = byLen.long.map(l => l.x), sx = byLen.short.map(l => l.x);
    const lMin = Math.min.apply(null, lx), lMax = Math.max.apply(null, lx);
    const sMin = Math.min.apply(null, sx), sMax = Math.max.apply(null, sx);
    const overlap = Math.min(lMax, sMax) - Math.max(lMin, sMin);
    console.log('    长行 x 区间 [' + lMin + ',' + lMax + ']  短行 x 区间 [' + sMin + ',' + sMax + ']  重叠 ' + Math.round(overlap));
    if (overlap > 0 && sMin < lMin + 60 && sMax < lMin + 200) {
      console.log('    → 短行集中在正文栏左侧的窄带里：典型的"窄左边注栏 + 宽正文栏"');
    } else if (overlap <= 0) {
      console.log('    → 长/短行 x 区间不重叠：两栏分离清晰');
    } else {
      console.log('    → x 区间大量重叠：可能是同栏混排（真单栏）或跨栏元素较多');
    }
  }

  /* 5) 按 y 排序打印前 30 行，看交替情况 */
  console.log('  按 y 排序的行（前 30，看正文/边注是否交替）:');
  lines.slice().sort((a, b) => a.y - b.y).slice(0, 30).forEach(l => {
    const t = String(l.text || '');
    const tag = t.length < 34 ? '短' : '长';
    console.log('    y=' + String(Math.round(l.y)).padStart(7) + ' x=' + String(Math.round(l.x)).padStart(5) +
      ' sz=' + String(l.size).padStart(5) + ' [' + tag + '] ' + JSON.stringify(t.slice(0, 52)));
  });
  console.log('');
}

const pages = rep.pages || [];
if (wantPage > 0) {
  const p = pages.find(x => x.number === wantPage);
  if (p) analyze(p); else console.log('没有第 ' + wantPage + ' 页');
} else {
  /* 默认分析前 2 页 + 有"很多区域"的页 */
  pages.slice(0, 2).forEach(analyze);
  const many = pages.filter(p => (p.columns || []).length > 5).slice(0, 1);
  many.forEach(analyze);
}
