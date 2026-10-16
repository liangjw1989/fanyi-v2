/* inspect-output.js — 检查你实际生成的输出文件：表格结构、字号、对齐
 * 用法: node test/tools/inspect-output.js <文件.docx|文件.html>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.log('用法: node test/tools/inspect-output.js <文件>'); process.exit(1); }

const isDocx = /\.docx$/i.test(file);
console.log('文件: ' + path.basename(file));
console.log('大小: ' + (fs.statSync(file).size / 1024).toFixed(1) + ' KB\n');

/* ---------- DOCX：直接读 document.xml ---------- */
function readZipEntry(buf, name) {
  // 极简 ZIP 解析：找 Local File Header，读压缩数据，inflateRaw
  let i = 0;
  while (i < buf.length - 4) {
    if (buf.readUInt32LE(i) === 0x04034b50) {
      const method = buf.readUInt16LE(i + 8);
      const compSize = buf.readUInt32LE(i + 18);
      const nameLen = buf.readUInt16LE(i + 26);
      const extraLen = buf.readUInt16LE(i + 28);
      const fname = buf.toString('utf8', i + 30, i + 30 + nameLen);
      const dataStart = i + 30 + nameLen + extraLen;
      if (fname === name) {
        const raw = buf.slice(dataStart, dataStart + compSize);
        if (method === 0) return raw;
        if (method === 8) {
          try { return zlib.inflateRawSync(raw); } catch (e) { return null; }
        }
        return null;
      }
      if (compSize > 0) { i = dataStart + compSize; continue; }
    }
    i++;
  }
  return null;
}

if (isDocx) {
  const buf = fs.readFileSync(file);
  const xmlBuf = readZipEntry(buf, 'word/document.xml');
  if (!xmlBuf) { console.log('无法读到 word/document.xml（ZIP 结构异常或加密）'); process.exit(1); }
  const xml = xmlBuf.toString('utf8');
  console.log('word/document.xml: ' + (xml.length / 1024).toFixed(1) + ' KB\n');

  /* 块统计 */
  const n = re => (xml.match(re) || []).length;
  console.log('=== 结构统计 ===');
  console.log('  段落 <w:p>          : ' + n(/<w:p[ >]/g));
  console.log('  表格 <w:tbl>        : ' + n(/<w:tbl>/g));
  console.log('  表格行 <w:tr>       : ' + n(/<w:tr[ >]/g));
  console.log('  单元格 <w:tc>       : ' + n(/<w:tc>/g));
  console.log('  分页 <w:br w:type="page">: ' + n(/w:type="page"/g));
  console.log('  分栏 <w:cols>       : ' + n(/<w:cols[ >]/g));
  console.log('  图片 <w:drawing>    : ' + n(/<w:drawing>/g));
  console.log('  字号 <w:sz>         : ' + n(/<w:sz /g));
  console.log('  对齐 <w:jc>         : ' + n(/<w:jc /g));
  console.log('  缩进 <w:ind>        : ' + n(/<w:ind /g));

  /* 段落对齐分布 */
  const jc = {};
  for (const m of xml.matchAll(/<w:jc w:val="([^"]+)"/g)) jc[m[1]] = (jc[m[1]] || 0) + 1;
  console.log('\n  对齐分布: ' + JSON.stringify(jc));

  /* 字号分布（w:sz 是半磅） */
  const sz = {};
  for (const m of xml.matchAll(/<w:sz w:val="(\d+)"/g)) {
    const pt = (+m[1] / 2).toFixed(1);
    sz[pt] = (sz[pt] || 0) + 1;
  }
  console.log('  字号分布(pt): ' + JSON.stringify(sz));

  /* 缩进分布 */
  const ind = {};
  for (const m of xml.matchAll(/<w:ind [^>]*w:firstLine="(\d+)"/g)) {
    const pt = (+m[1] / 20).toFixed(1);
    ind[pt] = (ind[pt] || 0) + 1;
  }
  console.log('  首行缩进(pt): ' + JSON.stringify(ind));

  /* 每个表格的规格 */
  console.log('\n=== 表格规格 ===');
  const tbls = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)];
  console.log('  共 ' + tbls.length + ' 个表格');
  tbls.slice(0, 25).forEach((t, i) => {
    const rows = (t[0].match(/<w:tr[ >]/g) || []).length;
    const firstRow = (t[0].match(/<w:tr[ >][\s\S]*?<\/w:tr>/) || [''])[0];
    const cells = (firstRow.match(/<w:tc>/g) || []).length;
    const text = [...firstRow.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('|');
    const gridCols = (t[0].match(/<w:gridCol /g) || []).length;
    console.log(`  表${i + 1}: ${rows} 行 x ${cells} 单元格 (gridCol=${gridCols})  首行: ${text.slice(0, 70)}`);
  });

  /* 正文抽样 */
  console.log('\n=== 段落抽样（前 12 段有文字的）===');
  const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(m => m[0]);
  let shown = 0;
  for (const p of paras) {
    if (/<w:tbl>/.test(p)) continue;
    const text = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');
    if (!text.trim() || shown >= 12) continue;
    const j = (/<w:jc w:val="([^"]+)"/.exec(p) || [])[1] || 'left';
    const s = (/<w:sz w:val="(\d+)"/.exec(p) || [])[1];
    const ind = (/<w:ind [^>]*w:firstLine="(\d+)"/.exec(p) || [])[1];
    console.log(`  [${j}${s ? ' sz=' + (+s / 2) : ''}${ind ? ' ind=' + (+ind / 20) + 'pt' : ''}] ${text.slice(0, 78)}`);
    shown++;
  }
} else {
  /* ---------- HTML ---------- */
  const c = fs.readFileSync(file, 'utf8');
  const n = re => (c.match(re) || []).length;
  console.log('=== 结构统计 ===');
  console.log('  <table>    : ' + n(/<table/g));
  console.log('  <tr>       : ' + n(/<tr/g));
  console.log('  <td>/<th>  : ' + n(/<t[dh]/g));
  console.log('  font-size  : ' + n(/font-size:/g));
  console.log('  text-align : ' + n(/text-align:/g));
  console.log('  text-indent: ' + n(/text-indent:/g));
  console.log('  ly-page    : ' + n(/class="ly-page/g));
  const cnt = {};
  for (const m of c.matchAll(/font-size:\s*([\d.]+)pt/g)) cnt[m[1]] = (cnt[m[1]] || 0) + 1;
  console.log('  字号分布: ' + JSON.stringify(cnt));
  const aligns = {};
  for (const m of c.matchAll(/text-align:\s*(\w+)/g)) aligns[m[1]] = (aligns[m[1]] || 0) + 1;
  console.log('  对齐分布: ' + JSON.stringify(aligns));
}
