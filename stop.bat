@echo off
REM Double-click to stop Pack Pal. Your lists are saved before it stops.
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed, so Pack Pal can't be running.
  pause
  exit /b 1
)
node scripts\pack-pal-ctl.js stop
if errorlevel 1 (
  pause
  exit /b 1
)
timeout /t 5 >nul
