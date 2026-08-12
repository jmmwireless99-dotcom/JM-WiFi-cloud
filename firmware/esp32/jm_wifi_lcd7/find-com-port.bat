@echo off
chcp 65001 >nul
echo ========================================
echo  BANKERO LCD7 — Hanapin ang COM Port
echo ========================================
echo.
echo I-plug muna ang ESP32 sa USB, tapos Enter...
pause >nul
echo.
echo --- COM ports BAGO at PAGKATapos (ikumpara mo) ---
echo.
echo [1] Buksan ang Device Manager:
echo     Win+X -^> Device Manager
echo     Ports (COM ^& LPT) -^> hanapin ang:
echo       - USB Serial / CP210x / CH340 / Silicon Labs
echo       - USB JTAG/serial debug unit (ESP32-S3)
echo.
echo [2] Sa Arduino IDE:
echo     Tools -^> Port -^> piliin ang COM na may (ESP32) o USB Serial
echo.
echo [3] Test gamit ang esptool (optional):
echo     pip install esptool
echo     esptool.py --port COM6 chip_id
echo     (palitan ang COM6 ng port mo)
echo.
echo --- Windows: listahan ng COM ports ngayon ---
powershell -NoProfile -Command "Get-CimInstance Win32_SerialPort | Select-Object DeviceID, Name, Description | Format-Table -AutoSize"
echo.
echo --- USB devices (may serial) ---
powershell -NoProfile -Command "Get-PnpDevice -Class Ports -Status OK -ErrorAction SilentlyContinue | Select-Object FriendlyName, InstanceId | Format-Table -AutoSize"
echo.
pause
