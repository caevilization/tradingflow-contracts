use {
    solana_client::rpc_client::RpcClient,
    solana_sdk::{
        commitment_config::CommitmentConfig,
        pubkey::Pubkey,
        signature::{Keypair, read_keypair_file, Signer},
        transaction::Transaction,
        system_program,
    },
    std::str::FromStr,
    std::env,
};

mod orca_swap;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 连接到 devnet
    let rpc_url = "https://api.devnet.solana.com";
    let client = RpcClient::new_with_commitment(
        rpc_url.to_string(),
        CommitmentConfig::confirmed(),
    );

    // 从环境变量获取钱包路径，如果没有则使用默认路径
    let keypair_path = env::var("SOLANA_KEYPAIR_PATH")
        .unwrap_or_else(|_| "~/.config/solana/id.json".to_string());
    
    println!("正在加载钱包: {}", keypair_path);
    
    // 加载钱包
    let payer = read_keypair_file(&keypair_path)?;
    println!("钱包地址: {}", payer.pubkey());

    // 检查钱包余额
    let balance = client.get_balance(&payer.pubkey())?;
    println!("钱包余额: {} SOL", balance as f64 / 1e9);

    // 示例：SOL -> USDC swap
    let sol_mint = Pubkey::from_str("So11111111111111111111111111111111111111112")?;
    let usdc_mint = Pubkey::from_str("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")?;

    // 这里需要填入实际的 whirlpool 地址和 token vault 地址
    let whirlpool = Pubkey::from_str("YOUR_WHIRLPOOL_ADDRESS")?;
    let token_vault_a = Pubkey::from_str("YOUR_TOKEN_VAULT_A_ADDRESS")?;
    let token_vault_b = Pubkey::from_str("YOUR_TOKEN_VAULT_B_ADDRESS")?;

    println!("\n准备执行 SOL -> USDC swap");
    println!("请确保已经创建了相应的 token 账户并持有足够的代币");
    println!("SOL Mint: {}", sol_mint);
    println!("USDC Mint: {}", usdc_mint);
    println!("Whirlpool: {}", whirlpool);

    // 实际使用时，需要：
    // 1. 获取用户的 token 账户地址
    // 2. 构造 swap 参数
    // 3. 调用 OrcaSwap::swap 函数

    Ok(())
}