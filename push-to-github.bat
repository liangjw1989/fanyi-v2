@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title LingYi - prepare and push to GitHub

echo ============================================================
echo   Prepare the repo and push to GitHub over SSH
echo ============================================================
echo.
echo   Environment checked on this machine:
echo     Git installed ................ yes  (2.55.0.windows.5)
echo     SSH to github.com ............ OK   (handshake works)
echo     github.com web pages ......... OK   (login / new repo / ssh keys)
echo     Windows user name is Chinese -^> Git's own ssh cannot read the
echo       .ssh path, so we force the Windows OpenSSH instead.
echo.

cd /d "%~dp0"

set GIT="%ProgramFiles%\Git\cmd\git.exe"
if not exist %GIT% set GIT="%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
if not exist %GIT% (
  echo   git.exe not found. Install Git first.
  pause
  exit /b 1
)

echo ============================================================
echo   STEP A - add your public key to GitHub  (do this first)
echo ============================================================
echo.
echo   Your public key:
echo   --------------------------------------------------------
type "%USERPROFILE%\.ssh\id_ed25519_github.pub"
echo   --------------------------------------------------------
echo.
echo   1) The key is already in your clipboard. If not, copy the
echo      line above manually.
echo   2) Open this page in your browser ^(it loads fast^):
echo         https://github.com/settings/ssh/new
echo   3) Title: lingyi      Key type: Authentication Key
echo      Key: press Ctrl+V
echo   4) Click "Add SSH key".
echo.
echo   The script copied the key to the clipboard again just now:
clip < "%USERPROFILE%\.ssh\id_ed25519_github.pub"
echo.
pause
echo.
echo   Testing whether the key is accepted yet ...
"C:\Windows\System32\OpenSSH\ssh.exe" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -T git@github.com
echo.
echo   If you see "Hi ... You've successfully authenticated" above,
echo   press any key to continue with the commit and push.
echo   If you see "Permission denied", the key is not added yet -
echo   add it on the web page and run this file again.
echo.
pause

echo ============================================================
echo   STEP B - create an EMPTY repository on GitHub
echo ============================================================
echo.
echo   Open:  https://github.com/new
echo   IMPORTANT: do NOT tick "Add a README file", .gitignore or license.
echo.
set /p GHUSER=   Your GitHub user name:
if "!GHUSER!"=="" ( echo   empty, aborted & pause & exit /b 1 )
set /p GHREPO=   Repository name (e.g. lingyi-translator):
if "!GHREPO!"=="" ( echo   empty, aborted & pause & exit /b 1 )
set REMOTE=git@github.com:!GHUSER!/!GHREPO!.git
echo.
echo   Remote will be: !REMOTE!
echo.
pause

echo ============================================================
echo   STEP C - commit and push
echo ============================================================
echo.
%GIT% config user.name "!GHUSER!"
%GIT% config user.email "!GHUSER!@users.noreply.github.com"
%GIT% config core.quotepath false
%GIT% config i18n.commitEncoding utf-8
%GIT% config i18n.logOutputEncoding utf-8
REM force Windows OpenSSH (Git's bundled ssh breaks on Chinese user paths)
%GIT% config core.sshCommand "\"C:/Windows/System32/OpenSSH/ssh.exe\" -o StrictHostKeyChecking=accept-new"

if not exist ".git" (
  %GIT% init
  %GIT% branch -M main
  echo   repository initialized
)

%GIT% add -A
%GIT% diff --cached --quiet
if errorlevel 1 (
  %GIT% commit -m "feat: layout-preserving document translator v2.1 (glossary + symbol protection + TM)"
) else (
  echo   nothing new to commit
)

%GIT% remote get-url origin >nul 2>nul
if errorlevel 1 (
  %GIT% remote add origin !REMOTE!
) else (
  %GIT% remote set-url origin !REMOTE!
)
echo   remote set to !REMOTE!
echo.
echo   Pushing ...  ^(first time may ask "yes" to confirm the host key^)
echo.
%GIT% push -u origin main
if errorlevel 1 (
  echo.
  echo   Push failed. Possible reasons:
  echo     - the repository does not exist / name is wrong
  echo     - the public key was not added to GitHub
  echo     - the repo was created WITH a README ^(then run:
  echo         git pull --rebase origin main   and push again^)
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   DONE - your project is on GitHub
echo ============================================================
echo   Optional: Settings -^> Pages -^> Source: main /(root)
echo   Then others can open your app in a browser.
echo.
pause
