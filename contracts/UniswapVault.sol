// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "./PriceOracle.sol"; // 引入价格预言机合约


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

    // 价格预言机
    PriceOracle public priceOracle;

    // 单一用户模式标识符
    bool public constant isSingleUserMode = true;
    
    // 构造函数中添加价格预言机参数
    constructor(
        IERC20 _asset,
        string memory _name,
        string memory _symbol,
        address _swapRouter,
        address _priceOracle
    ) ERC4626(_asset) ERC20(_name, _symbol) Ownable(msg.sender) {
        swapRouter = ISwapRouter(_swapRouter);
        priceOracle = PriceOracle(_priceOracle);
        
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
     * @notice 更新价格预言机地址
     * @param _priceOracle 新的价格预言机地址
     */
    function updatePriceOracle(address _priceOracle) external onlyRole(STRATEGY_MANAGER_ROLE) {
        require(_priceOracle != address(0), "Invalid oracle address");
        priceOracle = PriceOracle(_priceOracle);
    }
    
    /**
     * @notice 覆盖totalAssets方法，统计所有资产价值
     */
    function totalAssets() public view override returns (uint256) {
        address assetAddress = address(asset());
        uint256 total = IERC20(assetAddress).balanceOf(address(this));

        for (uint i = 0; i < tradingPairsList.length; i++) {
            address token = tradingPairsList[i];
            if (token != assetAddress && tradingPairs[token].isActive) {
                uint256 balance = IERC20(token).balanceOf(address(this));
                if (balance > 0) {
                    try priceOracle.getTokenValueInAsset(token, assetAddress, balance) returns (uint256 value) {
                        total += value;
                    } catch {
                        // 如果价格查询失败，忽略该代币
                        // FIXME 在生产环境中可能需要更严格的错误处理
                    }
                }
            }
        }
        return total;
    }

    /**
     * @notice 限制存款只能由合约所有者进行
     */
    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        if (isSingleUserMode) {
            require(msg.sender == owner(), "Only owner can deposit");
        }
        return super.deposit(assets, receiver);
    }

    /**
     * @notice 限制铸造只能由合约所有者进行
     */
    function mint(uint256 shares, address receiver) public override returns (uint256) {
        if (isSingleUserMode) {
            require(msg.sender == owner(), "Only owner can mint");
        }
        return super.mint(shares, receiver);
    }

    
    /**
     * @notice 支持AccessControl的supportsInterface
     */
    function supportsInterface(bytes4 interfaceId) public view override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @notice 覆盖maxRedeem以实现单用户模式下的灵活赎回
     * @param owner 赎回者地址
     */
    function maxRedeem(address owner) public view override returns (uint256) {
        // 仅允许唯一用户赎回
        if (owner != Ownable.owner()) return 0;
        
        // 单用户模式下，允许赎回所有份额
        return balanceOf(owner);
    }
    
    
    /**
     * @notice 智能流动性管理，按需卖出资产
     * @param neededAmount 需要的基础资产数量
     */
    function _ensureSufficientLiquidity(uint256 neededAmount) internal {
        address assetAddress = address(asset());
        uint256 currentBalance = IERC20(assetAddress).balanceOf(address(this));
        
        // 如果已有足够流动性，直接返回
        if (currentBalance >= neededAmount) return;
        
        uint256 additionalNeeded = neededAmount - currentBalance;
        
        // 按照持有比例卖出非基础资产，以最小化市场影响
        // 获取当前持有的所有非基础资产及价值
        uint256 totalNonBaseValue = 0;
        uint256[] memory tokenValues = new uint256[](tradingPairsList.length);
        
        for (uint i = 0; i < tradingPairsList.length; i++) {
            address token = tradingPairsList[i];
            if (token != assetAddress && tradingPairs[token].isActive) {
                uint256 balance = IERC20(token).balanceOf(address(this));
                if (balance > 0) {
                    try priceOracle.getTokenValueInAsset(token, assetAddress, balance) returns (uint256 value) {
                        tokenValues[i] = value;
                        totalNonBaseValue += value;
                    } catch {
                        tokenValues[i] = 0;
                    }
                }
            }
        }
        
        // 如果没有足够的非基础资产，返回（这种情况应该不会发生）
        if (totalNonBaseValue < additionalNeeded) return;
        
        // 按比例卖出每种资产
        for (uint i = 0; i < tradingPairsList.length; i++) {
            address token = tradingPairsList[i];
            if (token != assetAddress && tradingPairs[token].isActive && tokenValues[i] > 0) {
                // 计算需要卖出的该资产的比例
                uint256 portionToSell = (additionalNeeded * tokenValues[i]) / totalNonBaseValue;
                
                // 如果该资产价值小于需要的金额，全部卖出
                uint256 balance = IERC20(token).balanceOf(address(this));
                uint256 amountToSell;
                
                try priceOracle.getTokenValueInAsset(token, assetAddress, balance) returns (uint256 totalValue) {
                    // 计算应该卖出的代币数量
                    if (portionToSell >= totalValue) {
                        amountToSell = balance; // 全部卖出
                    } else {
                        // 按比例卖出，略微多卖一点以考虑滑点
                        amountToSell = (balance * portionToSell * 105) / (totalValue * 100);
                        if (amountToSell > balance) amountToSell = balance;
                    }
                } catch {
                    continue; // 如果价格查询失败，尝试下一个代币
                }
                
                if (amountToSell > 0) {
                    // 执行卖出
                    TransferHelper.safeApprove(token, address(swapRouter), amountToSell);
                    
                    ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
                        tokenIn: token,
                        tokenOut: assetAddress,
                        fee: 3000,
                        recipient: address(this),
                        deadline: block.timestamp + 15 minutes,
                        amountIn: amountToSell,
                        amountOutMinimum: 0, // 在紧急流动性需求下允许零最小值
                        sqrtPriceLimitX96: 0
                    });
                    
                    uint256 received = swapRouter.exactInputSingle(params);
                    
                    // 更新需要的金额
                    if (received >= additionalNeeded) {
                        break;
                    }
                    additionalNeeded -= received;
                }
            }
        }
    }

    /**
     * @notice 实现部分赎回功能
     * @param assets 要赎回的基础资产数量
     * @param receiver 接收赎回资产的地址
     * @return shares 销毁的份额数量
     */
    function partialWithdraw(
        uint256 assets,
        address receiver
    ) external nonReentrant returns (uint256 shares) {
        require(msg.sender == owner(), "Only owner can withdraw");
        require(assets > 0, "Cannot withdraw 0 assets");
        
        // 计算需要销毁的份额
        shares = previewWithdraw(assets);
        
        // 确保有足够的流动性
        _ensureSufficientLiquidity(assets);
        
        // 执行提款
        return withdraw(assets, receiver, msg.sender);
    }
    
    /**
     * @notice 实现百分比赎回功能
     * @param percentage 要赎回的资产百分比 (基数10000，如2500表示25%)
     * @param receiver 接收赎回资产的地址
     * @return assets 赎回的资产数量
     */
    function percentageWithdraw(
        uint256 percentage,
        address receiver
    ) external nonReentrant returns (uint256 assets) {
        require(msg.sender == owner(), "Only owner can withdraw");
        require(percentage > 0 && percentage <= 10000, "Invalid percentage");
        
        // 计算要赎回的资产价值
        uint256 totalValue = totalAssets();
        assets = (totalValue * percentage) / 10000;
        
        if (assets > 0) {
            // 确保有足够的流动性
            _ensureSufficientLiquidity(assets);
            
            // 执行提款
            withdraw(assets, receiver, msg.sender);
        }
        
        return assets;
    }
}