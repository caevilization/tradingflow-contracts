import { ethers } from "hardhat";
import { Contract, parseUnits, formatUnits } from "ethers";
import SwapRouter02ABI from "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json"; // 使用 SwapRouter02
import MyTokenABI from "../artifacts/contracts/MyToken.sol/MyToken.json"; // 导入我们自己代币的 ABI

// --- 配置 ---
// !!! 重要：请将下面的地址替换为你实际部署的 TKA 和 TKB 地址 !!!
const TKA_ADDRESS = "0x98F74b7C96497070ba5052E02832EF9892962e62"; // 替换为你的 TKA 地址
const TKB_ADDRESS = "0x831C6C334f8DDeE62246a5c81B82c8e18008b38f"; // 替换为你的 TKB 地址

const SWAP_ROUTER_ADDRESS = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"; // Uniswap V3 SwapRouter02 mainnet 地址
const POOL_FEE = 3000; // 与创建池子时使用的费率一致 (0.3%)
const AMOUNT_IN = parseUnits("100", 18); // 想要兑换的 TKA 数量 (100 TKA)

async function main() {
    if (TKA_ADDRESS === "TKA_ADDRESS_PLACEHOLDER" || TKB_ADDRESS === "TKB_ADDRESS_PLACEHOLDER") {
        console.error("错误：请在脚本中替换 TKA_ADDRESS_PLACEHOLDER 和 TKB_ADDRESS_PLACEHOLDER 为实际部署的代币地址！");
        process.exit(1);
    }

    const [signer] = await ethers.getSigners();
    console.log("使用账户:", signer.address);

    // --- 获取合约实例 ---
    const tokenA = new Contract(TKA_ADDRESS, MyTokenABI.abi, signer);
    const tokenB = new Contract(TKB_ADDRESS, MyTokenABI.abi, signer);
    const swapRouter = new Contract(SWAP_ROUTER_ADDRESS, SwapRouter02ABI.abi, signer);
    console.log("获取合约实例完成.");
    console.log("TKA 地址:", tokenA.address);
    console.log("TKB 地址:", tokenB.address);
    console.log("SwapRouter 地址:", swapRouter.address);

    // --- 显示 Swap 前余额 ---
    const balanceABefore = await tokenA.balanceOf(signer.address);
    const balanceBBefore = await tokenB.balanceOf(signer.address);
    console.log("\n--- Swap 前余额 ---");
    console.log(`TKA (${await tokenA.symbol()}): ${formatUnits(balanceABefore, 18)}`);
    console.log(`TKB (${await tokenB.symbol()}): ${formatUnits(balanceBBefore, 18)}`);
    console.log("--------------------");

    // --- 授权 SwapRouter 花费 TKA ---
    console.log(`\n授权 SwapRouter 花费 ${formatUnits(AMOUNT_IN, 18)} TKA...`);
    const approveTx = await tokenA.approve(SWAP_ROUTER_ADDRESS, AMOUNT_IN);
    await approveTx.wait();
    console.log("授权完成.");

    // --- 执行 Swap (TKA -> TKB) ---
    console.log(`\n执行 Swap: ${formatUnits(AMOUNT_IN, 18)} TKA 兑换 TKB...`);

    // Uniswap V3 需要地址排序，tokenIn < tokenOut 或 tokenIn > tokenOut
    // exactInputSingle 参数
    const params = {
        tokenIn: TKA_ADDRESS,
        tokenOut: TKB_ADDRESS,
        fee: POOL_FEE,
        recipient: signer.address, // 收款地址为执行者自己
        deadline: Math.floor(Date.now() / 1000) + 60 * 10, // 10 分钟过期时间
        amountIn: AMOUNT_IN,
        amountOutMinimum: 0, // 本地测试，不设置最小输出限制 (生产环境需要设置!)
        sqrtPriceLimitX96: 0 // 本地测试，不设置价格限制 (生产环境可能需要)
    };

    try {
        const swapTx = await swapRouter.exactInputSingle(params);
        console.log("Swap 交易已发送, Tx Hash:", swapTx.hash);
        const receipt = await swapTx.wait();
        console.log("Swap 交易已确认.");

        if (receipt.status !== 1) {
            console.error("Swap 交易失败!");
            // 可以尝试解析 revert reason (需要更复杂的逻辑)
            return;
        }

        // --- 显示 Swap 后余额 ---
        const balanceAAfter = await tokenA.balanceOf(signer.address);
        const balanceBAfter = await tokenB.balanceOf(signer.address);
        console.log("\n--- Swap 后余额 ---");
        console.log(`TKA (${await tokenA.symbol()}): ${formatUnits(balanceAAfter, 18)}`);
        console.log(`TKB (${await tokenB.symbol()}): ${formatUnits(balanceBAfter, 18)}`);
        console.log("--------------------");

        // --- 计算余额变化 ---
        const changeA = balanceABefore - balanceAAfter;
        const changeB = balanceBAfter - balanceBBefore;
        console.log("\n--- 余额变化 ---");
        console.log(`TKA 减少: ${formatUnits(changeA, 18)}`);
        console.log(`TKB 增加: ${formatUnits(changeB, 18)}`);
        console.log("-----------------");

    } catch (error) {
        console.error("\n执行 Swap 时出错:", error);
        // 尝试提取 revert reason
        if (error.data) {
            try {
                const reason = ethers.toUtf8String("0x" + error.data.substring(138));
                console.error("Revert Reason:", reason);
            } catch (e) {
                console.error("无法解析 Revert Reason Data:", error.data);
            }
        } else if (error.reason) {
             console.error("Revert Reason:", error.reason);
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("脚本执行出错:", error);
        process.exit(1);
    });