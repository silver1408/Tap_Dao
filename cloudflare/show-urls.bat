@echo off
title Tap DAO - Cloudflare URLs
echo.
echo ============================================
echo   Tap DAO - Public URLs
echo ============================================
echo.
echo   FRONTEND:
echo     https://tap.kiyoai.in
echo.
echo   API / BACKEND:
echo     https://tap-back.kiyoai.in
echo.
echo   API health check:
echo     https://tap-back.kiyoai.in/health
echo.
echo ============================================
echo   These hostnames are served by your Cloudflare Tunnel.
echo   If they do not open, run start-cloudflare.bat
echo   and check cloudflare\cf-tunnel.log.
echo ============================================
echo.
echo Tunnel status (last lines):
if exist "%~dp0cf-tunnel.log" (
  powershell -NoProfile -Command "Get-Content '%~dp0cf-tunnel.log' -Tail 5" 2>nul
) else (
  echo   (no tunnel log yet)
)
echo.
pause
