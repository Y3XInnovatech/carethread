@echo off
title CareThread - Clinical Digital Twin System
echo.
echo  ======================================
echo   CareThread - Clinical Digital Twin
echo  ======================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed or not in PATH.
    echo  Please install Node.js 18+ from https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f "tokens=1,2,3 delims=." %%a in ('node -v') do (
    set NODE_MAJOR=%%a
)
set NODE_MAJOR=%NODE_MAJOR:v=%
echo  Node.js version: %NODE_MAJOR%

echo.
echo  [1/2] Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo  [ERROR] npm install failed.
    pause
    exit /b 1
)

echo.
echo  [2/2] Starting CareThread...
echo.
echo  Server:  http://localhost:3001/api/v1
echo  Web UI:  http://localhost:5173
echo  WS:      ws://localhost:3001/ws
echo.
echo  Press Ctrl+C to stop.
echo.

call npm run dev
