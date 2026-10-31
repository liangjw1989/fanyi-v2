/* local-translate-e2e.js — 本地端到端：真实调用云函数翻译 + 生成原位 PDF
 *
 * 用法:
 *   node test/tools/local-translate-e2e.js <原始PDF> <输出PDF> [页数]
 *
 * 为什么需要：浏览器里的链路（抽取→分块→翻译回写→绘制）之前在真实文档上
 * 反复出错（译文全写进第一个块、坐标翻转……）。这个脚本在 Node 里跑同一套
 * 模块 + 真实云函数，生成 PDF 后可以直接渲染看效果，不用每次等用户试。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const DL = path.join(ROOT, '.dl');

const pdfPath = process.argv[2];
const outPath = process.argv[3] || path.join(ROOT, 'test', 'out', 'local-e2e.pdf');
const pages = parseInt(process.argv[4] || '2', 10);
const API = process.env.LINGYI_API || 'https://1430386389-cd8v5r6ng0.ap-beijing.tencentscf.com';

if (!pdfPath || !fs.existsSync(pdfPath)) { console.log('用法: node test/tools/local-translate-e2e.js <PDF> <输出> [页数]'); process.exit(1); }

const pdfjs = require(path.join(DL, 'pdf-node.js'));
try { pdfjs.GlobalWorkerOptions.workerSrc = path.join(DL, 'pdf-node.worker.js'); } catch (e) { }

const sb = {
  console, Math, Object, Array, String, Number, Map, Set, Uint8Array, DataView, ArrayBuffer,
  Error, JSON, isFinite, parseInt, parseFloat, atob, setTimeout, clearTimeout, Promise, Date,
  RegExp, TextEncoder, Blob: function () { }, URL: {}, fetch: globalThis.fetch,
  document: { createElement: () => ({ style: {}, textContent: '', innerHTML: '' }) }
};
sb.globalThis = sb; sb.window = sb;
const ctx = vm.createContext(sb);
for (const f of ['core.js', 'layout.js', 'pdf-extract.js', 'glossary.js', 'tm.js', 'translate.js',
  'pdf-font.js', 'render-pdf-inplace.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const px = sb.LingyiPdfExtract;
const core = sb.LingyiCore;
const F = sb.LingyiPdfFont;
const R = sb.LingyiPdfInPlace;
const tr = sb.LingyiTranslate;
const gloss = sb.LingyiGlossary;

(async () => {
  const bytes = new Uint8Array(fs.readFileSync(pdfPath));
  console.log('原始: ' + path.basename(pdfPath));
  console.log('云函数: ' + API);

  /* 1) 抽取 */
  const ir = await px.extractPDF(
    { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
    { pdfjs: pdfjs, fileName: path.basename(pdfPath), maxPages: pages }
  );
  console.log('页数 ' + ir.pages.length);

  /* 2) 分块 */
  const pagesIn = ir.pages.map(p => ({
    number: p.number, width: p.width, height: p.height,
    lines: (p.lines || []).map(l => ({ x: l.x, x1: l.x1, y: l.y, size: l.size, text: l.text }))
  }));
  const blocksPages = R.buildBlocks(pagesIn);
  const flat = [];
  blocksPages.forEach(p => p.blocks.forEach(b => flat.push(b)));
  console.log('块数 ' + flat.length);

  /* 3) 走**线上同一套**翻译流水线：临时 IR（必须带 id！） */
  const tmpIr = { blocks: flat.map((b, i) => ({ id: 'ob' + i, type: 'paragraph', runs: [{ t: b.text }] })) };
  const t0 = Date.now();
  const res = await tr.translateIR(tmpIr, {
    apiUrl: API, target: 'zh-CN', engine: 'tencent', mode: 'normal',
    terms: [], useTM: false, protectSymbols: true,
    onProgress: (done, total, msg) => {
      if (done === total || done % 20 === 0) console.log('  翻译 ' + done + '/' + total + '  ' + (msg || ''));
    }
  });
  console.log('翻译统计: 成功 ' + res.translated + ' / 兜底 ' + res.fallback +
    ' / 缓存 ' + res.fromCache + ' / 调用 ' + res.calls + ' / 耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

  /* 4) 回写（与 app 完全相同的写法） */
  flat.forEach((b, i) => {
    const nb = tmpIr.blocks[i];
    const t = nb && nb.runs ? core.runsToText(nb.runs) : '';
    if (t && t.trim()) b.text = t;
  });
  const changed = flat.filter(b => /[\u2e80-\u9fff]/.test(b.text)).length;
  console.log('回写后含中文的块: ' + changed + ' / ' + flat.length);
  if (changed < flat.length * 0.5) {
    console.log('  !! 大部分块没有中文 —— 回写链路有问题（检查 block id）');
  }

  /* 5) 生成 PDF（白底，方便看文字位置；不嵌原页底图） */
  const fontPath = ['C:\\Windows\\Fonts\\simhei.ttf', 'C:\\Windows\\Fonts\\simfang.ttf']
    .find(p => { try { return fs.statSync(p).size > 100000; } catch (e) { return false; } });
  const font = F.parseTtf(new Uint8Array(fs.readFileSync(fontPath)), 0);
  const used = new Map();
  const WHITE = Buffer.from(
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

  const outPages = blocksPages.map(p => ({
    width: p.width, height: p.height, pxW: 1, pxH: 1,
    jpeg: new Uint8Array(WHITE), ops: R.buildOps(p, p.height, F, font, used)
  }));
  const pdf = R.buildPdf({ pages: outPages, fontObjs: F.buildFontObjects(font, used), title: 'local-e2e' });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(pdf));
  console.log('\n已生成: ' + outPath + '  (' + (pdf.length / 1024 / 1024).toFixed(2) + ' MB, 字形 ' + used.size + ')');
})().catch(e => { console.error('失败:', e && e.stack || e); process.exit(1); });
