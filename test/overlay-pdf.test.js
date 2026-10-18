/* overlay-pdf.test.js — 验证"图片型 PDF"写入器与折行逻辑
 * 用法: node test/overlay-pdf.test.js
 *
 * 为什么重要：叠加方案绕开了"猜版式"这条路 —— 原 PDF 每页画成图，
 * 版式天然 100% 保真。这里验证最关键的底层：能写出**合法的 PDF**，
 * 且不依赖任何字体（中文靠 canvas 渲染，所以一定正确）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');

const SRC = path.join(__dirname, '..', 'src');
const sb = {
  console, setTimeout, clearTimeout, Promise, JSON, Math, Date, Object, Array, String, Number,
  RegExp, Error, isFinite, parseInt, parseFloat, Uint8Array, ArrayBuffer, TextEncoder, atob,
  Blob: function () { }, URL: {},
  document: { createElement: () => ({ style: {}, textContent: '', innerHTML: '' }) }
};
sb.globalThis = sb; sb.window = sb;
const ctx = vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(SRC, 'render-pdf-overlay.js'), 'utf8'), ctx, { filename: 'render-pdf-overlay.js' });
const O = sb.LingyiPdfOverlay;

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { console.log('  \u2713 ' + n); pass++; }
  else { console.log('  \u2717 ' + n + (extra ? '  → ' + extra : '')); fail++; }
};

/* 造一个 1x1 像素的最小 JPEG（真实可用的 baseline JPEG） */
const JPEG_1PX = Buffer.from(
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

console.log('=== 1) 折行算法 ===');
{
  /* 中文按字断行 */
  const lines = O.wrapText('这是一段很长的中文文本需要按照给定的最大宽度进行折行处理', 10, 60);
  console.log('    中文折行(' + lines.length + '行): ' + JSON.stringify(lines));
  check('中文能折成多行', lines.length > 1, '行数 ' + lines.length);
  check('每行宽度不超过限制', lines.every(l => O.measure(l, 10) <= 62), '最大 ' + Math.max.apply(null, lines.map(l => O.measure(l, 10))));

  /* 短文本不折行 */
  const one = O.wrapText('短文本', 10, 200);
  check('短文本保持 1 行', one.length === 1, JSON.stringify(one));

  /* 英文按词断行，不切断单词 */
  const en = O.wrapText('The quick brown fox jumps over the lazy dog again and again', 10, 80);
  console.log('    英文折行(' + en.length + '行): ' + JSON.stringify(en));
  check('英文折成多行', en.length > 1);
  check('英文不切断单词', en.every(l => !/^\s|\s$/.test(l)), JSON.stringify(en));

  /* 空文本 */
  check('空文本返回 1 个空行', O.wrapText('', 10, 100).length === 1);

  /* 测量：中文比西文宽 */
  check('中文字宽 ≈ 字号', Math.abs(O.measure('中', 10) - 10) < 0.01);
  check('空格最窄', O.measure(' ', 10) < O.measure('a', 10));
}

console.log('\n=== 2) 图片型 PDF 写入器 ===');
let pdfBytes = null;
{
  const pages = [
    { w: 595, h: 842, pxW: 1, pxH: 1, jpeg: new Uint8Array(JPEG_1PX) },
    { w: 595, h: 842, pxW: 1, pxH: 1, jpeg: new Uint8Array(JPEG_1PX) }
  ];
  pdfBytes = O.buildImagePdf(pages, { title: '测试文档' });
  check('返回 Uint8Array', pdfBytes instanceof Uint8Array);
  const head = Buffer.from(pdfBytes.slice(0, 8)).toString('latin1');
  console.log('    文件头: ' + JSON.stringify(head));
  check('文件头是 %PDF-1.', head.indexOf('%PDF-1.') === 0, head);
  const tail = Buffer.from(pdfBytes.slice(-8)).toString('latin1');
  console.log('    文件尾: ' + JSON.stringify(tail));
  check('以 %%EOF 结束', tail.indexOf('%%EOF') >= 0, tail);
  const all = Buffer.from(pdfBytes).toString('latin1');
  check('含 Catalog', all.indexOf('/Type /Catalog') >= 0);
  check('含 Pages 且 Count=2', all.indexOf('/Count 2') >= 0);
  check('含 2 个 Page 对象', (all.match(/\/Type \/Page[^s]/g) || []).length === 2,
    String((all.match(/\/Type \/Page[^s]/g) || []).length));
  check('图片用 DCTDecode（不重编码 JPEG）', all.indexOf('/Filter /DCTDecode') >= 0);
  check('含 xref', all.indexOf('\nxref\n') >= 0);
  check('含 startxref', all.indexOf('startxref') >= 0);
  check('MediaBox 正确', all.indexOf('/MediaBox [0 0 595 842]') >= 0);
  /* 关键：不含任何字体对象 —— 所以中文不可能出现"?" */
  check('不含字体对象（中文靠像素，不会缺字形）', all.indexOf('/Font') < 0);
  console.log('    体积: ' + (pdfBytes.length / 1024).toFixed(1) + ' KB');
}

console.log('\n=== 3) 写出真实文件并校验结构 ===');
{
  const out = path.join(os.tmpdir(), 'lingyi-overlay-test.pdf');
  fs.writeFileSync(out, Buffer.from(pdfBytes));
  const size = fs.statSync(out).size;
  console.log('    已写出: ' + out + '  (' + (size / 1024).toFixed(1) + ' KB)');
  const buf = fs.readFileSync(out);
  const s = buf.toString('latin1');
  /* 校验 xref 偏移是否真的指向对象 */
  const xrefAt = s.indexOf('\nxref\n');
  const startxref = parseInt(s.slice(s.lastIndexOf('startxref') + 9).trim(), 10);
  console.log('    xref 声明位置: ' + startxref + '  实际位置: ' + (xrefAt + 1));
  check('startxref 指向真实 xref', Math.abs(startxref - (xrefAt + 1)) <= 1,
    startxref + ' vs ' + (xrefAt + 1));
  /* 逐个校验对象偏移 */
  const lines = s.slice(xrefAt).split('\n').filter(l => /^\d{10} \d{5} n $/.test(l));
  let bad = 0;
  lines.forEach((l, i) => {
    const off = parseInt(l.slice(0, 10), 10);
    const expect = (i + 1) + ' 0 obj';
    if (s.slice(off, off + expect.length) !== expect) bad++;
  });
  console.log('    xref 条目: ' + lines.length + '  偏移错误: ' + bad);
  check('所有 xref 偏移都正确指向对象', bad === 0, bad + ' 个错误');
  fs.unlinkSync(out);
}

console.log('\n=== 4) 单页 / 20 页规模 ===');
{
  const one = O.buildImagePdf([{ w: 595, h: 842, pxW: 1, pxH: 1, jpeg: new Uint8Array(JPEG_1PX) }], {});
  check('单页可生成', Buffer.from(one.slice(0, 5)).toString('latin1') === '%PDF-');
  const many = [];
  for (let i = 0; i < 20; i++) many.push({ w: 595, h: 842, pxW: 1, pxH: 1, jpeg: new Uint8Array(JPEG_1PX) });
  const big = O.buildImagePdf(many, { title: '20 页' });
  const s = Buffer.from(big).toString('latin1');
  check('20 页 Count 正确', s.indexOf('/Count 20') >= 0);
  check('20 页对象数正确', (s.match(/\/Type \/Page[^s]/g) || []).length === 20);
}

console.log('\n====================================================');
console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
