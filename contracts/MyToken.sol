// filepath: /Users/fudata/work/github/uniswap-v3-test/contracts/MyToken.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24; // 使用你 hardhat.config.js 中定义的版本

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; // 引入 Ownable

contract MyToken is ERC20, Ownable {
    // 调用 Ownable 的构造函数来设置初始 owner
    constructor(string memory name, string memory symbol, address initialOwner) ERC20(name, symbol) Ownable(initialOwner) {}

    // 允许 owner 铸造新代币
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}