# browser-smoke.ps1 — 用无头 Edge 真机加载页面，捕获 JS 运行时错误
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\test\browser-smoke.ps1 [页面路径]
# 说明：
#   页面里有依赖 CDN 的第三方库，无网络时会打印加载失败（这属于预期兜底），
#   本脚本只关心"页面自身的 JS 是否报错"。

param(
  [string]$Page = '',
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)

$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
if (-not $Page) {
  # 仓库布局是 dist/index.html；旧布局（直接部署到静态目录）是 index.html
  foreach ($cand in @('dist\index.html', 'index.html')) {
    $p = Join-Path $root $cand
    if (Test-Path -LiteralPath $p) { $Page = $p; break }
  }
}

if (-not (Test-Path -LiteralPath $Page)) { Write-Host "找不到页面: $Page"; exit 2 }
if (-not (Test-Path -LiteralPath $Edge)) { Write-Host "找不到 Edge: $Edge"; exit 2 }

$work = Join-Path $env:TEMP ('lingyi-smoke-' + (Get-Date -Format 'HHmmss'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$profile = Join-Path $work 'profile'
$log = Join-Path $work 'edge.log'
$dump = Join-Path $work 'dom.html'

$uri = 'file:///' + ($Page -replace '\\', '/')
Write-Host "加载: $uri" -ForegroundColor Cyan

# 用 --dump-dom 强制渲染完页面，同时用 --enable-logging 捕获控制台错误
& $Edge --headless=new --disable-gpu --no-sandbox --enable-logging=stderr --v=0 `
  --user-data-dir="$profile" --virtual-time-budget=6000 `
  --dump-dom "$uri" 2>$log 1>$dump | Out-Null

$size = if (Test-Path $dump) { (Get-Item $dump).Length } else { 0 }
Write-Host ("DOM 大小: {0:N0} 字节" -f $size)

$errors = @()
if (Test-Path $log) {
  $errors = Select-String -LiteralPath $log -Pattern 'Uncaught|is not defined|TypeError|SyntaxError|ReferenceError' -ErrorAction SilentlyContinue |
    ForEach-Object { $_.Line } | Sort-Object -Unique
}

$dom = if (Test-Path $dump) { Get-Content -LiteralPath $dump -Raw -Encoding UTF8 } else { '' }

Write-Host "`n检查项：" -ForegroundColor Cyan
$checks = [ordered]@{
  '页面已渲染（DOM 非空）' = ($size -gt 2000)
  '标题正确'               = ($dom -match '灵译')
  '上传区域存在'           = ($dom -match 'translateUpload')
  '文件列表容器存在'       = ($dom -match 'translateFileList')
  '已完成列表存在'         = ($dom -match 'completedList')
  '七个核心模块已加载'     = (@('LingyiCore', 'LingyiLayout', 'LingyiDocx', 'LingyiPdfExtract', 'LingyiRenderHtml',
      'LingyiRenderDocx', 'LingyiGlossary', 'LingyiTM', 'LingyiTranslate') |
      Where-Object { -not ($dom -match $_) }).Count -eq 0
  '术语库面板存在'         = ($dom -match 'termsText') -and ($dom -match 'loadAcademicTerms')
}
$bad = 0
foreach ($k in $checks.Keys) {
  if ($checks[$k]) { Write-Host "  OK   $k" -ForegroundColor Green }
  else { Write-Host "  失败 $k" -ForegroundColor Red; $bad++ }
}

if ($errors.Count) {
  Write-Host "`n页面自身 JS 报错：" -ForegroundColor Red
  $errors | Select-Object -First 12 | ForEach-Object { Write-Host "  $_" }
  $bad += $errors.Count
} else {
  Write-Host "`n未发现页面自身 JS 报错 ✅" -ForegroundColor Green
}

Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
if ($bad) { Write-Host "`n冒烟测试失败（$bad 项）" -ForegroundColor Red; exit 1 }
Write-Host "`n冒烟测试通过 ✅" -ForegroundColor Cyan
exit 0
