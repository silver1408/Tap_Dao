@echo off
title Off-Grid DAO - Shutdown
echo Stopping all DAO services...
echo.

:: Kill by window title
taskkill /FI "WINDOWTITLE eq Hardhat Node*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Backend Server*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Frontend Dev*" /F >nul 2>&1

:: Also kill by port just in case
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8545 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :9201 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :9101 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1

echo All services stopped.
echo Done.
