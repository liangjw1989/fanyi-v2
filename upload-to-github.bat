@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title LingYi - Upload to GitHub

echo ============================================================
echo   LingYi  -  one-click upload to GitHub
echo ============================================================
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
  echo     - run   install-git.bat   in this folder, OR
  echo     - download from https://git-scm.com/download/win
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
echo [6/6] Pushing to GitHub ...
git remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo.
  echo   No remote configured yet.
  echo   1^) Create an EMPTY repository on github.com
  echo      ^(do NOT add README / .gitignore / license^)
  echo   2^) Copy its URL, looks like:
  echo      https://github.com/YOUR-NAME/REPO-NAME.git
  echo.
  set /p REPO_URL=   Paste repository URL and press Enter:
  if "!REPO_URL!"=="" ( echo   empty URL, aborted & pause & exit /b 1 )
  git remote add origin "!REPO_URL!"
  echo       origin set
) else (
  for /f "delims=" %%u in ('git remote get-url origin') do echo       current origin: %%u
)
echo.
echo   First push will ask you to sign in to GitHub in a browser window.
git push -u origin main
if errorlevel 1 (
  echo.
  echo   Push failed. Common reasons:
  echo     1^) wrong repo URL / repo does not exist
  echo     2^) GitHub sign-in not completed
  echo     3^) github.com is not reachable from this network
  echo   Just run this file again to retry.
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   DONE - uploaded successfully
echo ============================================================
echo   Optional next step: repo Settings -^> Pages -^> Source: main /(root)
echo   Then anyone can open your app from the generated Pages URL.
echo.
pause
