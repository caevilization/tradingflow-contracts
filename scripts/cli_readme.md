# Vault 操作命令行工具

## 使用指南

将上述代码保存为 `vault_cli.py`，并确保它具有执行权限。然后可以使用以下命令：

### 基本设置

首先，编辑脚本顶部的默认值：

```python
DEFAULT_RPC = "http://127.0.0.1:8545"  # 您的 RPC 地址
DEFAULT_VAULT_ADDRESS = "0xYourVaultAddress"  # 您的金库地址
DEFAULT_ACCOUNT = "0xYourAccountAddress"  # 您的账户地址
```

或者每次运行时通过命令行参数指定：

```bash
chmod +x vault_cli.py  # 给予执行权限
```

### 查看帮助

```bash
python3 vault_cli.py --help
```

### 查看金库信息

```bash
python3 vault_cli.py --vault 0xYourVaultAddress --account 0xYourAccount info
```

### 查看当前持仓

```bash
python3 vault_cli.py --vault 0xYourVaultAddress portfolio
```

### 存入资产

```bash
python3 vault_cli.py --vault 0xYourVaultAddress --account 0xYourAccount deposit 100
```

### 取出资产

```bash
# 取出特定金额
python3 vault_cli.py --vault 0xYourVaultAddress --account 0xYourAccount withdraw --amount 50

# 取出特定百分比
python3 vault_cli.py --vault 0xYourVaultAddress --account 0xYourAccount withdraw --percentage 50

# 取出全部
python3 vault_cli.py --vault 0xYourVaultAddress --account 0xYourAccount withdraw --all
```

### 执行买入信号

```bash
# 买入固定金额
python3 vault_cli.py --vault 0xYourVaultAddress --account 0xYourAccount buy 0xTokenAddress 100

# 买入百分比
python3 vault_cli.py --vault 0xYourVaultAddress --account 0xYourAccount buy 0xTokenAddress 30%
```

### 执行卖出信号

```bash
# 卖出全部
python3 vault_cli.py --vault 0xYourVaultAddress --account 0xYourAccount sell 0xTokenAddress

# 卖出特定金额
python3 vault_cli.py --vault 0xYourVaultAddress --account 0xYourAccount sell 0xTokenAddress --amount 50

# 卖出特定百分比
python3 vault_cli.py --vault 0xYourVaultAddress --account 0xYourAccount sell 0xTokenAddress --amount 75%
```

### 管理交易对

```bash
# 添加或更新交易对
python3 vault_cli.py --vault 0xYourVaultAddress --account 0xYourAccount pair 0xTokenAddress --max 30%

# 禁用交易对
python3 vault_cli.py --vault 0xYourVaultAddress --account 0xYourAccount pair 0xTokenAddress --disable
```

### 更新预言机价格

```bash
python3 vault_cli.py --vault 0xYourVaultAddress --account 0xYourAccount price 0xTokenA 0xTokenB 0.5
```

## 注意事项

1. 请确保您的账户有足够的权限执行相应操作
2. 执行交易信号需要 ORACLE_ROLE 权限
3. 管理交易对需要 STRATEGY_MANAGER_ROLE 权限
4. 更新价格需要 ORACLE_ROLE 权限

这个工具将大大简化您的测试流程，让您可以方便地与金库合约进行交互。