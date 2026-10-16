# trace-pdf.ps1 — 在无头浏览器里用真实 pdf.js 抽取指定 PDF，并输出块结构报告
# 用法: powershell -ExecutionPolicy Bypass -File test/tools/trace-pdf.ps1 -Pdf "C:\path\file.pdf"
param(
  [Parameter(Mandatory = $true)][string]$Pdf,
  [string]$PdfJsUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  [string]$WorkerUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  [int]$TimeoutSec = 180
)

$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent   # lingyi-final
$tools = $PSScriptRoot
$work = Join-Path $root 'test\out\pdfharness'
if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
New-Item -ItemType Directory -Force -Path $work | Out-Null

Write-Host "== 1) 把 PDF 切成 script 片段 ==" -ForegroundColor Cyan
& node (Join-Path $tools 'dump-pdf.js') $Pdf $work
if ($LASTEXITCODE -ne 0) { throw 'dump-pdf 失败' }

Write-Host "`n== 2) 生成测试页面 ==" -ForegroundColor Cyan
Copy-Item -LiteralPath (Join-Path $tools 'pdf-harness.js') -Destination (Join-Path $work 'pdf-harness.js') -Force
foreach ($m in @('core.js', 'layout.js', 'pdf-extract.js')) {
  Copy-Item -LiteralPath (Join-Path $root "src\$m") -Destination (Join-Path $work $m) -Force
}

$chunks = Get-ChildItem -LiteralPath $work -Filter 'chunk*.js' | Sort-Object Name
$scriptTags = ($chunks | ForEach-Object { "<script src=`"$($_.Name)`"></script>" }) -join "`n"

$html = @"
<!DOCTYPE html><html><head><meta charset="utf-8"><title>PDF harness</title></head>
<body>
<pre id="result" style="font-size:12px"></pre>
<script>window.__PDF_PARTS__=[];window.__PDF_PARTS_PUSH__=function(s){window.__PDF_PARTS__.push(s);};</script>
<script src="manifest.js"></script>
$scriptTags
<script src="$PdfJsUrl"></script>
<script>if(window.pdfjsLib){pdfjsLib.GlobalWorkerOptions.workerSrc='';pdfjsLib.GlobalWorkerOptions.workerPort=null;}</script>
<script src="core.js"></script>
<script src="layout.js"></script>
<script src="pdf-extract.js"></script>
<script src="pdf-harness.js"></script>
</body></html>
"@
$htmlPath = Join-Path $work 'harness.html'
[System.IO.File]::WriteAllText($htmlPath, $html, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "  $htmlPath"

Write-Host "`n== 3) 用无头浏览器运行 ==" -ForegroundColor Cyan
$edge = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edge) { throw '找不到 Microsoft Edge' }
Write-Host "  浏览器: $edge"

Write-Host "`n== 3) 用无头浏览器运行（轮询等待抽取完成）==" -ForegroundColor Cyan
$edge = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edge) { throw '找不到 Microsoft Edge' }
Write-Host "  浏览器: $edge"

$pageUrl = "file:///" + ($htmlPath -replace '\\', '/')
$baseArgs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--window-size=1200,900', '--virtual-time-budget=25000',
  "--user-data-dir=$work\profile"
)

$report = $null
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$round = 0
while ((Get-Date) -lt $deadline -and -not $report) {
  $round++
  $domFile = Join-Path $work "dom$round.txt"
  $p = Start-Process -FilePath $edge -ArgumentList ($baseArgs + @('--dump-dom', $pageUrl)) `
    -NoNewWindow -PassThru -RedirectStandardOutput $domFile -RedirectStandardError (Join-Path $work "err$round.txt")
  if (-not $p.WaitForExit(90000)) { $p.Kill() }
  Start-Sleep -Milliseconds 700
  if (Test-Path -LiteralPath $domFile) {
    $dom = Get-Content -LiteralPath $domFile -Raw -Encoding UTF8
    $m = [regex]::Match($dom, '(?s)<pre id="result"[^>]*>(.*?)</pre>')
    if ($m.Success) {
      $text = $m.Groups[1].Value
      $text = $text -replace '&lt;', '<' -replace '&gt;', '>' -replace '&amp;', '&' -replace '&quot;', '"'
      if ($text -match 'DONE|FATAL|EXCEPTION') { $report = $text }
      else { Write-Host ("  第 {0} 轮尚未完成，继续等待…" -f $round) -ForegroundColor DarkGray }
    }
  }
}

Write-Host "`n== 4) 抽取报告 ==" -ForegroundColor Cyan
if ($report) { Write-Host $report }
else {
  Write-Host "  等待 $TimeoutSec 秒仍未拿到完整报告。最后一轮原始输出：" -ForegroundColor Yellow
  $last = Join-Path $work "dom$round.txt"
  if (Test-Path -LiteralPath $last) {
    $dom = Get-Content -LiteralPath $last -Raw -Encoding UTF8
    $m = [regex]::Match($dom, '(?s)<pre id="result"[^>]*>(.*?)</pre>')
    if ($m.Success) { Write-Host ($m.Groups[1].Value -replace '&lt;', '<' -replace '&gt;', '>' -replace '&amp;', '&') }
  }
}
$errFile = Join-Path $work "err$round.txt"
if (Test-Path -LiteralPath $errFile) {
  $e = Get-Content -LiteralPath $errFile -Raw -Encoding UTF8
  $lines = ($e -split "`n") | Where-Object { $_ -match 'Uncaught|SEVERE|Warning' } | Select-Object -First 10
  if ($lines) {
    Write-Host "`n== 浏览器/库告警 ==" -ForegroundColor DarkYellow
    $lines | ForEach-Object { Write-Host "  $_" }
  }
}
Write-Host "`n报告目录: $work"
