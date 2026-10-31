/* scope-check.js — 静态检查：函数/常量的作用域是否可被调用方看到
 * 用法: node test/scope-check.js
 *
 * 为什么需要它（真实故障）：
 *   把 guideToFontPicker / FontStore / showFontReady 定义在 initTools() 内部，
 *   但 processFile 与输出格式下拉在模块顶层调用它们 →
 *   运行时报 "guideToFontPicker is not defined"，整个翻译失败。
 *   语法检查查不出来（合法 JS），只有运行时才炸。
 *
 * 做法：按缩进判断定义层级。模块顶层（IIFE 内）是 2 空格缩进；
 * 嵌在函数内部是 ≥4 空格。被顶层代码调用的辅助函数必须在顶层定义。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'app', 'index.html');
if (!fs.existsSync(APP)) { console.log('缺少 app/index.html'); process.exit(1); }
const html = fs.readFileSync(APP, 'utf8');

/* 只取 <script> 里的内联 JS（不含 src= 外部引用） */
const scripts = [];
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(html))) scripts.push(m[1]);
const js = scripts.join('\n');
if (!js.trim()) { console.log('没有内联脚本'); process.exit(1); }

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { console.log('  \u2713 ' + n); pass++; }
  else { console.log('  \u2717 ' + n + (extra ? '  → ' + extra : '')); fail++; }
};

/** 收集所有定义：name → [{ indent, line, kind }] */
function collectDefs(src) {
  const lines = src.split('\n');
  const defs = new Map();
  const add = (name, indent, lineNo, kind) => {
    if (!defs.has(name)) defs.set(name, []);
    defs.get(name).push({ indent: indent, line: lineNo, kind: kind });
  };
  const reFn = /^(\s*)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
  const reConst = /^(\s*)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;
  lines.forEach((ln, i) => {
    let mm = ln.match(reFn);
    if (mm) { add(mm[2], mm[1].length, i + 1, 'function'); return; }
    mm = ln.match(reConst);
    if (mm) add(mm[2], mm[1].length, i + 1, 'var');
  });
  return defs;
}

const defs = collectDefs(js);

/* 被 processFile / 格式下拉 / 顶层流程调用的辅助函数 —— 必须在顶层（缩进 ≤ 2）。
 * 注意 downloadText 是 initTools() 的内部函数、只在该函数内使用，所以不在列表里。 */
const MUST_BE_TOP_LEVEL = [
  'guideToFontPicker', 'FontStore', 'showFontReady',
  'buildOverlayBlocks', 'baseName', 'download',
  'addRecord', 'renderFiles', 'renderCompleted', 'setStage',
  'loadOptions', 'saveOptions', 'getApiUrl', 'escapeHtml',
  'refreshTMStats', 'processFile', 'initTools', 'openHtmlInNewTab'
];

console.log('=== 1) 关键辅助函数必须在模块顶层定义 ===');
MUST_BE_TOP_LEVEL.forEach(name => {
  const list = defs.get(name);
  if (!list || !list.length) {
    /* 有些名字可能用箭头函数赋值，宽松处理：找不到就跳过并记录 */
    console.log('  · ' + name + '（未按 function/const 声明，跳过）');
    return;
  }
  const topLevel = list.filter(d => d.indent <= 2);
  const nested = list.filter(d => d.indent > 2);
  if (nested.length && !topLevel.length) {
    check(name + ' 在顶层定义', false,
      '只在缩进 ' + nested.map(d => d.indent).join('/') + ' 处定义（第 ' +
      nested.map(d => d.line).join(',') + ' 行）→ 顶层调用会报 is not defined');
  } else {
    check(name + ' 在顶层定义（缩进 ' + (topLevel[0] ? topLevel[0].indent : '?') + '）', !!topLevel.length);
  }
});

