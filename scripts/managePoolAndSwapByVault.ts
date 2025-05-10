// 重命名文件以反映其新功能 (可选)
import { ethers } from "hardhat";
import { Contract, MaxUint256, parseUnits, formatUnits } from "ethers"; // 添加 formatUnits
import NonfungiblePositionManagerABI from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";
import UniswapV3FactoryABI from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import MyTokenABI from "../artifacts/contracts/MyToken.sol/MyToken.json";
// 导入 SwapRouter ABI (使用你确认的路径)
import SwapRouterABI from "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";

// --- 配置 ---
const FACTORY_ADDRESS = "0x1F98431c8aD98523631AE4a59f267346ea31F984"; // Uniswap V3 Factory mainnet 地址
const POSITION_MANAGER_ADDRESS = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"; // NonfungiblePositionManager mainnet 地址
// 使用旧版 SwapRouter 地址以匹配 SwapRouter.json ABI
const SWAP_ROUTER_ADDRESS = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

const TKA_NAME = "TokenA";
const TKA_SYMBOL = "TKA";
const TKB_NAME = "TokenB";
const TKB_SYMBOL = "TKB";

const INITIAL_MINT_AMOUNT = parseUnits("1000000", 18);
const LIQUIDITY_AMOUNT_TKA = parseUnits("1000", 18);
const LIQUIDITY_AMOUNT_TKB = parseUnits("1000", 18);
const POOL_FEE = 3000; // 0.3%

const TICK_LOWER = -887220;
const TICK_UPPER = 887220;

// Swap 配置
const AMOUNT_IN_SWAP = parseUnits("100", 18); // 想要兑换的 TKA 数量 (100 TKA)

