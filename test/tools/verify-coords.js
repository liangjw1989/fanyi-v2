/* verify-coords.js — 用真实诊断坐标生成 PDF，验证坐标方向/位置是否正确
 *
 * 用法: node test/tools/verify-coords.js <诊断报告.json> <字体路径> <输出.pdf> [页号]
 *
 * 为什么需要它：坐标方向（y 向上 vs 向下）错了会让整页**上下翻转**、
 * 分块失效，肉眼一看就知道，但单元测试不容易察觉。
 * 这里走的是**线上同一套代码**（buildBlocks → buildOps → buildPdf），
 * 生成的 PDF 可以直接用 LibreOffice 渲染出来看。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = path.join(__dirname, '..', '..', 'src');

const repPath = process.argv[2];
const fontPath = process.argv[3] || 'C:\\Windows\\Fonts\\simhei.ttf';
const outPath = process.argv[4] || path.join(process.cwd(), 'verify-coords.pdf');
const wantPage = parseInt(process.argv[5] || '1', 10);

if (!repPath || !fs.existsSync(repPath)) { console.log('用法: node test/tools/verify-coords.js <报告.json> <字体> <输出pdf> [页号]'); process.exit(1); }

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
const R = sb.LingyiPdfInplaceEdit || sb.LingyiPdfInPlace;

const rep = JSON.parse(fs.readFileSync(repPath, 'utf8').replace(/^\uFEFF/, ''));
const page = rep.pages.find(p => p.number === wantPage);
if (!page) { console.log('报告里没有第 ' + wantPage + ' 页'); process.exit(1); }

/* 1x1 白色 JPEG（不放原页底图，只看文字落点） */
const WHITE_JPEG = Buffer.from(
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

const fontBytes = new Uint8Array(fs.readFileSync(fontPath));
const font = F.parseTtf(fontBytes, 0);
const used = new Map();

console.log('报告页: ' + page.number + '  ' + page.width + 'x' + page.height +
  '  行数 ' + (page.lines || []).length);

/* 2) 走线上同一套代码：行 → 块（y 轴向下） */
const pagesIn = [{
  number: page.number,
  width: page.width,
  height: page.height,
  lines: (page.lines || []).map(l => ({ x: l.x, x1: l.x1, y: l.y, size: l.size, text: l.text }))
}];
const blocksPages = R.buildBlocks(pagesIn);
const info = blocksPages[0];
console.log('块数: ' + info.blocks.length);
console.log('前 3 块（y 轴向下，顶部为 0）:');
info.blocks.slice(0, 3).forEach((b, i) => {
  console.log('  #' + i + ' x=' + Math.round(b.x) + ' y=' + Math.round(b.y) +
    ' w=' + Math.round(b.w) + ' h=' + Math.round(b.h) + ' sz=' + b.size +
    '  ' + JSON.stringify(String(b.text).slice(0, 46)));
});
/* 最靠上/最靠下的块 */
const sorted = info.blocks.slice().sort((a, b) => a.y - b.y);
const topB = sorted[0], botB = sorted[sorted.length - 1];
console.log('最靠上的块 y=' + Math.round(topB.y) + ' ' + JSON.stringify(String(topB.text).slice(0, 40)));
console.log('最靠下的块 y=' + Math.round(botB.y) + ' ' + JSON.stringify(String(botB.text).slice(0, 40)));

/* 3) 绘制指令 + 生成 PDF */
const ops = R.buildOps(info, page.height, F, font, used);
console.log('绘制指令: ' + ops.length + ' 条（矩形 ' + ops.filter(o => o.kind === 'rect').length +
  ' / 文字 ' + ops.filter(o => o.kind === 'text').length + '）');

const pdf = R.buildPdf({
  pages: [{
    width: page.width, height: page.height,
    pxW: 1, pxH: 1, jpeg: new Uint8Array(WHITE_JPEG), ops: ops
  }],
  fontObjs: F.buildFontObjects(font, used),
  title: 'coordinate-verify'
});
fs.writeFileSync(outPath, Buffer.from(pdf));
console.log('\n已生成: ' + outPath + '  (' + (pdf.length / 1024 / 1024).toFixed(2) + ' MB)');
console.log('请用 LibreOffice 渲染该文件，检查：');
console.log('  · 最靠上的块应该在页面顶部');
console.log('  · 最靠下的块应该在页面底部');
console.log('  · 文字不应互相重叠');
