@echo off
title analyser server
cd /d "%~dp0"

set PORT=3000

rem If something is already listening on the port, just open it
netstat -ano | findstr "LISTENING" | findstr ":%PORT% " >nul
if %errorlevel%==0 (
  start "" "http://localhost:%PORT%"
  exit /b
)

rem Find local IP for phone access
set LOCAL_IP=
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  if not defined LOCAL_IP (
    for /f "tokens=* delims= " %%b in ("%%a") do set "LOCAL_IP=%%b"
  )
)

echo.
echo ============================================
echo   Local:   http://localhost:%PORT%
echo   Network: http://%LOCAL_IP%:%PORT%
echo.
echo   On your phone, open the Network URL.
echo   Phone must be on the same Wi-Fi.
echo ============================================
echo.

start "" "http://localhost:%PORT%"
rem serve.py mirrors the production Cloudflare routing (clean URLs + .html
rem redirects + SPA fallback), so local dev matches lab.valjdakosta.com exactly.
python serve.py %PORT%
pause
