/* coords.test.js — 坐标方向与绘制位置（y 轴向上 → 向下的转换）
 * 用法: node test/coords.test.js [字体路径]
 *
 * 为什么必须有这个测试（真实故障，已用渲染截图确认）：
 *   pdf-extract 产出的行坐标是 **y 轴向上（从页面底部算）** —— 因为
 *   pdf.js 的 textContent item 没有 pageHeight 字段，makeItem 用的是
 *   `baseline = tr[5]`（PDF 原始坐标）。
 *   而 canvas 与 PDF 内容流按 **y 轴向下（从顶部算）** 处理。
 *   漏掉这一次转换的后果：
 *     · 整页内容**上下翻转**（底部的版权声明跑到顶部）
 *     · 分块失效，整页被合并成一个巨大块 → 译文全部叠在一起
 *   肉眼一眼能看出，但普通单元测试查不到，所以这里显式锁住坐标约定。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');

const sb = {
  console, Math, Object, Array, String, Number, Map, Set, Uint8Array, DataView, ArrayBuffer,
  Error, JSON, isFinite, parseInt, parseFloat, atob, setTimeout, clearTimeout, Promise, Date,
  RegExp, TextEncoder, Blob: function () { }, URL: {},
  document: { createElement: () => ({ style: {}, textContent: '', innerHTML: '' }) }
};
sb.globalThis = sb; sb.window = sb;
const ctx = vm.createContext(sb);
for (const f of ['pdf-font.js', 'render-pdf-inplace.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const F = sb.LingyiPdfFont;
const R = sb.LingyiPdfInPlace;

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { console.log('  \u2713 ' + n); pass++; }
  else { console.log('  \u2717 ' + n + (extra ? '  → ' + extra : '')); fail++; }
};
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 2 : tol);

const H = 842;
/* 真实页面 1 的坐标（来自诊断报告，y 轴向上） */
const TITLE_Y = 772;      // 标题：靠近页面顶部
const BODY_Y = 700;       // 正文
const BOTTOM_Y = 72;      // 页面底部那行

console.log('=== 1) buildBlocks：y 轴向上 → 向下 ===');
let info = null;
{
  const pages = [{
    number: 1, width: 595, height: H,
    lines: [
      { x: 166, x1: 500, y: TITLE_Y, size: 18.5, text: 'Circular RNAs and Their Role in Male Infertility: A Systematic Review' },
      { x: 166, x1: 520, y: BODY_Y, size: 10, text: 'Male infertility is a global health problem that affects approximately 7% of the male population' },
      { x: 35.7, x1: 153, y: BOTTOM_Y, size: 7, text: 'Attribution (CC BY) license' },
      { x: 35.7, x1: 120, y: BOTTOM_Y + 12, size: 7, text: 'distributed under the terms' }
    ]
  }];
  info = R.buildBlocks(pages)[0];
  console.log('    块数: ' + info.blocks.length);
  info.blocks.forEach((b, i) => console.log('      #' + i + ' y=' + Math.round(b.y) +
    ' h=' + Math.round(b.h) + ' ' + JSON.stringify(String(b.text).slice(0, 40))));

  const title = info.blocks.find(b => /Circular RNAs and Their Role/.test(b.text));
  const lic = info.blocks.find(b => /Attribution/.test(b.text));
  check('标题块存在', !!title);
  check('标题块在页面顶部（y < 100）', !!title && title.y < 100, title ? 'y=' + Math.round(title.y) : '无');
  check('版权块存在', !!lic);
  check('版权块在页面底部（y > 700）', !!lic && lic.y > 700, lic ? 'y=' + Math.round(lic.y) : '无');
  /* 精确换算：top = H - (y + size) */
  /* 精确换算：top = H - (y + size)。
     注意这两行版权是相邻的、会被合并成 1 块，
     合并后块顶由**上面那一行**决定（y 轴向上时 y 越大越靠上）：
       y=72 → top 763（下面那行）
       y=84 → top 751（上面那行）← 块顶取这个 */
  check('标题 top = 842 -(772+18.5) ≈ 51.5', !!title && near(title.y, 51.5, 1.5),
    title ? String(title.y) : '无');
  check('版权块 top = 842 -(84+7) ≈ 751（取较上的一行）', !!lic && near(lic.y, 751, 1.5),
    lic ? String(lic.y) : '无');
  /* 关键：不能把整页合并成一个块 */
  check('块数 ≥ 3（没有整页合并）', info.blocks.length >= 3, String(info.blocks.length));
  check('相邻的版权两行合并成 1 块', info.blocks.filter(b => /Attribution|distributed/.test(b.text)).length === 1,
    String(info.blocks.filter(b => /Attribution|distributed/.test(b.text)).length));
}

