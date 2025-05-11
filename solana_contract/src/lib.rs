use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("FYT6Nd8Az21h31Wc7xLqeM8Ug8nkAEZnRmcrz991VNH5");

// 常量设置
const STRATEGY_SEED: &[u8] = b"strategy";
const VAULT_SEED: &[u8] = b"vault";
const BASIS_POINTS: u64 = 10000; // 百分比基数，与EVM版本保持一致

#[program]
pub mod my_vault_project {
    use super::*;

    // 修改 initialize_vault 函数中获取 bump 的方式
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        name: String,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let strategy = &mut ctx.accounts.strategy;
        
        // 设置金库基本信息
        vault.base_token_mint = ctx.accounts.base_token_mint.key();
        vault.base_token_account = ctx.accounts.vault_base_token.key();
        vault.authority = ctx.accounts.authority.key();
        vault.strategy = strategy.key(); // 使用已有的可变引用
        vault.name = name.clone();
        vault.bump = ctx.bumps.vault; // 修改这里
        
        // 设置策略初始配置
        strategy.authority = ctx.accounts.authority.key();
        strategy.vault = ctx.accounts.vault.key();
        strategy.strategy_enabled = false;
        strategy.signal_timeout = 900; // 15分钟，以秒为单位
        strategy.bump = ctx.bumps.strategy; // 修改这里
        strategy.last_signal_timestamp = 0;
        
