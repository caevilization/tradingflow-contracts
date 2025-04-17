// filepath: /Users/fudata/work/github/uniswap-v3-test/hardhat.config.js
require("@nomicfoundation/hardhat-toolbox"); // 导入 Hardhat Toolbox

// 建议使用 dotenv 来管理敏感信息，如 RPC URL 和私钥
// npm install dotenv --save-dev
require('dotenv').config();

INFURA_API_KEY = process.env.INFURA_API_KEY || ""
/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.28", // 确保版本与你的合约兼容，或者使用你的 0.8.28
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      }
    ]
  },
  networks: {
    hardhat: { // 这是默认网络，我们将在这里启用 forking
      forking: {
        // 将 YOUR_MAINNET_RPC_URL 替换为你的以太坊主网 RPC URL
        // 例如 Alchemy 或 Infura 的 URL
        // 强烈建议使用环境变量存储 URL
        url: process.env.MAINNET_RPC_URL || "https://mainnet.infura.io/v3/" + INFURA_API_KEY,
        // 可选：指定一个区块号进行 fork，以确保状态一致性
        // blockNumber: 19600000 // 例如
      },
      // 可选：增加 gas limit 和 timeout 以适应主网 fork
      gas: "auto",
      gasPrice: "auto",
      blockGasLimit: 30000000, // 增加区块 gas limit
      timeout: 1000000 // 增加超时时间 (毫秒)
    },
    // 你也可以添加其他网络配置，例如 sepolia, mainnet 等
    // mainnet: {
    //   url: process.env.MAINNET_RPC_URL || "YOUR_MAINNET_RPC_URL",
    //   accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    // }
  },
  // 可选：配置 Etherscan API Key 用于合约验证
  // etherscan: {
  //   apiKey: process.env.ETHERSCAN_API_KEY
  // }
};