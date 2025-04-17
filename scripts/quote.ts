// filepath: /Users/fudata/work/github/uniswap-v3-test/scripts/quote.ts
import { ethers } from "hardhat";
import { BigNumberish } from "ethers";
import QuoterV2ABI from "@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json"; // 导入 QuoterV2 ABI

async function main() {
  // --- 配置 ---
  const quoterAddress = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e"; // Uniswap V3 QuoterV2 mainnet 地址
  const tokenInAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH mainnet 地址
  const tokenOutAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // USDC mainnet 地址
  const feeTier = 500; // 池的费率 (0.05% = 500)
  const amountIn = ethers.parseEther("1"); // 要查询的数量 (1 WETH)

  // --- 获取 QuoterV2 合约实例 ---
  // 注意：由于是 fork 环境，我们直接使用主网地址和 ABI
  const [signer] = await ethers.getSigners(); // 获取一个签名者（虽然查询不需要，但 getContractAt 需要）
  const quoter = new ethers.Contract(quoterAddress, QuoterV2ABI.abi, signer);

  console.log(`查询 ${ethers.formatEther(amountIn)} WETH 可以兑换多少 USDC...`);

  // --- 调用 quoteExactInputSingle ---
  // V2 版本返回一个结构体，我们需要解构它
  const params = {
      tokenIn: tokenInAddress,
      tokenOut: tokenOutAddress,
      fee: feeTier,
      amountIn: amountIn,
      sqrtPriceLimitX96: 0, // 0 表示没有价格限制
  };

  try {
      const quoteResult = await quoter.quoteExactInputSingle.staticCall(params);

      // quoteResult 包含多个返回值，我们需要 amountOut
      const amountOut: BigNumberish = quoteResult.amountOut;

      // USDC 有 6 位小数
      const amountOutFormatted = ethers.formatUnits(amountOut, 6);

      console.log(`--- 报价结果 ---`);
      console.log(`输入: ${ethers.formatEther(amountIn)} WETH`);
      console.log(`输出: ${amountOutFormatted} USDC`);
      console.log(`费率等级: ${feeTier / 10000}%`);
      console.log(`----------------`);

      console.log("\nHardhat fork mainnet 节点可用，并且可以成功查询 Uniswap V3 报价！");

  } catch (error) {
      console.error("查询报价时出错:", error);
      console.log("\n请检查 Hardhat fork 节点是否正确运行，以及提供的地址和费率是否正确。");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });