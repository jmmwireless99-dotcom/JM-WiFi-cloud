@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo  BANKERO LCD7 — PlatformIO Flash COM6
echo ========================================
echo.

if not exist "config.h" (
  echo Creating config.h from config.h.example ...
  copy /Y "config.h.example" "config.h"
)

where pio >nul 2>&1
if errorlevel 1 (
  echo PlatformIO CLI not found. Install:
  echo   pip install platformio
  echo   OR: VS Code + PlatformIO extension
  echo.
  echo Then run this script again.
  pause
  exit /b 1
)

echo [1] Build ...
pio run -e lcd7s3
if errorlevel 1 (
  echo BUILD FAILED
  pause
  exit /b 1
)

echo.
echo [2] Upload to COM6 ...
pio run -e lcd7s3 -t upload
if errorlevel 1 (
  echo UPLOAD FAILED — close Serial Monitor, check USB COM6
  pause
  exit /b 1
)

echo.
echo OK — flashed via PlatformIO
echo.
echo [3] Serial monitor (115200) — Ctrl+C to exit
echo     Dapat may: Cloud OK — BANKERO GASOLINE LCD-7
echo.
pio device monitor -e lcd7s3
