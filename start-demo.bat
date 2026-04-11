@echo off
title Off-Grid DAO - Demo Startup
echo.
echo ============================================
echo   Off-Grid DAO - Starting Demo Environment
echo ============================================
echo.

:: Step 1: Start Hardhat blockchain node
echo [1/4] Starting local blockchain (Hardhat)...
start "Hardhat Node" cmd /c "cd /d %~dp0backend && npx hardhat node"
echo       Waiting 8 seconds for blockchain to boot...
timeout /t 8 /nobreak >nul

:: Step 2: Deploy smart contract
echo [2/4] Deploying smart contract...
cd /d %~dp0backend
cmd /c "npx hardhat compile >nul 2>&1 && npx hardhat run scripts/deploy.js --network localhost"
echo.

:: Step 3: Start backend server
echo [3/4] Starting backend server (port 3001)...
start "Backend Server" cmd /c "cd /d %~dp0backend && node server.js"
timeout /t 3 /nobreak >nul

:: Step 4: Start frontend
echo [4/4] Starting frontend (port 5173)...
start "Frontend Dev" cmd /c "cd /d %~dp0frontend && npx vite --host 0.0.0.0 --port 5173"
timeout /t 3 /nobreak >nul

echo.
echo ============================================
echo   All services started!
echo.
echo   Frontend:   http://localhost:5173
echo   Backend:    http://localhost:3001
echo   Blockchain: http://localhost:8545
echo.
echo   Phone access: http://YOUR_WIFI_IP:5173
echo ============================================
echo.
echo Press any key to close this window...
pause >nul
