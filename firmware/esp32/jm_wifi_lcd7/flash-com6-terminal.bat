@echo off
chcp 65001 >nul
setlocal
set PORT=COM6
set SKETCH=%~dp0
set FQBN=esp32:esp32:esp32s3

echo ========================================
echo  BANKERO LCD7 — Terminal Flash (COM6)
echo  Same style as dati: command line, hindi Arduino IDE GUI
echo ========================================
echo.

if not exist "%SKETCH%config.h" (
  echo Copying config.h from config.h.example ...
  copy /Y "%SKETCH%config.h.example" "%SKETCH%config.h"
)

where arduino-cli >nul 2>&1
if errorlevel 1 (
  echo [1] Install arduino-cli first:
  echo     winget install ArduinoSA.CLI
  echo     OR: https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Windows_64bit.zip
  echo.
  echo [2] Then run once:
  echo     arduino-cli config init
  echo     arduino-cli core update-index
  echo     arduino-cli core install esp32:esp32
  echo     arduino-cli lib install "ArduinoJson"
  pause
  exit /b 1
)

echo [A] Compile ...
arduino-cli compile --fqbn %FQBN% "%SKETCH%"
if errorlevel 1 (
  echo COMPILE FAILED
  pause
  exit /b 1
)

echo.
echo [B] Upload to %PORT% ...
arduino-cli upload -p %PORT% --fqbn %FQBN% "%SKETCH%"
if errorlevel 1 (
  echo UPLOAD FAILED — isara ang Serial Monitor, check COM6
  pause
  exit /b 1
)

echo.
echo OK — flashed sa %PORT%
echo Buksan ang Serial Monitor 115200 — dapat may "Cloud OK"
echo.
pause
