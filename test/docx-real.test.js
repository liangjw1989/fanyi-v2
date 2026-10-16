/* docx-real.test.js — 用真实 docx 库验证生成的 Word XML
 * 用法: node test/docx-real.test.js
 *
 * 用 vendor/docx.umd.js（就是浏览器里加载的同一个包）跑一遍渲染，
 * 解开 word/document.xml 检查：
 *   · 分栏容器是否真的生成了 <w:cols w:num="2">（Word 里的双栏）
 *   · 字号 / 对齐 / 首行缩进是否保留
 *   · 表格是否保持列数
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'vendor', 'docx.umd.js');

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { console.log('  \u2713 ' + n); pass++; }
  else { console.log('  \u2717 ' + n + (extra ? '  → ' + extra : '')); fail++; }
};

if (!fs.existsSync(LIB)) {
  console.log('未找到 ' + LIB);
  console.log('请先下载：curl -L -o vendor/docx.umd.js https://unpkg.com/docx@8.5.0/build/index.umd.js');
  process.exit(0);
}

/* ---------- 搭沙箱：加载真实 docx + 本项目渲染器 ---------- */
const sb = {
  console, setTimeout, clearTimeout, Promise, JSON, Math, Date, Object, Array, String, Number,
  RegExp, Error, isFinite, parseInt, parseFloat, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder,
  Blob: function (p, o) { this.parts = p; this.type = (o || {}).type; }
};
sb.globalThis = sb; sb.window = sb; sb.self = sb;
sb.document = {
  createElement: () => ({ style: {}, textContent: '', innerHTML: '' }),
  createElementNS: () => ({ style: {} })
};
sb.Buffer = Buffer;
sb.process = process;
sb.setImmediate = setImmediate;
sb.crypto = {
  getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; },
  randomUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  })
};
const ctx = vm.createContext(sb);
vm.runInContext(fs.readFileSync(LIB, 'utf8'), ctx, { filename: 'docx.umd.js' });
const D = sb.docx || sb.window.docx;
if (!D) { console.log('docx 库加载失败'); process.exit(1); }

/* Node 里没有 Blob，用 toBuffer 代替 toBlob */
const realToBlob = D.Packer.toBlob;
D.Packer.toBlob = function (doc) {
  return D.Packer.toBuffer(doc).then(buf => ({ _buf: buf, size: buf.length }));
};

for (const m of ['core.js', 'render-docx.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', m), 'utf8'), ctx, { filename: m });
}

/* ---------- 从 docx blob 里取 word/document.xml ---------- */
function unzipEntry(buf, want) {
  let i = 0;
  while (i < buf.length - 4) {
    if (buf.readUInt32LE(i) === 0x04034b50) {
      const method = buf.readUInt16LE(i + 8);
      const compSize = buf.readUInt32LE(i + 18);
      const nameLen = buf.readUInt16LE(i + 26);
      const extraLen = buf.readUInt16LE(i + 28);
      const fname = buf.toString('utf8', i + 30, i + 30 + nameLen);
      const ds = i + 30 + nameLen + extraLen;
      if (fname === want) {
        const raw = buf.slice(ds, ds + compSize);
        try { return method === 8 ? zlib.inflateRawSync(raw) : raw; } catch (e) { return null; }
      }
      if (compSize > 0) { i = ds + compSize; continue; }
    }
    i++;
  }
  return null;
}

