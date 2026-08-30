@echo off
title Tap DAO - Demo Startup
echo.
echo ============================================
echo   Tap DAO - Starting Demo Environment
echo ============================================
echo.

:: Step 1: Start Hardhat blockchain node
echo [1/6] Starting local blockchain (Hardhat)...
start "Hardhat Node" cmd /k "cd /d %~dp0backend && npx hardhat node"
echo       Waiting 8 seconds for blockchain to boot...
ping 127.0.0.1 -n 9 >nul

:: Step 2: Deploy smart contract
echo [2/6] Deploying smart contract...
cd /d %~dp0backend
cmd /c "npx hardhat compile >nul 2>&1 && npx hardhat run scripts/deploy.js --network localhost"
echo.

:: Step 3: Start backend server
echo [3/6] Starting backend server (port 3001)...
start "Backend Server" cmd /k "cd /d %~dp0backend && node server.js"
ping 127.0.0.1 -n 4 >nul

:: Step 4: Start frontend
echo [4/6] Starting frontend (port 5173)...
start "Frontend Dev" cmd /k "cd /d %~dp0frontend && npx vite --host 0.0.0.0 --port 5173"
ping 127.0.0.1 -n 3 >nul

:: Step 5: Start Apple Watch UI
echo [5/6] Starting Apple Watch UI (port 4000)...
start "Watch UI" cmd /k "cd /d %~dp0frontend-watch && node server.js"
ping 127.0.0.1 -n 3 >nul

:: Step 6: Start Cloudflare Tunnel (exposes backend to internet)
echo [6/6] Starting Cloudflare Tunnel...
if exist "%~dp0cloudflared.log" del "%~dp0cloudflared.log"
start "Cloudflare Tunnel" cmd /k "cloudflared tunnel --url http://localhost:3001 > %~dp0cloudflared.log 2>&1"
echo       Tunnel starting... public URL will appear in the Activity tab.
ping 127.0.0.1 -n 4 >nul

echo.
echo ============================================
echo   All services started!
echo.
echo   Frontend:    http://localhost:5173
echo   Watch UI:    http://localhost:4000
echo   Backend:     http://localhost:3001
echo   Blockchain:  http://localhost:8545
echo.
echo   Local phone: http://192.168.29.45:5173
echo   Public URL:  Check Activity tab in the app
echo ============================================
echo.
echo Done.