console.log('\n=== 2) buildOps：块（y 向下）→ PDF 绘制（y 向上）===');
let fontBytes = null;
{
  const cands = [process.argv[2], 'C:\\Windows\\Fonts\\simhei.ttf', 'C:\\Windows\\Fonts\\simfang.ttf',
    'C:\\Windows\\Fonts\\msyh.ttc', 'C:\\Windows\\Fonts\\Deng.ttf'].filter(Boolean);
  const fp = cands.find(p => { try { return fs.statSync(p).size > 100000; } catch (e) { return false; } });
  if (!fp) {
    console.log('    · 没有可用中文字体，跳过绘制检查');
  } else {
    fontBytes = new Uint8Array(fs.readFileSync(fp));
    const font = F.parseTtf(fontBytes, 0);
    const used = new Map();
    const ops = R.buildOps(info, H, F, font, used);
    const rects = ops.filter(o => o.kind === 'rect');
    const texts = ops.filter(o => o.kind === 'text');
    console.log('    ' + path.basename(fp) + '  矩形 ' + rects.length + ' / 文字 ' + texts.length);
    check('每个块都有白底矩形', rects.length === info.blocks.length,
      rects.length + ' vs ' + info.blocks.length);
    check('每个块至少有 1 行文字', texts.length >= info.blocks.length);

    /* 控件 1：标题的白底应贴近页面顶部 → PDF y 很大 */
    const title = info.blocks.find(b => /Circular RNAs/.test(b.text));
    const tRect = rects.find(r => near(r.x, title.x - 0.6, 0.2));
    check('标题白底在页面顶部（PDF y > 700）', !!tRect && tRect.y > 700,
      tRect ? 'y=' + Math.round(tRect.y) : '未找到');

    /* 控件 2：版权块的白底应贴近页面底部 → PDF y 很小 */
    const lic = info.blocks.find(b => /Attribution/.test(b.text));
    const lRect = rects.find(r => near(r.x, lic.x - 0.6, 0.2));
    check('版权白底在页面底部（PDF y < 100）', !!lRect && lRect.y < 100,
      lRect ? 'y=' + Math.round(lRect.y) : '未找到');

    /* 控件 3：所有文字基线必须落在页面内 */
    const outOfRange = texts.filter(t => t.y < -5 || t.y > H + 5);
    check('所有文字基线在页面范围内', outOfRange.length === 0,
      outOfRange.length ? outOfRange.slice(0, 2).map(t => Math.round(t.y)).join(',') : '');

    /* 控件 4：任意两块的白底不应互相覆盖（重叠=译文压在一起） */
    let overlap = 0;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 4 && oy > 4) overlap++;
      }
    }
    check('白底之间没有明显重叠', overlap === 0, overlap + ' 对重叠');
  }
}

console.log('\n=== 3) 生成可视检查用的 PDF（用真实坐标 + 原文文字）===');
{
  if (!fontBytes) { console.log('    · 跳过'); }
  else {
    const font = F.parseTtf(fontBytes, 0);
    const used = new Map();
    const ops = R.buildOps(info, H, F, font, used);
    const WHITE = Buffer.from(
      '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
      'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
      'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAED' +
      'ASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUF' +
      'BAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0' +
      'NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKj' +
      'pKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QA' +
      'HwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEE' +
      'BSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZH' +
      'SElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0' +
      'tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3' +
      '+iiigD//2Q==', 'base64');
    const pdf = R.buildPdf({
      pages: [{ width: 595, height: H, pxW: 1, pxH: 1, jpeg: new Uint8Array(WHITE), ops: ops }],
      fontObjs: F.buildFontObjects(font, used),
      title: 'coords-check'
    });
    const outDir = path.join(__dirname, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, 'coords-check.pdf');
    fs.writeFileSync(out, Buffer.from(pdf));
    console.log('    已生成: ' + out + '  (' + (pdf.length / 1024 / 1024).toFixed(2) + ' MB)');
    console.log('    可渲染检查：最上面的应是标题，最下面的应是 CC 许可证两行');
    check('生成的 PDF 以 %PDF 开头', Buffer.from(pdf.slice(0, 5)).toString('latin1') === '%PDF-');
  }
}

console.log('\n====================================================');
console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
