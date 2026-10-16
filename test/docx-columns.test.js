/* docx-columns.test.js — 验证「分栏还原」真的写进了 Word 的 w:cols
 * 用法: node test/docx-columns.test.js
 *
 * 背景：原来 render-docx 遇到 container（PDF 双栏）会直接拍平成单栏，
 * 导致"Word 排版不像原文"。现在应输出 word/section 的 w:cols=2。
 * 这里用一个最小的 docx 库替身，把它收到的 sections 原样记录下来，
 * 再用真实的 docx 库做一次 XML 层验证（若可用）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');

/* ---- 最小 docx 替身：记录构造参数，Packer 直接吐 JSON ---- */
function makeDocxMock() {
  const seen = { sections: null, documentCalls: 0 };
  class Paragraph {
    constructor(o) { Object.assign(this, o || {}); this._kind = 'p'; }
  }
  class TextRun { constructor(o) { Object.assign(this, o || {}); this._kind = 'r'; } }
  class Table { constructor(o) { Object.assign(this, o || {}); this._kind = 'tbl'; } }
  class TableRow { constructor(o) { Object.assign(this, o || {}); } }
  class TableCell { constructor(o) { Object.assign(this, o || {}); } }
  class PageBreak { constructor() { this._kind = 'br'; } }
  class ImageRun { constructor(o) { Object.assign(this, o || {}); } }
  class Document {
    constructor(o) { seen.documentCalls++; seen.sections = o.sections; Object.assign(this, o); }
  }
  const Packer = {
    toBlob: async () => ({ size: 1, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  };
  const D = {
    Document: Document, Packer: Packer, Paragraph: Paragraph, TextRun: TextRun,
    Table: Table, TableRow: TableRow, TableCell: TableCell, PageBreak: PageBreak,
    ImageRun: ImageRun,
    AlignmentType: { CENTER: 'center', LEFT: 'left', RIGHT: 'right', START: 'start', JUSTIFIED: 'both' },
    HeadingLevel: { HEADING_1: 'Heading1', HEADING_2: 'Heading2', HEADING_3: 'Heading3' },
    WidthType: { PERCENTAGE: 'pct', DXA: 'dxa' },
    BorderStyle: { SINGLE: 'single' },
    ShadingType: { CLEAR: 'clear' },
    VerticalAlign: { CENTER: 'center' },
    TableLayoutType: { FIXED: 'fixed' }
  };
  return { D: D, seen: seen };
}

function loadSandbox(D) {
  const sb = {
    console, setTimeout, clearTimeout, Promise, JSON, Math, Date, Object, Array, String, Number,
    RegExp, Error, isFinite, parseInt, parseFloat, Uint8Array, ArrayBuffer, TextEncoder,
    Blob: function (p, o) { this.parts = p; this.type = (o || {}).type; },
    URL: { createObjectURL: () => 'blob:x' }, atob: s => Buffer.from(s, 'base64').toString('binary')
  };
  sb.globalThis = sb; sb.window = sb;
  sb.document = { createElement: () => ({ style: {}, textContent: '', innerHTML: '' }) };
  const ctx = vm.createContext(sb);
  for (const f of ['core.js', 'render-docx.js']) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  }
  return sb;
}

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { console.log('  \u2713 ' + n); pass++; } else { console.log('  \u2717 ' + n + (extra ? '  → ' + extra : '')); fail++; } };

/** 造一个"单栏正文 + 双栏容器 + 收尾单栏"的 IR */
function mkIR() {
  const core = { uid: (p) => p + Math.random().toString(36).slice(2, 6) };
  const P = t => ({ id: 'b' + Math.random(), type: 'paragraph', runs: [{ t: t }], size: 10.5 });
  return {
    meta: { fileName: 'twocol.docx', title: 'twocol' },
    bodySize: 10.5,
    page: { width: 595, height: 842, margins: [50, 50, 55, 55] },
    blocks: [
      P('单栏大标题'),
      {
        id: 'c1', type: 'container', columns: [
          { x: 50, blocks: [P('左栏第一段'), P('左栏第二段')] },
          { x: 316, blocks: [P('右栏第一段'), P('右栏第二段')] }
        ]
      },
      P('收尾单栏段落')
    ]
  };
}

