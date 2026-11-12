@echo off
title Reddit Tracker
rem Double-click this file to run the site at http://localhost:3000
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Download the LTS version from https://nodejs.org, install it, then double-click this file again.
  pause
  exit /b 1
)

if not exist "node_modules\next" (
  echo Installing for the first time. This takes about a minute...
  call npm install
  if errorlevel 1 (
    echo.
    echo The install failed. See the messages above.
    pause
    exit /b 1
  )
)

echo Starting Reddit Tracker. Your browser will open in a few seconds.
echo Keep this window open while you use the site. Close it to stop the site.
echo.
start "" /b cmd /c "ping -n 6 127.0.0.1 >nul & start http://localhost:3000"
call npm run dev
pause
