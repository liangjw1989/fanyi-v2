/* run-tests.js — 一键跑完全部测试
 * 运行：node lingyi/run-tests.js
 *
 * 注：子进程输出通过临时文件收集（而不是 stdio 管道），
 *     这样在受限环境（禁止命名管道）下也能正常工作。
 */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SUITES = [
  ['layout.test.js', '版式算法（分行/分栏/表格/页边距/标题层级）'],
  ['glossary.test.js', '术语库 · 符号保护 · 翻译记忆'],
  ['real-docx.test.js', '真实 Word 稿结构还原'],
  ['real-pdf.test.js', '真实 PDF 双栏版式还原'],
  ['merge-table.test.js', '表格碎片合并（PDF 表格还原）'],
  ['docx-columns.test.js', 'Word 分栏节生成'],
  ['docx-real.test.js', '真实 docx 库验证（分栏/字号/缩进/表格 XML）'],
  ['e2e.test.js', '端到端：解析 → 翻译 → 生成 Word/HTML']
];

const node = process.execPath;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lingyi-test-'));

function run(scriptPath) {
  const log = path.join(tmp, path.basename(scriptPath) + '.log');
  const fd = fs.openSync(log, 'w');
  let res;
  try {
    res = spawnSync(node, [scriptPath], { stdio: ['ignore', fd, fd] });
  } finally {
    fs.closeSync(fd);
  }
  const out = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  return { code: res.status, out: out };
}

let totalPass = 0, totalFail = 0;
const rows = [];

console.log('================================================');
console.log(' 灵译 · 保版式翻译 · 测试套件');
console.log('================================================\n');

for (const [file, label] of SUITES) {
  const p = path.join(__dirname, 'test', file);
  if (!fs.existsSync(p)) { rows.push([label, '-', '跳过']); continue; }
  const r = run(p);
  const m = /通过 (\d+) 项，失败 (\d+) 项/.exec(r.out);
  /* "跳过"只在测试自己明确声明"缺少真实样本"时才算数。
   * 注意不能只匹配"跳过"二字：有些测试会打印"（跳过：本机未安装 xx）"
   * 之类的说明，那是信息而非跳过整套测试。 */
  const skipped = /缺少真实样本.{0,12}跳过|跳过.{0,12}缺少真实样本/.test(r.out) && !/✗/.test(r.out);
  let pass = m ? +m[1] : 0;
  let fail = m ? +m[2] : (skipped ? 0 : 1);
  if (!m && !skipped) {
    console.log('--- ' + label + ' 未能解析输出（退出码 ' + r.code + '）---');
    console.log(r.out.split('\n').slice(0, 20).map(l => '   ' + l).join('\n'));
    console.log('');
  }
  totalPass += pass; totalFail += fail;
  rows.push([label, skipped ? '跳过' : pass + '/' + (pass + fail), skipped ? '缺少真实样本，已跳过' : (fail ? '有失败' : '全部通过')]);
  if (fail) {
    console.log('--- ' + label + ' 失败明细 ---');
    r.out.split('\n').filter(l => l.includes('✗')).forEach(l => console.log('   ' + l.trim()));
    console.log('');
  }
}

console.log('套件结果：');
for (const [label, score, status] of rows) {
  const isSkip = status.indexOf('跳过') !== -1;
  const icon = status === '全部通过' ? '✓' : (isSkip ? '-' : '✗');
  console.log('  ' + icon + ' ' + String(score).padStart(7) + '   ' + label + (isSkip ? '  (' + status + ')' : ''));
}
console.log('\n合计：通过 ' + totalPass + ' 项，失败 ' + totalFail + ' 项');

const chk = run(path.join(__dirname, 'test', 'app-check.js'));
console.log('\n页面自检：');
chk.out.split('\n').filter(Boolean).forEach(l => console.log('  ' + l.trim()));
if (/DOM id 检查：缺失 (?!无)/.test(chk.out)) totalFail++;

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
process.exit(totalFail ? 1 : 0);
