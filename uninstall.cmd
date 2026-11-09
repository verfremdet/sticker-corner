@echo off
rem Sticker Corner - starts uninstall.ps1 from this folder (for the ZIP download).
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ([IO.File]::ReadAllText('%~dp0uninstall.ps1', [Text.Encoding]::UTF8))"
pause
