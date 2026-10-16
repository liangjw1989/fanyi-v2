/* build-harness.js — 生成"自带 PDF 数据"的无头浏览器测试页面
 * 用法: node test/tools/build-harness.js <文件.pdf> <输出目录> [harness.js]
 *
 * 为什么这么做：无头浏览器不能弹文件选择框，file:// 下 fetch 本地文件也不可靠。
 * 把 PDF 以 base64 分片写进独立 JS 文件，再由页面按序 <script> 引入。
 * 这里用 Node 直接生成整页 HTML，避免 PowerShell 拼接时把内容弄坏。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
const outDir = process.argv[3];
const harnessRel = process.argv[4] || 'harness.js';
if (!src || !outDir || !fs.existsSync(src)) {
  console.log('用法: node test/tools/build-harness.js <文件.pdf> <输出目录> [harness.js]');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const b64 = fs.readFileSync(src).toString('base64');
/* 校验 base64 合法性，避免把坏数据带进页面 */
if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
  console.log('!! base64 编码出现非法字符，PDF 可能已损坏');
}

const CHUNK = 300000;
const parts = [];
for (let i = 0; i < b64.length; i += CHUNK) parts.push(b64.substr(i, CHUNK));

parts.forEach((p, i) => {
  fs.writeFileSync(path.join(outDir, 'chunk' + i + '.js'),
    'window.__PDF_PARTS__.push(' + JSON.stringify(p) + ');\n', 'utf8');
});

const tags = parts.map((_, i) => '<script src="chunk' + i + '.js"></script>').join('\n');
const html = [
  '<!DOCTYPE html><html><head><meta charset="utf-8"><title>pdf harness</title></head><body>',
  '<pre id="result" style="font-size:12px"></pre>',
  '<script>window.__PDF_PARTS__=[];</script>',
  '<script>window.__PDF_NAME__=' + JSON.stringify(path.basename(src)) + ';window.__MAX_PAGES__=' + (process.argv[5] || 4) + ';</script>',
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>',
  '<script>if(window.pdfjsLib){pdfjsLib.GlobalWorkerOptions.workerSrc="";}</script>',
  tags,
  '<script src="' + harnessRel + '"></script>',
  '</body></html>'
].join('\n');
fs.writeFileSync(path.join(outDir, 'page.html'), html, 'utf8');

console.log('PDF: ' + src);
console.log('大小: ' + (fs.statSync(src).size / 1024 / 1024).toFixed(2) + ' MB → base64 ' + (b64.length / 1024).toFixed(0) + ' KB');
console.log('分片: ' + parts.length + ' 个');
console.log('页面: ' + path.join(outDir, 'page.html'));
