#!/usr/bin/env python3

import argparse
import json
import sys
from pathlib import Path
from web3 import Web3
import os



def normalize_address(address):
    """将地址转换为标准格式"""
    if address.startswith("0x"):
        return Web3.to_checksum_address(address)
    else:
        return Web3.to_checksum_address("0x" + address)
# --- 配置区域 ---
BASE_PATH = Path(__file__).parent.parent
DEFAULT_RPC = "http://127.0.0.1:8545"
DEFAULT_VAULT_ADDRESS = None  # 设置您的金库地址
DEFAULT_ACCOUNT = None  # 设置您的默认账户地址

# --- 辅助函数 ---
def load_abi(path):
    with open(path) as f:
        return json.load(f)["abi"]

def to_wei(amount, decimals=18):
    return int(float(amount) * 10**decimals)

def from_wei(amount, decimals=18):
    return amount / 10**decimals

def connect_web3(rpc_url):
    w3 = Web3(Web3.HTTPProvider(rpc_url))
    print(f"连接状态: {'已连接' if w3.is_connected() else '未连接'}")
    if not w3.is_connected():
        print(f"错误: 无法连接到 RPC {rpc_url}")
        sys.exit(1)
    return w3
# 确保在所有使用地址参数的地方添加规范化处理

def get_account(w3, key_or_account):
    if key_or_account and key_or_account.startswith("0x") and len(key_or_account) == 42:
        # 是地址
        return normalize_address(key_or_account)  # 添加规范化
    elif key_or_account:
        # 是私钥
        account = w3.eth.account.from_key(key_or_account)
        return normalize_address(account.address)  # 添加规范化
    elif w3.eth.accounts:
        # 使用第一个账户
        return normalize_address(w3.eth.accounts[0])  # 添加规范化
    else:
        print("错误: 未提供账户，且无法从节点获取账户")
        sys.exit(1)

def load_contracts(w3, vault_address):
    try:
        # 加载金库 ABI
        vault_abi = load_abi(BASE_PATH / "artifacts/contracts/UniswapVault_bak.sol/OracleGuidedVault.json")
        vault = w3.eth.contract(address=normalize_address(vault_address), abi=vault_abi)
        
        # 获取基础资产地址
        asset_address = vault.functions.asset().call()
        
        # 加载代币 ABI
        token_abi = load_abi(BASE_PATH / "artifacts/contracts/MyToken.sol/MyToken.json")
        asset = w3.eth.contract(address=normalize_address(asset_address), abi=token_abi)
        
        # 加载预言机地址
        oracle_address = vault.functions.priceOracle().call()
        oracle_abi = load_abi(BASE_PATH / "artifacts/contracts/PriceOracle.sol/PriceOracle.json")
        oracle = w3.eth.contract(address=normalize_address(oracle_address), abi=oracle_abi)
        
        return {
            'vault': vault,
            'asset': asset,
            'oracle': oracle
        }
    except Exception as e:
        print(f"错误: 加载合约失败 - {str(e)}")
        sys.exit(1)

def send_transaction(w3, account, contract_func, gas=5000000):
    if isinstance(account, str) and account.startswith("0x") and len(account) == 42:
        # 使用现有账户（假设是本地节点账户）
        tx_hash = contract_func.transact({'from': normalize_address(account), 'gas': gas})  # 添加规范化
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        return receipt
    else:
        # 使用私钥签名
        address = w3.eth.account.from_key(account).address
        normalized_address = normalize_address(address)  # 添加规范化
        tx = contract_func.build_transaction({
            'from': normalized_address,
            'gas': gas,
            'nonce': w3.eth.get_transaction_count(normalized_address)
        })
        signed_tx = w3.eth.account.sign_transaction(tx, account)
        tx_hash = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        return receipt
# --- 金库操作函数 ---

