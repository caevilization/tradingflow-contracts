// filepath: /Users/fudata/work/github/uniswap-v3-test/scripts/managePool.ts
import { ethers } from "hardhat";
import { Contract, MaxUint256, parseUnits } from "ethers";
import NonfungiblePositionManagerABI from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";
import UniswapV3FactoryABI from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json"; // 需要 v3-core ABI
import MyTokenABI from "../artifacts/contracts/MyToken.sol/MyToken.json"; // 导入我们自己代币的 ABI

// --- 配置 ---
const FACTORY_ADDRESS = "0x1F98431c8aD98523631AE4a59f267346ea31F984"; // Uniswap V3 Factory mainnet 地址
const POSITION_MANAGER_ADDRESS = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"; // NonfungiblePositionManager mainnet 地址

const TKA_NAME = "TokenA";
const TKA_SYMBOL = "TKA";
const TKB_NAME = "TokenB";
const TKB_SYMBOL = "TKB";

const INITIAL_MINT_AMOUNT = parseUnits("1000000", 18); // 铸造 1,000,000 个代币 (假设18位小数)
const LIQUIDITY_AMOUNT_TKA = parseUnits("1000", 18); // 提供 1000 TKA 流动性
const LIQUIDITY_AMOUNT_TKB = parseUnits("1000", 18); // 提供 1000 TKB 流动性 (初始价格 1:1)

const POOL_FEE = 3000; // 0.3% 费率等级

// 价格范围 (Tick) - 这是一个非常宽的范围示例
// 对于精确范围，需要根据目标价格计算 Tick
// 你可以使用 Uniswap V3 SDK 或在线工具来计算
const TICK_LOWER = -887220; // 示例最低 Tick
const TICK_UPPER = 887220;  // 示例最高 Tick

