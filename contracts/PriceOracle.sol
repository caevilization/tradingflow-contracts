// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title SimpleChainlinkPrice
 * @notice 简单的价格预言机合约，允许授权角色更新价格
 */
contract PriceOracle is AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    // 价格存储，基于两个代币地址的组合
    // tokenA/tokenB => 1 tokenA = ? tokenB (乘以10^18)
    mapping(bytes32 => uint256) private prices;
    
    // 价格更新时间戳
    mapping(bytes32 => uint256) private lastUpdateTimestamp;
    
    // 最大价格过期时间，默认1小时
    uint256 public maxPriceAge = 1 hours;
    
    event PriceUpdated(address tokenA, address tokenB, uint256 price);
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, msg.sender);
    }
    
    /**
     * @notice 设置最大价格过期时间
     * @param _maxPriceAge 最大价格过期时间（秒）
     */
    function setMaxPriceAge(uint256 _maxPriceAge) external onlyRole(ADMIN_ROLE) {
        maxPriceAge = _maxPriceAge;
    }
    
    /**
     * @notice 更新价格
     * @param tokenA 代币A地址
     * @param tokenB 代币B地址 
     * @param price 1个tokenA等于多少tokenB (乘以10^18)
     */
    function updatePrice(address tokenA, address tokenB, uint256 price) external onlyRole(ORACLE_ROLE) {
        require(tokenA != address(0) && tokenB != address(0), "Invalid token address");
        require(price > 0, "Price must be positive");
        
        bytes32 pairHash = _getPairHash(tokenA, tokenB);
        prices[pairHash] = price;
        lastUpdateTimestamp[pairHash] = block.timestamp;
        
        emit PriceUpdated(tokenA, tokenB, price);
        
        // 同时更新反向价格
        bytes32 reversePairHash = _getPairHash(tokenB, tokenA);
        // 反向价格 = 1 / 价格 * 10^18
        uint256 reversePrice = (1e36) / price;
        prices[reversePairHash] = reversePrice;
        lastUpdateTimestamp[reversePairHash] = block.timestamp;
        
        emit PriceUpdated(tokenB, tokenA, reversePrice);
    }

    /**
     * @notice 批量更新多个币对的价格
     * @param tokenAs 代币A地址数组
     * @param tokenBs 代币B地址数组
     * @param priceList 价格数组 (每个价格乘以10^18)
     */
    function updatePricesBatch(
        address[] calldata tokenAs,
        address[] calldata tokenBs,
        uint256[] calldata priceList
    ) external onlyRole(ORACLE_ROLE) {
        uint256 length = tokenAs.length;
        require(length > 0, "Empty arrays not allowed");
        require(length == tokenBs.length && length == priceList.length, "Array lengths must match");
        
        for (uint256 i = 0; i < length; i++) {
            address tokenA = tokenAs[i];
            address tokenB = tokenBs[i];
            uint256 price = priceList[i];
            
            require(tokenA != address(0) && tokenB != address(0), "Invalid token address");
            require(price > 0, "Price must be positive");
            
            // 更新正向价格
            bytes32 pairHash = _getPairHash(tokenA, tokenB);
            prices[pairHash] = price;
            lastUpdateTimestamp[pairHash] = block.timestamp;
            
            emit PriceUpdated(tokenA, tokenB, price);
            
            // 更新反向价格
            bytes32 reversePairHash = _getPairHash(tokenB, tokenA);
            uint256 reversePrice = (1e36) / price;
            prices[reversePairHash] = reversePrice;
            lastUpdateTimestamp[reversePairHash] = block.timestamp;
            
            emit PriceUpdated(tokenB, tokenA, reversePrice);
        }
    }

    /**
     * @notice 获取价格
     * @param tokenA 代币A地址
     * @param tokenB 代币B地址
     * @return 1个tokenA等于多少tokenB (乘以10^18)
     */
    function getPrice(address tokenA, address tokenB) public view returns (uint256) {
        bytes32 pairHash = _getPairHash(tokenA, tokenB);
        uint256 timestamp = lastUpdateTimestamp[pairHash];
        require(timestamp > 0, "Price not available");
        require(block.timestamp - timestamp <= maxPriceAge, "Price is stale");
        
        return prices[pairHash];
    }
    
    /**
     * @notice 计算tokenA的指定数量在tokenB中的价值
     * @param tokenA 代币A地址
     * @param tokenB 代币B地址
     * @param amountA 代币A数量
     * @return 等值的代币B数量
     */
    function getTokenValueInAsset(address tokenA, address tokenB, uint256 amountA) public view returns (uint256) {
        if (tokenA == tokenB) return amountA;
        
        uint256 price = getPrice(tokenA, tokenB);
        return (amountA * price) / 1e18;
    }
    
    /**
     * @notice 获取价格的最后更新时间
     */
    function getLastUpdateTimestamp(address tokenA, address tokenB) public view returns (uint256) {
        return lastUpdateTimestamp[_getPairHash(tokenA, tokenB)];
    }
    
    /**
     * @notice 计算交易对的哈希值
     */
    function _getPairHash(address tokenA, address tokenB) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenA, tokenB));
    }
}