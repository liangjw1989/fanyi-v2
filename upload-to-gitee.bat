@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title LingYi - Upload to Gitee (gitee.com)

echo ============================================================
echo   LingYi  -  one-click upload to Gitee (gitee.com)
echo ============================================================
echo.
echo   Why Gitee: gitee.com is reachable from this network,
echo   while github.com is currently blocked here.
echo   Everything works the same way for your users.
echo.

cd /d "%~dp0"

REM ============================================================
REM  !! EDIT THESE TWO LINES BEFORE FIRST USE !!
REM ============================================================
set GIT_USER_NAME=your-name
set GIT_USER_EMAIL=your-email@example.com
REM ============================================================

echo [1/6] Checking Git ...
where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Git not found. Install it first:
  echo     - run   install-git.bat   (Microsoft Store first, then mirrors)
  echo     - or download from a domestic mirror, see
  echo       docs\upload-troubleshooting.md
  echo   Then run this file again.
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('git --version') do echo       %%v

echo.
echo [2/6] Setting commit identity ^(this repo only^) ...
if "%GIT_USER_NAME%"=="your-name" (
  echo.
  echo   Please open this .bat in Notepad and set GIT_USER_NAME / GIT_USER_EMAIL
  echo   to your own name and email, then run it again.
  echo.
  pause
  exit /b 1
)
git config user.name  "%GIT_USER_NAME%"
git config user.email "%GIT_USER_EMAIL%"
git config core.quotepath false
git config i18n.commitEncoding utf-8
git config i18n.logOutputEncoding utf-8
echo       user: %GIT_USER_NAME% ^<%GIT_USER_EMAIL%^>

echo.
echo [3/6] Initializing repository ...
if not exist ".git" (
  git init
  git branch -M main
  echo       created local repo on branch main
) else (
  echo       .git already exists, skipped
)

echo.
echo [4/6] Staging all files ...
git add -A
for /f %%n in ('git diff --cached --name-only ^| find /c /v ""') do echo       staged: %%n file^(s^)

echo.
echo [5/6] Committing ...
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "feat: layout-preserving document translator v2.1 (glossary + symbol protection + TM)"
) else (
  echo       nothing new to commit
)

echo.
echo [6/6] Pushing to Gitee ...
git remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo.
  echo   1^) Open https://gitee.com/projects/new
  echo   2^) Create an EMPTY repository, do NOT initialize it with
  echo      README / .gitignore / license
  echo   3^) Copy the HTTPS address, it looks like:
  echo      https://gitee.com/YOUR-NAME/REPO-NAME.git
  echo.
  set /p REPO_URL=   Paste repository URL and press Enter:
  if "!REPO_URL!"=="" ( echo   empty URL, aborted & pause & exit /b 1 )
  git remote add origin "!REPO_URL!"
  echo       origin set
) else (
  for /f "delims=" %%u in ('git remote get-url origin') do echo       current origin: %%u
)

echo.
git push -u origin main
if errorlevel 1 (
  echo.
  echo   Push failed. Most likely account / password problem.
  echo   Gitee will ask for your Gitee user name and password
  echo   ^(a personal access token is recommended^) in a popup.
  echo   Just run this file again to retry.
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   DONE - uploaded to Gitee
echo ============================================================
echo   Optional: repo -^> Services -^> Gitee Pages to get a public URL
echo   so others can open the app in a browser.
echo.
echo   Want a GitHub copy later, once github.com is reachable:
echo     git remote add github https://github.com/YOUR-NAME/REPO.git
echo     git push github main
echo.
pause
