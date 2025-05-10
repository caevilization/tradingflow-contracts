use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke_signed, instruction::Instruction};

declare_id!("8giLYWwfoBsJS93VTLcuqp8qDvBevmuvK5vYCatEiKkG");

#[program]
pub mod dex_trader {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }

    /// 通过 CPI 调用 Raydium swap
    pub fn swap_on_raydium(
        ctx: Context<SwapOnRaydium>,
        amount_in: u64,
        min_amount_out: u64,
    ) -> Result<()> {
        // 构造 Raydium swap 指令
        let ix = Instruction {
            program_id: ctx.accounts.raydium_program.key(),
            accounts: ctx.remaining_accounts.iter().map(|acc| {
                anchor_lang::solana_program::instruction::AccountMeta {
                    pubkey: acc.key(),
                    is_signer: acc.is_signer,
                    is_writable: acc.is_writable,
                }
            }).collect(),
            data: vec![], // 这里应填入 Raydium swap 指令的序列化数据，实际使用时需替换
        };
        // CPI 调用 Raydium
        invoke_signed(
            &ix,
            ctx.remaining_accounts,
            &[],
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}

/// swap_on_raydium 指令所需账户
#[derive(Accounts)]
pub struct SwapOnRaydium<'info> {
    /// Raydium 程序ID
    /// 由前端传入 Raydium 主网程序ID
    pub raydium_program: UncheckedAccount<'info>,
    // 其余账户通过 remaining_accounts 传入（如池子、用户token账户等）
}
