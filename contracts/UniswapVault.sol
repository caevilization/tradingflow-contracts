// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";

/**
 * @title OracleGuidedVault
 * @notice 由预言机引导交易参数的 Uniswap 交易金库
 * @dev 所有价格计算在链下进行，合约只负责执行
 */
contract OracleGuidedVault is ERC4626, Ownable, ReentrancyGuard, AccessControl {
    // 角色定义
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant STRATEGY_MANAGER_ROLE = keccak256("STRATEGY_MANAGER_ROLE");
    
    // Uniswap V3 SwapRouter地址
    ISwapRouter public immutable swapRouter;
    
    // 交易对配置
    struct TradingPair {
        address tokenAddress;  // 交易代币地址
        bool isActive;         // 是否激活
        uint256 maxAllocation; // 最大分配比例 (基数为10000，即100.00%)
        uint256 minExitAmount; // 最小退出金额
    }
    
    // 交易信号类型
    enum SignalType { BUY, SELL }
    
    // 交易信号事件
    event SignalReceived(SignalType signalType, address tokenAddress, uint256 timestamp);
    event TradeExecuted(SignalType signalType, address tokenAddress, uint256 amount, uint256 result);
    
    // 存储激活的交易对
    mapping(address => TradingPair) public tradingPairs;
    address[] public tradingPairsList;
    
    // 策略配置
    bool public strategyEnabled = false;
    uint256 public signalTimeout = 15 minutes; // 信号超时时间
    uint256 public lastSignalTimestamp;
    
    // 构造函数
    constructor(
        IERC20 _asset,
        string memory _name,
        string memory _symbol,
        address _swapRouter
    ) ERC4626(_asset) ERC20(_name, _symbol) Ownable(msg.sender) {
        swapRouter = ISwapRouter(_swapRouter);
        
        // 设置角色
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, msg.sender);
        _grantRole(STRATEGY_MANAGER_ROLE, msg.sender);
    }
    
    /**
     * @notice 添加或更新交易对
     * @param tokenAddress 交易代币地址
     * @param maxAllocation 最大分配比例 (基数10000)
     * @param minExitAmount 最小退出金额
     */
    function setTradingPair(
        address tokenAddress, 
        uint256 maxAllocation, 
        uint256 minExitAmount
    ) external onlyRole(STRATEGY_MANAGER_ROLE) {
        require(tokenAddress != address(0), "Invalid token address");
        require(maxAllocation <= 10000, "Max allocation cannot exceed 100%");
        
        if (!tradingPairs[tokenAddress].isActive) {
            tradingPairsList.push(tokenAddress);
        }
        
        tradingPairs[tokenAddress] = TradingPair({
            tokenAddress: tokenAddress,
            isActive: true,
            maxAllocation: maxAllocation,
            minExitAmount: minExitAmount
        });
    }
    
    /**
     * @notice 禁用交易对
     * @param tokenAddress 交易代币地址
     */
    function disableTradingPair(address tokenAddress) external onlyRole(STRATEGY_MANAGER_ROLE) {
        require(tradingPairs[tokenAddress].isActive, "Trading pair not active");
        tradingPairs[tokenAddress].isActive = false;
    }
    
    /**
     * @notice 更新策略配置
     * @param _strategyEnabled 是否启用策略
     * @param _signalTimeout 信号超时时间
     */
    function updateStrategySettings(
        bool _strategyEnabled,
        uint256 _signalTimeout
    ) external onlyRole(STRATEGY_MANAGER_ROLE) {
        strategyEnabled = _strategyEnabled;
        signalTimeout = _signalTimeout;
    }
    
    /**
     * @notice 由预言机触发的买入信号
     * @param tokenAddress 目标代币地址
     * @param amountToSwap 要交换的基础资产数量
     * @param minAmountOut 最小获得的代币数量
     * @param maxAllocationPct 最大分配百分比 (基数10000)
     */
    function executeBuySignal(
        address tokenAddress,
        uint256 amountToSwap,
        uint256 minAmountOut,
        uint256 maxAllocationPct
    ) external nonReentrant onlyRole(ORACLE_ROLE) {
        require(strategyEnabled, "Strategy not enabled");
        require(tradingPairs[tokenAddress].isActive, "Trading pair not active");
        require(maxAllocationPct <= tradingPairs[tokenAddress].maxAllocation, "Allocation exceeds maximum");
        
        address assetAddress = address(asset());
        uint256 totalAssetBalance = IERC20(assetAddress).balanceOf(address(this));
        
        // 验证交换金额不超过最大分配
        uint256 maxAllowedAmount = (totalAssetBalance * maxAllocationPct) / 10000;
        require(amountToSwap <= maxAllowedAmount, "Swap amount exceeds allocation");
        
        // 记录时间戳并发出事件
        lastSignalTimestamp = block.timestamp;
        emit SignalReceived(SignalType.BUY, tokenAddress, lastSignalTimestamp);
        
        // 如果交换金额为零，直接返回
        if (amountToSwap == 0) return;
        
        // 执行交换
        TransferHelper.safeApprove(assetAddress, address(swapRouter), amountToSwap);
        
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: assetAddress,
            tokenOut: tokenAddress,
            fee: 3000, // 默认使用0.3%费率，可以考虑让预言机指定
            recipient: address(this),
            deadline: block.timestamp + 15 minutes,
            amountIn: amountToSwap,
            amountOutMinimum: minAmountOut,
            sqrtPriceLimitX96: 0
        });
        
        uint256 amountOut = swapRouter.exactInputSingle(params);
        emit TradeExecuted(SignalType.BUY, tokenAddress, amountToSwap, amountOut);
    }
    
    /**
     * @notice 由预言机触发的卖出信号
     * @param tokenAddress 卖出代币地址
     * @param amountToSell 要卖出的代币数量 (0表示全部)
     * @param minAmountOut 最小获得的基础资产数量
     */
    function executeSellSignal(
        address tokenAddress,
        uint256 amountToSell,
        uint256 minAmountOut
    ) external nonReentrant onlyRole(ORACLE_ROLE) {
        require(strategyEnabled, "Strategy not enabled");
        require(tradingPairs[tokenAddress].isActive, "Trading pair not active");
        
        address assetAddress = address(asset());
        uint256 tokenBalance = IERC20(tokenAddress).balanceOf(address(this));
        
        // 如果代币余额为零，直接返回
        if (tokenBalance == 0) return;
        
        // 如果amountToSell为0或大于余额，则卖出全部
        uint256 sellAmount = (amountToSell == 0 || amountToSell > tokenBalance) ? 
            tokenBalance : amountToSell;
        
        // 记录时间戳并发出事件
        lastSignalTimestamp = block.timestamp;
        emit SignalReceived(SignalType.SELL, tokenAddress, lastSignalTimestamp);
        
        // 执行交换
        TransferHelper.safeApprove(tokenAddress, address(swapRouter), sellAmount);
        
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: tokenAddress,
            tokenOut: assetAddress,
            fee: 3000, // 默认使用0.3%费率
            recipient: address(this),
            deadline: block.timestamp + 15 minutes,
            amountIn: sellAmount,
            amountOutMinimum: minAmountOut,
            sqrtPriceLimitX96: 0
        });
        
        uint256 amountOut = swapRouter.exactInputSingle(params);
        emit TradeExecuted(SignalType.SELL, tokenAddress, sellAmount, amountOut);
    }
    
    /**
     * @notice 增强版交易执行函数，支持更多Uniswap参数
     * @param tokenIn 输入代币地址
     * @param tokenOut 输出代币地址
     * @param fee 池费率 (500=0.05%, 3000=0.3%, 10000=1%)
     * @param amountIn 输入金额
     * @param amountOutMinimum 最小输出金额
     * @param sqrtPriceLimitX96 价格限制 (通常为0，特殊情况使用)
     */
    function executeAdvancedSwap(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96
    ) external nonReentrant onlyRole(ORACLE_ROLE) {
        require(strategyEnabled, "Strategy not enabled");
        
        // 如果tokenIn不是基础资产，需要验证是否是激活的交易对
        if (tokenIn != address(asset())) {
            require(tradingPairs[tokenIn].isActive, "TokenIn not active trading pair");
        }
        
        // 如果tokenOut不是基础资产，需要验证是否是激活的交易对
        if (tokenOut != address(asset())) {
            require(tradingPairs[tokenOut].isActive, "TokenOut not active trading pair");
        }
        
        // 确保有足够的代币余额
        uint256 balance = IERC20(tokenIn).balanceOf(address(this));
        require(balance >= amountIn, "Insufficient token balance");
        
        // 执行交换
        TransferHelper.safeApprove(tokenIn, address(swapRouter), amountIn);
        
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            recipient: address(this),
            deadline: block.timestamp + 15 minutes,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: sqrtPriceLimitX96
        });
        
        uint256 amountOut = swapRouter.exactInputSingle(params);
        
        // 发出交易执行事件
        SignalType signalType;
        if (tokenIn == address(asset())) {
            signalType = SignalType.BUY;
        } else {
            signalType = SignalType.SELL;
        }
        
        emit TradeExecuted(signalType, (signalType == SignalType.BUY) ? tokenOut : tokenIn, amountIn, amountOut);
    }
    
    /**
     * @notice 紧急卖出所有非底层资产
     * @dev 只有在紧急情况下使用
     */
    function emergencyExitAll() external onlyOwner {
        address assetAddress = address(asset());
        
        for (uint i = 0; i < tradingPairsList.length; i++) {
            address tokenAddress = tradingPairsList[i];
            if (tokenAddress != assetAddress && tradingPairs[tokenAddress].isActive) {
                uint256 balance = IERC20(tokenAddress).balanceOf(address(this));
                if (balance > 0) {
                    TransferHelper.safeApprove(tokenAddress, address(swapRouter), balance);
                    
                    ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
                        tokenIn: tokenAddress,
                        tokenOut: assetAddress,
                        fee: 3000, // 默认使用0.3%费率
                        recipient: address(this),
                        deadline: block.timestamp + 15 minutes,
                        amountIn: balance,
                        amountOutMinimum: 0, // 紧急情况下不设置最小输出
                        sqrtPriceLimitX96: 0
                    });
                    
                    swapRouter.exactInputSingle(params);
                }
            }
        }
    }
    
    /**
     * @notice 查询投资组合当前资产配置
     * @return baseAssetAmount 基础资产数量
     * @return tokenAddresses 持有的其他代币地址
     * @return tokenAmounts 持有的其他代币数量
     */
    function getPortfolioComposition() external view returns (
        uint256 baseAssetAmount,
        address[] memory tokenAddresses,
        uint256[] memory tokenAmounts
    ) {
        address assetAddress = address(asset());
        baseAssetAmount = IERC20(assetAddress).balanceOf(address(this));
        
        // 计算有多少个非零余额的代币
        uint256 tokenCount = 0;
        for (uint i = 0; i < tradingPairsList.length; i++) {
            address token = tradingPairsList[i];
            if (token != assetAddress && IERC20(token).balanceOf(address(this)) > 0) {
                tokenCount++;
            }
        }
        
        // 创建返回数组
        tokenAddresses = new address[](tokenCount);
        tokenAmounts = new uint256[](tokenCount);
        
        // 填充数组
        uint256 index = 0;
        for (uint i = 0; i < tradingPairsList.length; i++) {
            address token = tradingPairsList[i];
            if (token != assetAddress) {
                uint256 balance = IERC20(token).balanceOf(address(this));
                if (balance > 0) {
                    tokenAddresses[index] = token;
                    tokenAmounts[index] = balance;
                    index++;
                }
            }
        }
        
        return (baseAssetAmount, tokenAddresses, tokenAmounts);
    }
    
    /**
     * @notice 覆盖totalAssets方法
     */
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }
    
    /**
     * @notice 支持AccessControl的supportsInterface
     */
    function supportsInterface(bytes4 interfaceId) public view override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}