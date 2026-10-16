/* pdf-outline.js — 抽取 PDF 每页的可读文字，快速评估译文质量
 * 用法: node test/tools/pdf-outline.js <文件.pdf> [页数] [每页行数]
 *
 * 说明：只做基础抽取（BT…ET 里的 Tj/TJ 字符串），不做坐标推断。
 * 目的是"看内容"，不是"还原版式"。
 */
'use strict';
const fs = require('fs');
const zlib = require('zlib');

const file = process.argv[2];
const maxPages = parseInt(process.argv[3] || '3', 10);
const perPage = parseInt(process.argv[4] || '18', 10);
if (!file || !fs.existsSync(file)) { console.log('用法: node test/tools/pdf-outline.js <文件.pdf> [页数] [每页行数]'); process.exit(1); }

const buf = fs.readFileSync(file);
const s = buf.toString('latin1');

/* 收集所有可解压的内容流（合并成一个大文本池，再按页粗分） */
function inflateAll() {
  const texts = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) continue;
    const raw = buf.slice(start, end);
    let out = null;
    try { out = zlib.inflateSync(raw); } catch (e) { try { out = zlib.inflateRawSync(raw); } catch (e2) { out = null; } }
    if (out) texts.push(out.toString('latin1'));
    if (texts.length > 400) break;
  }
  return texts;
}

/* 从内容流里抽出所有 (…) 与 <hex> 字符串 */
function extractStrings(content) {
  const out = [];
  /* 普通字符串 ( ... ) 支持转义 */
  const reParen = /\(((?:\\.|[^\\()])*)\)\s*(Tj|TJ|'|")/g;
  let m;
  while ((m = reParen.exec(content)) !== null) out.push(unescapePdf(m[1]));
  /* TJ 数组里的字符串 */
  const reArr = /\[((?:[^\[\]]|\\.)*)\]\s*TJ/g;
  let ma;
  while ((ma = reArr.exec(content)) !== null) {
    const inner = ma[1];
    const reStr = /\(((?:\\.|[^\\()])*)\)/g;
    let mm;
    while ((mm = reStr.exec(inner)) !== null) out.push(unescapePdf(mm[1]));
  }
  return out;
}

function unescapePdf(t) {
  return String(t)
    .replace(/\\([nrtbf()\\])/g, (mm, c) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }[c]))
    .replace(/\\([0-7]{1,3})/g, (mm, o) => String.fromCharCode(parseInt(o, 8)));
}

const streams = inflateAll();
console.log('文件: ' + file);
console.log('大小: ' + (buf.length / 1024 / 1024).toFixed(2) + ' MB   内容流: ' + streams.length + ' 个\n');

/* 把每个流当作"一页"来展示（多数生成器一页一个内容流） */
let shown = 0;
streams.slice(0, maxPages * 4).forEach((content, idx) => {
  if (shown >= maxPages) return;
  const strs = extractStrings(content);
  if (strs.length < 20) return;                 // 跳过图片页/资源页
  shown++;
  /* 把碎片按顺序拼起来，按长度切行 */
  const joined = strs.join('');
  console.log('===== 内容流 #' + idx + '（' + strs.length + ' 个文字片段，共 ' + joined.length + ' 字符）=====');
  /* 按"看起来像断行"的地方切分：中文句号/句末 + 长度 */
  const chunks = [];
  let cur = '';
  for (const t of strs) {
    cur += t;
    if (cur.length > 60) { chunks.push(cur); cur = ''; }
    if (chunks.length >= perPage) break;
  }
  if (cur && chunks.length < perPage) chunks.push(cur);
  chunks.forEach((c, i) => console.log('  ' + String(i + 1).padStart(2) + '. ' + c.slice(0, 110)));
  console.log('');
});
