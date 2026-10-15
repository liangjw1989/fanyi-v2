@echo off
chcp 65001 >nul
title LingYi - find a working channel to GitHub

echo ============================================================
echo   Can we reach GitHub at all?  (deeper test)
echo ============================================================
echo.
echo   github.com:443 is blocked on this network.
echo   This test checks whether ANY GitHub channel still works,
echo   because "git push" needs one of them.
echo.
echo   Note: each test can take up to 10 seconds.
echo.

set SCRIPT=%TEMP%\lingyi-ghcheck.ps1
> "%SCRIPT%" echo $ProgressPreference='SilentlyContinue'
>>"%SCRIPT%" echo function Tcp([string]$h,[int]$p,[string]$label) {
>>"%SCRIPT%" echo   try {
>>"%SCRIPT%" echo     $c = New-Object System.Net.Sockets.TcpClient
>>"%SCRIPT%" echo     $ar = $c.BeginConnect($h, $p, $null, $null)
>>"%SCRIPT%" echo     if ($ar.AsyncWaitHandle.WaitOne(9000)) { $c.EndConnect($ar); $c.Close(); Write-Host ('  PASS  ' + $label) -ForegroundColor Green }
>>"%SCRIPT%" echo     else { $c.Close(); Write-Host ('  FAIL  ' + $label + '  (timeout)') -ForegroundColor Red }
>>"%SCRIPT%" echo   } catch { Write-Host ('  FAIL  ' + $label + '  ' + $_.Exception.Message) -ForegroundColor Red }
>>"%SCRIPT%" echo }
>>"%SCRIPT%" echo function Http([string]$u,[string]$label) {
>>"%SCRIPT%" echo   try {
>>"%SCRIPT%" echo     $r = Invoke-WebRequest -Uri $u -TimeoutSec 10 -UseBasicParsing
>>"%SCRIPT%" echo     Write-Host ('  PASS  ' + $label + '  HTTP ' + $r.StatusCode) -ForegroundColor Green
>>"%SCRIPT%" echo   } catch {
>>"%SCRIPT%" echo     $m = $_.Exception.Message; if ($m.Length -gt 40) { $m = $m.Substring(0,40) }
>>"%SCRIPT%" echo     Write-Host ('  FAIL  ' + $label + '  ' + $m) -ForegroundColor Red
>>"%SCRIPT%" echo   }
>>"%SCRIPT%" echo }
>>"%SCRIPT%" echo Write-Host '--- git push channels ---' -ForegroundColor Cyan
>>"%SCRIPT%" echo Tcp 'github.com' 443 'github.com:443  (HTTPS push - blocked earlier)'
>>"%SCRIPT%" echo Tcp 'github.com' 22 'github.com:22   (SSH)'
>>"%SCRIPT%" echo Tcp 'ssh.github.com' 443 'ssh.github.com:443  (SSH over HTTPS port - often works)'
>>"%SCRIPT%" echo Tcp 'ssh.github.com' 22 'ssh.github.com:22'
>>"%SCRIPT%" echo Tcp 'gitee.com' 22 'gitee.com:22    (SSH)'
>>"%SCRIPT%" echo Write-Host ''
>>"%SCRIPT%" echo Write-Host '--- download channels ---' -ForegroundColor Cyan
>>"%SCRIPT%" echo Http 'https://api.github.com/repos/git-for-windows/git/releases/latest' 'api.github.com release info'
>>"%SCRIPT%" echo Http 'https://git-scm.com/download/win' 'git-scm.com download page'
>>"%SCRIPT%" echo Http 'https://registry.npmmirror.com/-/binary/git-for-windows/' 'npmmirror git mirror'
>>"%SCRIPT%" echo Http 'https://mirrors.huaweicloud.com/git-for-windows/' 'huawei git mirror'
>>"%SCRIPT%" echo Http 'https://mirrors.tuna.tsinghua.edu.cn/github-release/git-for-windows/git/' 'tuna git mirror'
>>"%SCRIPT%" echo Http 'https://cdn.jsdelivr.net/gh/git-for-windows/git@main/README.md' 'jsdelivr gh proxy'

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
del "%SCRIPT%" >nul 2>nul

echo.
echo ------------------------------------------------------------
echo   How to read it
echo.
echo   [A] if  ssh.github.com:443  is PASS
echo       -^> push over SSH will work. Then in the repo folder run:
echo            git remote set-url origin git@github.com:USER/REPO.git
echo          and create %%USERPROFILE%%\.ssh\config with:
echo            Host github.com
echo              HostName ssh.github.com
echo              Port 443
echo              User git
echo.
echo   [B] if every github.com channel FAILs but mirrors PASS
echo       -^> you cannot push to GitHub from this network.
echo          Two good options:
echo            1) publish on Gitee (gitee.com works): run upload-to-gitee.bat
echo            2) use a proxy / VPN, then run upload-to-github.bat
echo.
echo   [C] if nothing works
echo       -^> the app still works: send repo\index.html directly
echo          to others (185 KB, single file, double-click to use).
echo ------------------------------------------------------------
echo.
pause