def get_info(w3, vault, account):
    """获取金库和账户基本信息"""
    try:
        account = normalize_address(account)  # 添加规范化
        asset_address = vault.functions.asset().call()
        asset_contract = w3.eth.contract(address=asset_address, abi=load_abi(BASE_PATH / "artifacts/contracts/MyToken.sol/MyToken.json"))
        
        asset_symbol = asset_contract.functions.symbol().call()
        asset_decimals = asset_contract.functions.decimals().call()
        
        total_assets = vault.functions.totalAssets().call()
        total_supply = vault.functions.totalSupply().call()
        
        user_shares = vault.functions.balanceOf(account).call()
        user_assets = 0
        if total_supply > 0:
            user_assets = (user_shares * total_assets) // total_supply
        
        asset_balance = asset_contract.functions.balanceOf(account).call()
        
        strategy_enabled = vault.functions.strategyEnabled().call()
        
        print("\n=== 金库信息 ===")
        print(f"金库地址: {vault.address}")
        print(f"基础资产: {asset_symbol} ({asset_address})")
        print(f"总资产: {from_wei(total_assets, asset_decimals)} {asset_symbol}")
        print(f"总份额: {from_wei(total_supply)}")
        print(f"策略状态: {'启用' if strategy_enabled else '禁用'}")
        
        print("\n=== 用户信息 ===")
        print(f"账户地址: {account}")
        print(f"持有份额: {from_wei(user_shares)}")
        print(f"份额价值: {from_wei(user_assets, asset_decimals)} {asset_symbol}")
        print(f"钱包余额: {from_wei(asset_balance, asset_decimals)} {asset_symbol}")
        
        return True
    except Exception as e:
        print(f"错误: 获取信息失败 - {str(e)}")
        return False

def get_portfolio(w3, vault):
    """获取金库当前持仓情况"""
    try:
        portfolio = vault.functions.getPortfolioComposition().call()
        base_asset_amount, token_addresses, token_amounts = portfolio
        
        asset_address = vault.functions.asset().call()
        asset_contract = w3.eth.contract(address=asset_address, abi=load_abi(BASE_PATH / "artifacts/contracts/MyToken.sol/MyToken.json"))
        asset_symbol = asset_contract.functions.symbol().call()
        asset_decimals = asset_contract.functions.decimals().call()
        
        print("\n=== 当前持仓 ===")
        print(f"{asset_symbol}: {from_wei(base_asset_amount, asset_decimals)}")
        
        for i in range(len(token_addresses)):
            try:
                token_contract = w3.eth.contract(address=token_addresses[i], abi=load_abi(BASE_PATH / "artifacts/contracts/MyToken.sol/MyToken.json"))
                token_symbol = token_contract.functions.symbol().call()
                token_decimals = token_contract.functions.decimals().call()
                print(f"{token_symbol}: {from_wei(token_amounts[i], token_decimals)} (地址: {token_addresses[i]})")
            except:
                print(f"未知代币: {from_wei(token_amounts[i])} (地址: {token_addresses[i]})")
        
        return True
    except Exception as e:
        print(f"错误: 获取持仓失败 - {str(e)}")
        return False

def deposit_asset(w3, vault, asset, account, amount):
    """向金库存入资产"""
    try:
        asset_address = vault.functions.asset().call()
        asset_contract = w3.eth.contract(address=asset_address, abi=load_abi(BASE_PATH / "artifacts/contracts/MyToken.sol/MyToken.json"))
        asset_symbol = asset_contract.functions.symbol().call()
        asset_decimals = asset_contract.functions.decimals().call()
        
        amount_wei = to_wei(amount, asset_decimals)
        
        # 检查余额
        balance = asset_contract.functions.balanceOf(account).call()
        if balance < amount_wei:
            print(f"错误: 余额不足. 需要 {amount} {asset_symbol}, 但只有 {from_wei(balance, asset_decimals)} {asset_symbol}")
            return False
        
        # 授权
        print(f"授权金库花费 {amount} {asset_symbol}...")
        approve_func = asset_contract.functions.approve(vault.address, amount_wei)
        send_transaction(w3, account, approve_func)
        
        # 存款
        print(f"向金库存入 {amount} {asset_symbol}...")
        deposit_func = vault.functions.deposit(amount_wei, account)
        receipt = send_transaction(w3, account, deposit_func)
        
        if receipt.status == 1:
            print(f"成功存入 {amount} {asset_symbol} 到金库")
            return True
        else:
            print("存款交易失败")
            return False
    except Exception as e:
        print(f"错误: 存款失败 - {str(e)}")
        return False

