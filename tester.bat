@echo off
rem Opens a test class on this PC: the teacher and a few made-up players, each in
rem its own browser tab. No Google sign-in. Double-click for 4 players, or run
rem "tester.bat 6" for more (up to 8); add noai ("tester.bat 4 noai") to skip the
rem OpenAI checks, or "random" for made-up names. Close this window to stop.
cd /d "%~dp0"
title Pixel Plaza - tester

where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)

rem Wake Render while dependency installation and the build run.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "node scripts/warm-speech.mjs"

echo Checking dependencies...
call npm install --no-audit --no-fund --no-save || (echo. & echo Installing failed. Is this PC online? & pause & exit /b 1)

echo Building the game...
call npm run build || (echo. & echo The build failed. & pause & exit /b 1)

node scripts\tester.mjs %1
pause
