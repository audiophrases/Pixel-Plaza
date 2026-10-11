@echo off
rem Runs the class on this laptop and opens the teacher controls. Double-click
rem to run; keep the window open during the lesson. Close it to stop the class.
cd /d "%~dp0"
title Pixel Plaza - class server

where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)

rem First time on this laptop: ask for the teacher password and save its hash.
if not exist .dev.vars (
    node scripts\setup-laptop.mjs || (pause & exit /b 1)
)

rem Every time, so packages added by an update are installed too. Quick when nothing changed.
echo Checking dependencies...
call npm install --no-audit --no-fund --no-save || (echo. & echo Installing failed. Is this laptop online? & pause & exit /b 1)

rem Opens the teacher controls in the browser once the server answers.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command ^
  "for ($i = 0; $i -lt 180; $i++) { try { Invoke-WebRequest -UseBasicParsing http://localhost:8787/api/health | Out-Null; Start-Process http://localhost:8787/teacher; break } catch { Start-Sleep 1 } }"

set PORT=8787
call npm run classroom
pause
