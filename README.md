# Uniswap V3 流动性池管理和交易脚本

**如何运行:**

1.  **启动 Hardhat 节点 (如果尚未运行):**
    ```bash
    npx hardhat node
    ```
2.  **运行合并后的脚本:**
    ```bash
    # 如果你重命名了文件
    npx hardhat run scripts/managePoolAndSwap.ts --network localhost
    ```

现在，这个脚本会按顺序完成部署、铸币、授权、创建池、添加流动性以及执行 swap 的所有步骤，并在控制台显示各个阶段的信息和余额变化。
