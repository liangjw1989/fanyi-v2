/* analyze-pdf-streams.js — 解开 PDF 的 Flate 压缩流，统计真实的文字绘制指令
 * 用法: node test/tools/analyze-pdf-streams.js <文件.pdf>
 *
 * 目的：判断文字层到底是"完整可用"、"被切成碎片"还是"几乎没有文字"。
 * 有些 PDF 的文字操作符全在压缩流里，只看原始字节会误判。
 */
'use strict';
const fs = require('fs');
const zlib = require('zlib');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.log('用法: node test/tools/analyze-pdf-streams.js <文件.pdf>'); process.exit(1); }
const buf = fs.readFileSync(file);

console.log('文件: ' + file);
console.log('大小: ' + (buf.length / 1024 / 1024).toFixed(2) + ' MB\n');

/* 找所有 stream ... endstream，尝试 inflate */
let streams = 0, inflated = 0, totalOut = 0;
let bt = 0, tj = 0, tjArray = 0, textOps = 0, images = 0;
const textSamples = [];
const latinChars = new Set();

const s = buf.toString('latin1');
const re = /stream\r?\n/g;
let m;
while ((m = re.exec(s)) !== null) {
  streams++;
  const start = m.index + m[0].length;
  const end = s.indexOf('endstream', start);
  if (end < 0) continue;
  const raw = buf.slice(start, end);
  let out = null;
  try { out = zlib.inflateSync(raw); }
  catch (e) {
    try { out = zlib.inflateRawSync(raw); } catch (e2) { out = null; }
  }
  if (!out) continue;
  inflated++;
  totalOut += out.length;
  const t = out.toString('latin1');
  const nbt = (t.match(/\bBT\b/g) || []).length;
  const ntj = (t.match(/\bTj\b/g) || []).length;
  const nTJ = (t.match(/\bTJ\b/g) || []).length;
  const nImg = (t.match(/\bDo\b/g) || []).length;
  bt += nbt; tj += ntj; tjArray += nTJ; images += nImg;
  textOps += nbt + ntj + nTJ;
  /* 收集字符串字面量样本（( ... ) 形式） */
  if (nbt && textSamples.length < 6) {
    const strs = [...t.matchAll(/\(((?:[^()\\]|\\.){1,80})\)\s*Tj/g)].map(x => x[1]);
    if (strs.length) textSamples.push({ stream: streams, count: nbt, sample: strs.slice(0, 10) });
  }
  for (const ch of t) if (/[A-Za-z]/.test(ch)) latinChars.add(ch);
}

console.log('=== 压缩流统计 ===');
console.log('  stream 总数        : ' + streams);
console.log('  成功解压           : ' + inflated);
console.log('  解压后总字节       : ' + (totalOut / 1024).toFixed(0) + ' KB');
console.log('');
console.log('=== 解压后的内容操作符 ===');
console.log('  BT (开始文字块)    : ' + bt);
console.log('  Tj (显示文字)      : ' + tj);
console.log('  TJ (显示文字数组)  : ' + tjArray);
console.log('  Do (绘制外部对象)  : ' + images);
console.log('  文字相关合计       : ' + textOps);

console.log('');
console.log('=== 字符串样本（判断是否乱码/碎片）===');
if (!textSamples.length) {
  console.log('  （解压流里没有找到 ( … ) Tj 形式的字符串）');
} else {
  textSamples.forEach(x => {
    console.log('  流#' + x.stream + '  文字块 ' + x.count + ' 个，样本：');
    x.sample.forEach(str => console.log('      ' + JSON.stringify(str)));
  });
}

console.log('');
console.log('=== 判定 ===');
if (textOps === 0) {
  console.log('  PDF 几乎没有文字绘制指令 → 图片型/扫描件，必须 OCR');
} else if (bt > 0 && bt < 30) {
  console.log('  文字块极少（' + bt + ' 个）却有大量图片 → 很可能是「扫描件 + 少量 OCR 文字层」，');
  console.log('  这种文字层通常残缺、错位，翻译出来必然错乱 → 建议走 OCR 模式');
} else {
  console.log('  文字块数量正常（' + bt + ' 个）→ 文字层完整，问题应出在版式算法');
}
