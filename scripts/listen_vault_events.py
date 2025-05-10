import asyncio
import json
from pathlib import Path
from web3 import Web3

# --- 配置 ---
NODE_URL = 'http://127.0.0.1:8545'  # 本地节点地址
# !!! 重要：请将下方地址替换为您部署的 OracleGuidedVault 合约地址 !!!
VAULT_CONTRACT_ADDRESS = "0x934A389CaBFB84cdB3f0260B2a4FD575b8B345A3" 
BASE_PATH = Path(__file__).parent.parent
VAULT_ABI_PATH = BASE_PATH / "artifacts/contracts/UniswapVault_bak.sol/OracleGuidedVault.json"
POLL_INTERVAL = 2  # 每隔多少秒检查一次新事件

# --- 辅助函数 ---
def load_abi(path):
    try:
        with open(path) as f:
            return json.load(f)["abi"]
    except FileNotFoundError:
        print(f"错误：找不到 ABI 文件：{path}")
        exit(1)
    except json.JSONDecodeError:
        print(f"错误：无法解析 ABI 文件：{path}")
        exit(1)
    except KeyError:
        print(f"错误：ABI 文件格式不正确（缺少 'abi' 键）：{path}")
        exit(1)

# --- 连接 Web3 ---
w3 = Web3(Web3.HTTPProvider(NODE_URL))
if not w3.is_connected():
    print(f"错误：无法连接到节点 {NODE_URL}")
    exit(1)

print(f"已连接到节点: {NODE_URL}")

# --- 加载合约 ---
VAULT_ABI = load_abi(VAULT_ABI_PATH)
try:
    # 检查地址是否有效
    checksum_address = Web3.to_checksum_address(VAULT_CONTRACT_ADDRESS)
    vault_contract = w3.eth.contract(address=checksum_address, abi=VAULT_ABI)
    print(f"监听合约地址: {checksum_address}")
except ValueError:
    print(f"错误：提供的合约地址 '{VAULT_CONTRACT_ADDRESS}' 无效。请确保替换了占位符。")
    exit(1)

# --- 事件处理函数 ---
def handle_event(event, event_name):
    """处理并打印事件日志"""
    print(f"\n--- 收到事件: {event_name} ---")
    print(f"  交易哈希: {event.transactionHash.hex()}")
    print(f"  区块号: {event.blockNumber}")
    print("  事件参数:")
    for key, value in event.args.items():
        # 对地址和枚举类型进行特殊处理以提高可读性
        if isinstance(value, str) and value.startswith('0x'):
             print(f"    {key}: {value}") # 保持地址格式
        elif event_name == 'SignalReceived' and key == 'signalType':
             signal_type = "BUY" if value == 0 else "SELL"
             print(f"    {key}: {signal_type} ({value})")
        elif event_name == 'TradeExecuted' and key == 'signalType':
             signal_type = "BUY" if value == 0 else "SELL"
             print(f"    {key}: {signal_type} ({value})")
        elif isinstance(value, int):
             # 尝试将大数字转换为 ether (假设是 18 位小数)
             try:
                 # 避免转换非常小的数字或非金额值
                 if value > 10**6: # 仅转换大于 1 million wei 的值
                     print(f"    {key}: {Web3.from_wei(value, 'ether')} (wei: {value})")
                 else:
                     print(f"    {key}: {value}")
             except:
                 print(f"    {key}: {value}") # 如果转换失败，打印原始值
        else:
            print(f"    {key}: {value}")
    print("--------------------------")

async def log_loop(event_filter, poll_interval, event_name):
    """异步轮询指定事件过滤器的新条目"""
    print(f"开始监听 {event_name} 事件...")
    while True:
        try:
            for event_log in event_filter.get_new_entries():
                # 将日志数据解码为更易读的事件对象
                try:
                    # 尝试使用合约对象解码日志
                    decoded_event = vault_contract.events[event_name]().process_log(event_log)
                    handle_event(decoded_event, event_name)
                except Exception as decode_error:
                    # 如果解码失败，直接打印原始日志
                    print(f"\n--- 收到未解码的 {event_name} 事件 ---")
                    print(f"原始数据: {event_log}")
                    print(f"解码错误: {decode_error}")
            await asyncio.sleep(poll_interval)
        except Exception as e:
            print(f"监听 {event_name} 事件时发生错误: {e}")
            await asyncio.sleep(poll_interval * 5)

# 修改主函数中创建过滤器的部分
async def main():
    print("创建事件过滤器 (从最新区块开始)...")
    
    # 为合约中定义的所有事件创建过滤器
    # 注意：ERC4626 的 Deposit 和 Withdraw 事件也包含在内
    event_filters = {}
    event_names = []
    
    # 获取当前最新区块号
    latest_block = w3.eth.block_number
    print(f"当前最新区块号: {latest_block}")

    # 从 ABI 中提取所有事件定义
    for item in VAULT_ABI:
        if item.get("type") == "event":
            event_name = item.get("name")
            if event_name:
                event_names.append(event_name)
                try:
                    # 使用不同的方法创建过滤器
                    event = getattr(vault_contract.events, event_name)
                    event_filter = w3.eth.filter({
                        'fromBlock': latest_block,
                        'toBlock': 'latest',
                        'address': vault_contract.address,
                        'topics': [event.build_filter().topics[0]]
                    })
                    event_filters[event_name] = event_filter
                    print(f" - 已创建 {event_name} 过滤器")
                except AttributeError:
                    print(f"警告：无法为 ABI 中定义的事件 '{event_name}' 创建过滤器。")
                except Exception as e:
                    print(f"创建 {event_name} 过滤器时出错: {e}")


    if not event_filters:
        print("错误：未能为任何事件创建过滤器。请检查 ABI 和合约地址。")
        return

    # 为每个事件过滤器启动一个监听任务
    tasks = [
        log_loop(event_filters[name], POLL_INTERVAL, name)
        for name in event_filters # 只为成功创建的过滤器启动任务
    ]

    print(f"\n开始监听 {len(tasks)} 个事件类型。按 Ctrl+C 停止。")
    # 并发运行所有监听任务
    await asyncio.gather(*tasks)

if __name__ == "__main__":
    # 检查是否设置了合约地址
    if "YOUR_VAULT_CONTRACT_ADDRESS" in VAULT_CONTRACT_ADDRESS:
        print("错误：请在脚本中替换 'YOUR_VAULT_CONTRACT_ADDRESS' 为实际的合约地址。")
    else:
        try:
            asyncio.run(main())
        except KeyboardInterrupt:
            print("\n脚本已停止。")