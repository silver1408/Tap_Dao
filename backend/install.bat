@echo off
set PATH=C:\Program Files\nodejs;%PATH%
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox ethers@6
npx hardhat compile