console.log('\n=== 2) 不允许"顶层 + 内层"同名（顶层定义会被内层遮蔽）===');
{
  /* 只关心真正的风险：某个名字在顶层有定义，同时又在某个函数内部被重新定义。
     各函数里的 n/p/r/t/f 这类短局部变量是正常的，不算问题。 */
  const risky = [];
  for (const [name, list] of defs) {
    if (name.length <= 2) continue;                  // 短局部变量名，忽略
    const hasTop = list.some(d => d.indent <= 2);
    const hasNested = list.some(d => d.indent > 2);
    if (hasTop && hasNested) {
      risky.push(name + '(缩进 ' + [...new Set(list.map(d => d.indent))].join('/') + ')');
    }
  }
  console.log('    遮蔽风险: ' + (risky.length ? risky.slice(0, 8).join(', ') : '无'));
  check('没有"顶层+内层"同名定义', risky.length === 0, risky.join(', '));
}

console.log('\n=== 3) 字体相关函数必须存在且可见 ===');
['FontStore', 'showFontReady', 'guideToFontPicker'].forEach(n => {
  const list = defs.get(n);
  check(n + ' 已定义', !!list && list.length > 0);
  if (list && list.length) check(n + ' 缩进 ≤ 2（顶层）', list.every(d => d.indent <= 2),
    '缩进 ' + list.map(d => d.indent).join('/'));
});

console.log('\n=== 4) 字体选择控件与 IndexedDB 关键标识都在 ===');
{
  check('有 #fontFile 控件', html.indexOf('id="fontFile"') >= 0);
  check('有 #fontStatus 展示位', html.indexOf('id="fontStatus"') >= 0);
  check('有 #fontClearBtn', html.indexOf('id="fontClearBtn"') >= 0);
  check('用了 IndexedDB 库名', js.indexOf('lingyi_font_v1') >= 0);
  check('选择「原位替换」格式时会引导选字体',
    /pdf-inplace'\s*&&\s*!fontBytes[\s\S]{0,120}guideToFontPicker/.test(js) ||
    /guideToFontPicker\(\);[\s\S]{0,80}/.test(js));
  check('缺少字体时会引导而不是只报错', /!fontBytes\)\s*\{[\s\S]{0,160}guideToFontPicker/.test(js));
}

