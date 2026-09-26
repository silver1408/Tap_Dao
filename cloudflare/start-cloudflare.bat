@echo off
setlocal enabledelayedexpansion
title Tap DAO - Cloudflare Deploy

echo.
echo ============================================
echo   Tap DAO - Production Startup
echo ============================================
echo.
echo   Public URLs (via Cloudflare Tunnel)
echo   ------------------------------------
echo     Frontend: https://tap.kiyoai.in
echo     API:      https://tap-back.kiyoai.in
echo.

:: ── Resolve paths ──────────────────────────────────────────────────────
set ROOT=%~dp0..
set CFDIR=%~dp0
set TUNNEL_NAME=tapdao
if exist "%ROOT%\.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%ROOT%\.env") do (
    if /I "%%A"=="CLOUDFLARE_TUNNEL_NAME" set TUNNEL_NAME=%%B
  )
)

:: ── Check the environment file ──────────────────────────────────────────
if not exist "%ROOT%\.env" (
  echo [X] Missing %ROOT%\.env
  echo     Copy .env.example to .env and fill in SESSION_SECRET
  echo     and CRYPTO_SECRET_KEY, then run this script again.
  echo.
  pause
  exit /b 1
)

:: ── Step 1: Build and start the stack ───────────────────────────────────
echo [1/3] Starting Docker stack ^(chain, deploy, API, frontend^)...
pushd "%ROOT%"
docker compose up -d --build
if errorlevel 1 (
  popd
  echo [X] docker compose failed - see the output above.
  pause
  exit /b 1
)

echo       Waiting for the API to report healthy...
set /a TRIES=0
:WAIT_HEALTH
set /a TRIES+=1
for /f "tokens=*" %%H in ('docker compose ps --format "{{.Health}}" app 2^>nul') do set "HEALTH=%%H"
if "!HEALTH!"=="healthy" goto HEALTHY
if !TRIES! GEQ 30 (
  echo [X] The API did not become healthy in time. Check: docker compose logs app
  popd
  pause
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto WAIT_HEALTH

:HEALTHY
echo       API is healthy.
popd
echo.

:: ── Step 2: Start the tunnel ────────────────────────────────────────────
echo [2/3] Starting Cloudflare Tunnel "%TUNNEL_NAME%"...
if exist "%CFDIR%config.yml" (
  start "CF-Tunnel" cmd /k "cloudflared tunnel --config "%CFDIR%config.yml" run %TUNNEL_NAME% >> "%CFDIR%cf-tunnel.log" 2>&1"
) else (
  echo       No cloudflare\config.yml found - using the tunnel named on the
  echo       command line. If your ingress is defined in the Cloudflare
  echo       dashboard, run:  cloudflared tunnel run %TUNNEL_NAME%
  start "CF-Tunnel" cmd /k "cloudflared tunnel run %TUNNEL_NAME% >> "%CFDIR%cf-tunnel.log" 2>&1"
)
echo       Waiting for the tunnel to connect...
timeout /t 8 /nobreak >nul
echo.

:: ── Step 3: Summary ────────────────────────────────────────────────────
echo [3/3] Done.
echo.
echo ============================================
echo   Tap DAO is live
echo.
echo     Frontend:  https://tap.kiyoai.in
echo     API:       https://tap-back.kiyoai.in
echo.
echo   Local origins (loopback only, not public)
echo   -----------------------------------------
echo     Frontend:  http://localhost:9100
echo     API:       http://localhost:9200
echo.
echo   Tunnel log: cloudflare\cf-tunnel.log
echo   App logs:   docker compose logs -f app frontend
echo ============================================
echo.
pause
