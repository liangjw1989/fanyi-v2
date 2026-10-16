/* dump-pdf.js — 把 PDF 转成"可分片加载的 base64 片段 JS"，供浏览器无头测试台读取
 * 用法: node test/tools/dump-pdf.js <文件.pdf> <输出目录>
 *
 * 为什么这么做：无头浏览器不能弹文件选择框，file:// 下 fetch 本地文件也不可靠。
 * 把 PDF 切成一堆 <script> 片段，用 file:// 页面直接引入即可，最稳。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
const outDir = process.argv[3] || path.join(__dirname, '..', 'out', 'pdfdump');
if (!src || !fs.existsSync(src)) { console.log('用法: node test/tools/dump-pdf.js <文件.pdf> [输出目录]'); process.exit(1); }

fs.mkdirSync(outDir, { recursive: true });
const b64 = fs.readFileSync(src).toString('base64');
const CHUNK = 400000;                 // 每片 400KB，避免单文件过大
const parts = [];
for (let i = 0; i < b64.length; i += CHUNK) parts.push(b64.slice(i, i + CHUNK));

parts.forEach((p, i) => {
  fs.writeFileSync(path.join(outDir, 'chunk' + i + '.js'), 'window.__PDF_PARTS_PUSH__("' + p + '");\n', 'utf8');
});
fs.writeFileSync(path.join(outDir, 'manifest.js'),
  'window.__PDF_CHUNKS__ = ' + JSON.stringify(parts.map((_, i) => 'chunk' + i + '.js')) + ';\n' +
  'window.__PDF_NAME__ = ' + JSON.stringify(path.basename(src)) + ';\n', 'utf8');

console.log('PDF: ' + src);
console.log('大小: ' + (fs.statSync(src).size / 1024 / 1024).toFixed(2) + ' MB → base64 ' + (b64.length / 1024).toFixed(0) + ' KB');
console.log('分片: ' + parts.length + ' 个');
console.log('输出: ' + outDir);
console.log('  manifest.js + ' + parts.map((_, i) => 'chunk' + i + '.js').join(' + '));
