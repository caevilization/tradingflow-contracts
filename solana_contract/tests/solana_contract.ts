import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaContract } from "../target/types/solana_contract";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, getAssociatedTokenAddress, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("solana_contract", () => {
  console.log("开始测试...");
  
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  console.log("Provider 设置完成");

  const program = anchor.workspace.SolanaContract as Program<SolanaContract>;
  console.log("程序 ID:", program.programId.toString());
  
  // 测试账户
  const authority = Keypair.generate();
  const investor = Keypair.generate();
  console.log("测试账户创建完成");
  console.log("Authority:", authority.publicKey.toString());
  console.log("Investor:", investor.publicKey.toString());
  
  let baseTokenMint: PublicKey;
  let vaultBaseToken: PublicKey;
  let vaultShares: PublicKey;
  let vault: PublicKey;
  let strategy: PublicKey;
  let vaultAuthority: PublicKey;
  let userTokenAccount: PublicKey;
  let userSharesAccount: PublicKey;

  before(async () => {
    console.log("开始创建基础代币...");
    // 创建基础代币
    baseTokenMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      9
    );
    console.log("基础代币创建完成:", baseTokenMint.toString());

    // 创建用户代币账户
    userTokenAccount = await getAssociatedTokenAddress(
      baseTokenMint,
      investor.publicKey
    );
    await createAccount(
      provider.connection,
      authority,
      baseTokenMint,
      investor.publicKey
    );
  });

  it("初始化金库", async () => {
    console.log("开始初始化金库...");
    // 创建金库
    [vault] = await PublicKey.findProgramAddress(
      [Buffer.from("vault"), baseTokenMint.toBuffer()],
      program.programId
    );
    console.log("金库地址:", vault.toString());
    
    // 创建策略账户
    [strategy] = await PublicKey.findProgramAddress(
      [Buffer.from("strategy"), vault.toBuffer()],
      program.programId
    );
    console.log("策略账户地址:", strategy.toString());

    // 创建金库权限账户
    [vaultAuthority] = await PublicKey.findProgramAddress(
      [Buffer.from("vault"), baseTokenMint.toBuffer()],
      program.programId
    );

    // 创建金库基础代币账户
    [vaultBaseToken] = await PublicKey.findProgramAddress(
      [Buffer.from("base_token"), vault.toBuffer()],
      program.programId
    );

    // 创建金库份额代币账户
    [vaultShares] = await PublicKey.findProgramAddress(
      [Buffer.from("shares"), vault.toBuffer()],
      program.programId
    );

    // 创建用户份额账户
    userSharesAccount = await getAssociatedTokenAddress(
      vaultShares,
      investor.publicKey
    );
    
    try {
      // 调用初始化函数
      const tx = await program.methods
        .initializeVault("测试金库")
        .accounts({
          authority: provider.wallet.publicKey,
          vault,
          strategy,
          baseTokenMint,
          vaultBaseToken,
          vaultAuthority,
          vaultShares,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      console.log("金库初始化成功，交易签名:", tx);
    } catch (error) {
      console.error("金库初始化失败:", error);
      throw error;
    }
  });

  it("设置交易对", async () => {
    console.log("开始设置交易对...");
    const maxAllocation = 5000; // 50%
    const minExitAmount = 1000000; // 1 SOL
    
    try {
      const tx = await program.methods
        .setTradingPair(maxAllocation, minExitAmount)
        .accounts({
          authority: authority.publicKey,
          strategy,
          tokenMint: baseTokenMint,
          vault,
        })
        .signers([authority])
        .rpc();
      console.log("交易对设置成功，交易签名:", tx);
    } catch (error) {
      console.error("交易对设置失败:", error);
      throw error;
    }
  });

  it("存款测试", async () => {
    console.log("开始存款测试...");
    const amount = 1000000000; // 1 SOL
    
    try {
      const tx = await program.methods
        .deposit(amount)
        .accounts({
          authority: investor.publicKey,
          vault,
          vaultBaseToken,
          vaultShares,
          vaultAuthority,
          userToken: userTokenAccount,
          userShares: userSharesAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([investor])
        .rpc();
      console.log("存款成功，交易签名:", tx);
    } catch (error) {
      console.error("存款失败:", error);
      throw error;
    }
  });

  it("提款测试", async () => {
    console.log("开始提款测试...");
    const percentage = 5000; // 50%
    
    try {
      const tx = await program.methods
        .percentageWithdraw(percentage)
        .accounts({
          authority: investor.publicKey,
          vault,
          vaultBaseToken,
          vaultShares,
          vaultAuthority,
          userToken: userTokenAccount,
          userShares: userSharesAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([investor])
        .rpc();
      console.log("提款成功，交易签名:", tx);
    } catch (error) {
      console.error("提款失败:", error);
      throw error;
    }
  });

  it("错误处理测试 - 未授权操作", async () => {
    try {
      const tx = await program.methods
        .updateInvestor(investor.publicKey)
        .accounts({
          authority: investor.publicKey,
          vault,
          systemProgram: SystemProgram.programId,
        })
        .signers([investor])
        .rpc();
    } catch (error) {
      console.log("预期的未授权错误:", error);
    }
  });
});
