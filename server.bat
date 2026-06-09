@echo off
title analyser server
cd /d "%~dp0"

set PORT=3000

rem Reuse the port ONLY if our clean-URL server is already there: it answers
rem GET /about with 200. A foreign server (VS Code Live Server, python -m http.server)
rem returns 404 for /about - opening it is exactly why /about and /patch "don't work".
set CODE=000
for /f %%c in ('curl -s -o nul -w "%%{http_code}" "http://localhost:%PORT%/about" 2^>nul') do set CODE=%%c
if "%CODE%"=="200" (
  start "" "http://localhost:%PORT%"
  exit /b
)
if not "%CODE%"=="000" (
  echo.
  echo   Port %PORT% is in use by a server that does NOT do clean URLs
  echo   ^(GET /about returned %CODE%, expected 200^) - it 404s /about and /patch.
  echo   Close that server ^(its terminal, or VS Code Live Server^), then run this again.
  echo.
  pause
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
