@echo off
chcp 65001 >nul
title LingYi - Install Git (mirror friendly)

echo ============================================================
echo   Install Git for Windows  -  try several sources
echo ============================================================
echo.
echo   The previous attempt failed because the download host
echo   (github.com releases) was not reachable from this network.
echo   This script tries sources in order until one works.
echo.
pause

echo.
echo [Attempt 1/3] winget + Microsoft Store source ...
where winget >nul 2>nul
if errorlevel 1 (
  echo    winget not available, skip.
  goto :mirror
)
winget install --id Git.Git -e --source msstore --accept-package-agreements --accept-source-agreements
where git >nul 2>nul
if not errorlevel 1 ( echo    OK - Git installed. & goto :done )

echo.
echo [Attempt 2/3] winget + official source (may fail on this network) ...
winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
where git >nul 2>nul
if not errorlevel 1 ( echo    OK - Git installed. & goto :done )

:mirror
echo.
echo [Attempt 3/3] Download from a domestic mirror ...
echo.
echo   Please download manually (about 2 minutes):
echo.
echo     1) Open this page in your browser:
echo        https://registry.npmmirror.com/-/binary/git-for-windows/
echo.
echo     2) Open the newest  v2.x.x  folder.
echo.
echo     3) Download  Git-2.x.x-64-bit.exe   (about 60-70 MB)
echo.
echo     4) Run it, keep ALL default options, click Next to the end.
echo.
echo   Other mirrors if the above is slow:
echo        https://mirrors.tuna.tsinghua.edu.cn/github-release/git-for-windows/git/
echo        https://mirrors.huaweicloud.com/git-for-windows/
echo.
echo   Tips:
echo     - Use Edge or Chrome directly; avoid download managers.
echo     - In the folder list, pick the highest version that also
echo       contains the "-64-bit.exe" file.
echo.
echo   After installing Git:
echo     - close this window
echo     - run  check-network.bat   to confirm github.com is reachable
echo     - then run  upload-to-github.bat
echo.
pause
exit /b 0

:done
echo.
echo ============================================================
echo   Git is installed.
echo ============================================================
echo   Close this window, then run  upload-to-github.bat
echo   (a new console is needed to detect the new Git)
echo.
pause
