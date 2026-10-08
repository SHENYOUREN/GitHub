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
for /f "usebackq delims=" %%T in (`node scripts\win10-token.mjs`) do set "CONTROLLER_TOKEN=%%T"
if not defined CONTROLLER_TOKEN (
  echo [ERROR] Failed to create or read the local controller token.
  pause
  exit /b 1
)
echo.
echo ChatGPT x DeepSeek task room
echo URL: http://127.0.0.1:4310/
echo Agent window: http://127.0.0.1:4310/agent
echo Controller token is stored in data\controller-token.txt
echo Press Ctrl+C in this window to stop the local relay.
echo.
npm start
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo [ERROR] Task room stopped with exit code %RC%.
  pause
)
exit /b %RC%