        msg!("金库已初始化: {}", name);
        Ok(())
    }

    // 添加交易对
    pub fn set_trading_pair(
        ctx: Context<SetTradingPair>,
        max_allocation: u64,
        min_exit_amount: u64,
    ) -> Result<()> {
        require!(
            max_allocation <= BASIS_POINTS,
            MyVaultError::InvalidAllocation
        );
        
        let strategy = &mut ctx.accounts.strategy;
        let token_mint = ctx.accounts.token_mint.key();
        
        // 检查策略管理权限
        require!(
            strategy.authority == ctx.accounts.authority.key(),
            MyVaultError::Unauthorized
        );
        
        // 添加或更新交易对
        let mut found = false;
        for pair in &mut strategy.trading_pairs {
            if pair.token_mint == token_mint {
                pair.is_active = true;
                pair.max_allocation = max_allocation;
                pair.min_exit_amount = min_exit_amount;
                found = true;
                break;
            }
        }
        
        if !found {
            // 添加新的交易对
            strategy.trading_pairs.push(TradingPair {
                token_mint,
                is_active: true,
                max_allocation,
                min_exit_amount,
            });
        }
        
        msg!("交易对已设置: {}", token_mint);
        Ok(())
    }
    
    // 禁用交易对
    pub fn disable_trading_pair(
        ctx: Context<SetTradingPair>,
    ) -> Result<()> {
        let strategy = &mut ctx.accounts.strategy;
        let token_mint = ctx.accounts.token_mint.key();
        
        // 检查策略管理权限
        require!(
            strategy.authority == ctx.accounts.authority.key(),
            MyVaultError::Unauthorized
        );
        
        // 禁用交易对
        let mut found = false;
        for pair in &mut strategy.trading_pairs {
            if pair.token_mint == token_mint {
                pair.is_active = false;
                found = true;
                break;
            }
        }
        
        require!(found, MyVaultError::TradingPairNotActive);
        
        msg!("交易对已禁用: {}", token_mint);
        Ok(())
    }
    
    // 更新策略设置
    pub fn update_strategy_settings(
        ctx: Context<UpdateStrategy>,
        strategy_enabled: bool,
        signal_timeout: u64,
    ) -> Result<()> {
        let strategy = &mut ctx.accounts.strategy;
        
        // 检查策略管理权限
        require!(
            strategy.authority == ctx.accounts.authority.key(),
            MyVaultError::Unauthorized
        );
        
        // 更新策略配置
        strategy.strategy_enabled = strategy_enabled;
        strategy.signal_timeout = signal_timeout;
        
        msg!("策略设置已更新: 启用={}, 超时={}秒", strategy_enabled, signal_timeout);
        Ok(())
    }
    
    // 修改 execute_buy_signal 中的签名种子
    pub fn execute_buy_signal(
        ctx: Context<ExecuteTrade>,
        amount_to_swap: u64,
        _min_amount_out: u64,
        max_allocation_pct: u64,
        jupiter_route_data: Vec<u8>,
    ) -> Result<()> {
        let strategy = &mut ctx.accounts.strategy;
        let vault = &ctx.accounts.vault;
        let token_mint = ctx.accounts.token_mint.key();
        
        // 验证策略设置
        require!(
            strategy.strategy_enabled,
            MyVaultError::StrategyNotEnabled
        );
        
        // 验证交易对
        let trading_pair = strategy.trading_pairs
            .iter()
            .find(|p| p.token_mint == token_mint && p.is_active)
            .ok_or(MyVaultError::TradingPairNotActive)?;
        
        require!(
            max_allocation_pct <= trading_pair.max_allocation,
            MyVaultError::AllocationExceedsMaximum
        );
        
        // 获取金库中基础资产余额
        let vault_base_balance = ctx.accounts.vault_base_token.amount;
        
        // 验证交换金额不超过最大分配
        let max_allowed_amount = (vault_base_balance * max_allocation_pct) / BASIS_POINTS;
        require!(
            amount_to_swap <= max_allowed_amount,
            MyVaultError::SwapAmountExceedsAllocation
        );
        
        // 更新最后信号时间戳
        strategy.last_signal_timestamp = Clock::get()?.unix_timestamp as u64;
        
        // 发出事件
        emit!(SignalReceived {
            signal_type: SignalType::Buy,
            token_mint,
            timestamp: strategy.last_signal_timestamp,
        });
        
        // 如果交换金额为零，直接返回
        if amount_to_swap == 0 {
            return Ok(());
        }
        
        // 创建临时签名者PDA来授权转账
        let vault_seeds = [
            VAULT_SEED,
            vault.base_token_mint.as_ref(),
            &[ctx.bumps.vault_authority] // 修改这里
        ];
        
        // 从金库转移代币到Jupiter程序
        if amount_to_swap > 0 {
            // 我们从金库转移代币到我们的临时账户，然后调用Jupiter进行交换
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_base_token.to_account_info(),
                to: ctx.accounts.jupiter_user_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_signer_seeds = &[&vault_seeds[..]];
            
            let cpi_ctx = CpiContext::new_with_signer(
                cpi_program,
                cpi_accounts,
                cpi_signer_seeds,
            );
            
            token::transfer(cpi_ctx, amount_to_swap)?;
            
            // 调用Jupiter执行交换
            let jupiter_program = ctx.accounts.jupiter_program.to_account_info();
            let accounts_vec: Vec<AccountInfo> = ctx.remaining_accounts.to_vec();
            let route_instruction = anchor_lang::solana_program::instruction::Instruction {
                program_id: jupiter_program.key(),
                accounts: ctx.remaining_accounts.iter().map(|a| {
                    anchor_lang::solana_program::instruction::AccountMeta {
                        pubkey: a.key(),
                        is_signer: a.is_signer,
                        is_writable: a.is_writable,
                    }
                }).collect(),
                data: jupiter_route_data,
            };
            
            anchor_lang::solana_program::program::invoke(
                &route_instruction,
                &accounts_vec[..],
            )?;
            
            // 记录事件
            emit!(TradeExecuted {
                signal_type: SignalType::Buy,
                token_mint,
                amount: amount_to_swap,
                result: ctx.accounts.vault_token_account.amount, // 这只是近似值，后续可以使用更准确的方式
            });
        }
        
        Ok(())
    }
    
    // 执行卖出信号
    pub fn execute_sell_signal(
        ctx: Context<ExecuteTrade>,
        amount_to_sell: u64,
        min_amount_out: u64,
        jupiter_route_data: Vec<u8>,
    ) -> Result<()> {
        let strategy = &mut ctx.accounts.strategy;
        let vault = &ctx.accounts.vault;
        let token_mint = ctx.accounts.token_mint.key();
        
        // 验证策略设置
        require!(
            strategy.strategy_enabled,
            MyVaultError::StrategyNotEnabled
        );
        
        // 验证交易对
        let trading_pair = strategy.trading_pairs
            .iter()
            .find(|p| p.token_mint == token_mint && p.is_active)
            .ok_or(MyVaultError::TradingPairNotActive)?;
        
        // 获取金库中代币余额
        let token_balance = ctx.accounts.vault_token_account.amount;
        
        // 如果代币余额为零，直接返回
        if token_balance == 0 {
            return Ok(());
        }
        
        // 如果amount_to_sell为0或大于余额，则卖出全部
        let sell_amount = if amount_to_sell == 0 || amount_to_sell > token_balance {
            token_balance
        } else {
            amount_to_sell
        };
        
        // 更新最后信号时间戳
        strategy.last_signal_timestamp = Clock::get()?.unix_timestamp as u64;
        
        // 发出事件
        emit!(SignalReceived {
            signal_type: SignalType::Sell,
            token_mint,
            timestamp: strategy.last_signal_timestamp,
        });
        
        // 创建临时签名者PDA来授权转账
        let vault_seeds = [
            VAULT_SEED,
            vault.base_token_mint.as_ref(),
            &[ctx.bumps.vault_authority] // 修改这里
        ];
        
        // 从金库转移代币到Jupiter程序
        if sell_amount > 0 {
            // 我们从金库转移代币到我们的临时账户，然后调用Jupiter进行交换
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.jupiter_user_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_signer_seeds = &[&vault_seeds[..]];
            
            let cpi_ctx = CpiContext::new_with_signer(
                cpi_program,
                cpi_accounts,
                cpi_signer_seeds,
            );
            
            token::transfer(cpi_ctx, sell_amount)?;
            
            // 调用Jupiter执行交换
            let jupiter_program = ctx.accounts.jupiter_program.to_account_info();
            let accounts_vec: Vec<AccountInfo> = ctx.remaining_accounts.to_vec();
            let route_instruction = anchor_lang::solana_program::instruction::Instruction {
                program_id: jupiter_program.key(),
                accounts: ctx.remaining_accounts.iter().map(|a| {
                    anchor_lang::solana_program::instruction::AccountMeta {
                        pubkey: a.key(),
                        is_signer: a.is_signer,
                        is_writable: a.is_writable,
                    }
                }).collect(),
                data: jupiter_route_data,
            };
            
            anchor_lang::solana_program::program::invoke(
                &route_instruction,
                &accounts_vec[..],
            )?;
            
            // 记录事件
            emit!(TradeExecuted {
                signal_type: SignalType::Sell,
                token_mint,
                amount: sell_amount,
                result: ctx.accounts.vault_base_token.amount, // 这只是近似值，后续可以使用更准确的方式
            });
        }
        
        Ok(())
    }

    // 存入基础资产
    pub fn deposit(
        ctx: Context<Deposit>,
        amount: u64,
    ) -> Result<()> {
        let vault = &ctx.accounts.vault;
        
        // 检查是否是指定的投资者
        require!(
            vault.investor == ctx.accounts.authority.key(),
            MyVaultError::OnlyInvestorAllowed
        );
        
        // 计算应该铸造的份额
        let shares_to_mint = if ctx.accounts.vault_shares.supply == 0 {
            // 首次存款，1:1铸造
            amount
        } else {
            // 按比例计算份额
            let total_assets = ctx.accounts.vault_base_token.amount;
            (amount * ctx.accounts.vault_shares.supply) / total_assets
        };
        
        // 转移代币到金库
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token.to_account_info(),
            to: ctx.accounts.vault_base_token.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(
            cpi_program,
            cpi_accounts,
        );
        
        token::transfer(cpi_ctx, amount)?;
        
        // 铸造份额代币
        let vault_seeds = [
            VAULT_SEED,
            vault.base_token_mint.as_ref(),
            &[ctx.bumps.vault_authority] // 修改这里
        ];
        
        let cpi_accounts = token::MintTo {
            mint: ctx.accounts.vault_shares.to_account_info(),
            to: ctx.accounts.user_shares.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_signer_seeds = &[&vault_seeds[..]];
        
        let cpi_ctx = CpiContext::new_with_signer(
            cpi_program,
            cpi_accounts,
            cpi_signer_seeds,
        );
        
        token::mint_to(cpi_ctx, shares_to_mint)?;
        
        emit!(Deposited {
            user: ctx.accounts.authority.key(),
            amount,
            shares: shares_to_mint,
        });
        
        Ok(())
    }

    // 提取一定比例的资产
    pub fn percentage_withdraw(
        ctx: Context<Withdraw>,
        percentage: u64,
    ) -> Result<()> {
        let vault = &ctx.accounts.vault;
        
        // 检查是否是指定的投资者
        require!(
            vault.investor == ctx.accounts.authority.key(),
            MyVaultError::OnlyInvestorAllowed
        );
        
        require!(
            percentage > 0 && percentage <= BASIS_POINTS,
            MyVaultError::InvalidPercentage
        );
        
        // 计算要赎回的份额
        let total_shares = ctx.accounts.user_shares.amount;
        let shares_to_redeem = (total_shares * percentage) / BASIS_POINTS;
        
        // 如果份额为0，直接返回
        if shares_to_redeem == 0 {
            return Ok(());
        }
        
        // 计算应该提取的资产数量
        let total_assets = ctx.accounts.vault_base_token.amount;
        let assets_to_withdraw = (shares_to_redeem * total_assets) / ctx.accounts.vault_shares.supply;
        
        // 确保金库中有足够的基础资产
        // 注意：在实际实现中，这里可能需要调用一个辅助函数来出售其他代币以获取基础资产
        
        // 销毁份额代币
        let vault_seeds = [
            VAULT_SEED,
            vault.base_token_mint.as_ref(),
            &[ctx.bumps.vault_authority] // 修改这里
        ];
        
        // 先销毁份额
        let cpi_accounts = token::Burn {
            mint: ctx.accounts.vault_shares.to_account_info(),
            from: ctx.accounts.user_shares.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(
            cpi_program,
            cpi_accounts,
        );
        
        token::burn(cpi_ctx, shares_to_redeem)?;
        
        // 转移代币到用户
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_base_token.to_account_info(),
            to: ctx.accounts.user_token.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_signer_seeds = &[&vault_seeds[..]];
        
        let cpi_ctx = CpiContext::new_with_signer(
            cpi_program,
            cpi_accounts,
            cpi_signer_seeds,
        );
        
        token::transfer(cpi_ctx, assets_to_withdraw)?;
        
        emit!(Withdrawn {
            user: ctx.accounts.authority.key(),
            amount: assets_to_withdraw,
            shares: shares_to_redeem,
        });
        
        Ok(())
    }

    // 提取指定数量的资产
    pub fn partial_withdraw(
        ctx: Context<Withdraw>,
        amount: u64,
    ) -> Result<()> {
        let vault = &ctx.accounts.vault;
        
        // 检查是否是指定的投资者
        require!(
            vault.investor == ctx.accounts.authority.key(),
            MyVaultError::OnlyInvestorAllowed
        );
        
        require!(amount > 0, MyVaultError::InvalidWithdrawAmount);
        
        // 计算应该销毁的份额
        let total_assets = ctx.accounts.vault_base_token.amount;
        let shares_to_burn = (amount * ctx.accounts.vault_shares.supply) / total_assets;
        
        // 确保用户有足够的份额
        require!(
            shares_to_burn <= ctx.accounts.user_shares.amount,
            MyVaultError::InsufficientShares
        );
        
        // 确保金库中有足够的基础资产
        require!(
            amount <= ctx.accounts.vault_base_token.amount,
            MyVaultError::InsufficientVaultBalance
        );
        
        // 销毁份额代币
        let vault_seeds = [
            VAULT_SEED,
            vault.base_token_mint.as_ref(),
            &[ctx.bumps.vault_authority] // 修改这里
        ];
        
        // 先销毁份额
        let cpi_accounts = token::Burn {
            mint: ctx.accounts.vault_shares.to_account_info(),
            from: ctx.accounts.user_shares.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(
            cpi_program,
            cpi_accounts,
        );
        
        token::burn(cpi_ctx, shares_to_burn)?;
        
        // 转移代币到用户
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_base_token.to_account_info(),
            to: ctx.accounts.user_token.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_signer_seeds = &[&vault_seeds[..]];
        
        let cpi_ctx = CpiContext::new_with_signer(
            cpi_program,
            cpi_accounts,
            cpi_signer_seeds,
        );
        
        token::transfer(cpi_ctx, amount)?;
        
        emit!(Withdrawn {
            user: ctx.accounts.authority.key(),
            amount,
            shares: shares_to_burn,
        });
        
        Ok(())
    }
    
    // 更新投资者
    pub fn update_investor(
        ctx: Context<UpdateInvestor>,
        new_investor: Pubkey,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        
        // 检查是否是金库管理员
        require!(
            vault.authority == ctx.accounts.authority.key(),
            MyVaultError::Unauthorized
        );
        
        // 更新投资者
        vault.investor = new_investor;
        
        msg!("投资者已更新为: {}", new_investor);
        Ok(())
    }
}

// 交易信号类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SignalType {
    Buy,
    Sell,
}

// 交易对定义
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct TradingPair {
    pub token_mint: Pubkey,
    pub is_active: bool,
    pub max_allocation: u64,
    pub min_exit_amount: u64,
}

// Jupiter路由数据
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct JupiterRouteData {
    pub token_mint: Pubkey,
    pub jupiter_user_account: Pubkey,
    pub route_data: Vec<u8>,
}

// 事件定义
#[event]
pub struct SignalReceived {
    pub signal_type: SignalType,
    pub token_mint: Pubkey,
    pub timestamp: u64,
}

#[event]
pub struct TradeExecuted {
    pub signal_type: SignalType,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub result: u64,
}

#[event]
pub struct Deposited {
    pub user: Pubkey,
    pub amount: u64,
    pub shares: u64,
}

#[event]
pub struct Withdrawn {
    pub user: Pubkey,
    pub amount: u64,
    pub shares: u64,
}

// 错误代码
#[error_code]
pub enum MyVaultError {
    #[msg("未授权操作")]
    Unauthorized,
    
    #[msg("策略未启用")]
    StrategyNotEnabled,
    
    #[msg("交易对未激活")]
    TradingPairNotActive,
    
    #[msg("分配超过最大限制")]
    AllocationExceedsMaximum,
    
    #[msg("交换金额超过分配")]
    SwapAmountExceedsAllocation,
    
    #[msg("无效的分配百分比")]
    InvalidAllocation,
    
    #[msg("无效的百分比值")]
    InvalidPercentage,
    
    #[msg("份额不足")]
    InsufficientShares,
    
    #[msg("金库余额不足")]
    InsufficientVaultBalance,
    
    #[msg("只有指定投资者可以操作")]
    OnlyInvestorAllowed,
    
    #[msg("找不到账户")]
    AccountNotFound,
    
    #[msg("无法提取0数量的资产")]
    InvalidWithdrawAmount,
}

// 金库账户结构
#[account]
#[derive(Default)]
pub struct Vault {
    pub base_token_mint: Pubkey,     // 基础代币铸币厂
    pub base_token_account: Pubkey,  // 基础代币账户
    pub authority: Pubkey,           // 管理员
    pub strategy: Pubkey,            // 策略账户
    pub name: String,                // 金库名称
    pub investor: Pubkey,            // 投资者
    pub bump: u8,                    // PDA bump
}

// 策略账户结构
#[account]
pub struct Strategy {
    pub authority: Pubkey,                 // 管理员
    pub vault: Pubkey,                     // 关联的金库
    pub strategy_enabled: bool,            // 策略是否启用
    pub signal_timeout: u64,               // 信号超时时间(秒)
    pub last_signal_timestamp: u64,        // 最后信号时间戳
    pub trading_pairs: Vec<TradingPair>,   // 交易对列表
    pub bump: u8,                          // PDA bump
}

// 初始化金库指令
#[derive(Accounts)]
#[instruction(name: String)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 32 + 32 + 4 + name.len() + 32 + 1,
        seeds = [VAULT_SEED, base_token_mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 1 + 8 + 8 + 4 + (32 + 1 + 8 + 8) * 10 + 1, // 预留10个交易对空间
        seeds = [STRATEGY_SEED, vault.key().as_ref()],
        bump
    )]
    pub strategy: Account<'info, Strategy>,
    
    pub base_token_mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = authority,
        token::mint = base_token_mint,
        token::authority = vault_authority,
        seeds = ["base_token".as_bytes(), vault.key().as_ref()],
        bump
    )]
    pub vault_base_token: Account<'info, TokenAccount>,
    
    /// CHECK: PDA作为金库权限
    #[account(
        seeds = [VAULT_SEED, base_token_mint.key().as_ref()],
        bump
    )]
    pub vault_authority: AccountInfo<'info>,
    
    #[account(
        init,
        payer = authority,
        mint::decimals = base_token_mint.decimals,
        mint::authority = vault_authority,
        seeds = ["shares".as_bytes(), vault.key().as_ref()],
        bump
    )]
    pub vault_shares: Account<'info, Mint>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// 设置交易对指令