console.log('\n=== 5) 每条 PDF 输出路线都能找到自己的渲染器 ===');
{
  check('叠加路线引用 LingyiPdfOverlay', js.indexOf('LingyiPdfOverlay') >= 0);
  check('原位路线引用 LingyiPdfInPlace', js.indexOf('LingyiPdfInPlace') >= 0);
  check('原地渲染传入了 fontBytes', /renderInPlace\(\{[\s\S]{0,400}fontBytes/.test(js));
  check('两条路线共用 buildOverlayBlocks', js.indexOf('buildOverlayBlocks') >= 0);
}

console.log('\n=== 6) 第三方库加载方式（禁止 document.write）===');
{
  /* 真实故障：Chrome 控制台报
       "A parser-blocking, cross site script ... is invoked via document.write.
        The network request for this script MAY be blocked by the browser"
     用 document.write 注入跨站脚本会被判定为 parser-blocking，未来可能被拦。
     必须改成按需异步加载；本地 vendor/ 有文件时根本不该走 CDN。 */
  /* 只查"往当前文档注入 <script>"这种真正会被浏览器拦的写法。
     `w.document.write(html)` 往打印用的新窗口写内容属于正当用法，不算问题；
     注释里提到 document.write 也不该报。所以先把注释剥掉，再匹配
     document.write 后面紧跟 <script。 */
  const jsNoComment = js
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');  // 行注释（避免误伤 http://）
  const htmlNoComment = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  const badWrite = (jsNoComment + '\n' + htmlNoComment)
    .match(/document\.write\s*\(\s*['"`]?\s*<script/gi);
  check('没有用 document.write 注入 <script>（跨站脚本）', !badWrite,
    badWrite ? badWrite.length + ' 处' : '');
  check('提供了 ensureLib 异步加载器', js.indexOf('window.ensureLib') >= 0);
  check('有 CDN 兜底地址表', js.indexOf('__LINGYI_CDN') >= 0);

  ['pdfjsLib', 'mammoth', 'docx', 'Tesseract'].forEach(n => {
    if (js.indexOf('window.' + n) < 0) return;      // 该库未被使用就跳过
    check(n + ' 使用前有 ensureLib 保护', js.indexOf("ensureLib('" + n + "')") >= 0);
  });

  const vendorRefs = (html.match(/src="\.\/vendor\//g) || []).length;
  const uniq = new Set((html.match(/src="\.\/vendor\/[^"]+"/g) || []));
  console.log('    vendor 引用: ' + vendorRefs + ' 条，去重后 ' + uniq.size + ' 条');
  check('vendor 引用无重复', vendorRefs === uniq.size, vendorRefs + ' vs ' + uniq.size);
}

console.log('\n=== 7) 字体选择入口必须"在操作行内"且事件已绑定 ===');
{
  /* 真实故障：字体控件藏在折叠面板深处，用户点了翻译才看到报错，
     报错里让他"打开面板找控件"，他找不到 → 反复失败。
     修法：文件那一行直接显示「⚠️ 选择中文字体」按钮。 */
  check('文件行模板里有 pick-font-btn 按钮', js.indexOf('pick-font-btn') >= 0);
  check('按钮只在 pdf-inplace 输出时出现', /pdf-inplace'\s*\?\s*`/.test(js) || /outFmt === 'pdf-inplace' \? `/.test(js));
  check('点击事件已绑定 pick-font-btn', /classList\.contains\('pick-font-btn'\)/.test(js));
  check('点击后打开文件选择框', /pick-font-btn'\)\)[\s\S]{0,300}\$\('fontFile'\)\.click\(\)/.test(js) ||
    /classList\.contains\('pick-font-btn'\)[\s\S]{0,400}fontFile'\)\.click\(\)/.test(js));
  check('选择格式后立刻刷新列表（让按钮出现）', /fmt-select'\)\)[\s\S]{0,200}renderFiles\(\)/.test(js));
  check('字体载入后刷新列表（按钮变"已就绪"）', /showFontReady\([\s\S]{0,160}renderFiles\(\)/.test(js));
  check('有 btn-warn 警示样式', html.indexOf('btn-warn') >= 0);
  check('报错文案指向行内按钮', js.indexOf('选择中文字体」按钮') >= 0 || js.indexOf('该文件那一行') >= 0);
}

console.log('\n=== 8) 字体获取要"不依赖用户在文件对话框里找文件" ===');
{
  /* 真实故障：Windows 文件对话框隐藏字体扩展名（显示 simhei 而非 simhei.ttf），
     用户按提示输入完整路径也找不到 → 反复失败。
     修法：① 提供「用系统字体」按钮（Local Font Access API），完全不找文件；
           ② 支持 .ttc（微软雅黑 msyh.ttc 一定存在）；
           ③ 支持把字体文件拖进来。 */
  check('有「用系统字体」按钮', html.indexOf('id="pickSystemFontBtn"') >= 0);
  check('调用 Local Font Access API', js.indexOf('queryLocalFonts') >= 0);
  check('有该按钮的点击处理', /pickSystemFontBtn'\)\.addEventListener/.test(js));
  check('读取到 blob 后写入 fontBytes', /queryLocalFonts[\s\S]{0,2000}fontBytes\s*=/.test(js));
  check('文件选择支持 .ttc', /accept="\.ttf,\.otf,\.ttc"/.test(html));
  check('支持拖拽字体文件', js.indexOf('setupFontDrop') >= 0);
  check('提示说明了"扩展名被隐藏"这个坑', js.indexOf('隐藏字体扩展名') >= 0 || html.indexOf('隐藏字体扩展名') >= 0);
  check('推荐 msyh.ttc 作为备选', html.indexOf('msyh.ttc') >= 0 || js.indexOf('msyh.ttc') >= 0);
  check('不支持该 API 时有明确提示', js.indexOf('不支持「用系统字体」') >= 0);
}

console.log('\n====================================================');
console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
