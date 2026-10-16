/* probe-retry.js — 标记丢失到底是"确定性"还是"随机"？重试能不能救回来？
 * 用法: node test/tools/probe-retry.js [云函数地址]
 *
 * 这决定优化方向：
 *   · 若重试常常能成功 → 应保留批量翻译（快），只在重试也失败时才逐段
 *   · 若重试永远失败   → 应立刻逐段（避免浪费）
 */
'use strict';
const URL = process.argv[2] || 'https://1430386389-cd8v5r6ng0.ap-beijing.tencentscf.com';

async function post(text) {
  const res = await fetch(URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text, target: 'en', engine: 'tencent' })
  });
  const t = await res.text();
  try { return JSON.parse(t); } catch (e) { return { code: -1, result: t }; }
}

const seg = n => '##V' + n + '##';
const countM = s => (String(s || '').match(/##\s*[VPT]?\d+\s*##/g) || []).length;

/* 一批 6 段，模拟真实批量（每段 1~3 行中文） */
const PARAS = [
  '共纳入 4441 例患者，见表 1。',
  '年龄 20~59 岁，BMI（kg/m²）为 23.1。',
  '结果 P<0.001，95%CI 1.030~1.074，OR=1.052。',
  '采用德尔菲法对 30 名专家进行两轮函询。',
  '精子DNA碎片化指数（DFI）≥30% 者占 6.8%。',
  '结论 该体系科学实用[1,2]。'
];
function batch() {
  return PARAS.map((p, i) => seg(i) + p + seg(i)).join('\n');
}

(async () => {
  console.log('目标:', URL);
  console.log('场景：一批 6 段（共 12 个分段标记），连续发 10 次，看每次回来几个\n');

  const text = batch();
  const want = countM(text);
  let okCount = 0;
  const results = [];
  for (let i = 1; i <= 10; i++) {
    const j = await post(text);
    if (j.code !== 0) { results.push('失败'); console.log('  第 ' + i + ' 次: 失败 ' + String(j.result).slice(0, 50)); continue; }
    const got = countM(j.result);
    if (got === want) okCount++;
    results.push(got + '/' + want);
    console.log('  第 ' + i + ' 次: 标记 ' + got + '/' + want + (got === want ? '  ✓' : '  ✗'));
    await new Promise(r => setTimeout(r, 300));
  }
  console.log('\n成功 ' + okCount + '/10 次');

  /* 再测：失败的那次立即重试，看第 2、3 次能否成功 */
  console.log('\n=== 重试序列测试（同一批连发 5 次）===');
  let firstFail = -1;
  for (let i = 1; i <= 5; i++) {
    const j = await post(text);
    const got = countM(j.result);
    const ok = got === want;
    console.log('  尝试 ' + i + ': ' + got + '/' + want + (ok ? ' ✓' : ' ✗'));
    if (!ok && firstFail < 0) firstFail = i;
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n=== 结论 ===');
  if (okCount >= 8) {
    console.log('  标记保留是"大概率成功"的 → 应当保留批量翻译（快），失败再重试');
  } else if (okCount >= 3) {
    console.log('  标记保留是"随机"的 → 保留批量 + 重试，重试仍失败才逐段');
  } else {
    console.log('  标记几乎必丢 → 逐段翻译更划算，避免反复重试');
  }
})();
