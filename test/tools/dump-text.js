/* dump-text.js — 导出 PDF 某一页的文字层（位置 + 内容 + 是否中文）
 * 用法: node test/tools/dump-text.js <PDF> [页号]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const DL = path.join(ROOT, '.dl');
const pdfPath = process.argv[2];
const wantPage = parseInt(process.argv[3] || '1', 10);

if (!fs.existsSync(path.join(DL, 'pdf-node.js'))) {
  console.log('缺少 .dl/pdf-node.js');
  process.exit(1);
}
const pdfjs = require(path.join(DL, 'pdf-node.js'));
try { pdfjs.GlobalWorkerOptions.workerSrc = path.join(DL, 'pdf-node.worker.js'); } catch (e) { }

const isCJK = s => /[\u2e80-\u9fff]/.test(s);

(async () => {
  const bytes = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  console.log('文件: ' + path.basename(pdfPath) + '  页数 ' + doc.numPages);

  /* 全文档统计中文/英文 */
  let cjkChars = 0, latinChars = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p);
    const tc = await pg.getTextContent();
    for (const it of tc.items) {
      const s = String(it.str || '');
      for (const ch of s) {
        if (/[\u2e80-\u9fff]/.test(ch)) cjkChars++;
        else if (/[A-Za-z]/.test(ch)) latinChars++;
      }
    }
  }
  console.log('全文档字符统计: 中文 ' + cjkChars + '  英文 ' + latinChars +
    '   中文占比 ' + (cjkChars / Math.max(1, cjkChars + latinChars) * 100).toFixed(1) + '%');

  const page = await doc.getPage(wantPage);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  console.log('\n第 ' + wantPage + ' 页  页高 ' + Math.round(vp.height) + '  文字片段 ' + tc.items.length);

  /* 按 y 排序（y 轴向上）后打印，标注中英文 */
  const items = tc.items
    .filter(it => it && String(it.str || '').trim())
    .map(it => ({
      x: Math.round(it.transform[4]),
      y: Math.round(it.transform[5]),
      size: Math.round(Math.hypot(it.transform[2], it.transform[3]) * 10) / 10,
      str: String(it.str)
    }))
    .sort((a, b) => (b.y - a.y) || (a.x - b.x));

  let cn = 0, en = 0;
  for (const it of items) if (isCJK(it.str)) cn++; else en++;
  console.log('  中文片段 ' + cn + '   非中文片段 ' + en);

  console.log('\n  前 40 个片段（按 y 从高到低 = 从上到下）:');
  items.slice(0, 40).forEach(it => {
    const tag = isCJK(it.str) ? 'CN' : 'EN';
    console.log('    ' + tag + ' y=' + String(it.y).padStart(4) + ' x=' + String(it.x).padStart(4) +
      ' sz=' + String(it.size).padStart(4) + ' ' + JSON.stringify(it.str.slice(0, 46)));
  });
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
