@echo off
title Tap DAO - Cloudflare Shutdown
echo.
echo ============================================
echo   Tap DAO - Stopping Cloudflare Stack
echo ============================================
echo.

:: ── Kill by window title (Cloudflare windows use CF- prefix) ──────────────
echo Stopping Cloudflare tunnels...
taskkill /FI "WINDOWTITLE eq CF-Tunnel Backend*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq CF-Tunnel Frontend*" /F >nul 2>&1

echo Stopping app services...
taskkill /FI "WINDOWTITLE eq CF-Hardhat Node*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq CF-Backend Server*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq CF-Frontend Dev*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq CF-Watch UI*" /F >nul 2>&1

:: ── Also kill by port just in case ────────────────────────────────────────
echo Releasing ports...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8545 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :4000 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1

:: ── Kill cloudflared processes ─────────────────────────────────────────────
taskkill /IM cloudflared.exe /F >nul 2>&1

echo.
echo All Cloudflare services stopped.
echo Done.
