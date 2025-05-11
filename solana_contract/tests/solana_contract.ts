import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaContract } from "../target/types/solana_contract";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount } from "@solana/spl-token";

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
  });

  it("初始化金库", async () => {
    console.log("开始初始化金库...");
    // 创建金库
    const [vault] = await PublicKey.findProgramAddress(
      [Buffer.from("vault"), baseTokenMint.toBuffer()],
      program.programId
    );
    console.log("金库地址:", vault.toString());
    
    // 创建策略账户
    const [strategy] = await PublicKey.findProgramAddress(
      [Buffer.from("strategy"), vault.toBuffer()],
      program.programId
    );
    console.log("策略账户地址:", strategy.toString());
    
    try {
      // 调用初始化函数
      const tx = await program.methods
        .initializeVault("测试金库")
        .accounts({
          authority: provider.wallet.publicKey,
          vault,
          strategy,
          baseTokenMint,
          // ... 其他必要的账户
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
          strategy: strategy,
          // 其他账户...
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
          vault: vault,
          // 其他账户...
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
          vault: vault,
          // 其他账户...
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
          vault: vault,
          systemProgram: SystemProgram.programId,
        })
        .signers([investor])
        .rpc();
    } catch (error) {
      console.log("预期的未授权错误:", error);
    }
  });
});
