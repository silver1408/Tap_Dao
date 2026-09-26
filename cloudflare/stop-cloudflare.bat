@echo off
title Tap DAO - Cloudflare Shutdown
echo.
echo ============================================
echo   Tap DAO - Stopping the stack
echo ============================================
echo.

:: ── Stop the tunnel ────────────────────────────────────────────────────
echo Stopping the Cloudflare tunnel...
taskkill /FI "WINDOWTITLE eq CF-Tunnel*" /F >nul 2>&1
taskkill /IM cloudflared.exe /F >nul 2>&1

:: ── Stop the containers ────────────────────────────────────────────────
echo Stopping the Docker stack ^(containers, chain, API, frontend^)...
pushd "%~dp0.."
docker compose down
popd
echo.

:: ── Free the loopback ports if something else grabbed them ──────────────
echo Releasing ports...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8545 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :9200 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :9100 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1

echo.
echo Persistent data was kept in the "runtime-data" volume.
echo Use "docker compose down -v" in the repository root to delete it as well.
echo.
echo Done.
