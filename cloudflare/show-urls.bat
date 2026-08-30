@echo off
title Tap DAO - Cloudflare URLs
echo.
echo ============================================
echo   Tap DAO - Cloudflare Public URLs
echo ============================================
echo.

echo   BACKEND (port 3001):
findstr "trycloudflare.com" "%~dp0cf-backend.log" 2>nul | findstr "https://" || echo   (not ready yet - try again in a few seconds)

echo.
echo   FRONTEND (port 5173):
findstr "trycloudflare.com" "%~dp0cf-frontend.log" 2>nul | findstr "https://" || echo   (not ready yet - try again in a few seconds)

echo.
echo ============================================
echo   Tip: URLs change every time you restart.
echo   Local phone: use your LAN IP instead.
echo ============================================
echo.
pause
