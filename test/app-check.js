/* 检查应用页面：内联脚本语法、模块引用、DOM 依赖
 * 优先检查打包产物 dist/index.html（单文件版，模块已内联）；
 * 没有产物时再检查 app/index.html（模块版，依赖 ./src/*.js）。
 */
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist', 'index.html');
const APP = path.join(__dirname, '..', 'app', 'index.html');
const useDist = fs.existsSync(DIST);
const target = useDist ? DIST : APP;
const html = fs.readFileSync(target, 'utf8');
console.log('检查文件: ' + path.relative(path.join(__dirname, '..'), target) + (useDist ? '（打包产物）' : '（源码）'));

const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log('内联脚本块: ' + blocks.length + ' 个，共 ' + (blocks.reduce((a, b) => a + b.length, 0) / 1024).toFixed(0) + ' KB');
let ok = 0, bad = 0;
blocks.forEach((code, i) => {
  try { new Function(code); ok++; }
  catch (e) { bad++; console.log('  ✗ 第 ' + i + ' 块语法错误: ' + e.message); }
});
console.log('语法检查：通过 ' + ok + ' 个，失败 ' + bad + ' 个');

/* 必需模块是否都在（打包版看内联，源码版看 ./src/ 引用） */
const MODULES = ['core.js', 'layout.js', 'docx-extract.js', 'pdf-extract.js', 'render-html.js',
  'render-docx.js', 'render-pdf-overlay.js', 'pdf-font.js', 'render-pdf-inplace.js', 'glossary.js', 'diagnostics.js', 'tm.js', 'translate.js'];
const NAMES = ['LingyiCore', 'LingyiLayout', 'LingyiDocx', 'LingyiPdfExtract', 'LingyiRenderHtml',
  'LingyiRenderDocx', 'LingyiPdfOverlay', 'LingyiPdfFont', 'LingyiPdfInPlace', 'LingyiGlossary', 'LingyiDiagnostics', 'LingyiTM', 'LingyiTranslate'];
let missingModule = 0;
if (useDist) {
  NAMES.forEach((n, i) => {
    if (html.includes(n)) console.log('  ✓ 内联模块 ' + MODULES[i]);
    else { console.log('  ✗ 内联模块缺失 ' + MODULES[i] + '（' + n + '）'); missingModule++; }
  });
} else {
  const refs = [...html.matchAll(/src="\.\/([^"]+)"/g)].map(m => m[1]);
  for (const r of refs) {
    if (/^https?:/.test(r)) continue;
    const p = path.join(__dirname, '..', 'app', r);
    const exists = fs.existsSync(p);
    console.log('  ' + (exists ? '✓' : '✗') + ' ' + r + (exists ? '' : '  (缺失)'));
    if (!exists && r.startsWith('src/')) missingModule++;
  }
}

/* 第三方库：允许 CDN 兜底（离线时用 vendor/ 本地副本） */
const CDN_FALLBACKS = ['pdf.min.js', 'mammoth', 'docx', 'tesseract', 'qrcode', 'marked'];
const hasFallback = CDN_FALLBACKS.every(c => html.includes(c));
console.log('第三方库加载方式: ' + (hasFallback ? '本地 vendor 优先 + CDN 兜底 ✓' : '未检测到兜底加载 ✗'));
if (!hasFallback) missingModule++;

const ids = ['translateFileInput', 'translateUpload', 'translateFileList', 'completedList', 'toast',
  'loginBtn', 'loginStatus', 'historyBtn', 'logoutBtn', 'loginModal', 'closeLoginModal', 'doLoginBtn',
  'loginUsername', 'loginPassword', 'historyModal', 'closeHistoryModal', 'historyList',
  'qrSection', 'qrContainer', 'qrZoomModal', 'closeQrZoom', 'qrLargeContainer',
  'toggleToolsBtn', 'toolsPanel', 'termsText', 'optProtectSymbols', 'optUseTM',
  'tmStats', 'tmExport', 'tmImport', 'tmClear', 'loadAcademicTerms',
  'apiUrlInput', 'saveApiBtn', 'testApiBtn', 'apiStatus',
  'exportDiagBtn', 'exportDiagTextBtn', 'diagStatus'];
const missing = ids.filter(id => !new RegExp('id="' + id + '"').test(html));
console.log('DOM id 检查：缺失 ' + (missing.length ? missing.join(', ') : '无'));
process.exit(bad || missing.length || missingModule ? 1 : 0);
