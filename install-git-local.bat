@echo off
chcp 65001 >nul
title LingYi - Install Git from the local file

echo ============================================================
echo   Install Git for Windows  (from the file on your Desktop)
echo ============================================================
echo.

set SETUP=
for %%f in ("%USERPROFILE%\Desktop\Git-*-64-bit.exe") do set SETUP=%%~ff
if "%SETUP%"=="" (
  for %%f in ("%~dp0Git-*-64-bit.exe") do set SETUP=%%~ff
)
if "%SETUP%"=="" (
  echo   Installer not found.
  echo   Put Git-2.x.x-64-bit.exe on your Desktop, or in this folder.
  echo   Download it from:
  echo     https://mirrors.huaweicloud.com/git-for-windows/
  echo.
  pause
  exit /b 1
)

echo   Installer: %SETUP%
echo.
echo   Installing silently with default options ...
echo   A UAC prompt will appear - click Yes.
echo.

"%SETUP%" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS ^
  /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh" /o:PathOption=Cmd /o:CRLFOption=CRLFCommitAsIs /o:BashTerminalOption=MinTTY
echo   exit code: %errorlevel%

echo.
echo   Verifying ...
set "PATH=%PATH%;%ProgramFiles%\Git\cmd;%LOCALAPPDATA%\Programs\Git\cmd"
where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo   git not found in this window's PATH yet.
  echo   Close this window, open a NEW one, then run:  git --version
  echo   If it still fails, Git may not be installed - run the installer
  echo   manually and keep all default options.
) else (
  for /f "delims=" %%v in ('git --version') do echo   OK - %%v
)

echo.
echo ============================================================
echo   Next step
echo ============================================================
echo   1) Close this window and open a NEW command window.
echo   2) Run:  git --version     (should print a version)
echo   3) Then double-click   setup-github-ssh.bat   in the repo folder.
echo.
pause
