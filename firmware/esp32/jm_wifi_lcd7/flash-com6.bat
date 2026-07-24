@echo off
chcp 65001 >nul
set PORT=COM6
echo ========================================
echo  BANKERO LCD7 — COM6 Flash Check
echo ========================================
echo Port: %PORT%
echo.
echo [A] Test kung buhay ang ESP32 sa COM6...
where esptool.py >nul 2>&1
if errorlevel 1 (
  echo Installing esptool...
  pip install esptool
)
esptool.py --port %PORT% chip_id
if errorlevel 1 (
  echo.
  echo FAILED — check:
  echo   - USB cable naka-plug
  echo   - Tamang port ^(COM6^) sa Device Manager
  echo   - Walang ibang program na bukas ^(Serial Monitor, Arduino^)
  pause
  exit /b 1
)
echo.
echo OK — ESP32 detected sa %PORT%
echo.
echo [B] Sunod: Arduino IDE Upload
echo   1. Tools -^> Port -^> %PORT%
echo   2. Board: ESP32S3 Dev Module ^(o Waveshare LCD7^)
echo   3. USB CDC On Boot: Enabled
echo   4. Buksan folder: jm_wifi_lcd7
echo   5. Upload ^(arrow button^)
echo   6. Serial Monitor 115200 — dapat may "Cloud OK"
echo.
pause
