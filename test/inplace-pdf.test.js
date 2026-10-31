/* inplace-pdf.test.js — "原版式 + 可选中矢量译文" PDF 生成器
 * 用法: node test/inplace-pdf.test.js [字体路径]
 *
 * 这是真正的目标方案（路线 C）：底图保证版式 100% 保真，
 * 译文是真正的 PDF 文字对象（Identity-H + 内嵌 TrueType），所以可选中/搜索。
 *
 * 测试重点：
 *   · TTF 解析（unitsPerEm / advance / cmap 取字）
 *   · Identity-H 编码与宽度计算
 *   · 生成的 PDF 结构合法（xref 偏移、字体对象、ToUnicode）
 *   · 进度与缺字兜底
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const SRC = path.join(__dirname, '..', 'src');

const FONT_CANDIDATES = [
  process.argv[2],
  'C:\\Windows\\Fonts\\simhei.ttf',
  'C:\\Windows\\Fonts\\simfang.ttf',
  'C:\\Windows\\Fonts\\simkai.ttf',
  'C:\\Windows\\Fonts\\Deng.ttf'
].filter(Boolean);
const fontPath = FONT_CANDIDATES.find(p => { try { return fs.statSync(p).size > 100000; } catch (e) { return false; } });
if (!fontPath) {
  console.log('未找到中文字体，跳过（请传字体路径作为参数）');
  console.log('\n结果：通过 0 项，失败 0 项（缺少真实样本，已跳过）');
  process.exit(0);
}

const sb = {
  console, Math, Object, Array, String, Number, Map, Set, Uint8Array, DataView, ArrayBuffer,
  Error, JSON, isFinite, parseInt, parseFloat, atob, setTimeout, clearTimeout, Promise, Date, RegExp,
  TextEncoder, Blob: function () { }, URL: {},
  document: { createElement: () => ({ style: {}, textContent: '', innerHTML: '' }) }
};
sb.globalThis = sb; sb.window = sb;
const ctx = vm.createContext(sb);
for (const f of ['pdf-font.js', 'render-pdf-inplace.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const F = sb.LingyiPdfFont;
const R = sb.LingyiPdfInPlace;

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { console.log('  \u2713 ' + n); pass++; }
  else { console.log('  \u2717 ' + n + (extra ? '  → ' + extra : '')); fail++; }
};

/* 1x1 最小 JPEG */
const JPEG_1PX = Buffer.from(
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

console.log('字体: ' + fontPath + '  (' + (fs.statSync(fontPath).size / 1024 / 1024).toFixed(1) + ' MB)');

console.log('\n=== 1) TTF 解析 ===');
let font = null;
{
  const bytes = new Uint8Array(fs.readFileSync(fontPath));
  const t0 = Date.now();
  try { font = F.parseTtf(bytes, 0); check('解析成功', true); }
  catch (e) { check('解析成功', false, e.message); }
  console.log('    耗时 ' + (Date.now() - t0) + ' ms  unitsPerEm=' + font.unitsPerEm +
    '  glyphs=' + font.numGlyphs);
  check('unitsPerEm > 0', font.unitsPerEm > 0);
  check('字形数 > 100', font.numGlyphs > 100, String(font.numGlyphs));
  check('ascender > descender', font.ascender > font.descender);
  /* 常用字都要能取到 */
  const must = '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙飞';
  let miss = 0;
  for (const ch of must) if (!font.gidFor(ch.codePointAt(0))) miss++;
  check('常用汉字可取字率 > 95%', miss / must.length < 0.05, '缺 ' + miss + '/' + must.length);
  const gidLatin = font.gidFor(0x41);   // 'A'
  check('拉丁字母可取字', gidLatin > 0);
  check('advance 宽度合理（汉字≈全角）', Math.abs(font.widthOf(font.gidFor(0x4E2D)) - font.unitsPerEm) < font.unitsPerEm * 0.1,
    'w=' + font.widthOf(font.gidFor(0x4E2D)) + ' upm=' + font.unitsPerEm);
}

console.log('\n=== 1b) TTC 字体集合（.ttc）也要能解析 ===');
{
  /* 真实需求：Windows 文件对话框会隐藏字体扩展名，用户常常找不到
     simhei.ttf，但 msyh.ttc（微软雅黑）一定存在。所以必须支持 .ttc。 */
  const ttcCandidates = [
    'C:\\Windows\\Fonts\\msyh.ttc',
    'C:\\Windows\\Fonts\\simsun.ttc',
    'C:\\Windows\\Fonts\\msyhbd.ttc'
  ];
  const ttcPath = ttcCandidates.find(p => { try { return fs.statSync(p).size > 100000; } catch (e) { return false; } });
  if (!ttcPath) {
    console.log('    · 本机没有 .ttc 字体，跳过这一组');
  } else {
    console.log('    ' + path.basename(ttcPath));
    try {
      const b = new Uint8Array(fs.readFileSync(ttcPath));
      const sig = Buffer.from(b.slice(0, 4)).toString('latin1');
      check('文件签名是 ttcf', sig === 'ttcf', sig);
      const f2 = F.parseTtf(b, 0);
      check('解析成功', !!f2);
      check('unitsPerEm > 0', f2.unitsPerEm > 0, String(f2.unitsPerEm));
      check('字形数 > 1000', f2.numGlyphs > 1000, String(f2.numGlyphs));
      check('汉字「中」可取字', f2.gidFor(0x4E2D) > 0, String(f2.gidFor(0x4E2D)));
      const u2 = new Map();
      const w2 = F.textWidth(f2, '中文测试', 10, u2);
      check('4 汉字宽度 35~45pt', w2 > 35 && w2 < 45, w2.toFixed(2));
      const fo2 = F.buildFontObjects(f2, u2);
      check('能生成 PDF 字体对象', fo2.type0.indexOf('/Type0') >= 0 && fo2.cidFont.indexOf('/CIDFontType2') >= 0);
    } catch (e) {
      check('解析 .ttc', false, e.message);
    }
  }
}

console.log('\n=== 2) Identity-H 编码与宽度 ===');
let fontObjs = null;
let used = null;
{
  used = new Map();
  const hex = F.encodeText(font, '中文', used);
  console.log('    "中文" → ' + hex);
  check('编码为 4 个字节（2 字 × 2 字节）', hex.length === 8, hex.length + ' 字节');
  check('每个字形 2 字节（4 位十六进制）', /^([0-9A-F]{4}){2}$/.test(hex));
  check('用到的字形被记录', used.size === 2, String(used.size));
  /* 宽度：4 个汉字 @10pt ≈ 40pt */
  const w = F.textWidth(font, '中文测试', 10, used);
  console.log('    "中文测试"@10pt = ' + w.toFixed(2) + ' pt');
  check('4 汉字宽度在 35~45pt 之间', w > 35 && w < 45, w.toFixed(2));
  /* 西文更窄 */
  const we = F.textWidth(font, 'iiii', 10, used);
  const wm = F.textWidth(font, '中中中中', 10, used);
  check('西文比中文窄', we < wm, we.toFixed(1) + ' vs ' + wm.toFixed(1));
}

console.log('\n=== 3) ToUnicode 与字体对象 ===');
{
  fontObjs = F.buildFontObjects(font, used);
  const s = Buffer.from(fontObjs.toUnicode).toString('latin1');
  check('ToUnicode 含 begincmap', s.indexOf('begincmap') >= 0);
  check('ToUnicode 含 beginbfchar', s.indexOf('beginbfchar') >= 0);
  check('ToUnicode 含 endcmap', s.indexOf('endcmap') >= 0);
  /* 每个用到的字形都应有映射。注意只统计 beginbfchar 块内的条目，
     不能直接数整个文件的 <x> <y> 对 —— codespacerange 里的 <0000> <FFFF>
     也会被匹配到。 */
  let bfchars = 0;
  const blocks = s.split('beginbfchar');
  for (let i = 1; i < blocks.length; i++) {
    const seg = blocks[i].split('endbfchar')[0];
    bfchars += (seg.match(/<[0-9A-F]{4}> <[0-9A-F]{4,8}>/g) || []).length;
  }
  console.log('    ToUnicode 映射条数: ' + bfchars + '  用到字形: ' + used.size);
  check('映射条数 == 用到字形数', bfchars === used.size, bfchars + ' vs ' + used.size);
  check('Type0 字体声明正确', fontObjs.type0.indexOf('/Subtype /Type0') >= 0 &&
    fontObjs.type0.indexOf('/Encoding /Identity-H') >= 0);
  check('CIDFont 是 CIDFontType2', fontObjs.cidFont.indexOf('/Subtype /CIDFontType2') >= 0);
  check('含 /W 宽度数组', fontObjs.cidFont.indexOf('/W [') >= 0);
  check('CIDToGIDMap 为 Identity', fontObjs.cidFont.indexOf('/CIDToGIDMap /Identity') >= 0);
  check('Descriptor 含 FontBBox/Ascent/Descent', fontObjs.descriptor.indexOf('/FontBBox') >= 0 &&
    fontObjs.descriptor.indexOf('/Ascent') >= 0 && fontObjs.descriptor.indexOf('/Descent') >= 0);
  check('FontFile2 就是字体原始字节', fontObjs.fontFile2.length === font.bytes.length);
}

console.log('\n=== 4) 生成完整 PDF 并校验结构 ===');
let pdfBytes = null;
{
  const ops = [
    { kind: 'rect', x: 50, y: 600, w: 300, h: 14 },
    { kind: 'text', x: 50, y: 610, size: 10.5, hex: F.encodeText(font, '中文测试：精子DNA碎片指数', used) },
    { kind: 'rect', x: 50, y: 560, w: 200, h: 14 },
    { kind: 'text', x: 50, y: 570, size: 10.5, hex: F.encodeText(font, '第二段译文', used) }
  ];
  const pages = [{
    width: 595, height: 842, pxW: 1, pxH: 1,
    jpeg: new Uint8Array(JPEG_1PX), ops: ops
  }];
  fontObjs = F.buildFontObjects(font, used);   // 用最终 used 重建
  pdfBytes = R.buildPdf({ pages: pages, fontObjs: fontObjs, title: '原位替换测试' });
  check('返回 Uint8Array', pdfBytes instanceof Uint8Array);
  const head = Buffer.from(pdfBytes.slice(0, 8)).toString('latin1');
  check('文件头 %PDF-1.5', head.indexOf('%PDF-1.5') === 0, head);
  const s = Buffer.from(pdfBytes).toString('latin1');
  check('含 Type0 字体', s.indexOf('/Subtype /Type0') >= 0);
  check('含 CIDFontType2', s.indexOf('/CIDFontType2') >= 0);
  check('含 FontFile2 流', s.indexOf('/FontFile2') >= 0);
  check('含 ToUnicode', s.indexOf('/ToUnicode') >= 0);
  check('含 DCTDecode 底图', s.indexOf('/Filter /DCTDecode') >= 0);
  check('内容流含文字绘制 Tj', s.indexOf('Tj') >= 0);
  check('内容流含白底矩形 re', s.indexOf(' re') >= 0);
  check('含 Tm 定位', s.indexOf(' Tm') >= 0);
  console.log('    体积: ' + (pdfBytes.length / 1024 / 1024).toFixed(2) + ' MB（字体占大头）');

  /* xref 逐个校验 */
  const xrefAt = s.indexOf('\nxref\n');
  const startxref = parseInt(s.slice(s.lastIndexOf('startxref') + 9).trim(), 10);
  check('startxref 指向真实 xref', Math.abs(startxref - (xrefAt + 1)) <= 1);
  const lines = s.slice(xrefAt + 6).split('\n').filter(l => /^\d{10} \d{5} n $/.test(l));
  let bad = 0;
  lines.forEach((l, i) => {
    const off = parseInt(l.slice(0, 10), 10);
    const expect = (i + 1) + ' 0 obj';
    if (s.slice(off, off + expect.length) !== expect) bad++;
  });
  console.log('    xref 条目 ' + lines.length + '  偏移错误 ' + bad);
  check('所有 xref 偏移正确', bad === 0, bad + ' 个错误');
  check('以 %%EOF 结束', s.slice(-8).indexOf('%%EOF') >= 0);

  /* 写盘供人工打开验证 */
  const out = path.join(os.tmpdir(), 'lingyi-inplace-test.pdf');
  fs.writeFileSync(out, Buffer.from(pdfBytes));
  console.log('    已写出: ' + out);
}

console.log('\n=== 5) 折行（用真实字体度量）===');
{
  used = new Map();
  const lines = R.wrapWithFont(F, font, '这是一段比较长的中文文本需要按照块宽度折行处理否则会超出边界', 10, 100, used);
  console.log('    折行 ' + lines.length + ' 行: ' + JSON.stringify(lines.slice(0, 3)));
  check('中文折成多行', lines.length > 1);
  const maxW = Math.max.apply(null, lines.map(l => F.textWidth(font, l, 10, used)));
  console.log('    最宽行: ' + maxW.toFixed(2) + ' pt（限 100）');
  check('每行不超过块宽', maxW <= 101, maxW.toFixed(2));
  /* 英文按词 */
  const en = R.wrapWithFont(F, font, 'The quick brown fox jumps over the lazy dog', 10, 80, used);
  check('英文折成多行', en.length > 1);
  check('英文不切断单词', en.every(l => !/^\s|\s$/.test(l)), JSON.stringify(en));
}

console.log('\n=== 6) 缺字兜底不崩溃 ===');
{
  used = new Map();
  const hex = F.encodeText(font, '²³µ', used);      // 这些符号可能缺
  check('缺字时仍返回合法十六进制', /^([0-9A-F]{4})+$/.test(hex), hex);
}

console.log('\n====================================================');
console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
