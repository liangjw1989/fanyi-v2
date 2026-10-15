@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title LingYi - GitHub SSH setup

set SSH_DIR=%USERPROFILE%\.ssh
set KEY=%SSH_DIR%\id_ed25519_github

echo ============================================================
echo   Set up GitHub over SSH  (works on this network)
echo ============================================================
echo.
echo   Test result on this machine:
echo     HTTPS to github.com      -^> BLOCKED (timeout)
echo     SSH  to github.com:22    -^> WORKS   (handshake OK)
echo.
echo   So we push over SSH instead of HTTPS. This script:
echo     1) creates an SSH key
echo     2) shows the PUBLIC key you must paste into GitHub
echo     3) tests the connection
echo     4) prints the exact git commands to run afterwards
echo.

where ssh >nul 2>nul
if errorlevel 1 (
  echo   ssh.exe not found.
  echo   Windows Settings -^> Apps -^> Optional features
  echo   -^> Add a feature -^> OpenSSH Client. Then rerun.
  echo.
  pause
  exit /b 1
)

echo [1/4] Preparing %SSH_DIR% ...
if not exist "%SSH_DIR%" mkdir "%SSH_DIR%"

echo.
echo [2/4] Creating SSH key ...
if exist "%KEY%" (
  echo       key already exists, skipped
) else (
  echo       when asked for a passphrase just press Enter (3 times^)
  echo.
  ssh-keygen -t ed25519 -f "%KEY%" -C "lingyi-github"
  if errorlevel 1 ( echo   keygen failed & pause & exit /b 1 )
)

if not exist "%KEY%.pub" (
  echo   public key not found, something went wrong.
  pause
  exit /b 1
)

echo.
echo [3/4] Testing connection to GitHub over SSH ...
ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -T git@github.com

echo.
echo [4/4] Your PUBLIC key (copy ALL of the text below^)
echo.
echo ------------------------------------------------------------
type "%KEY%.pub"
echo ------------------------------------------------------------
echo.
echo   NEXT STEPS
echo.
echo   Step A - add this public key to your GitHub account.
echo     Open (from a phone hotspot, a VPN, or any network where
echo     github.com works^):
echo        https://github.com/settings/ssh/new
echo     Title: lingyi   /   Key type: Authentication Key
echo     Key:   paste the block above
echo     Click  Add SSH key.
echo.
echo     If github.com is not reachable anywhere for you, use Gitee
echo     instead: run upload-to-gitee.bat  (gitee.com is reachable^).
echo.
echo   Step B - tell git to use SSH. In the repo folder run:
echo        git remote set-url origin git@github.com:USER/REPO.git
echo        git push -u origin main
echo.
echo     (Replace USER/REPO with your own GitHub user and repo name.
echo      The repo must already exist and be EMPTY on GitHub.)
echo.

echo   Copying the public key to the clipboard as well ...
clip < "%KEY%.pub"
if errorlevel 1 ( echo   (clipboard copy failed, please select manually^) ) else ( echo   OK - key is in your clipboard, just paste it on GitHub. )

echo.
start notepad "%KEY%.pub"
echo.
pause
