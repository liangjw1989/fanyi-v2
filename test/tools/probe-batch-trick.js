/* probe-batch-trick.js — 能不能让腾讯云保住"批量翻译"的标记？
 * 用法: node test/tools/probe-batch-trick.js [云函数地址]
 *
 * 已知：腾讯云会丢掉"整段文本最前面"的那个标记。
 * 猜想：如果给每批加一个"无害前缀"（比如一个换行或一个词），把标记从
 *      行首挪开，标记就都能保住 → 可以恢复批量翻译（每次调用翻多段）。
 * 验证：对比 5 种前缀写法，看标记是否 100% 回来。
 */
'use strict';
const URL = process.argv[2] || 'https://1430386389-cd8v5r6ng0.ap-beijing.tencentscf.com';

async function post(text, target, engine) {
  const res = await fetch(URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text, target: target || 'en', engine: engine || 'tencent' })
  });
  const t = await res.text();
  try { return JSON.parse(t); } catch (e) { return { code: -1, result: t }; }
}

const seg = n => '##V' + n + '##';
const countM = s => (String(s || '').match(/##\s*[VPT]?\d+\s*##/g) || []).length;

/* 三段中文，共 6 个分段标记 */
function body(prefix) {
  return prefix
    + seg(0) + '共纳入 4441 例患者，见表 1。' + seg(0)
    + seg(1) + '年龄 20~59 岁，BMI 为 23.1。' + seg(1)
    + seg(2) + 'P<0.001，95%CI 1.030~1.074。' + seg(2);
}

const CASES = [
  ['无前缀（当前做法）', ''],
  ['前置换行', '\n'],
  ['前缀空格', ' '],
  ['前缀一个点号', '. '],
  ['前缀英文词', 'Translate: '],
  ['前缀中文词', '正文：'],
  ['前缀零宽空格', '\u200b'],
  ['前缀不换行横线', '--- ']
];

(async () => {
  console.log('目标:', URL);
  console.log('每批 3 段、共 6 个分段标记，看回来几个\n');
  console.log('前缀写法'.padEnd(22) + '标记'.padEnd(10) + '结果');
  console.log('-'.repeat(72));

  for (const [name, prefix] of CASES) {
    const text = body(prefix);
    const want = countM(text);
    const j = await post(text);
    if (j.code !== 0) { console.log(name.padEnd(22) + String(want).padEnd(10) + '失败: ' + String(j.result).slice(0, 40)); continue; }
    const got = countM(j.result);
    const ok = got === want;
    console.log(name.padEnd(22) + (got + '/' + want).padEnd(10) + (ok ? '✓ 完整' : '✗ 丢失') + '   ' + JSON.stringify(String(j.result).slice(0, 70)));
  }

  console.log('\n=== 若有 ✓ 的写法，说明可以恢复批量翻译（调用次数降到 1/N）===');
})();
