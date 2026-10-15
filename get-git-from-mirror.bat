@echo off
chcp 65001 >nul
title LingYi - Download Git from a domestic mirror

set DEST=%~dp0Git-2.55.0.5-64-bit.exe

echo ============================================================
echo   Download the Git installer from a domestic mirror
echo ============================================================
echo.
echo   github.com downloads are throttled/cut on this network
echo   (winget got 56 of 62 MB and then failed).
echo   Domestic mirrors are fast here: about 10 MB/s.
echo.
echo   This script downloads with resume support, so if it is
echo   interrupted you can simply run it again.
echo.

where curl >nul 2>nul
if errorlevel 1 (
  echo   curl.exe not found - it ships with Windows 10 1803+.
  echo   Please download manually in your browser:
  echo     https://mirrors.huaweicloud.com/git-for-windows/
  echo.
  pause
  exit /b 1
)

echo [1/2] Downloading to:
echo       %DEST%
echo.
curl.exe -L --retry 8 --retry-delay 3 --retry-all-errors -C - --connect-timeout 20 ^
  -o "%DEST%" ^
  https://mirrors.huaweicloud.com/git-for-windows/v2.55.0.windows.5/Git-2.55.0.5-64-bit.exe

if not exist "%DEST%" (
  echo.
  echo   Download failed. Try the other mirrors in your browser:
  echo     https://registry.npmmirror.com/-/binary/git-for-windows/
  echo     https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)

for %%a in ("%DEST%") do set SIZE=%%~za
echo.
echo   Downloaded size: %SIZE% bytes  (expected about 65357000)
echo.
echo   If the size is much smaller than expected, run this file again
echo   to resume the download.
echo.
echo [2/2] Starting installer ...
echo.
"%DEST%" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS ^
  /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"

echo.
echo   Installer finished. Close this window, open a NEW one, then run:
echo     git --version
echo.
pause
