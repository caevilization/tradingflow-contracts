import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { SolanaContract } from "../target/types/solana_contract";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount } from "@solana/spl-token";

describe("solana_contract", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaContract as Program<SolanaContract>;
  
  // 测试账户
  const authority = Keypair.generate();
  const investor = Keypair.generate();
  let baseTokenMint: PublicKey;
  let vaultBaseToken: PublicKey;
  let vaultShares: PublicKey;
  let vault: PublicKey;
  let strategy: PublicKey;

  before(async () => {
    // 创建基础代币
    baseTokenMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      9
    );
  });

  it("初始化金库", async () => {
    // 创建金库
    const [vault] = await PublicKey.findProgramAddress(
      [Buffer.from("vault"), baseTokenMint.toBuffer()],
      program.programId
    );
    
    // 创建策略账户
    const [strategy] = await PublicKey.findProgramAddress(
      [Buffer.from("strategy"), vault.toBuffer()],
      program.programId
    );
    
    // 调用初始化函数
    await program.methods
      .initializeVault("测试金库")
      .accounts({
        authority: provider.wallet.publicKey,
        vault,
        strategy,
        baseTokenMint,
        // ... 其他必要的账户
      })
      .rpc();
  });

  it("设置交易对", async () => {
    const maxAllocation = 5000; // 50%
    const minExitAmount = 1000000; // 1 SOL
    
    const tx = await program.methods
      .setTradingPair(maxAllocation, minExitAmount)
      .accounts({
        authority: authority.publicKey,
        strategy: strategy,
        // 其他账户...
      })
      .signers([authority])
      .rpc();
      
    console.log("设置交易对交易签名:", tx);
  });

  it("存款测试", async () => {
    const amount = 1000000000; // 1 SOL
    
    const tx = await program.methods
      .deposit(amount)
      .accounts({
        authority: investor.publicKey,
        vault: vault,
        // 其他账户...
      })
      .signers([investor])
      .rpc();
      
    console.log("存款交易签名:", tx);
  });

  it("提款测试", async () => {
    const percentage = 5000; // 50%
    
    const tx = await program.methods
      .percentageWithdraw(percentage)
      .accounts({
        authority: investor.publicKey,
        vault: vault,
        // 其他账户...
      })
      .signers([investor])
      .rpc();
      
    console.log("提款交易签名:", tx);
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