def withdraw_asset(w3, vault, account, amount=None, percentage=None, all_shares=False):
    """从金库取出资产"""
    try:
        asset_address = vault.functions.asset().call()
        asset_contract = w3.eth.contract(address=asset_address, abi=load_abi(BASE_PATH / "artifacts/contracts/MyToken.sol/MyToken.json"))
        asset_symbol = asset_contract.functions.symbol().call()
        asset_decimals = asset_contract.functions.decimals().call()
        
        user_shares = vault.functions.balanceOf(account).call()
        if user_shares == 0:
            print("错误: 您没有任何份额可以赎回")
            return False
        
        if all_shares:
            # 赎回全部
            print(f"赎回所有份额...")
            redeem_func = vault.functions.redeem(user_shares, account, account)
            receipt = send_transaction(w3, account, redeem_func)
        elif percentage is not None:
            # 按百分比赎回
            pct = min(10000, max(1, int(float(percentage) * 100)))  # 转换为基点 (1-10000)
            print(f"赎回 {percentage}% 的份额...")
            withdraw_func = vault.functions.percentageWithdraw(pct, account)
            receipt = send_transaction(w3, account, withdraw_func)
        elif amount is not None:
            # 按金额赎回
            amount_wei = to_wei(amount, asset_decimals)
            print(f"赎回价值 {amount} {asset_symbol} 的份额...")
            withdraw_func = vault.functions.withdraw(amount_wei, account, account)
            receipt = send_transaction(w3, account, withdraw_func)
        else:
            print("错误: 必须指定赎回金额或百分比")
            return False
        
        if receipt.status == 1:
            print("赎回成功")
            # 显示赎回后的余额
            new_balance = asset_contract.functions.balanceOf(account).call()
            new_shares = vault.functions.balanceOf(account).call()
            print(f"当前钱包余额: {from_wei(new_balance, asset_decimals)} {asset_symbol}")
            print(f"剩余份额: {from_wei(new_shares)}")
            return True
        else:
            print("赎回交易失败")
            return False
    except Exception as e:
        print(f"错误: 赎回失败 - {str(e)}")
        return False

