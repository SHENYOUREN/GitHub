@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 22.19 or newer first.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found in PATH. Reinstall Node.js with npm enabled.
  pause
  exit /b 1
)
node scripts\windows-compat-check.mjs
if errorlevel 1 (
  echo [ERROR] Windows compatibility pre-check failed.
  pause
  exit /b 1
)
echo Installing dependencies with npm ci...
npm ci
if errorlevel 1 (
  echo [ERROR] npm ci failed.
  pause
  exit /b 1
)
echo.
echo Installation completed.
pause