#[derive(Accounts)]
pub struct SetTradingPair<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub strategy: Account<'info, Strategy>,
    
    pub token_mint: Account<'info, Mint>,
    
    pub vault: Account<'info, Vault>,
}

// 更新策略设置指令
#[derive(Accounts)]
pub struct UpdateStrategy<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub strategy: Account<'info, Strategy>,
    
    pub vault: Account<'info, Vault>,
}

// 执行交易指令
#[derive(Accounts)]
pub struct ExecuteTrade<'info> {
    #[account(mut)]
    pub oracle: Signer<'info>,
    
    #[account(mut)]
    pub strategy: Account<'info, Strategy>,
    
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    
    #[account(mut)]
    pub vault_base_token: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    
    /// CHECK: 交易中使用的PDA
    #[account(
        seeds = [VAULT_SEED, vault.base_token_mint.as_ref()],
        bump
    )]
    pub vault_authority: AccountInfo<'info>,
    
    pub token_mint: Account<'info, Mint>,
    
    /// CHECK: Jupiter会处理此账户
    #[account(mut)]
    pub jupiter_user_token_account: AccountInfo<'info>,
    
    /// CHECK: Jupiter程序
    #[account(mut)]
    pub jupiter_program: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    
    // 其余账户将作为剩余账户传递给Jupiter
}

