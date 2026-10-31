/* transform-ir-mapping.test.js — 临时 IR 的"译文回写"必须落到正确的块上
 * 用法: node test/transform-ir-mapping.test.js
 *
 * 为什么必须有这个测试（真实故障）：
 *   原位替换输出会先把每个段落块塞进一个"临时 IR"去走翻译流水线，
 *   再把译文读回来。临时 IR 的块**必须带唯一 id** ——
 *   因为 core.applyTranslation 是用 blockId 定位块的：
 *       const b = findBlock(ir, unit.blockId);
 *       if (!b) return false;
 *   没有 id 时 findBlock 会用 `b.id === undefined` 匹配到**第一个块**，
 *   于是所有译文都写进 block[0]，其余块保持原文。
 *   表现：整份 22 页只有 27 个中文字符，全挤在页面左上角。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const core = require(path.join(__dirname, '..', 'src', 'core.js'));

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { console.log('  \u2713 ' + n); pass++; }
  else { console.log('  \u2717 ' + n + (extra ? '  → ' + extra : '')); fail++; }
};

const TEXTS = ['第一段原文 First', '第二段 Second', '第三段 Third', '第四段 Fourth'];

console.log('=== 1) 带 id 的临时 IR：回写必须一一对应 ===');
{
  const ir = {
    blocks: TEXTS.map((t, i) => ({ id: 'ob' + i, type: 'paragraph', runs: [{ t: t }] }))
  };
  const units = core.eachTextUnit(ir);
  check('eachTextUnit 取到 ' + TEXTS.length + ' 个单元', units.length === TEXTS.length, String(units.length));
  check('每个单元都有 blockId', units.every(u => u.blockId != null),
    units.map(u => u.blockId).join(','));

  /* 逐段"翻译"（加中文前缀），写回 */
  units.forEach((u, i) => core.applyTranslation(ir, u, '译文' + (i + 1)));

  const got = ir.blocks.map(b => core.runsToText(b.runs));
  console.log('    回写结果: ' + JSON.stringify(got));
  check('第 1 块 = 译文1', got[0] === '译文1', got[0]);
  check('第 2 块 = 译文2', got[1] === '译文2', got[1]);
  check('第 3 块 = 译文3', got[2] === '译文3', got[2]);
  check('第 4 块 = 译文4', got[3] === '译文4', got[3]);
  check('没有块残留原文', !got.some(t => /First|Second|Third|Fourth/.test(t)), JSON.stringify(got));
}

console.log('\n=== 2) 没有 id 会退化成"全部写进第 1 块"（回归保护）===');
{
  const ir = { blocks: TEXTS.map(t => ({ type: 'paragraph', runs: [{ t: t }] })) };
  const units = core.eachTextUnit(ir);
  units.forEach((u, i) => core.applyTranslation(ir, u, 'X' + (i + 1)));
  const got = ir.blocks.map(b => core.runsToText(b.runs));
  console.log('    回写结果: ' + JSON.stringify(got));
  /* 这正是之前的 bug 表现：只有第 1 块被改写（最后一段覆盖） */
  const changed = got.filter(t => /^X\d$/.test(t)).length;
  console.log('    被改写的块数: ' + changed + ' / ' + got.length);
  check('确认这是错误行为（仅 1 块被改写）—— 所以 id 不可省', changed <= 1,
    '改写了 ' + changed + ' 块');
  check('除第 1 块外仍是原文', got.slice(1).every(t => /Second|Third|Fourth/.test(t)), JSON.stringify(got));
}

console.log('\n=== 3) 顺序必须稳定（否则译文会串段）===');
{
  const ir = { blocks: TEXTS.map((t, i) => ({ id: 'k' + i, type: 'paragraph', runs: [{ t: t }] })) };
  const units = core.eachTextUnit(ir);
  const order = units.map(u => u.blockId);
  console.log('    unit 顺序: ' + order.join(','));
  check('顺序与块顺序一致', order.join(',') === 'k0,k1,k2,k3', order.join(','));
  /* 乱序写回也应落到正确块 */
  units.slice().reverse().forEach((u, i) => core.applyTranslation(ir, u, 'R' + u.blockId));
  const got = ir.blocks.map((b, i) => core.runsToText(b.runs));
  check('乱序写回仍正确', got[0] === 'Rk0' && got[3] === 'Rk3', JSON.stringify(got));
}

console.log('\n=== 4) 界面代码必须给临时 IR 的块加 id ===');
{
  const appPath = path.join(__dirname, '..', 'app', 'index.html');
  const app = fs.readFileSync(appPath, 'utf8');
  const hasId = /blocks:\s*flat\.map\(\(b,\s*i\)\s*=>\s*\(\{\s*id:/.test(app);
  check('app 里 flat.map 生成了 id', hasId, hasId ? '' : '缺少 id → 译文会全部写进第 1 块');
}

console.log('\n====================================================');
console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
