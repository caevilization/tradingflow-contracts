from web3 import Web3
import json
import time
import os
from pathlib import Path

# --- 连接到本地区块链 ---
w3 = Web3(Web3.HTTPProvider('http://127.0.0.1:8545'))
print(f"连接状态: {'已连接' if w3.is_connected() else '未连接'}")

# --- 辅助函数 ---
def load_abi(path):
    with open(path) as f:
        return json.load(f)["abi"]

# 项目根目录
BASE_PATH = Path(__file__).parent.parent

# --- 加载合约 ABI ---
TOKEN_ABI = load_abi(BASE_PATH / "artifacts/contracts/MyToken.sol/MyToken.json")

# 从 node_modules 获取 Uniswap ABI
NFPM_ABI = json.load(open(BASE_PATH / "node_modules/@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json"))["abi"]
FACTORY_ABI = json.load(open(BASE_PATH / "node_modules/@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json"))["abi"]
SWAP_ROUTER_ABI = json.load(open(BASE_PATH / "node_modules/@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json"))["abi"]

# --- 配置 ---
FACTORY_ADDRESS = "0x1F98431c8aD98523631AE4a59f267346ea31F984"  # Uniswap V3 Factory mainnet 地址
POSITION_MANAGER_ADDRESS = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"  # NonfungiblePositionManager mainnet 地址
SWAP_ROUTER_ADDRESS = "0xE592427A0AEce92De3Edee1F18E0157C05861564"  # 旧版 SwapRouter 地址

TKA_NAME = "TokenA"
TKA_SYMBOL = "TKA"
TKB_NAME = "TokenB"
TKB_SYMBOL = "TKB"

# 单位转换函数
def to_wei(amount, decimals=18):
    return int(amount * 10**decimals)

def from_wei(amount, decimals=18):
    return amount / 10**decimals

INITIAL_MINT_AMOUNT = to_wei(1000000)
LIQUIDITY_AMOUNT_TKA = to_wei(1000)
LIQUIDITY_AMOUNT_TKB = to_wei(1000)
POOL_FEE = 3000  # 0.3%

TICK_LOWER = -887220
TICK_UPPER = 887220

# Swap 配置
AMOUNT_IN_SWAP = to_wei(100)  # 想要兑换的 TKA 数量 (100 TKA)

# 计算 sqrtPriceX96
def calculate_sqrt_price_x96(price_ratio=1):
    return 1 << 96  # 1:1 价格

# 获取合约代码
def get_contract_bytecode(compiled_json_path):
    with open(compiled_json_path) as f:
        contract_json = json.load(f)
    return contract_json["bytecode"]

