require("@nomicfoundation/hardhat-toolbox");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
require("@nomicfoundation/hardhat-verify");

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    arbmainnet: {
      url: process.env.ARBITRUM_ALCHEMY_MAINNET, // Alchemy/Infura HTTPS
      accounts: [process.env.WALLET_SECRET], // 0x-prefixed private key
      chainId: 42161,
    },
  },
  etherscan: {
    // Arbiscan key works for Arbitrum verification
    apiKey: { arbitrumOne: process.env.ARBISCAN_API_KEY },
  },
  mocha: { timeout: 180000 },
};