// 辅助函数：计算初始 sqrtPriceX96 (假设初始价格 TKA/TKB = 1:1)
// 注意：这是一个简化计算，实际应根据代币小数位数调整
function calculateSqrtPriceX96(priceRatio: number = 1): bigint {
    // priceRatio = price of token1 / price of token0
    // sqrt(priceRatio) * 2^96
    const price = BigInt(Math.floor(priceRatio * (2 ** 192))); // Use 192 bits for intermediate precision
    // Simple integer square root approximation
    let x = price;
    let y = (x + BigInt(1)) / BigInt(2);
    while (y < x) {
        x = y;
        y = (x + price / x) / BigInt(2);
    }
    return x; // This is sqrt(priceRatio * 2^192), which is sqrtPriceX96 * sqrt(2^192) / 2^96 = sqrtPriceX96 * 2^48
    // For 1:1 price, sqrtPriceX96 should be 1 * 2^96
    // Let's directly use the 1 * 2^96 value for 1:1 price
    return BigInt(1) << BigInt(96); // Correct for 1:1 price
}

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("使用账户:", deployer.address);

    // --- 1. 部署 TKA 和 TKB ---
    console.log("部署 TKA...");
    const MyTokenFactory = await ethers.getContractFactory("MyToken");
    const tokenA = await MyTokenFactory.deploy(TKA_NAME, TKA_SYMBOL, deployer.address);
    await tokenA.waitForDeployment();
    const tokenAAddress = await tokenA.getAddress();
    console.log("TKA 部署到:", tokenAAddress);

    console.log("部署 TKB...");
    const tokenB = await MyTokenFactory.deploy(TKB_NAME, TKB_SYMBOL, deployer.address);
    await tokenB.waitForDeployment();
    const tokenBAddress = await tokenB.getAddress();
    console.log("TKB 部署到:", tokenBAddress);

    // --- 2. 铸造初始代币 ---
    console.log(`铸造 ${ethers.formatUnits(INITIAL_MINT_AMOUNT, 18)} TKA 给 ${deployer.address}...`);
    let tx = await tokenA.mint(deployer.address, INITIAL_MINT_AMOUNT);
    await tx.wait();
    console.log(`铸造 ${ethers.formatUnits(INITIAL_MINT_AMOUNT, 18)} TKB 给 ${deployer.address}...`);
    tx = await tokenB.mint(deployer.address, INITIAL_MINT_AMOUNT);
    await tx.wait();
    console.log("铸造完成.");
    // 查询余额
    const balanceA = await tokenA.balanceOf(deployer.address);
    const balanceB = await tokenB.balanceOf(deployer.address);
    console.log("\n--- 初始余额 ---");
    console.log(`TKA (${await tokenA.symbol()}): ${ethers.formatUnits(balanceA, 18)}`);
    console.log(`TKB (${await tokenB.symbol()}): ${ethers.formatUnits(balanceB, 18)}`);
    console.log("--------------------");

    // --- 3. 获取 Uniswap 合约实例 ---
    const factory = new Contract(FACTORY_ADDRESS, UniswapV3FactoryABI.abi, deployer);
    const positionManager = new Contract(POSITION_MANAGER_ADDRESS, NonfungiblePositionManagerABI.abi, deployer);

    // --- 4. 授权 Position Manager 花费代币 ---
    console.log("授权 Position Manager 花费 TKA...");
    tx = await tokenA.approve(POSITION_MANAGER_ADDRESS, MaxUint256); // 授权最大值
    await tx.wait();
    console.log("授权 Position Manager 花费 TKB...");
    tx = await tokenB.approve(POSITION_MANAGER_ADDRESS, MaxUint256); // 授权最大值
    await tx.wait();
    console.log("授权完成.");

    // --- 5. 创建并初始化池子 (如果不存在) ---
    // Uniswap V3 需要地址排序，token0 < token1
    const [token0Address, token1Address] = BigInt(tokenAAddress) < BigInt(tokenBAddress)
        ? [tokenAAddress, tokenBAddress]
        : [tokenBAddress, tokenAAddress];
    const token0 = BigInt(tokenAAddress) < BigInt(tokenBAddress) ? tokenA : tokenB;
    const token1 = BigInt(tokenAAddress) < BigInt(tokenBAddress) ? tokenB : tokenA;

    console.log(`Token0: ${await token0.symbol()} (${token0Address})`);
    console.log(`Token1: ${await token1.symbol()} (${token1Address})`);

    // 计算初始价格 (假设 TKA/TKB = 1:1)
    // 如果 token0 是 TKB, token1 是 TKA, 价格是 TKA/TKB = 1
    // 如果 token0 是 TKA, token1 是 TKB, 价格是 TKB/TKA = 1
    const initialPriceRatio = 1; // TKA/TKB = 1
    const sqrtPriceX96 = calculateSqrtPriceX96(initialPriceRatio);

    console.log(`尝试创建并初始化池子 (费率: ${POOL_FEE / 10000}%, 初始 SqrtPriceX96: ${sqrtPriceX96})...`);
    tx = await positionManager.createAndInitializePoolIfNecessary(
        token0Address,
        token1Address,
        POOL_FEE,
        sqrtPriceX96
    );
    const receipt = await tx.wait();
    const poolAddress = await factory.getPool(token0Address, token1Address, POOL_FEE);
    console.log(`池子地址: ${poolAddress}`);
    if (receipt.status !== 1) {
        console.error("创建或初始化池子失败!");
        return;
    }
    console.log("池子已存在或已成功创建并初始化.");

    // --- 6. 添加流动性 ---
    console.log("准备添加流动性...");

    // 确定 amount0 和 amount1
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
        amount0Min: 0, // 不设置滑点保护 (仅用于本地测试)
        amount1Min: 0, // 不设置滑点保护 (仅用于本地测试)
        recipient: deployer.address,
        deadline: Math.floor(Date.now() / 1000) + 60 * 10 // 10 分钟后过期
    };

    console.log("调用 mint 添加流动性...");
    tx = await positionManager.mint(mintParams);
    const mintReceipt = await tx.wait();

    if (mintReceipt.status === 1) {
        console.log("流动性添加成功!");
        // 你可以从 mintReceipt.logs 中解析出 tokenId (需要更复杂的事件解析)
        // const tokenId = ...
        // console.log("获得流动性 NFT ID:", tokenId);
    } else {
        console.error("添加流动性失败!");
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("脚本执行出错:", error);
        process.exit(1);
    });