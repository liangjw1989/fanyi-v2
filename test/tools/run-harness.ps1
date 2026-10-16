# run-harness.ps1 — 用无头浏览器跑一个已生成的测试页面，取回 <pre id="result"> 内容
# 用法: powershell -ExecutionPolicy Bypass -File test/tools/run-harness.ps1 -Dir <目录> [-TimeoutSec 200]
param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [int]$TimeoutSec = 200
)
$ErrorActionPreference = 'Stop'
$dir = [System.IO.Path]::GetFullPath($Dir)
$page = Join-Path $dir 'page.html'
if (-not (Test-Path -LiteralPath $page)) { throw "找不到 $page" }

$edge = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edge) { throw '找不到 Microsoft Edge' }

$pageUrl = "file:///" + ($page -replace '\\', '/')
$baseArgs = @('--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--allow-file-access-from-files','--window-size=1200,900',"--user-data-dir=$dir\profile")

$report = $null
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$round = 0
$lastText = ''
while ((Get-Date) -lt $deadline -and -not $report) {
  $round++
  $domFile = Join-Path $dir "dom$round.txt"
  $errFile = Join-Path $dir "err$round.txt"
  $p = Start-Process -FilePath $edge -ArgumentList ($baseArgs + @('--dump-dom', $pageUrl)) -NoNewWindow -PassThru `
    -RedirectStandardOutput $domFile -RedirectStandardError $errFile
  if (-not $p.WaitForExit(120000)) { $p.Kill() }
  Start-Sleep -Milliseconds 700
  if (Test-Path -LiteralPath $domFile) {
    $dom = [string](Get-Content -LiteralPath $domFile -Raw -Encoding UTF8)
    if ($dom) {
      $m = [regex]::Match($dom, '(?s)<pre id="result"[^>]*>(.*?)</pre>')
      if ($m.Success) {
        $t = $m.Groups[1].Value -replace '&lt;','<' -replace '&gt;','>' -replace '&amp;','&' -replace '&quot;','"'
        $lastText = $t
        if ($t -match 'DONE|FATAL|EXCEPTION') { $report = $t }
        elseif ($round -eq 1) { Write-Host "  第 1 轮未完成，继续等待…" -ForegroundColor DarkGray }
      }
    }
  }
}
if ($report) { Write-Host $report }
elseif ($lastText) { Write-Host "（超时，最后一轮输出）" -ForegroundColor Yellow; Write-Host $lastText }
else { Write-Host "未拿到任何输出" -ForegroundColor Yellow }

$errFile = Join-Path $dir "err$round.txt"
if (Test-Path -LiteralPath $errFile) {
  $e = [string](Get-Content -LiteralPath $errFile -Raw -Encoding UTF8)
  $lines = ($e -split "`n") | Where-Object { $_ -match 'Uncaught|SEVERE|Error' } | Select-Object -First 8
  if ($lines) { Write-Host "`n-- 浏览器报错 --" -ForegroundColor DarkYellow; $lines | ForEach-Object { Write-Host "  $_" } }
}
