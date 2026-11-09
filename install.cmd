@echo off
rem Sticker Corner - starts install.ps1 from this folder (for the ZIP download).
rem Reads the script explicitly as UTF-8 and runs it, without changing any system settings.
set "STICKERCORNER_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ([IO.File]::ReadAllText('%~dp0install.ps1', [Text.Encoding]::UTF8))"
pause