// 紧急退出指令
#[derive(Accounts)]
pub struct EmergencyExit<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    
    /// CHECK: 交易中使用的PDA
    #[account(
        seeds = [VAULT_SEED, vault.base_token_mint.as_ref()],
        bump
    )]
    pub vault_authority: AccountInfo<'info>,
    
    /// CHECK: Jupiter程序
    #[account(mut)]
    pub jupiter_program: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    
    // 其余账户将作为剩余账户传递
}

// 存款指令
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    
    #[account(mut)]
    pub vault_base_token: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub vault_shares: Account<'info, Mint>,
    
    /// CHECK: 交易中使用的PDA
    #[account(
        seeds = [VAULT_SEED, vault.base_token_mint.as_ref()],
        bump
    )]
    pub vault_authority: AccountInfo<'info>,
    
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub user_shares: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// 提款指令
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    
    #[account(mut)]
    pub vault_base_token: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub vault_shares: Account<'info, Mint>,
    
    /// CHECK: 交易中使用的PDA
    #[account(
        seeds = [VAULT_SEED, vault.base_token_mint.as_ref()],
        bump
    )]
    pub vault_authority: AccountInfo<'info>,
    
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub user_shares: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// 更新投资者指令
#[derive(Accounts)]
pub struct UpdateInvestor<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    
    pub system_program: Program<'info, System>,
}