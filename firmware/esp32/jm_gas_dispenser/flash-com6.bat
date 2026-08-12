@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === JM Gas Dispenser — Flash COM6 ===
where pio >nul 2>&1 || (echo Install: pip install platformio & pause & exit /b 1)
pio run -e esp32dev -t upload || (echo FAILED — isara ang Serial Monitor, check COM6 & pause & exit /b 1)
echo OK — buksan ang monitor:
pio device monitor -e esp32dev