def execute_buy_signal(w3, vault, account, token_address, amount_or_percentage, min_amount_out=0):
    """执行买入信号"""
    try:
        asset_address = vault.functions.asset().call()
        asset_contract = w3.eth.contract(address=asset_address, abi=load_abi(BASE_PATH / "artifacts/contracts/MyToken.sol/MyToken.json"))
        asset_symbol = asset_contract.functions.symbol().call()
        asset_decimals = asset_contract.functions.decimals().call()
        
        # 检查是否有ORACLE_ROLE权限
        oracle_role = vault.functions.ORACLE_ROLE().call()
        has_role = vault.functions.hasRole(oracle_role, account).call()
        if not has_role:
            print("错误: 账户没有ORACLE_ROLE权限，无法执行交易信号")
            return False
        
        # 检查交易对是否被激活
        if not vault.functions.tradingPairs(token_address).call()[1]:  # isActive
            print("错误: 代币交易对未激活")
            return False
        
        # 获取金库中的资产余额
        vault_asset_balance = asset_contract.functions.balanceOf(vault.address).call()
        
        # 确定买入金额
        amount_wei = 0
        max_allocation = 0
        
        if amount_or_percentage.endswith("%"):
            # 按百分比买入
            percentage = float(amount_or_percentage[:-1])
            amount_wei = int(vault_asset_balance * percentage / 100)
            max_allocation = int(percentage * 100)  # 转为基点
        else:
            # 按金额买入
            amount_wei = to_wei(amount_or_percentage, asset_decimals)
            if vault_asset_balance > 0:
                max_allocation = int((amount_wei / vault_asset_balance) * 10000)
            else:
                max_allocation = 10000
        
        # 获取代币信息
        try:
            token_contract = w3.eth.contract(address=token_address, abi=load_abi(BASE_PATH / "artifacts/contracts/MyToken.sol/MyToken.json"))
            token_symbol = token_contract.functions.symbol().call()
        except:
            token_symbol = "未知代币"
        
        print(f"执行买入信号: 使用 {from_wei(amount_wei, asset_decimals)} {asset_symbol} 购买 {token_symbol}...")
        buy_func = vault.functions.executeBuySignal(
            token_address,
            amount_wei,
            min_amount_out,
            max_allocation
        )
        
        receipt = send_transaction(w3, account, buy_func)
        
        if receipt.status == 1:
            print(f"成功执行买入信号: {from_wei(amount_wei, asset_decimals)} {asset_symbol} -> {token_symbol}")
            return True
        else:
            print("买入信号执行失败")
            return False
    except Exception as e:
        print(f"错误: 执行买入信号失败 - {str(e)}")
        return False

def execute_sell_signal(w3, vault, account, token_address, amount_or_percentage=None, min_amount_out=0):
    """执行卖出信号"""
    try:
        # 检查是否有ORACLE_ROLE权限
        oracle_role = vault.functions.ORACLE_ROLE().call()
        has_role = vault.functions.hasRole(oracle_role, account).call()
        if not has_role:
            print("错误: 账户没有ORACLE_ROLE权限，无法执行交易信号")
            return False
        
        # 检查交易对是否被激活
        if not vault.functions.tradingPairs(token_address).call()[1]:  # isActive
            print("错误: 代币交易对未激活")
            return False
        
        # 获取代币信息
        try:
            token_contract = w3.eth.contract(address=token_address, abi=load_abi(BASE_PATH / "artifacts/contracts/MyToken.sol/MyToken.json"))
            token_symbol = token_contract.functions.symbol().call()
            token_decimals = token_contract.functions.decimals().call()
        except:
            token_symbol = "未知代币"
            token_decimals = 18
        
        # 获取金库中的代币余额
        token_balance = token_contract.functions.balanceOf(vault.address).call()
        if token_balance == 0:
            print(f"错误: 金库中没有 {token_symbol} 余额")
            return False
        
        # 确定卖出金额
        amount_wei = 0
        if amount_or_percentage is None or amount_or_percentage == "all":
            # 全部卖出
            amount_wei = 0  # 在合约中，0 表示全部卖出
            print(f"执行卖出信号: 卖出所有 {token_symbol} ({from_wei(token_balance, token_decimals)} {token_symbol})...")
        elif amount_or_percentage.endswith("%"):
            # 按百分比卖出
            percentage = float(amount_or_percentage[:-1])
            amount_wei = int(token_balance * percentage / 100)
            print(f"执行卖出信号: 卖出 {percentage}% 的 {token_symbol} ({from_wei(amount_wei, token_decimals)} {token_symbol})...")
        else:
            # 按金额卖出
            amount_wei = to_wei(amount_or_percentage, token_decimals)
            if amount_wei > token_balance:
                print(f"警告: 指定卖出金额 {amount_or_percentage} 超过金库持有的 {from_wei(token_balance, token_decimals)} {token_symbol}，将卖出全部")
                amount_wei = token_balance
            print(f"执行卖出信号: 卖出 {from_wei(amount_wei, token_decimals)} {token_symbol}...")
        
        sell_func = vault.functions.executeSellSignal(
            token_address,
            amount_wei,
            min_amount_out
        )
        
        receipt = send_transaction(w3, account, sell_func)
        
        if receipt.status == 1:
            print(f"成功执行卖出信号: {token_symbol} -> 基础资产")
            return True
        else:
            print("卖出信号执行失败")
            return False
    except Exception as e:
        print(f"错误: 执行卖出信号失败 - {str(e)}")
        return False

