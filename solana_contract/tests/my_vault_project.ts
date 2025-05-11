import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyVaultProject } from "../target/types/my_vault_project";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { assert } from "chai";

describe("my_vault_project", () => {
  // 配置提供者
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // 获取程序
  const program = anchor.workspace.MyVaultProject as Program<MyVaultProject>;

  // 测试账户
  let baseTokenMint: PublicKey;
  let vault: PublicKey;
  let strategy: PublicKey;
  let vaultBaseToken: PublicKey;
  let vaultShares: PublicKey;
  let vaultAuthority: PublicKey;

  it("初始化金库", async () => {
    // 创建基础代币铸币厂
    baseTokenMint = await createMint(provider);

    // 计算 PDA 地址
    [vault] = await PublicKey.findProgramAddress(
      [Buffer.from("vault"), baseTokenMint.toBuffer()],
      program.programId
    );

    [strategy] = await PublicKey.findProgramAddress(
      [Buffer.from("strategy"), vault.toBuffer()],
      program.programId
    );

    [vaultBaseToken] = await PublicKey.findProgramAddress(
      [Buffer.from("base_token"), vault.toBuffer()],
      program.programId
    );

    [vaultShares] = await PublicKey.findProgramAddress(
      [Buffer.from("shares"), vault.toBuffer()],
      program.programId
    );

    [vaultAuthority] = await PublicKey.findProgramAddress(
      [Buffer.from("vault"), baseTokenMint.toBuffer()],
      program.programId
    );

    // 初始化金库
    await program.methods
      .initializeVault("测试金库")
      .accounts({
        authority: provider.wallet.publicKey,
        vault: vault,
        strategy: strategy,
        baseTokenMint: baseTokenMint,
        vaultBaseToken: vaultBaseToken,
        vaultAuthority: vaultAuthority,
        vaultShares: vaultShares,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // 验证金库状态
    const vaultAccount = await program.account.vault.fetch(vault);
    assert.equal(vaultAccount.name, "测试金库");
    assert.equal(vaultAccount.baseTokenMint.toString(), baseTokenMint.toString());
  });

  it("设置交易对", async () => {
    const tokenMint = await createMint(provider);
    
    await program.methods
      .setTradingPair(
        new anchor.BN(5000), // 50% 最大分配
        new anchor.BN(1000000) // 最小退出数量
      )
      .accounts({
        authority: provider.wallet.publicKey,
        strategy: strategy,
        tokenMint: tokenMint,
        vault: vault,
      })
      .rpc();

    // 验证交易对设置
    const strategyAccount = await program.account.strategy.fetch(strategy);
    const tradingPair = strategyAccount.tradingPairs.find(
      pair => pair.tokenMint.toString() === tokenMint.toString()
    );
    assert.isTrue(tradingPair.isActive);
    assert.equal(tradingPair.maxAllocation.toNumber(), 5000);
  });

  it("存款测试", async () => {
    const amount = new anchor.BN(1000000); // 存款数量

    // 创建用户代币账户
    const userTokenAccount = await createAssociatedTokenAccount(
      provider,
      baseTokenMint,
      provider.wallet.publicKey
    );

    // 创建用户份额账户
    const userSharesAccount = await createAssociatedTokenAccount(
      provider,
      vaultShares,
      provider.wallet.publicKey
    );

    // 铸造代币到用户账户
    await mintTo(
      provider,
      baseTokenMint,
      userTokenAccount,
      provider.wallet.publicKey,
      amount.toNumber()
    );

    // 执行存款
    await program.methods
      .deposit(amount)
      .accounts({
        authority: provider.wallet.publicKey,
        vault: vault,
        vaultBaseToken: vaultBaseToken,
        vaultShares: vaultShares,
        vaultAuthority: vaultAuthority,
        userToken: userTokenAccount,
        userShares: userSharesAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // 验证存款结果
    const userShares = await getAccount(provider.connection, userSharesAccount);
    assert.isTrue(userShares.amount > 0);
  });
});

// 辅助函数
async function createMint(provider: anchor.AnchorProvider): Promise<PublicKey> {
  const mint = anchor.web3.Keypair.generate();
  const lamports = await provider.connection.getMinimumBalanceForRentExemption(82);
  
  const tx = new anchor.web3.Transaction().add(
    anchor.web3.SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: mint.publicKey,
      space: 82,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mint.publicKey,
      9,
      provider.wallet.publicKey,
      provider.wallet.publicKey
    )
  );

  await provider.sendAndConfirm(tx, [mint]);
  return mint.publicKey;
}

async function createAssociatedTokenAccount(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  const [ata] = await PublicKey.findProgramAddress(
    [
      owner.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const tx = new anchor.web3.Transaction().add(
    createAssociatedTokenAccountInstruction(
      provider.wallet.publicKey,
      ata,
      owner,
      mint
    )
  );

  await provider.sendAndConfirm(tx);
  return ata;
}

async function mintTo(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  destination: PublicKey,
  authority: PublicKey,
  amount: number
): Promise<void> {
  const tx = new anchor.web3.Transaction().add(
    createMintToInstruction(
      mint,
      destination,
      authority,
      amount
    )
  );

  await provider.sendAndConfirm(tx);
}

async function getAccount(
  connection: anchor.web3.Connection,
  address: PublicKey
): Promise<any> {
  return await connection.getTokenAccountBalance(address);
} 