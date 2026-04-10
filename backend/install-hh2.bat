@echo off
set PATH=C:\Program Files\nodejs;%PATH%
npm install --save-dev hardhat@^2.22.0 @nomicfoundation/hardhat-toolbox@^3.0.0 ethers@^6.16.0 --legacy-peer-deps
npx hardhat compile