def manage_trading_pair(w3, vault, account, token_address, max_allocation, min_exit_amount=0, disable=False):
    """添加/更新/禁用交易对"""
    try:
        # 检查是否有STRATEGY_MANAGER_ROLE权限
        strategy_role = vault.functions.STRATEGY_MANAGER_ROLE().call()
        has_role = vault.functions.hasRole(strategy_role, account).call()
        if not has_role:
            print("错误: 账户没有STRATEGY_MANAGER_ROLE权限，无法管理交易对")
            return False
        
        if disable:
            print(f"禁用交易对: {token_address}")
            disable_func = vault.functions.disableTradingPair(token_address)
            receipt = send_transaction(w3, account, disable_func)
        else:
            # 转换百分比为基点
            if isinstance(max_allocation, str) and max_allocation.endswith("%"):
                max_allocation_bps = int(float(max_allocation[:-1]) * 100)
            else:
                max_allocation_bps = int(float(max_allocation) * 100)
            
            print(f"设置交易对: {token_address}, 最大分配: {max_allocation_bps/100}%, 最小退出金额: {min_exit_amount}")
            set_pair_func = vault.functions.setTradingPair(token_address, max_allocation_bps, min_exit_amount)
            receipt = send_transaction(w3, account, set_pair_func)
        
        if receipt.status == 1:
            print("交易对设置成功")
            return True
        else:
            print("交易对设置失败")
            return False
    except Exception as e:
        print(f"错误: 管理交易对失败 - {str(e)}")
        return False

def update_price(w3, oracle, account, token_a, token_b, price):
    """更新预言机价格"""
    try:
        # 检查是否有ORACLE_ROLE权限
        oracle_role = oracle.functions.ORACLE_ROLE().call()
        has_role = oracle.functions.hasRole(oracle_role, account).call()
        if not has_role:
            print("错误: 账户没有ORACLE_ROLE权限，无法更新价格")
            return False
        
        # 价格应该是以10^18为基数
        price_wei = to_wei(price)
        
        print(f"更新价格: 1 {token_a} = {price} {token_b}")
        update_func = oracle.functions.updatePrice(token_a, token_b, price_wei)
        receipt = send_transaction(w3, account, update_func)
        
        if receipt.status == 1:
            print("价格更新成功")
            return True
        else:
            print("价格更新失败")
            return False
    except Exception as e:
        print(f"错误: 更新价格失败 - {str(e)}")
        return False


# 添加以下函数到金库操作函数部分
def mint_tokens(w3, account, token_address, amount, recipient=None):
    """铸造代币到指定地址"""
    try:
        if recipient is None:
            recipient = account
        
        # 加载代币合约
        token_abi = load_abi(BASE_PATH / "artifacts/contracts/MyToken.sol/MyToken.json")
        token = w3.eth.contract(address=normalize_address(token_address), abi=token_abi)
        
        # 获取代币信息
        token_symbol = token.functions.symbol().call()
        token_decimals = token.functions.decimals().call()
        
        # 转换金额为 wei
        amount_wei = to_wei(amount, token_decimals)
        
        print(f"尝试铸造 {amount} {token_symbol} 到地址 {recipient}...")
        
        # 检查账户是否有铸造权限
        try:
            # 检查是否是所有者
            owner = token.functions.owner().call()
            if normalize_address(account) != normalize_address(owner):
                print(f"警告: 账户 {account} 不是代币 {token_symbol} 的所有者，可能无法铸造")
        except Exception:
            print("无法检查所有权，继续尝试铸造")
        
        # 执行铸造
        mint_func = token.functions.mint(normalize_address(recipient), amount_wei)
        receipt = send_transaction(w3, account, mint_func)
        
        if receipt.status == 1:
            print(f"成功铸造 {amount} {token_symbol} 到地址 {recipient}")
            
            # 显示新余额
            balance = token.functions.balanceOf(normalize_address(recipient)).call()
            print(f"{recipient} 的 {token_symbol} 余额: {from_wei(balance, token_decimals)}")
            return True
        else:
            print("铸造失败")
            return False
        
    except Exception as e:
        print(f"错误: 铸造代币失败 - {str(e)}")
        return False


