require("@nomicfoundation/hardhat-toolbox");

const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.24",
  networks: {
    localhost: {
      url: rpcUrl,
    },
  },
};