(async () => {
  console.log('=== 1) 双栏容器应生成 w:cols=2 的独立节 ===');
  {
    const mock = makeDocxMock();
    const sb = loadSandbox(mock.D);
    await sb.LingyiRenderDocx.renderDocx(mkIR(), { docx: mock.D, fileName: 'twocol', bodySize: 10.5 });
    const secs = mock.seen.sections || [];
    console.log('    生成节数: ' + secs.length);
    secs.forEach((s, i) => {
      const c = s.properties && s.properties.column;
      console.log('      节' + (i + 1) + ': 段落数=' + (s.children || []).length +
        '  分栏=' + (c ? c.count : '无') +
        '  页面=' + (s.properties.page && s.properties.page.size ? '有' : '无'));
    });
    check('节数 ≥ 2（分栏单独成节）', secs.length >= 2, '实际 ' + secs.length);
    const colSec = secs.find(s => s.properties && s.properties.column);
    check('存在分栏节且 count=2', !!colSec && colSec.properties.column.count === 2);
    check('分栏节包含左右栏共 4 段', !!colSec && colSec.children.length === 4,
      colSec ? String(colSec.children.length) : 'n/a');
    check('非分栏节不含 column 属性',
      secs.filter(s => !(s.properties && s.properties.column)).length >= 1);
    check('每节都带页面尺寸与边距',
      secs.every(s => s.properties.page && s.properties.page.size && s.properties.page.margin));
  }

  console.log('\n=== 2) 单栏文档不应凭空产生分栏节 ===');
  {
    const mock = makeDocxMock();
    const sb = loadSandbox(mock.D);
    const ir = mkIR();
    ir.blocks = [ir.blocks[0], ir.blocks[2]];
    await sb.LingyiRenderDocx.renderDocx(ir, { docx: mock.D, fileName: 'one', bodySize: 10.5 });
    const secs = mock.seen.sections || [];
    check('只有 1 节', secs.length === 1, '实际 ' + secs.length);
    check('没有 column 属性', !secs.some(s => s.properties && s.properties.column));
  }

  console.log('\n=== 3) 用真实 docx 库验证生成的 XML 含 w:cols（若已安装）===');
  {
    let real = null;
    try { real = require('docx'); } catch (e) { }
    if (!real) {
      console.log('    （本机未安装 docx 包，此项不计入；浏览器运行时用的是 CDN 版本）');
    } else {
      const sb = loadSandbox(real);
      const r = await sb.LingyiRenderDocx.renderDocx(mkIR(), { docx: real, fileName: 'twocol', bodySize: 10.5 });
      let xml = '';
      if (r && r.blob && typeof r.blob.arrayBuffer === 'function') {
        const ab = await r.blob.arrayBuffer();
        const buf = Buffer.from(ab);
        const zlib = require('zlib');
        let i = 0;
        while (i < buf.length - 4) {
          if (buf.readUInt32LE(i) === 0x04034b50) {
            const method = buf.readUInt16LE(i + 8);
            const compSize = buf.readUInt32LE(i + 18);
            const nameLen = buf.readUInt16LE(i + 26);
            const extraLen = buf.readUInt16LE(i + 28);
            const fname = buf.toString('utf8', i + 30, i + 30 + nameLen);
            const ds = i + 30 + nameLen + extraLen;
            if (fname === 'word/document.xml') {
              const raw = buf.slice(ds, ds + compSize);
              xml = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
              break;
            }
            if (compSize > 0) { i = ds + compSize; continue; }
          }
          i++;
        }
      }
      if (!xml) { console.log('    （未能从 blob 里解出 document.xml，跳过该项）'); }
      else {
        const cols = [...xml.matchAll(/<w:cols[^>]*w:num="(\d+)"/g)].map(m => m[1]);
        console.log('    XML 里的 w:cols w:num: ' + JSON.stringify(cols));
        check('XML 含 w:cols w:num="2"', cols.includes('2'));
        check('XML 含 w:sectPr（多节）', (xml.match(/<w:sectPr/g) || []).length >= 2);
      }
    }
  }

  console.log('\n====================================================');
  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
  console.log('====================================================');
  process.exit(fail ? 1 : 0);
})();
