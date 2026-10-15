/* probe-marker-formats.js — 找一个"腾讯云/百度也能原样保留"的标记格式
 * 用法: node test/tools/probe-marker-formats.js [云函数地址]
 *
 * 背景：腾讯云机器翻译会丢弃 ⟦0⟧ 这类特殊 Unicode 括号标记；
 *      DeepSeek 能保留。所以需要一个对机器翻译引擎也友好的格式。
 *
 * 方法：同一段文本，分别用 5 种候选格式标注，看哪些格式在腾讯云下能完整来回。
 *   1. ⟦0⟧        当前使用的（已确认腾讯云会丢）
 *   2. [[0]]      ASCII 双方括号（很多 MT 引擎会保留）
 *   3. {{0}}      ASCII 花括号
 *   4. <0>        尖括号
 *   5. ##0##      井号包裹
 *   6. \u00010\u0001  控制字符（MT 通常直接透传）
 */
'use strict';
const URL = process.argv[2] || 'https://1430386389-cd8v5r6ng0.ap-beijing.tencentscf.com';

async function post(body) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60000);
  try {
    const res = await fetch(URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ac.signal
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { }
    return { json, raw: text };
  } catch (e) { return { error: e.message }; }
  finally { clearTimeout(t); }
}

const CORE = '共纳入 4441 例患者，见表 1，P<0.001。';

/** 用给定的包裹函数生成带标记文本 */
const FORMATS = [
  { name: '⟦0⟧ (当前)', wrap: n => '\u27e6' + n + '\u27e7', re: /\u27e6\s*(\w+)\s*\u27e7/g },
  { name: '[[0]]', wrap: n => '[[' + n + ']]', re: /\[\[\s*(\w+)\s*\]\]/g },
  { name: '{{0}}', wrap: n => '{{' + n + '}}', re: /\{\{\s*(\w+)\s*\}\}/g },
  { name: '<0>', wrap: n => '<' + n + '>', re: /<\s*(\w+)\s*>/g },
  { name: '##0##', wrap: n => '##' + n + '##', re: /##\s*(\w+)\s*##/g },
  { name: '\u00010\u0001', wrap: n => '\u0001' + n + '\u0001', re: /\u0001\s*(\w+)\s*\u0001/g }
];

(async () => {
  console.log('目标:', URL);
  console.log('原文片段:', CORE, '\n');
  console.log('格式'.padEnd(16) + '腾讯云'.padEnd(12) + 'DeepSeek');
  console.log('-'.repeat(52));

  for (const f of FORMATS) {
    // 文本：段首尾用 seg 标记，中间插入一个术语标记和一个符号标记
    const text = f.wrap('S') + '共纳入 ' + f.wrap('T0') + '4441 例患者，见表 ' + f.wrap('P1') + '，P<0.001。' + f.wrap('S');
    const need = (text.match(f.re) || []).length;
    const row = [];
    for (const eng of ['tencent', 'deepseek']) {
      const r = await post({ text: text, target: 'en', engine: eng });
      const j = (r.json) || {};
      if (j.code !== 0) { row.push('失败'); continue; }
      const got = (String(j.result).match(f.re) || []).length;
      row.push(got === need ? `✓ 完整 ${got}/${need}` : `✗ 丢 ${need - got} 个 (${got}/${need})`);
    }
    console.log(f.name.padEnd(16) + String(row[0]).padEnd(12) + String(row[1]));
  }
  console.log('\n提示：只有两种引擎都显示 ✓ 的格式，才是安全的传输格式。');
})();
