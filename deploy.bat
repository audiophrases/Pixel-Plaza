@echo off
rem Builds Pixel Plaza and publishes it online (Cloudflare). Double-click to run.
cd /d "%~dp0"
title Pixel Plaza - deploy

where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)

rem Every time, so packages added by an update are installed too. Quick when nothing changed.
echo Checking dependencies...
call npm install --no-audit --no-fund --no-save || (echo. & echo Installing failed. Is this laptop online? & pause & exit /b 1)

echo Deploying Pixel Plaza...
call npm run deploy
if errorlevel 1 (
    echo.
    echo Deploy failed. If it asks you to log in, run: npx wrangler login
    pause
    exit /b 1
)

echo.
echo Done. Pixel Plaza is live at https://pixel-plaza.eugenime.workers.dev
pause
