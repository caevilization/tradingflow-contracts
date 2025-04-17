# Uniswap V3 流动性池管理和交易脚本

**如何运行:**

1.  **启动 Hardhat 节点 (如果尚未运行):**
    ```bash
    npx hardhat node
    ```
2.  **运行合并后的脚本:**
    ```bash
    npx hardhat run scripts/managePoolAndSwapByVault.ts --network localhost
    ```

现在，这个脚本会按顺序完成部署、铸币、授权、创建池、添加流动性、执行 swap 以及部署vault合约，质押并通过信号交易，最后全部赎回的所有步骤，并在控制台显示各个阶段的信息和余额变化。
