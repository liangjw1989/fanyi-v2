/* build.js — 把 src/*.js 内联进 index.html，产出"单文件版"应用
 * 运行：node build.js
 * 产物：
 *   dist/index.html        单文件版（内联全部模块，双击即用）
 *   dist/index.debug.html  模块版（保留 ./src/*.js 便于后续维护）
 *   dist/src/              模块源码 + 学术术语库
 *
 * © 2026 灵译 LingYi · 个人使用免费，商业使用需获得授权（见 LICENSE）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const APP = path.join(ROOT, 'app', 'index.html');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const MODULES = ['core.js', 'layout.js', 'docx-extract.js', 'pdf-extract.js',
  'render-html.js', 'render-docx.js', 'glossary.js', 'diagnostics.js', 'tm.js', 'translate.js'];
const ASSETS = ['glossary-academic.txt'];
const OPTIONAL_FILES = ['config.js'];   // 可选部署配置（接口地址），缺失也能运行

fs.mkdirSync(DIST, { recursive: true });

let html = fs.readFileSync(APP, 'utf8');

/* ---- 0. 单文件版：把可选的 config.js 内联进去（避免发布后只带一个 html 时缺文件） ---- */
const configTag = '<script src="./config.js" onerror="this.remove()"></script>';
if (html.indexOf(configTag) >= 0) {
  const cfgPath = path.join(ROOT, 'config.js');
  if (fs.existsSync(cfgPath)) {
    const cfg = fs.readFileSync(cfgPath, 'utf8');
    html = html.replace(configTag, '<!-- ==================== config.js（部署配置，可改） ==================== -->\n<script>\n' + cfg + '\n</script>');
  } else {
    html = html.replace(configTag, '<!-- config.js 未提供：请在程序界面里填写翻译服务地址 -->');
  }
}

/* ---- 1. 校验所有模块都被引用 ---- */
const refs = [...html.matchAll(/<script src="\.\/src\/([^"]+)"><\/script>/g)].map(m => m[1]);
const missingRef = MODULES.filter(m => !refs.includes(m));
const extraRef = refs.filter(m => !MODULES.includes(m));
if (missingRef.length || extraRef.length) {
  console.error('模块引用不一致！缺失:', missingRef, '多余:', extraRef);
  process.exit(1);
}

/* ---- 2. 生成模块版（app/index.html 副本 + src/ + config.js） ---- */
fs.writeFileSync(path.join(DIST, 'index.debug.html'), html, 'utf8');
fs.mkdirSync(path.join(DIST, 'src'), { recursive: true });
for (const m of MODULES) fs.copyFileSync(path.join(SRC, m), path.join(DIST, 'src', m));
for (const a of ASSETS) {
  if (fs.existsSync(path.join(SRC, a))) fs.copyFileSync(path.join(SRC, a), path.join(DIST, 'src', a));
}
for (const f of OPTIONAL_FILES) {
  if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f));
}

/* ---- 3. 生成单文件版：把 ./src/*.js 替换成内联脚本 ---- */
const pkgVersion = (function () {
  const m = /VERSION\s*=\s*'([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8'));
  return m ? m[1] : 'unknown';
})();

const inline = MODULES.map(m => {
  const code = fs.readFileSync(path.join(SRC, m), 'utf8');
  return `<!-- ==================== ${m} ==================== -->\n<script>\n${code}\n</script>`;
}).join('\n');

const first = '<script src="./src/' + MODULES[0] + '"></script>';
const last = '<script src="./src/' + MODULES[MODULES.length - 1] + '"></script>';
const i = html.indexOf(first);
const j = html.lastIndexOf(last);
if (i < 0 || j < 0) { console.error('找不到模块引用位置'); process.exit(1); }
const jEnd = j + last.length;
let bundled = html.slice(0, i) + inline + html.slice(jEnd);

/* ---- 3b. 版权水印：构建时写入，运行时只读校验 ---- */
const crypto = require('crypto');
const banner = [
  '<!--',
  '  灵译 LingYi · 文档翻译与版式还原引擎  v' + pkgVersion,
  '  © 2026 LingYi. All rights reserved.',
  '  许可：个人学习与非商业使用免费；商业使用、二次分发、去标识后再分发均需获得书面授权。',
  '  本文件由 build.js 自动生成（单文件版），请勿手工修改；修改请编辑 app/index.html 与 src/*.js。',
  '-->'
].join('\n');
bundled = bundled.replace('<head>', '<head>\n' + banner);

// 构建指纹：内容哈希 + 时间（用于确认"这是官方发布的构建"）
const bodyHash = crypto.createHash('sha256').update(bundled).digest('hex').slice(0, 16);
bundled = bundled.replace('</body>',
  '<!-- build: v' + pkgVersion + ' | sha256:' + bodyHash + ' | ' + new Date().toISOString().slice(0, 10) + ' -->\n</body>');

fs.writeFileSync(path.join(DIST, 'index.html'), bundled, 'utf8');

/* ---- 4. 报告 ---- */
const report = [];
report.push('单文件版 dist/index.html: ' + (Buffer.byteLength(bundled) / 1024).toFixed(0) + ' KB');
report.push('构建指纹: ' + bodyHash + '  (v' + pkgVersion + ')');
report.push('模块版 dist/index.debug.html + src/(' + MODULES.length + ' 个模块)');
for (const m of MODULES) {
  const size = fs.statSync(path.join(SRC, m)).size;
  report.push('  · ' + m.padEnd(18) + (size / 1024).toFixed(1) + ' KB');
}
for (const a of ASSETS) {
  if (fs.existsSync(path.join(SRC, a))) {
    report.push('  · ' + a.padEnd(18) + (fs.statSync(path.join(SRC, a)).size / 1024).toFixed(1) + ' KB');
  }
}
console.log(report.join('\n'));

/* ---- 5. 语法自检 ---- */
const blocks = [...bundled.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[1]);
let bad = 0;
blocks.forEach((code, idx) => {
  try { new Function(code); } catch (e) { bad++; console.error('内联脚本第 ' + idx + ' 块语法错误: ' + e.message); }
});
console.log('内联脚本语法检查：' + (blocks.length - bad) + '/' + blocks.length + ' 通过');
process.exit(bad ? 1 : 0);