# 主函数
def main():
    # 获取账户
    deployer = w3.eth.accounts[0]
    print(f"使用账户: {deployer}")

    # # --- 1. 部署 TKA 和 TKB ---
    # print("\n--- 部署代币 ---")
    # MyToken_bytecode = get_contract_bytecode(BASE_PATH / "artifacts/contracts/MyToken.sol/MyToken.json")
    # MyToken = w3.eth.contract(abi=TOKEN_ABI, bytecode=MyToken_bytecode)
    
    # # 部署 TokenA
    # tx_hash = MyToken.constructor(TKA_NAME, TKA_SYMBOL, deployer).transact({'from': deployer})
    # tx_receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    token_a_address = "0x831C6C334f8DDeE62246a5c81B82c8e18008b38f"
    token_a = w3.eth.contract(address=token_a_address, abi=TOKEN_ABI)
    # print(f"TKA 部署到: {token_a_address}")
    
    # # 部署 TokenB
    # tx_hash = MyToken.constructor(TKB_NAME, TKB_SYMBOL, deployer).transact({'from': deployer})
    # tx_receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    token_b_address = "0xF47e3B0A1952A81F1afc41172762CB7CE8700133"
    token_b = w3.eth.contract(address=token_b_address, abi=TOKEN_ABI)
    # print(f"TKB 部署到: {token_b_address}")
    # print("--------------------")

    # # --- 2. 铸造初始代币 ---
    # print("\n--- 铸造代币 ---")
    # tx_hash = token_a.functions.mint(deployer, INITIAL_MINT_AMOUNT).transact({'from': deployer})
    # w3.eth.wait_for_transaction_receipt(tx_hash)
    # print(f"铸造 {from_wei(INITIAL_MINT_AMOUNT)} TKA 完成.")
    
    # tx_hash = token_b.functions.mint(deployer, INITIAL_MINT_AMOUNT).transact({'from': deployer})
    # w3.eth.wait_for_transaction_receipt(tx_hash)
    # print(f"铸造 {from_wei(INITIAL_MINT_AMOUNT)} TKB 完成.")

    # # 查询并显示初始余额
    # balance_a = token_a.functions.balanceOf(deployer).call()
    # balance_b = token_b.functions.balanceOf(deployer).call()
    # print("\n--- 铸造后余额 ---")
    # print(f"TKA: {from_wei(balance_a)}")
    # print(f"TKB: {from_wei(balance_b)}")
    # print("--------------------")

    # # --- 3. 获取 Uniswap 合约实例 ---
    # factory = w3.eth.contract(address=FACTORY_ADDRESS, abi=FACTORY_ABI)
    # position_manager = w3.eth.contract(address=POSITION_MANAGER_ADDRESS, abi=NFPM_ABI)
    # swap_router = w3.eth.contract(address=SWAP_ROUTER_ADDRESS, abi=SWAP_ROUTER_ABI)

    # # --- 4. 授权 Position Manager 和 SwapRouter 花费代币 ---
    # print("\n--- 授权 ---")
    # print("授权 Position Manager 花费 TKA & TKB...")
    
    # # 授权 Position Manager
    # tx_hash = token_a.functions.approve(POSITION_MANAGER_ADDRESS, 2**256 - 1).transact({'from': deployer})
    # w3.eth.wait_for_transaction_receipt(tx_hash)
    
    # tx_hash = token_b.functions.approve(POSITION_MANAGER_ADDRESS, 2**256 - 1).transact({'from': deployer})
    # w3.eth.wait_for_transaction_receipt(tx_hash)
    # print("Position Manager 授权完成.")
    
    # # 授权 SwapRouter
    # print(f"授权 SwapRouter 花费 TKA (最多 {from_wei(INITIAL_MINT_AMOUNT)})...")
    # tx_hash = token_a.functions.approve(SWAP_ROUTER_ADDRESS, INITIAL_MINT_AMOUNT).transact({'from': deployer})
    # w3.eth.wait_for_transaction_receipt(tx_hash)
    # print("SwapRouter 授权完成.")
    # print("--------------------")

    # # --- 5. 创建并初始化池子 ---
    # print("\n--- 创建/初始化池子 ---")
    # if int(token_a_address, 16) < int(token_b_address, 16):
    #     token0_address, token1_address = token_a_address, token_b_address
    #     token0, token1 = token_a, token_b
    # else:
    #     token0_address, token1_address = token_b_address, token_a_address
    #     token0, token1 = token_b, token_a
        
    # print(f"Token0: {token0.functions.symbol().call()} ({token0_address})")
    # print(f"Token1: {token1.functions.symbol().call()} ({token1_address})")

    # sqrt_price_x96 = calculate_sqrt_price_x96(1)
    # print(f"尝试创建并初始化池子 (费率: {POOL_FEE / 10000}%, 初始 SqrtPriceX96: {sqrt_price_x96})...")
    
    # # 创建并初始化池子
    # tx_hash = position_manager.functions.createAndInitializePoolIfNecessary(
    #     token0_address,
    #     token1_address,
    #     POOL_FEE,
    #     sqrt_price_x96
    # ).transact({'from': deployer, 'gas': 5000000})
    
    # pool_receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    # pool_address = factory.functions.getPool(token0_address, token1_address, POOL_FEE).call()
    # print(f"池子地址: {pool_address}")
    
    # if pool_receipt.status != 1:
    #     print("创建或初始化池子失败!")
    #     return
    # print("池子已存在或已成功创建并初始化.")
    # print("--------------------")

    # # --- 6. 添加流动性 ---
    # print("\n--- 添加流动性 ---")
    # amount0_desired = LIQUIDITY_AMOUNT_TKA if token0_address == token_a_address else LIQUIDITY_AMOUNT_TKB
    # amount1_desired = LIQUIDITY_AMOUNT_TKB if token0_address == token_a_address else LIQUIDITY_AMOUNT_TKA

    # mint_params = {
    #     'token0': token0_address,
    #     'token1': token1_address,
    #     'fee': POOL_FEE,
    #     'tickLower': TICK_LOWER,
    #     'tickUpper': TICK_UPPER,
    #     'amount0Desired': amount0_desired,
    #     'amount1Desired': amount1_desired,
    #     'amount0Min': 0,
    #     'amount1Min': 0,
    #     'recipient': deployer,
    #     'deadline': int(time.time()) + 600
    # }

    # print("调用 mint 添加流动性...")
    # tx_hash = position_manager.functions.mint(mint_params).transact({'from': deployer, 'gas': 5000000})
    # mint_receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

    # if mint_receipt.status != 1:
    #     print("添加流动性失败!")
    #     return
    # print("流动性添加成功!")
    # print("--------------------")

    # # --- 7. 执行 Swap (TKA -> TKB) ---
    # print("\n--- 执行 Swap ---")
    # # 显示 Swap 前余额
    # balance_a_before_swap = token_a.functions.balanceOf(deployer).call()
    # balance_b_before_swap = token_b.functions.balanceOf(deployer).call()
    # print("\n--- Swap 前余额 ---")
    # print(f"TKA: {from_wei(balance_a_before_swap)}")
    # print(f"TKB: {from_wei(balance_b_before_swap)}")
    # print("--------------------")

    # print(f"\n执行 Swap: {from_wei(AMOUNT_IN_SWAP)} TKA 兑换 TKB...")
    # swap_params = {
    #     'tokenIn': token_a_address,
    #     'tokenOut': token_b_address,
    #     'fee': POOL_FEE,
    #     'recipient': deployer,
    #     'deadline': int(time.time()) + 600,
    #     'amountIn': AMOUNT_IN_SWAP,
    #     'amountOutMinimum': 0,
    #     'sqrtPriceLimitX96': 0
    # }

    # try:
    #     tx_hash = swap_router.functions.exactInputSingle(swap_params).transact({'from': deployer, 'gas': 5000000})
    #     print(f"Swap 交易已发送, Tx Hash: {tx_hash.hex()}")
    #     swap_receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    #     print("Swap 交易已确认.")

    #     if swap_receipt.status != 1:
    #         print("Swap 交易失败!")
    #     else:
    #         # 显示 Swap 后余额
    #         balance_a_after_swap = token_a.functions.balanceOf(deployer).call()
    #         balance_b_after_swap = token_b.functions.balanceOf(deployer).call()
    #         print("\n--- Swap 后余额 ---")
    #         print(f"TKA: {from_wei(balance_a_after_swap)}")
    #         print(f"TKB: {from_wei(balance_b_after_swap)}")
    #         print("--------------------")

    #         # 计算余额变化
    #         change_a = balance_a_before_swap - balance_a_after_swap
    #         change_b = balance_b_after_swap - balance_b_before_swap
    #         print("\n--- Swap 余额变化 ---")
    #         print(f"TKA 减少: {from_wei(change_a)}")
    #         print(f"TKB 增加: {from_wei(change_b)}")
    #         print("--------------------")
    # except Exception as e:
    #     print("\n执行 Swap 时出错:", str(e))

    # # --- 8.1. 部署本地价格预言机合约 ---
    # print("\n--- 部署本地价格预言机合约 PriceOracle ---")
    # PriceOracle_bytecode = get_contract_bytecode(BASE_PATH / "artifacts/contracts/PriceOracle.sol/PriceOracle.json")
    # PriceOracle_abi = load_abi(BASE_PATH / "artifacts/contracts/PriceOracle.sol/PriceOracle.json")
    
    # PriceOracle = w3.eth.contract(abi=PriceOracle_abi, bytecode=PriceOracle_bytecode)
    # tx_hash = PriceOracle.constructor().transact({'from': deployer})
    # tx_receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    # price_oracle_address = tx_receipt.contractAddress
    # price_oracle = w3.eth.contract(address=price_oracle_address, abi=PriceOracle_abi)
    # print(f"PriceOracle 部署到: {price_oracle_address}")

    # # --- 8.2. 部署金库合约 OracleGuidedVault ---
    # print("\n--- 部署金库合约 OracleGuidedVault ---")
    # # 确保加载的是 UniswapVault_bak.sol 编译后的 ABI
    # # 假设编译后的 JSON 文件名仍然是 OracleGuidedVault.json
    # # 如果文件名不同 (例如 UniswapVault_bak.json)，请相应修改路径
    # Vault_bytecode = get_contract_bytecode(BASE_PATH / "artifacts/contracts/UniswapVault_bak.sol/OracleGuidedVault.json") #<-- 修改路径以匹配编译输出
    Vault_abi = load_abi(BASE_PATH / "artifacts/contracts/UniswapVault_bak.sol/OracleGuidedVault.json") #<-- 修改路径以匹配编译输出
    
    # Vault = w3.eth.contract(abi=Vault_abi, bytecode=Vault_bytecode)
    
    # # 获取部署者地址作为初始投资者地址
    # initial_investor_address = deployer 
    # print(f"使用部署者地址作为初始投资者: {initial_investor_address}")

    # tx_hash = Vault.constructor(
    #     token_a_address,        # _asset (TKA)
    #     "VaultTKA",             # _name
    #     "vTKA",                 # _symbol
    #     SWAP_ROUTER_ADDRESS,    # _swapRouter
    #     price_oracle_address,   # _priceOracle
    #     initial_investor_address # _initialInvestor <-- 新增参数
    # ).transact({'from': deployer, 'gas': 5000000})
    
    # tx_receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    vault_address = "0x934A389CaBFB84cdB3f0260B2a4FD575b8B345A3"
    vault = w3.eth.contract(address=vault_address, abi=Vault_abi)
    # print(f"Vault 部署到: {vault_address}")

    # --- 9. 设置 TKB 交易对，启用策略 ---
    print("\n--- 配置金库策略 ---")
    strategy_manager_role = vault.functions.STRATEGY_MANAGER_ROLE().call()
    tx_hash = vault.functions.grantRole(strategy_manager_role, deployer).transact({'from': deployer})
    w3.eth.wait_for_transaction_receipt(tx_hash)
    
    # tx_hash = vault.functions.setTradingPair(token_b_address, 3000, 0).transact({'from': deployer})
    # w3.eth.wait_for_transaction_receipt(tx_hash)
    
    # tx_hash = vault.functions.updateStrategySettings(True, 900).transact({'from': deployer})
    # w3.eth.wait_for_transaction_receipt(tx_hash)
    
    # oracle_role = vault.functions.ORACLE_ROLE().call()
    # tx_hash = vault.functions.grantRole(oracle_role, deployer).transact({'from': deployer})
    # w3.eth.wait_for_transaction_receipt(tx_hash)

    # --- 10. 用户质押 TKA ---
    DEPOSIT_AMOUNT = to_wei(1000)
    print(f"\n用户质押 {from_wei(DEPOSIT_AMOUNT)} TKA 到金库...")
    tx_hash = token_a.functions.approve(vault_address, DEPOSIT_AMOUNT).transact({'from': deployer})
    w3.eth.wait_for_transaction_receipt(tx_hash)
    
    tx_hash = vault.functions.deposit(DEPOSIT_AMOUNT, deployer).transact({'from': deployer})
    w3.eth.wait_for_transaction_receipt(tx_hash)
    print("质押完成.")

    # --- 11. 打印金库持仓信息 ---
    print("\n--- 金库持仓信息 ---")
    portfolio = vault.functions.getPortfolioComposition().call()
    base_asset_amount, token_addresses, token_amounts = portfolio
    print(f"TKA: {from_wei(base_asset_amount)}")
    for i in range(len(token_addresses)):
        print(f"TKB: {from_wei(token_amounts[i])} (地址: {token_addresses[i]})")
    print("--------------------")
    

    # --- 11. Oracle信号：swap 30% TKA 为 TKB ---
    vault_tka_balance = token_a.functions.balanceOf(vault_address).call()
    swap_amount = vault_tka_balance * 30 // 100
    print(f"\nOracle信号: swap 30% TKA ({from_wei(swap_amount)}) 为 TKB...")
    
    tx_hash = vault.functions.executeBuySignal(
        token_b_address,
        swap_amount,
        0,      # 不设最小输出
        3000    # 最大分配30%
    ).transact({'from': deployer, 'gas': 5000000})
    w3.eth.wait_for_transaction_receipt(tx_hash)

    # --- 12. 打印金库持仓信息 ---
    print("\n--- 金库持仓信息（TKA->TKB后） ---")
    portfolio = vault.functions.getPortfolioComposition().call()
    base_asset_amount1, token_addresses1, token_amounts1 = portfolio
    
    print(f"TKA: {from_wei(base_asset_amount1)}")
    for i in range(len(token_addresses1)):
        print(f"TKB: {from_wei(token_amounts1[i])} (地址: {token_addresses1[i]})")

    # --- 13. Oracle信号: swap 所有 TKB 为 TKA ---
    vault_tkb_balance = token_b.functions.balanceOf(vault_address).call()
    print(f"\nOracle信号: swap 所有 TKB ({from_wei(vault_tkb_balance)}) 为 TKA...")
    
    tx_hash = vault.functions.executeSellSignal(
        token_b_address,
        0, # 0表示全部
        0  # 不设最小输出
    ).transact({'from': deployer, 'gas': 5000000})
    w3.eth.wait_for_transaction_receipt(tx_hash)

    # --- 14. 打印金库持仓信息 ---
    print("\n--- 金库持仓信息（TKB->TKA后） ---")
    portfolio = vault.functions.getPortfolioComposition().call()
    base_asset_amount2, token_addresses2, token_amounts2 = portfolio
    
    print(f"TKA: {from_wei(base_asset_amount2)}")
    for i in range(len(token_addresses2)):
        print(f"TKB: {from_wei(token_amounts2[i])} (地址: {token_addresses2[i]})")

    # --- 15. 用户赎回全部 TKA，打印余额变化 ---
    user_tka_before = token_a.functions.balanceOf(deployer).call()
    print("\n用户赎回全部 TKA...")
    
    vault_share = vault.functions.balanceOf(deployer).call()
    tx_hash = vault.functions.redeem(vault_share, deployer, deployer).transact({'from': deployer})
    w3.eth.wait_for_transaction_receipt(tx_hash)
    
    user_tka_after = token_a.functions.balanceOf(deployer).call()
    print(f"用户赎回前 TKA: {from_wei(user_tka_before)}")
    print(f"用户赎回后 TKA: {from_wei(user_tka_after)}")
    print(f"TKA 增加: {from_wei(user_tka_after - user_tka_before)}")

    print("--------------------")
    print("\n脚本执行完毕.")

if __name__ == "__main__":
    main()