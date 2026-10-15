@echo off
chcp 65001 >nul
title LingYi - Network diagnostics

echo ============================================================
echo   Network check  (for GitHub / Git install)
echo ============================================================
echo.
echo   Testing a few endpoints, 8 seconds timeout each.
echo   PASS means reachable from this machine.
echo.

set SCRIPT=%TEMP%\lingyi-netcheck.ps1
> "%SCRIPT%" echo $ProgressPreference='SilentlyContinue'
>>"%SCRIPT%" echo $targets = @(
>>"%SCRIPT%" echo   @('github.com',            'https://github.com'),
>>"%SCRIPT%" echo   @('github releases CDN',   'https://github.com/git-for-windows/git/releases/latest'),
>>"%SCRIPT%" echo   @('objects.githubusercontent', 'https://objects.githubusercontent.com'),
>>"%SCRIPT%" echo   @('raw.githubusercontent', 'https://raw.githubusercontent.com'),
>>"%SCRIPT%" echo   @('api.github.com',        'https://api.github.com'),
>>"%SCRIPT%" echo   @('gitee.com',             'https://gitee.com'),
>>"%SCRIPT%" echo   @('npmjs (jsdelivr CDN)',  'https://cdn.jsdelivr.net'),
>>"%SCRIPT%" echo   @('npmmirror.com',         'https://registry.npmmirror.com'),
>>"%SCRIPT%" echo   @('git-scm.com',           'https://git-scm.com')
>>"%SCRIPT%" echo )
>>"%SCRIPT%" echo foreach ($t in $targets) {
>>"%SCRIPT%" echo   $name = $t[0]; $url = $t[1]
>>"%SCRIPT%" echo   try {
>>"%SCRIPT%" echo     $r = Invoke-WebRequest -Uri $url -Method Head -TimeoutSec 8 -UseBasicParsing
>>"%SCRIPT%" echo     Write-Host ('  PASS  {0,-24} {1}' -f $name, $r.StatusCode) -ForegroundColor Green
>>"%SCRIPT%" echo   } catch {
>>"%SCRIPT%" echo     $msg = $_.Exception.Message
>>"%SCRIPT%" echo     if ($msg.Length -gt 42) { $msg = $msg.Substring(0,42) }
>>"%SCRIPT%" echo     Write-Host ('  FAIL  {0,-24} {1}' -f $name, $msg) -ForegroundColor Red
>>"%SCRIPT%" echo   }
>>"%SCRIPT%" echo }

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
del "%SCRIPT%" >nul 2>nul

echo.
echo ------------------------------------------------------------
echo   How to read the result:
echo.
echo   * github.com PASS but "github releases CDN" FAIL
echo       -^> the download host is blocked. Install Git from a
echo          mirror instead (see step 2 below).
echo.
echo   * everything FAIL
echo       -^> no usable internet right now, or a proxy / VPN is
echo          needed. Ask your network admin or turn on VPN.
echo.
echo   * gitee.com / npmmirror.com PASS
echo       -^> domestic mirrors work, use them.
echo ------------------------------------------------------------
echo.
echo   Step 2 - install Git without GitHub:
echo     Open this page in your browser and download manually:
echo        https://registry.npmmirror.com/-/binary/git-for-windows/
echo     Pick the newest v2.x.x folder, then the file
echo        Git-2.x.x-64-bit.exe
echo     Run it, keep all default options.
echo.
echo   Alternative mirrors:
echo        https://mirrors.tuna.tsinghua.edu.cn/github-release/git-for-windows/git/
echo        https://mirrors.huaweicloud.com/git-for-windows/
echo.
echo   After installing, run  upload-to-github.bat  again.
echo.
pause
