@echo off
REM Double-click to start Pack Pal. Close this window to stop it.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
REM To require a family password, remove "REM " from the next line and pick a password:
REM set PACK_PASSWORD=change-me
set PACK_OPEN_BROWSER=1
node server.js
pause
