/* marker-decode.test.js — 占位符解码必须容忍引擎插入的空格
 * 用法: node test/marker-decode.test.js
 *
 * 真实故障（来自用户实际译文）：
 *   腾讯云把 ##P0## 输出成 "## P0 ##"，而旧正则只匹配 "##V12##"（无空格），
 *   结果 "##P0##" 只被替换掉半边，译文里残留 "#P0 ##"、"##P0#" 这种垃圾字符，
 *   原本应还原成 "4441"、"kg/m²" 等符号的地方变成了乱码。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');

function load() {
  const sb = {
    console, setTimeout, clearTimeout, Promise, JSON, Math, Date, Object, Array, String, Number,
    RegExp, Error, isFinite, parseInt, parseFloat, Uint8Array, ArrayBuffer, TextEncoder,
    Blob: function () { }, URL: {}, atob: s => Buffer.from(s, 'base64').toString('binary'),
    localStorage: { getItem: () => null, setItem: () => { }, removeItem: () => { } }
  };
  sb.globalThis = sb; sb.window = sb;
  sb.document = { createElement: () => ({ style: {}, textContent: '', innerHTML: '' }) };
  const ctx = vm.createContext(sb);
  for (const f of ['core.js', 'glossary.js', 'tm.js', 'translate.js']) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  }
  return sb;
}

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { console.log('  \u2713 ' + n); pass++; }
  else { console.log('  \u2717 ' + n + (extra ? '  → ' + extra : '')); fail++; }
};

const sb = load();
const tr = sb.LingyiTranslate, core = sb.LingyiCore;

console.log('=== 1) 无空格的标准形式 ===');
{
  check('##V3## → ⟦3⟧', tr.decodeMarkers('##V3##') === '\u27e63\u27e7', JSON.stringify(tr.decodeMarkers('##V3##')));
  check('##P0## → ⟦P0⟧', tr.decodeMarkers('##P0##') === '\u27e6P0\u27e7', JSON.stringify(tr.decodeMarkers('##P0##')));
  check('##T1## → ⟦T1⟧', tr.decodeMarkers('##T1##') === '\u27e6T1\u27e7', JSON.stringify(tr.decodeMarkers('##T1##')));
}

console.log('\n=== 2) 引擎插空格的形式（真实故障）===');
{
  const cases = [
    ['## P0 ##', '\u27e6P0\u27e7', '## 与字母间有空格'],
    ['##P0 ##', '\u27e6P0\u27e7', '数字与 ## 间有空格'],
    ['## P0##', '\u27e6P0\u27e7', '开头有空格'],
    ['##  V12  ##', '\u27e612\u27e7', '双向多空格'],
    ['## T2 ##', '\u27e6T2\u27e7', '术语占位符带空格'],
    ['## P1##', '\u27e6P1\u27e7', '混合']
  ];
  cases.forEach(([input, want, desc]) => {
    const got = tr.decodeMarkers(input);
    check(desc + '：' + JSON.stringify(input), got === want, JSON.stringify(got));
  });
}

console.log('\n=== 3) 残缺标记（只剩半边 #）也要还原 ===');
{
  const cases = [
    ['#P0 ##', '\u27e6P0\u27e7'],
    ['##P0 #', '\u27e6P0\u27e7'],
    ['# P0 #', '\u27e6P0\u27e7'],
    ['#T3#', '\u27e6T3\u27e7']
  ];
  cases.forEach(([input, want]) => {
    const got = tr.decodeMarkers(input);
    check('残缺 ' + JSON.stringify(input), got === want, JSON.stringify(got));
  });
}

console.log('\n=== 4) 混合文本：标记与正常文字共存 ===');
{
  const input = '共纳入 ## P0 ## 例患者，见表 ##P1##，差异有统计学意义 ## T0 ##。';
  const got = tr.decodeMarkers(input);
  console.log('    解码后: ' + got);
  check('三个标记全部还原', (got.match(/\u27e6[PT]\d+\u27e7/g) || []).length === 3, got);
  check('没有残留 # 号', got.indexOf('#') < 0, got);
  check('普通文字未被破坏', got.indexOf('共纳入') >= 0 && got.indexOf('统计学意义') >= 0);
}

console.log('\n=== 5) 端到端：占位符还原成真实符号 ===');
{
  const G = sb.LingyiGlossary;
  const text = '共纳入 4441 例患者，BMI（kg/m²）为 23.1，P<0.001。';
  const p = G.protect(text, { terms: [] });
  console.log('    保护后: ' + p.text);
  const encoded = tr.encodeMarkers(p.text);
  console.log('    编码后: ' + encoded);
  /* 模拟腾讯云：在每个 ##x## 内部插空格 */
  const engineOut = encoded.replace(/##([VPT]?)(\d+)##/g, '## $1$2 ##');
  console.log('    引擎输出(带空格): ' + engineOut);
  const decoded = tr.decodeMarkers(engineOut);
  console.log('    解码后: ' + decoded);
  const restored = G.restore(decoded, p.items);
  console.log('    还原后: ' + restored.text);
  check('符号全部还原', restored.missing.length === 0, restored.missing.join(','));
  check('含 4441', restored.text.indexOf('4441') >= 0);
  check('含 kg/m²', restored.text.indexOf('kg/m²') >= 0);
  check('含 P<0.001', restored.text.indexOf('P<0.001') >= 0);
  check('无残留 # 号', restored.text.indexOf('#') < 0, restored.text);
}

console.log('\n=== 6) 编码函数必须能反解（往返一致）===');
{
  const toks = ['\u27e60\u27e7', '\u27e6P0\u27e7', '\u27e6T12\u27e7', '\u27e63\u27e7'];
  toks.forEach(t => {
    const enc = tr.encodeMarkers(t);
    const dec = tr.decodeMarkers(enc);
    check('往返 ' + JSON.stringify(t) + ' → ' + JSON.stringify(enc), dec === t, JSON.stringify(dec));
  });
}

console.log('\n====================================================');
console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
