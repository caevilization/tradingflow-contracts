use anchor_lang::prelude::*;
use anchor_lang::solana_program;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("7nsTEo39qMPazWxfPSezWSRMBJ7wTF52dB7JgG3t2X1T");

// Constants
const STRATEGY_SEED: &[u8] = b"strategy";
const VAULT_SEED: &[u8] = b"vault";
const BASIS_POINTS: u64 = 10000; // Percentage base, consistent with EVM version

#[program]
pub mod solana_contract {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }

    // Modify the way to get bump in initialize_vault function
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        name: String,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let strategy = &mut ctx.accounts.strategy;
        
        // Set vault basic information
        vault.base_token_mint = ctx.accounts.base_token_mint.key();
        vault.base_token_account = ctx.accounts.vault_base_token.key();
        vault.authority = ctx.accounts.authority.key();
        vault.strategy = strategy.key();
        vault.name = name.clone();
        vault.bump = ctx.bumps.vault;
        
        // Set initial strategy configuration
        strategy.authority = ctx.accounts.authority.key();
        strategy.vault = ctx.accounts.vault.key();
        strategy.strategy_enabled = false;
        strategy.signal_timeout = 900; // 15 minutes, in seconds
        strategy.bump = ctx.bumps.strategy;
        strategy.last_signal_timestamp = 0;
        
        msg!("Vault initialized: {}", name);
        Ok(())
    }

    // Add trading pair
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
        
        // Check strategy management permission
        require!(
            strategy.authority == ctx.accounts.authority.key(),
            MyVaultError::Unauthorized
        );
        
        // Add or update trading pair
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
            // Add new trading pair
            strategy.trading_pairs.push(TradingPair {
                token_mint,
                is_active: true,
                max_allocation,
                min_exit_amount,
            });
        }
        
        msg!("Trading pair set: {}", token_mint);
        Ok(())
    }
    
    // Disable trading pair
    pub fn disable_trading_pair(
        ctx: Context<SetTradingPair>,
    ) -> Result<()> {
        let strategy = &mut ctx.accounts.strategy;
        let token_mint = ctx.accounts.token_mint.key();
        
        // Check strategy management permission
        require!(
            strategy.authority == ctx.accounts.authority.key(),
            MyVaultError::Unauthorized
        );
        
        // Disable trading pair
        let mut found = false;
        for pair in &mut strategy.trading_pairs {
            if pair.token_mint == token_mint {
                pair.is_active = false;
                found = true;
                break;
            }
        }
        
        require!(found, MyVaultError::TradingPairNotActive);
        
        msg!("Trading pair disabled: {}", token_mint);
        Ok(())
    }
    
    // Update strategy settings
    pub fn update_strategy_settings(
        ctx: Context<UpdateStrategy>,
        strategy_enabled: bool,
        signal_timeout: u64,
    ) -> Result<()> {
        let strategy = &mut ctx.accounts.strategy;
        
        // Check strategy management permission
        require!(
            strategy.authority == ctx.accounts.authority.key(),
            MyVaultError::Unauthorized
        );
        
        // Update strategy configuration
        strategy.strategy_enabled = strategy_enabled;
        strategy.signal_timeout = signal_timeout;
        
        msg!("Strategy settings updated: Enabled={}, Timeout={} seconds", strategy_enabled, signal_timeout);
        Ok(())
    }
    
    // Modify execute_buy_signal function
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
        
        // Verify strategy settings
        require!(
            strategy.strategy_enabled,
            MyVaultError::StrategyNotEnabled
        );
        
        // Verify trading pair
        let trading_pair = strategy.trading_pairs
            .iter()
            .find(|p| p.token_mint == token_mint && p.is_active)
            .ok_or(MyVaultError::TradingPairNotActive)?;
        
        require!(
            max_allocation_pct <= trading_pair.max_allocation,
            MyVaultError::AllocationExceedsMaximum
        );
        
        // Get vault base balance
        let vault_base_balance = ctx.accounts.vault_base_token.amount;
        
        // Verify swap amount does not exceed allocation
        let max_allowed_amount = (vault_base_balance * max_allocation_pct) / BASIS_POINTS;
        require!(
            amount_to_swap <= max_allowed_amount,
            MyVaultError::SwapAmountExceedsAllocation
        );
        
        // Update last signal timestamp
        strategy.last_signal_timestamp = Clock::get()?.unix_timestamp as u64;
        
        // Emit event
        emit!(SignalReceived {
            signal_type: SignalType::Buy,
            token_mint,
            timestamp: strategy.last_signal_timestamp,
        });
        
        // If swap amount is zero, return immediately
        if amount_to_swap == 0 {
            return Ok(());
        }
        
        // Create temporary signer PDA to authorize transfer
        let vault_authority_seeds = &[
            VAULT_SEED,
            vault.base_token_mint.as_ref(),
            &[ctx.bumps.vault_authority],
        ];
        
        // Transfer tokens from vault to Jupiter program
        if amount_to_swap > 0 {
            // We transfer tokens from vault to our temporary account, then call Jupiter for swap
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_base_token.to_account_info(),
                to: ctx.accounts.jupiter_user_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_signer_seeds = &[&vault_authority_seeds[..]];
            
            let cpi_ctx = CpiContext::new_with_signer(
                cpi_program,
                cpi_accounts,
                cpi_signer_seeds,
            );
            
            token::transfer(cpi_ctx, amount_to_swap)?;
            
            // Call Jupiter to execute swap
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
            
            // Record event
            emit!(TradeExecuted {
                signal_type: SignalType::Buy,
                token_mint,
                amount: amount_to_swap,
                result: ctx.accounts.vault_token_account.amount, // This is an approximation, subsequent use can use a more accurate method
            });
        }
        
        Ok(())
    }
    
    // Execute sell signal
    pub fn execute_sell_signal(
        ctx: Context<ExecuteTrade>,
        amount_to_sell: u64,
        min_amount_out: u64,
        jupiter_route_data: Vec<u8>,
    ) -> Result<()> {
        let strategy = &mut ctx.accounts.strategy;
        let vault = &ctx.accounts.vault;
        let token_mint = ctx.accounts.token_mint.key();
        
        // Verify strategy settings
        require!(
            strategy.strategy_enabled,
            MyVaultError::StrategyNotEnabled
        );
        
        // Verify trading pair
        let trading_pair = strategy.trading_pairs
            .iter()
            .find(|p| p.token_mint == token_mint && p.is_active)
            .ok_or(MyVaultError::TradingPairNotActive)?;
        
        // Get token balance in vault
        let token_balance = ctx.accounts.vault_token_account.amount;
        
        // If token balance is zero, return immediately
        if token_balance == 0 {
            return Ok(());
        }
        
        // If amount_to_sell is 0 or greater than balance, sell all
        let sell_amount = if amount_to_sell == 0 || amount_to_sell > token_balance {
            token_balance
        } else {
            amount_to_sell
        };
        
        // Update last signal timestamp
        strategy.last_signal_timestamp = Clock::get()?.unix_timestamp as u64;
        
        // Emit event
        emit!(SignalReceived {
            signal_type: SignalType::Sell,
            token_mint,
            timestamp: strategy.last_signal_timestamp,
        });
        
        // Create temporary signer PDA to authorize transfer
        let vault_authority_seeds = &[
            VAULT_SEED,
            vault.base_token_mint.as_ref(),
            &[ctx.bumps.vault_authority],
        ];
        
        // Transfer tokens from vault to Jupiter program
        if sell_amount > 0 {
            // We transfer tokens from vault to our temporary account, then call Jupiter for swap
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.jupiter_user_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_signer_seeds = &[&vault_authority_seeds[..]];
            
            let cpi_ctx = CpiContext::new_with_signer(
                cpi_program,
                cpi_accounts,
                cpi_signer_seeds,
            );
            
            token::transfer(cpi_ctx, sell_amount)?;
            
            // Call Jupiter to execute swap
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
            
            // Record event
            emit!(TradeExecuted {
                signal_type: SignalType::Sell,
                token_mint,
                amount: sell_amount,
                result: ctx.accounts.vault_base_token.amount, // This is an approximation, subsequent use can use a more accurate method
            });
        }
        
        Ok(())
    }

    // Deposit base assets
    pub fn deposit(
        ctx: Context<Deposit>,
        amount: u64,
    ) -> Result<()> {
        let vault = &ctx.accounts.vault;
        
        // Check if it's specified investor
        require!(
            vault.investor == ctx.accounts.authority.key(),
            MyVaultError::OnlyInvestorAllowed
        );
        
        // Calculate shares to mint
        let shares_to_mint = if ctx.accounts.vault_shares.supply == 0 {
            // First deposit, 1:1 mint
            amount
        } else {
            // Calculate shares proportionally
            let total_assets = ctx.accounts.vault_base_token.amount;
            (amount * ctx.accounts.vault_shares.supply) / total_assets
        };
        
        // Transfer tokens to vault
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
        
        // Mint shares tokens
        let vault_authority_seeds = &[
            VAULT_SEED,
            vault.base_token_mint.as_ref(),
            &[ctx.bumps.vault_authority],
        ];
        
        let cpi_accounts = token::MintTo {
            mint: ctx.accounts.vault_shares.to_account_info(),
            to: ctx.accounts.user_shares.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_signer_seeds = &[&vault_authority_seeds[..]];
        
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

    // Withdraw a certain percentage of assets
    pub fn percentage_withdraw(
        ctx: Context<Withdraw>,
        percentage: u64,
    ) -> Result<()> {
        let vault = &ctx.accounts.vault;
        
        // Check if it's specified investor
        require!(
            vault.investor == ctx.accounts.authority.key(),
            MyVaultError::OnlyInvestorAllowed
        );
        
        require!(
            percentage > 0 && percentage <= BASIS_POINTS,
            MyVaultError::InvalidPercentage
        );
        
        // Calculate shares to redeem
        let total_shares = ctx.accounts.user_shares.amount;
        let shares_to_redeem = (total_shares * percentage) / BASIS_POINTS;
        
        // If shares are 0, return immediately
        if shares_to_redeem == 0 {
            return Ok(());
        }
        
        // Calculate assets to withdraw
        let total_assets = ctx.accounts.vault_base_token.amount;
        let assets_to_withdraw = (shares_to_redeem * total_assets) / ctx.accounts.vault_shares.supply;
        
        // Ensure vault has enough base assets
        // Note: In actual implementation, this may need to call an auxiliary function to sell other tokens to get base assets
        
        // Burn shares tokens
        let vault_authority_seeds = &[
            VAULT_SEED,
            vault.base_token_mint.as_ref(),
            &[ctx.bumps.vault_authority],
        ];
        
        // First burn shares
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
        
        // Transfer assets to user
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_base_token.to_account_info(),
            to: ctx.accounts.user_token.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_signer_seeds = &[&vault_authority_seeds[..]];
        
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

    // Withdraw a specified amount of assets
    pub fn partial_withdraw(
        ctx: Context<Withdraw>,
        amount: u64,
    ) -> Result<()> {
        let vault = &ctx.accounts.vault;
        
        // Check if it's specified investor
        require!(
            vault.investor == ctx.accounts.authority.key(),
            MyVaultError::OnlyInvestorAllowed
        );
        
        require!(amount > 0, MyVaultError::InvalidWithdrawAmount);
        
        // Calculate shares to burn
        let total_assets = ctx.accounts.vault_base_token.amount;
        let shares_to_burn = (amount * ctx.accounts.vault_shares.supply) / total_assets;
        
        // Ensure user has enough shares
        require!(
            shares_to_burn <= ctx.accounts.user_shares.amount,
            MyVaultError::InsufficientShares
        );
        
        // Ensure vault has enough base assets
        require!(
            amount <= ctx.accounts.vault_base_token.amount,
            MyVaultError::InsufficientVaultBalance
        );
        
        // Burn shares tokens
        let vault_authority_seeds = &[
            VAULT_SEED,
            vault.base_token_mint.as_ref(),
            &[ctx.bumps.vault_authority],
        ];
        
        // First burn shares
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
        
        // Transfer assets to user
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_base_token.to_account_info(),
            to: ctx.accounts.user_token.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_signer_seeds = &[&vault_authority_seeds[..]];
        
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
    
    // Update investor
    pub fn update_investor(
        ctx: Context<UpdateInvestor>,
        new_investor: Pubkey,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        
        // Check if it's vault admin
        require!(
            vault.authority == ctx.accounts.authority.key(),
            MyVaultError::Unauthorized
        );
        
        // Update investor
        vault.investor = new_investor;
        
        msg!("Investor updated to: {}", new_investor);
        Ok(())
    }
}

// Trading signal type
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SignalType {
    Buy,
    Sell,
}

// Trading pair definition
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct TradingPair {
    pub token_mint: Pubkey,
    pub is_active: bool,
    pub max_allocation: u64,
    pub min_exit_amount: u64,
}

// Jupiter route data
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct JupiterRouteData {
    pub token_mint: Pubkey,
    pub jupiter_user_account: Pubkey,
    pub route_data: Vec<u8>,
}

// Event definition
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

// Error code
#[error_code]
pub enum MyVaultError {
    #[msg("Unauthorized operation")]
    Unauthorized,
    
    #[msg("Strategy not enabled")]
    StrategyNotEnabled,
    
    #[msg("Trading pair not active")]
    TradingPairNotActive,
    
    #[msg("Allocation exceeds maximum")]
    AllocationExceedsMaximum,
    
    #[msg("Swap amount exceeds allocation")]
    SwapAmountExceedsAllocation,
    
    #[msg("Invalid allocation percentage")]
    InvalidAllocation,
    
    #[msg("Invalid percentage value")]
    InvalidPercentage,
    
    #[msg("Insufficient shares")]
    InsufficientShares,
    
    #[msg("Insufficient vault balance")]
    InsufficientVaultBalance,
    
    #[msg("Only specified investor can operate")]
    OnlyInvestorAllowed,
    
    #[msg("Account not found")]
    AccountNotFound,
    
    #[msg("Cannot withdraw 0 amount of assets")]
    InvalidWithdrawAmount,
}

// Vault account structure
#[account]
#[derive(Default)]
pub struct Vault {
    pub base_token_mint: Pubkey,     // Base token mint
    pub base_token_account: Pubkey,  // Base token account
    pub authority: Pubkey,           // Admin
    pub strategy: Pubkey,            // Strategy account
    pub name: String,                // Vault name
    pub investor: Pubkey,            // Investor
    pub bump: u8,                    // PDA bump
}

// Strategy account structure
#[account]
pub struct Strategy {
    pub authority: Pubkey,                 // Admin
    pub vault: Pubkey,                     // Associated vault
    pub strategy_enabled: bool,            // Strategy enabled
    pub signal_timeout: u64,               // Signal timeout (seconds)
    pub last_signal_timestamp: u64,        // Last signal timestamp
    pub trading_pairs: Vec<TradingPair>,   // Trading pair list
    pub bump: u8,                          // PDA bump
}

// Initialize vault instruction
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
        space = 8 + 32 + 32 + 1 + 8 + 8 + 4 + (32 + 1 + 8 + 8) * 5 + 1, // Reduce to 5 trading pair spaces
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
    
    /// CHECK: PDA as vault authority
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

// Set trading pair instruction
#[derive(Accounts)]
pub struct SetTradingPair<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub strategy: Account<'info, Strategy>,
    
    pub token_mint: Account<'info, Mint>,
    
    pub vault: Account<'info, Vault>,
}

// Update strategy settings instruction
#[derive(Accounts)]
pub struct UpdateStrategy<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub strategy: Account<'info, Strategy>,
    
    pub vault: Account<'info, Vault>,
}

// Execute trade instruction
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
    
    /// CHECK: PDA used in transaction
    #[account(
        seeds = [VAULT_SEED, vault.base_token_mint.as_ref()],
        bump
    )]
    pub vault_authority: AccountInfo<'info>,
    
    pub token_mint: Account<'info, Mint>,
    
    /// CHECK: Jupiter will handle this account
    #[account(mut)]
    pub jupiter_user_token_account: AccountInfo<'info>,
    
    /// CHECK: Jupiter program
    #[account(mut)]
    pub jupiter_program: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    
    // Remaining accounts will be passed as remaining accounts to Jupiter
}

// Emergency exit instruction
#[derive(Accounts)]
pub struct EmergencyExit<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    
    /// CHECK: PDA used in transaction
    #[account(
        seeds = [VAULT_SEED, vault.base_token_mint.as_ref()],
        bump
    )]
    pub vault_authority: AccountInfo<'info>,
    
    /// CHECK: Jupiter program
    #[account(mut)]
    pub jupiter_program: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    
    // Remaining accounts will be passed as remaining accounts
}

// Deposit instruction
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
    
    /// CHECK: PDA used in transaction
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

// Withdraw instruction
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
    
    /// CHECK: PDA used in transaction
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

// Update investor instruction
#[derive(Accounts)]
pub struct UpdateInvestor<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Initialize {}