# 添加以下函数到金库操作函数部分
def transfer_tokens(w3, account, token_address, recipient, amount):
    """从当前账户转移代币到指定地址"""
    try:
        # 加载代币合约
        token_abi = load_abi(BASE_PATH / "artifacts/contracts/MyToken.sol/MyToken.json")
        token = w3.eth.contract(address=normalize_address(token_address), abi=token_abi)
        
        # 获取代币信息
        token_symbol = token.functions.symbol().call()
        token_decimals = token.functions.decimals().call()
        
        # 转换金额为 wei
        amount_wei = to_wei(amount, token_decimals)
        
        # 检查余额
        balance = token.functions.balanceOf(account).call()
        if balance < amount_wei:
            print(f"错误: 余额不足. 需要 {amount} {token_symbol}, 但只有 {from_wei(balance, token_decimals)} {token_symbol}")
            return False
        
        recipient_addr = normalize_address(recipient)
        print(f"转移 {amount} {token_symbol} 到地址 {recipient_addr}...")
        
        # 执行转账
        transfer_func = token.functions.transfer(recipient_addr, amount_wei)
        receipt = send_transaction(w3, account, transfer_func)
        
        if receipt.status == 1:
            print(f"成功转移 {amount} {token_symbol} 到地址 {recipient_addr}")
            
            # 显示新余额
            sender_balance = token.functions.balanceOf(account).call()
            recipient_balance = token.functions.balanceOf(recipient_addr).call()
            print(f"发送方 {account} 余额: {from_wei(sender_balance, token_decimals)} {token_symbol}")
            print(f"接收方 {recipient_addr} 余额: {from_wei(recipient_balance, token_decimals)} {token_symbol}")
            return True
        else:
            print("转账失败")
            return False
        
    except Exception as e:
        print(f"错误: 转移代币失败 - {str(e)}")
        return False


def manage_role(w3, vault, account, role_name, target_address, revoke=False):
    """授予或撤销角色权限"""
    try:
        # 获取角色名对应的bytes32值
        if role_name.upper() == "ORACLE":
            role = vault.functions.ORACLE_ROLE().call()
        elif role_name.upper() == "STRATEGY_MANAGER":
            role = vault.functions.STRATEGY_MANAGER_ROLE().call()
        elif role_name.upper() == "ADMIN":
            role = vault.functions.DEFAULT_ADMIN_ROLE().call()
        else:
            print(f"错误: 未知角色 '{role_name}'，请使用 ORACLE, STRATEGY_MANAGER 或 ADMIN")
            return False
        
        target = normalize_address(target_address)
        
        # 检查当前调用者是否有admin权限
        admin_role = vault.functions.DEFAULT_ADMIN_ROLE().call()
        has_admin = vault.functions.hasRole(admin_role, account).call()
        if not has_admin:
            print("错误: 账户没有 ADMIN 权限，无法管理角色")
            return False
        
        if revoke:
            print(f"撤销 {target_address} 的 {role_name} 角色...")
            role_func = vault.functions.revokeRole(role, target)
        else:
            print(f"授予 {target_address} {role_name} 角色...")
            role_func = vault.functions.grantRole(role, target)
            
        receipt = send_transaction(w3, account, role_func)
        
        if receipt.status == 1:
            action = "撤销" if revoke else "授予"
            print(f"成功{action} {role_name} 角色")
            return True
        else:
            print("角色管理操作失败")
            return False
    except Exception as e:
        print(f"错误: 管理角色失败 - {str(e)}")
        return False


