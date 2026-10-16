/* pdf-kind.js — 判断 PDF 是"矢量文字"还是"扫描图片"
 * 用法: node test/tools/pdf-kind.js <文件.pdf>
 */
'use strict';
const fs = require('fs');
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.log('用法: node test/tools/pdf-kind.js <文件.pdf>'); process.exit(1); }

const buf = fs.readFileSync(file);
const s = buf.toString('latin1');          // 逐字节映射，足够做关键字统计
const count = re => (s.match(re) || []).length;

const stat = {
  '页面对象 /Type/Page': count(/\/Type\s*\/Page[^s]/g),
  '内容流 /Contents': count(/\/Contents/g),
  '文字绘制 BT': count(/\bBT\b/g),
  '文字绘制 Tj': count(/\bTj\b/g),
  '文字绘制 TJ': count(/\bTJ\b/g),
  '字体对象 /Font': count(/\/Font/g),
  '内嵌字体 /FontFile': count(/\/FontFile/g),
  '图片对象 /Image': count(/\/Subtype\s*\/Image/g),
  'JPEG 流 DCTDecode': count(/DCTDecode/g),
  'JPEG2000 JPXDecode': count(/JPXDecode/g),
  '传真压缩 CCITT': count(/CCITTFaxDecode/g),
  'Flate 压缩流': count(/FlateDecode/g)
};

console.log('文件: ' + file);
console.log('大小: ' + (buf.length / 1024 / 1024).toFixed(2) + ' MB\n');
for (const k of Object.keys(stat)) console.log('  ' + k.padEnd(24) + stat[k]);

const hasText = stat['文字绘制 BT'] > 3;
const scanImage = stat['JPEG 流 DCTDecode'] + stat['JPEG2000 JPXDecode'] + stat['传真压缩 CCITT'];
console.log('\n判定:');
if (hasText) {
  console.log('  ✓ 有文字层（BT/Tj 存在）→ 可以直接解析，表格应能被识别');
} else if (scanImage > 0) {
  console.log('  ⚠ 没有文字绘制指令，只有图片流 → 这是「扫描件 / 图片型 PDF」');
  console.log('    必须走 OCR（界面上的图片模式）才能翻译；表格只能靠 OCR + 结构推断');
} else {
  console.log('  ? 两者都不明显，可能是加密或特殊编码的 PDF');
}

// 看页面尺寸，确认是否双栏
const mb = s.match(/\/MediaBox\s*\[([^\]]+)\]/);
if (mb) console.log('\n  MediaBox: [' + mb[1].trim().replace(/\s+/g, ' ') + ']');
const imgs = [...s.matchAll(/\/Subtype\s*\/Image[\s\S]{0,300}?\/Width\s+(\d+)[\s\S]{0,150}?\/Height\s+(\d+)/g)];
if (imgs.length) {
  console.log('  内嵌图片尺寸（前 5 个）:');
  imgs.slice(0, 5).forEach((m, i) => console.log(`    ${i + 1}. ${m[1]} x ${m[2]}`));
  console.log('  图片总数: ' + imgs.length);
}
