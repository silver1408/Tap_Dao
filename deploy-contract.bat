@echo off
set PATH=C:\Program Files\nodejs;%PATH%
npx hardhat run scripts/deploy.js --network localhost