// 辅助函数：计算 sqrtPriceX96
function calculateSqrtPriceX96(priceRatio: number = 1): bigint {
    return BigInt(1) << BigInt(96); // 1:1 价格
}

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("使用账户:", deployer.address);

    // --- 1. 部署 TKA 和 TKB ---
    console.log("\n--- 部署代币 ---");
    const MyTokenFactory = await ethers.getContractFactory("MyToken");
    const tokenA = await MyTokenFactory.deploy(TKA_NAME, TKA_SYMBOL, deployer.address);
    await tokenA.waitForDeployment();
    const tokenAAddress = await tokenA.getAddress();
    console.log("TKA 部署到:", tokenAAddress);

    const tokenB = await MyTokenFactory.deploy(TKB_NAME, TKB_SYMBOL, deployer.address);
    await tokenB.waitForDeployment();
    const tokenBAddress = await tokenB.getAddress();
    console.log("TKB 部署到:", tokenBAddress);
    console.log("--------------------");

    // --- 2. 铸造初始代币 ---
    console.log("\n--- 铸造代币 ---");
    let tx = await tokenA.mint(deployer.address, INITIAL_MINT_AMOUNT);
    await tx.wait();
    console.log(`铸造 ${formatUnits(INITIAL_MINT_AMOUNT, 18)} TKA 完成.`);
    tx = await tokenB.mint(deployer.address, INITIAL_MINT_AMOUNT);
    await tx.wait();
    console.log(`铸造 ${formatUnits(INITIAL_MINT_AMOUNT, 18)} TKB 完成.`);

    // 查询并显示初始余额
    let balanceA = await tokenA.balanceOf(deployer.address);
    let balanceB = await tokenB.balanceOf(deployer.address);
    console.log("\n--- 铸造后余额 ---");
    console.log(`TKA: ${formatUnits(balanceA, 18)}`);
    console.log(`TKB: ${formatUnits(balanceB, 18)}`);
    console.log("--------------------");
    console.log("--------------------");


    // --- 3. 获取 Uniswap 合约实例 ---
    const factory = new Contract(FACTORY_ADDRESS, UniswapV3FactoryABI.abi, deployer);
    const positionManager = new Contract(POSITION_MANAGER_ADDRESS, NonfungiblePositionManagerABI.abi, deployer);
    const swapRouter = new Contract(SWAP_ROUTER_ADDRESS, SwapRouterABI.abi, deployer); // 获取 SwapRouter 实例

    // --- 4. 授权 Position Manager 和 SwapRouter 花费代币 ---
    console.log("\n--- 授权 ---");
    console.log("授权 Position Manager 花费 TKA & TKB...");
    tx = await tokenA.approve(POSITION_MANAGER_ADDRESS, MaxUint256);
    await tx.wait();
    tx = await tokenB.approve(POSITION_MANAGER_ADDRESS, MaxUint256);
    await tx.wait();
    console.log("Position Manager 授权完成.");
    // 授权 SwapRouter 花费 TKA (只需授权输入代币)
    console.log(`授权 SwapRouter 花费 TKA (最多 ${formatUnits(INITIAL_MINT_AMOUNT, 18)})...`); // 授权足够数量
    tx = await tokenA.approve(SWAP_ROUTER_ADDRESS, INITIAL_MINT_AMOUNT); // 授权足够数量，避免每次 swap 都授权
    await tx.wait();
    console.log("SwapRouter 授权完成.");
    console.log("--------------------");

    // --- 5. 创建并初始化池子 ---
    console.log("\n--- 创建/初始化池子 ---");
    const [token0Address, token1Address] = BigInt(tokenAAddress) < BigInt(tokenBAddress)
        ? [tokenAAddress, tokenBAddress]
        : [tokenBAddress, tokenAAddress];
    const token0 = BigInt(tokenAAddress) < BigInt(tokenBAddress) ? tokenA : tokenB;
    const token1 = BigInt(tokenAAddress) < BigInt(tokenBAddress) ? tokenB : tokenA;
    console.log(`Token0: ${await token0.symbol()} (${token0Address})`);
    console.log(`Token1: ${await token1.symbol()} (${token1Address})`);

    const sqrtPriceX96 = calculateSqrtPriceX96(1);
    console.log(`尝试创建并初始化池子 (费率: ${POOL_FEE / 10000}%, 初始 SqrtPriceX96: ${sqrtPriceX96})...`);
    tx = await positionManager.createAndInitializePoolIfNecessary(
        token0Address,
        token1Address,
        POOL_FEE,
        sqrtPriceX96
    );
    const poolReceipt = await tx.wait();
    const poolAddress = await factory.getPool(token0Address, token1Address, POOL_FEE);
    console.log(`池子地址: ${poolAddress}`);
    if (poolReceipt.status !== 1) {
        console.error("创建或初始化池子失败!");
        process.exit(1); // 如果池子创建失败则退出
    }
    console.log("池子已存在或已成功创建并初始化.");
    console.log("--------------------");

    // --- 6. 添加流动性 ---
    console.log("\n--- 添加流动性 ---");
    const amount0Desired = BigInt(tokenAAddress) < BigInt(tokenBAddress) ? LIQUIDITY_AMOUNT_TKA : LIQUIDITY_AMOUNT_TKB;
    const amount1Desired = BigInt(tokenAAddress) < BigInt(tokenBAddress) ? LIQUIDITY_AMOUNT_TKB : LIQUIDITY_AMOUNT_TKA;

    const mintParams = {
        token0: token0Address,
        token1: token1Address,
        fee: POOL_FEE,
        tickLower: TICK_LOWER,
        tickUpper: TICK_UPPER,
        amount0Desired: amount0Desired,
        amount1Desired: amount1Desired,
        amount0Min: 0,
        amount1Min: 0,
        recipient: deployer.address,
        deadline: Math.floor(Date.now() / 1000) + 60 * 10
    };

    console.log("调用 mint 添加流动性...");
    tx = await positionManager.mint(mintParams);
    const mintReceipt = await tx.wait();

    if (mintReceipt.status !== 1) {
        console.error("添加流动性失败!");
        process.exit(1); // 如果添加流动性失败则退出
    }
    console.log("流动性添加成功!");
    console.log("--------------------");

    // --- 7. 执行 Swap (TKA -> TKB) ---
    console.log("\n--- 执行 Swap ---");
    // 显示 Swap 前余额
    const balanceABeforeSwap = await tokenA.balanceOf(deployer.address);
    const balanceBBeforeSwap = await tokenB.balanceOf(deployer.address);
    console.log("\n--- Swap 前余额 ---");
    console.log(`TKA: ${formatUnits(balanceABeforeSwap, 18)}`);
    console.log(`TKB: ${formatUnits(balanceBBeforeSwap, 18)}`);
    console.log("--------------------");

    console.log(`\n执行 Swap: ${formatUnits(AMOUNT_IN_SWAP, 18)} TKA 兑换 TKB...`);
    const swapParams = {
        tokenIn: tokenAAddress, // TKA 是输入
        tokenOut: tokenBAddress, // TKB 是输出
        fee: POOL_FEE,
        recipient: deployer.address,
        deadline: Math.floor(Date.now() / 1000) + 60 * 10,
        amountIn: AMOUNT_IN_SWAP,
        amountOutMinimum: 0, // 本地测试，不设滑点
        sqrtPriceLimitX96: 0 // 本地测试，不设价格限制
    };

    try {
        const swapTx = await swapRouter.exactInputSingle(swapParams);
        console.log("Swap 交易已发送, Tx Hash:", swapTx.hash);
        const swapReceipt = await swapTx.wait();
        console.log("Swap 交易已确认.");

        if (swapReceipt.status !== 1) {
            console.error("Swap 交易失败!");
            // 注意：这里不退出，允许脚本继续，但标记失败
        } else {
             // 显示 Swap 后余额
            const balanceAAfterSwap = await tokenA.balanceOf(deployer.address);
            const balanceBAfterSwap = await tokenB.balanceOf(deployer.address);
            console.log("\n--- Swap 后余额 ---");
            console.log(`TKA: ${formatUnits(balanceAAfterSwap, 18)}`);
            console.log(`TKB: ${formatUnits(balanceBAfterSwap, 18)}`);
            console.log("--------------------");

            // 计算余额变化
            const changeA = balanceABeforeSwap - balanceAAfterSwap;
            const changeB = balanceBAfterSwap - balanceBBeforeSwap;
            console.log("\n--- Swap 余额变化 ---");
            console.log(`TKA 减少: ${formatUnits(changeA, 18)}`);
            console.log(`TKB 增加: ${formatUnits(changeB, 18)}`);
            console.log("--------------------");
        }

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

    // --- 8.1. 部署本地价格预言机合约 ---
    console.log("\n--- 部署本地价格预言机合约 PriceOracle ---");
    const PriceOracleFactory = await ethers.getContractFactory("PriceOracle");
    const priceOracle = await PriceOracleFactory.deploy();
    await priceOracle.waitForDeployment();
    const priceOracleAddress = await priceOracle.getAddress();
    console.log("PriceOracle 部署到:", priceOracleAddress);

    // --- 8.2. 部署金库合约 OracleGuidedVault ---
    console.log("\n--- 部署金库合约 OracleGuidedVault ---");
    const OracleGuidedVaultFactory = await ethers.getContractFactory("OracleGuidedVault");
    const vault = await OracleGuidedVaultFactory.deploy(
        tokenAAddress, // asset (TKA)
        "VaultTKA",
        "vTKA",
        SWAP_ROUTER_ADDRESS,
        priceOracleAddress // 新增参数：价格预言机地址
    );
    await vault.waitForDeployment();
    const vaultAddress = await vault.getAddress();
    console.log("Vault 部署到:", vaultAddress);

    // --- 9. 设置 TKB 交易对，启用策略 ---
    console.log("\n--- 配置金库策略 ---");
    await vault.grantRole(await vault.STRATEGY_MANAGER_ROLE(), deployer.address);
    await vault.setTradingPair(tokenBAddress, 3000, 0); // 允许最大30%分配
    await vault.updateStrategySettings(true, 900); // 启用策略，信号超时15分钟
    await vault.grantRole(await vault.ORACLE_ROLE(), deployer.address);

    // --- 10. 用户质押 TKA ---
    const DEPOSIT_AMOUNT = parseUnits("1000", 18);
    console.log(`\n用户质押 ${formatUnits(DEPOSIT_AMOUNT, 18)} TKA 到金库...`);
    await tokenA.approve(vaultAddress, DEPOSIT_AMOUNT);
    await vault.deposit(DEPOSIT_AMOUNT, deployer.address);
    console.log("质押完成.");

    // --- 11. Oracle信号：swap 30% TKA 为 TKB ---
    const vaultTkaBalance = await tokenA.balanceOf(vaultAddress);
    const swapAmount = vaultTkaBalance * 30n / 100n;
    console.log(`\nOracle信号: swap 30% TKA (${formatUnits(swapAmount, 18)}) 为 TKB...`);
    await vault.executeBuySignal(
        tokenBAddress,
        swapAmount,
        0,      // 不设最小输出
        3000    // 最大分配30%
    );

    // --- 12. 打印金库持仓信息 ---
    console.log("\n--- 金库持仓信息（TKA->TKB后） ---");
    const [baseAssetAmount1, tokenAddresses1, tokenAmounts1] = await vault.getPortfolioComposition();
    console.log(`TKA: ${formatUnits(baseAssetAmount1, 18)}`);
    for (let i = 0; i < tokenAddresses1.length; i++) {
        console.log(`TKB: ${formatUnits(tokenAmounts1[i], 18)} (地址: ${tokenAddresses1[i]})`);
    }

    // --- 13. Oracle信号: swap 所有 TKB 为 TKA ---
    const vaultTkbBalance = await tokenB.balanceOf(vaultAddress);
    console.log(`\nOracle信号: swap 所有 TKB (${formatUnits(vaultTkbBalance, 18)}) 为 TKA...`);
    await vault.executeSellSignal(
        tokenBAddress,
        0, // 0表示全部
        0  // 不设最小输出
    );

    // --- 14. 打印金库持仓信息 ---
    console.log("\n--- 金库持仓信息（TKB->TKA后） ---");
    const [baseAssetAmount2, tokenAddresses2, tokenAmounts2] = await vault.getPortfolioComposition();
    console.log(`TKA: ${formatUnits(baseAssetAmount2, 18)}`);
    for (let i = 0; i < tokenAddresses2.length; i++) {
        console.log(`TKB: ${formatUnits(tokenAmounts2[i], 18)} (地址: ${tokenAddresses2[i]})`);
    }

    // --- 15. 用户赎回全部 TKA，打印余额变化 ---
    const userTkaBefore = await tokenA.balanceOf(deployer.address);
    console.log("\n用户赎回全部 TKA...");
    const vaultShare = await vault.balanceOf(deployer.address);
    // await vault.withdraw(vaultShare, deployer.address, deployer.address);
    await vault.redeem(vaultShare, deployer.address, deployer.address);
    const userTkaAfter = await tokenA.balanceOf(deployer.address);
    console.log(`用户赎回前 TKA: ${formatUnits(userTkaBefore, 18)}`);
    console.log(`用户赎回后 TKA: ${formatUnits(userTkaAfter, 18)}`);
    console.log(`TKA 增加: ${formatUnits(userTkaAfter - userTkaBefore, 18)}`);

    console.log("--------------------");
    console.log("\n脚本执行完毕.");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("脚本执行出错:", error);
        process.exit(1);
    });