def update_strategy_settings(w3, vault, account, enabled):
    """更新策略设置"""
    try:
        # 检查是否有STRATEGY_MANAGER_ROLE权限
        strategy_role = vault.functions.STRATEGY_MANAGER_ROLE().call()
        has_role = vault.functions.hasRole(strategy_role, account).call()
        if not has_role:
            print("错误: 账户没有STRATEGY_MANAGER_ROLE权限，无法更新策略设置")
            return False
        
        print(f"更新策略设置: 启用 = {enabled}")
        settings_func = vault.functions.updateStrategySettings(enabled)
        receipt = send_transaction(w3, account, settings_func)
        
        if receipt.status == 1:
            print("策略设置更新成功")
            return True
        else:
            print("策略设置更新失败")
            return False
    except Exception as e:
        print(f"错误: 更新策略设置失败 - {str(e)}")
        return False

# --- 主函数与命令行解析 ---
def main():
    parser = argparse.ArgumentParser(description="Vault 操作命令行工具")
    
    # 全局参数
    parser.add_argument("--rpc", default=DEFAULT_RPC, help=f"RPC URL (默认: {DEFAULT_RPC})")
    parser.add_argument("--vault", default=DEFAULT_VAULT_ADDRESS, help="金库合约地址")
    parser.add_argument("--account", default=DEFAULT_ACCOUNT, help="账户地址或私钥")
    
    subparsers = parser.add_subparsers(dest="command", help="子命令")
    
    # info 子命令
    info_parser = subparsers.add_parser("info", help="显示金库信息")
    
    # portfolio 子命令
    portfolio_parser = subparsers.add_parser("portfolio", help="显示当前持仓")
    
    # deposit 子命令
    deposit_parser = subparsers.add_parser("deposit", help="向金库存入资产")
    deposit_parser.add_argument("amount", help="存款金额")
    
    # withdraw 子命令
    withdraw_parser = subparsers.add_parser("withdraw", help="从金库取出资产")
    withdraw_group = withdraw_parser.add_mutually_exclusive_group(required=True)
    withdraw_group.add_argument("--amount", help="取款金额")
    withdraw_group.add_argument("--percentage", help="按百分比取款 (如 '50' 表示 50%)")
    withdraw_group.add_argument("--all", action="store_true", help="取出全部")
    
    # buy 子命令
    buy_parser = subparsers.add_parser("buy", help="执行买入信号")
    buy_parser.add_argument("token", help="目标代币地址")
    buy_parser.add_argument("amount", help="买入金额或百分比 (如 '100' 或 '30%')")
    buy_parser.add_argument("--min", default="0", help="最小获得数量 (默认为 0)")
    
    # sell 子命令
    sell_parser = subparsers.add_parser("sell", help="执行卖出信号")
    sell_parser.add_argument("token", help="卖出代币地址")
    sell_parser.add_argument("--amount", default="all", help="卖出金额或百分比 (如 '100'、'30%' 或 'all')")
    sell_parser.add_argument("--min", default="0", help="最小获得数量 (默认为 0)")
    
    # pair 子命令
    pair_parser = subparsers.add_parser("pair", help="管理交易对")
    pair_parser.add_argument("token", help="代币地址")
    pair_parser.add_argument("--max", default="30%", help="最大分配比例 (如 '30%' 或 '0.3')")
    pair_parser.add_argument("--min-exit", default="0", help="最小退出金额 (默认为 0)")
    pair_parser.add_argument("--disable", action="store_true", help="禁用交易对")
    
    # 角色管理子命令
    role_parser = subparsers.add_parser("role", help="管理金库角色")
    role_parser.add_argument("role", choices=["oracle", "strategy_manager", "admin"], help="角色名称")
    role_parser.add_argument("address", help="目标地址")
    role_parser.add_argument("--revoke", action="store_true", help="撤销而不是授予角色")

    # 策略设置子命令
    strategy_parser = subparsers.add_parser("strategy", help="更新策略设置")
    strategy_parser.add_argument("--enabled", type=bool, default=True, help="是否启用策略")
    
    # price 子命令
    price_parser = subparsers.add_parser("price", help="更新预言机价格")
    price_parser.add_argument("token_a", help="代币A地址")
    price_parser.add_argument("token_b", help="代币B地址")
    price_parser.add_argument("price", help="价格 (1个tokenA = ?个tokenB)")
    # mint 子命令
    mint_parser = subparsers.add_parser("mint", help="铸造代币")
    mint_parser.add_argument("token", help="代币地址")
    mint_parser.add_argument("amount", help="铸造数量")
    mint_parser.add_argument("--to", default=None, help="接收地址 (默认为操作账户)")

    # 添加 transfer 子命令
    transfer_parser = subparsers.add_parser("transfer", help="转移代币")
    transfer_parser.add_argument("token", help="代币地址")
    transfer_parser.add_argument("recipient", help="接收方地址")
    transfer_parser.add_argument("amount", help="转移金额")


    
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return
    
    
    # 连接到 Web3
    w3 = connect_web3(args.rpc)
    print(f"已连接到网络: {args.rpc}")
    
    # 获取账户
    account = get_account(w3, args.account)  # get_account 内部已包含规范化

    # 处理不需要 vault 的命令
    if args.command == "mint":
        token = normalize_address(args.token)
        recipient = args.to if args.to is None else normalize_address(args.to)
        mint_tokens(w3, account, token, args.amount, recipient)
        return
        
    elif args.command == "transfer":
        token = normalize_address(args.token)
        recipient = normalize_address(args.recipient)
        transfer_tokens(w3, account, token, recipient, args.amount)
        return

    # 检查金库地址是否提供（仅对需要金库的命令）
    if not args.vault:
        print("错误: 未指定金库地址. 使用 --vault 参数或设置 DEFAULT_VAULT_ADDRESS")
        return
    # 加载合约
    contracts = load_contracts(w3, args.vault)  # load_contracts 内部已包含规范化    
    vault = contracts['vault']
    asset = contracts['asset']
    oracle = contracts['oracle']
    
    # 执行子命令
    if args.command == "info":
        get_info(w3, vault, account)
    
    elif args.command == "portfolio":
        get_portfolio(w3, vault)
    
    elif args.command == "deposit":
        deposit_asset(w3, vault, asset, account, args.amount)
    
    elif args.command == "withdraw":
        if args.all:
            withdraw_asset(w3, vault, account, all_shares=True)
        elif args.percentage:
            withdraw_asset(w3, vault, account, percentage=args.percentage)
        elif args.amount:
            withdraw_asset(w3, vault, account, amount=args.amount)
    
    elif args.command == "buy":
        token = normalize_address(args.token)  # 添加规范化
        execute_buy_signal(w3, vault, account, token, args.amount, int(args.min))
    
    elif args.command == "sell":
        token = normalize_address(args.token)  # 添加规范化
        execute_sell_signal(w3, vault, account, token, args.amount, int(args.min))
    
    elif args.command == "pair":
        token = normalize_address(args.token)  # 添加规范化
        manage_trading_pair(w3, vault, account, token, args.max, int(args.min_exit), args.disable)
    
    elif args.command == "price":
        token_a = normalize_address(args.token_a)  # 添加规范化
        token_b = normalize_address(args.token_b)  # 添加规范化
        update_price(w3, oracle, account, token_a, token_b, args.price)
    # 在执行子命令的部分添加
    elif args.command == "role":
        role_name = args.role
        target = normalize_address(args.address)
        manage_role(w3, vault, account, role_name, target, args.revoke)

    elif args.command == "strategy":
        update_strategy_settings(w3, vault, account, args.enabled)
    else:
        print("错误: 未知命令")
        parser.print_help()
        return

if __name__ == "__main__":
    main()