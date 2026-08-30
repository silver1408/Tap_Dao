@echo off
setlocal enabledelayedexpansion
title Tap DAO - Cloudflare Deploy

echo.
echo ============================================
echo   Tap DAO - Cloudflare Deployment Startup
echo ============================================
echo.
echo   This script starts the full stack and
echo   exposes the backend + frontend publicly
echo   via Cloudflare Tunnel (trycloudflare.com)
echo.
echo   Double-click this file to run it.
echo   Do NOT launch it from PowerShell.
echo ============================================
echo.

:: ── Resolve root dir (one level above this script) ─────────
set ROOT=%~dp0..
set CFDIR=%~dp0

:: ── Step 1: Start Hardhat blockchain node ───────────────────
echo [1/7] Starting local blockchain (Hardhat)...
start "CF-Hardhat Node" cmd /k "cd /d "%ROOT%\backend" && npx hardhat node"
echo       Waiting 10 seconds for blockchain to boot...
ping 127.0.0.1 -n 11 >nul

:: ── Step 2: Deploy smart contract ───────────────────────────
echo [2/7] Deploying smart contract...
pushd "%ROOT%\backend"
call npx hardhat compile >nul 2>&1
call npx hardhat run scripts/deploy.js --network localhost
popd
echo.

:: ── Step 3: Start backend server ────────────────────────────
echo [3/7] Starting backend server (port 3001)...
start "CF-Backend Server" cmd /k "cd /d "%ROOT%\backend" && node server.js"
ping 127.0.0.1 -n 4 >nul

:: ── Step 4: Start frontend ───────────────────────────────────
echo [4/7] Starting frontend (port 5173)...
start "CF-Frontend Dev" cmd /k "cd /d "%ROOT%\frontend" && npx vite --host 0.0.0.0 --port 5173"
ping 127.0.0.1 -n 4 >nul

:: ── Step 5: Start Apple Watch UI ────────────────────────────
echo [5/7] Starting Apple Watch UI (port 4000)...
start "CF-Watch UI" cmd /k "cd /d "%ROOT%\frontend-watch" && node server.js"
ping 127.0.0.1 -n 3 >nul

:: ── Step 6: Cloudflare Tunnel → Backend ─────────────────────
echo [6/7] Starting Cloudflare Tunnel for Backend (port 3001)...
if exist "%CFDIR%cf-backend.log" del "%CFDIR%cf-backend.log"
start "CF-Tunnel Backend" cmd /k "cloudflared tunnel --url http://localhost:3001 >> "%CFDIR%cf-backend.log" 2>&1"
ping 127.0.0.1 -n 8 >nul

:: ── Step 7: Cloudflare Tunnel → Frontend ────────────────────
echo [7/7] Starting Cloudflare Tunnel for Frontend (port 5173)...
if exist "%CFDIR%cf-frontend.log" del "%CFDIR%cf-frontend.log"
start "CF-Tunnel Frontend" cmd /k "cloudflared tunnel --url http://localhost:5173 >> "%CFDIR%cf-frontend.log" 2>&1"
ping 127.0.0.1 -n 10 >nul

:: ── Extract and print public URLs ───────────────────────────
echo.
echo ============================================
echo   Extracting Cloudflare public URLs...
echo ============================================

set BACKEND_URL=not yet available
set FRONTEND_URL=not yet available

for /f "tokens=*" %%L in ('findstr "trycloudflare.com" "%CFDIR%cf-backend.log" 2^>nul') do set "BLINE=%%L"
for %%W in (!BLINE!) do echo %%W | findstr "https://" >nul && set BACKEND_URL=%%W

for /f "tokens=*" %%L in ('findstr "trycloudflare.com" "%CFDIR%cf-frontend.log" 2^>nul') do set "FLINE=%%L"
for %%W in (!FLINE!) do echo %%W | findstr "https://" >nul && set FRONTEND_URL=%%W

echo.
echo ============================================
echo   All services started!
echo.
echo   LOCAL URLS
echo   ----------
echo   Frontend:    http://localhost:5173
echo   Watch UI:    http://localhost:4000
echo   Backend:     http://localhost:3001
echo   Blockchain:  http://localhost:8545
echo.
echo   CLOUDFLARE PUBLIC URLS
echo   ----------------------
echo   Backend:     !BACKEND_URL!
echo   Frontend:    !FRONTEND_URL!
echo.
echo   Tip: If URLs show "not yet available",
echo        run  cloudflare\show-urls.bat  in ~10s.
echo ============================================
echo.
echo Done. Press any key to close this window.
pause >nul