/* ---------- 造 IR：单栏标题 + 双栏正文 + 表格 ---------- */
const P = (t, o) => Object.assign({ id: 'b' + Math.random(), type: 'paragraph', runs: [{ t: t }], size: 10.5 }, o || {});
const IR = {
  meta: { fileName: 'twocol.docx', title: 'twocol' },
  bodySize: 10.5,
  page: { width: 595, height: 842, margins: [50, 50, 55, 55] },
  blocks: [
    P('单栏大标题', { type: 'heading', level: 1, align: 'center', size: 15, bold: true }),
    {
      id: 'c1', type: 'container', columns: [
        { x: 50, blocks: [P('左栏第一段内容', { indent: 21, align: 'justify' }), P('左栏第二段内容')] },
        { x: 316, blocks: [P('右栏第一段内容'), P('右栏第二段内容')] }
      ]
    },
    { id: 't1', type: 'table', rows: [[{ text: '变量' }, { text: 'OR' }, { text: 'P' }], [{ text: 'MR Egger' }, { text: '0.832' }, { text: '<0.001' }]] },
    P('收尾段落')
  ]
};

(async () => {
  console.log('使用库: ' + LIB + '\n');
  const out = await sb.LingyiRenderDocx.renderDocx(IR, { docx: D, fileName: 'twocol', bodySize: 10.5 });
  const buf = Buffer.from(out.blob._buf);
  console.log('生成的 .docx: ' + (buf.length / 1024).toFixed(1) + ' KB\n');

  const xmlBuf = unzipEntry(buf, 'word/document.xml');
  if (!xmlBuf) { console.log('无法解出 word/document.xml'); process.exit(1); }
  const xml = xmlBuf.toString('utf8');

  console.log('=== 1) 分栏（最关键：原来会被拍平成单栏）===');
  const cols = [...xml.matchAll(/<w:cols[^>]*w:num="(\d+)"/g)].map(m => m[1]);
  const sectPr = (xml.match(/<w:sectPr/g) || []).length;
  console.log('    w:cols w:num = ' + JSON.stringify(cols) + '   w:sectPr 数量 = ' + sectPr);
  check('生成了双栏 w:cols w:num="2"', cols.includes('2'));
  check('是多节文档（分栏独立成节）', sectPr >= 2, '实际 ' + sectPr);

  console.log('\n=== 2) 字号与对齐 ===');
  const sz = {};
  for (const m of xml.matchAll(/<w:sz w:val="(\d+)"/g)) { const pt = (+m[1] / 2).toFixed(1); sz[pt] = (sz[pt] || 0) + 1; }
  console.log('    字号分布(pt): ' + JSON.stringify(sz));
  check('保留 15pt 标题字号', !!(sz['15'] || sz['15.0']));
  check('保留 10.5pt 正文字号', !!(sz['10.5'] || sz[10.5]));
  check('保留居中对齐', /<w:jc w:val="center"/.test(xml));
  check('保留两端对齐(justify)', /<w:jc w:val="both"/.test(xml));

  console.log('\n=== 3) 首行缩进 ===');
  const ind = [...xml.matchAll(/<w:ind [^>]*w:firstLine="(\d+)"/g)].map(m => m[1]);
  console.log('    w:firstLine(二十分之一磅) = ' + JSON.stringify(ind));
  check('保留首行缩进（21pt → 420）', ind.includes('420'), JSON.stringify(ind));

  console.log('\n=== 4) 表格 ===');
  const tbls = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)];
  check('生成了 1 个表格', tbls.length === 1, '实际 ' + tbls.length);
  if (tbls.length) {
    const cells = (tbls[0][0].match(/<w:tc>/g) || []).length;
    const texts = [...tbls[0][0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]);
    console.log('    单元格数 = ' + cells + '   文本 = ' + JSON.stringify(texts));
    check('表格 3 列 × 2 行 = 6 个单元格', cells === 6, '实际 ' + cells);
    check('单元格内容完整', texts.includes('MR Egger') && texts.includes('0.832'));
  }

  console.log('\n=== 5) 段落总数（内容没丢）===');
  const paras = (xml.match(/<w:p[ >]/g) || []).length;
  console.log('    <w:p> 数量 = ' + paras);
  check('段落数 ≥ 7（标题+4栏内段+表格内+收尾）', paras >= 7, '实际 ' + paras);

  console.log('\n====================================================');
  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
  console.log('====================================================');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
