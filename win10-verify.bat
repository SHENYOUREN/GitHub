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
if not exist node_modules (
  echo [ERROR] Dependencies are not installed. Run win10-install.bat first.
  pause
  exit /b 1
)
npm run verify:win10
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo [ERROR] Verification failed with exit code %RC%.
if "%RC%"=="0" echo Verification passed.
pause
exit /b %RC%
