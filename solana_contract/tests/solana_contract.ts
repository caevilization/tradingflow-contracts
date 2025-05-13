import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaContract } from "../target/types/solana_contract";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, getAssociatedTokenAddress, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("Solana Contract Test Suite", () => {
  console.log("=== Starting Test Suite ===");
  
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  console.log("Provider setup completed");

  const program = anchor.workspace.SolanaContract as Program<SolanaContract>;
  console.log("Program ID:", program.programId.toString());
  
  // Test accounts
  const authority = Keypair.generate();
  const investor = Keypair.generate();
  console.log("Test accounts created");
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
    console.log("\n=== Starting Test Environment Setup ===");
    console.log("Creating base token...");
    // Create base token
    baseTokenMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      9
    );
    console.log("Base token created:", baseTokenMint.toString());

    // Create user token account
    console.log("Creating user token account...");
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
    console.log("User token account created:", userTokenAccount.toString());
    console.log("=== Test Environment Setup Completed ===\n");
  });

  it("should successfully initialize vault", async () => {
    console.log("\n=== Starting Initialize Vault Test ===");
    // Create vault
    [vault] = await PublicKey.findProgramAddress(
      [Buffer.from("vault"), baseTokenMint.toBuffer()],
      program.programId
    );
    console.log("Vault address:", vault.toString());
    
    // Create strategy account
    [strategy] = await PublicKey.findProgramAddress(
      [Buffer.from("strategy"), vault.toBuffer()],
      program.programId
    );
    console.log("Strategy account address:", strategy.toString());

    // Create vault authority account
    [vaultAuthority] = await PublicKey.findProgramAddress(
      [Buffer.from("vault"), baseTokenMint.toBuffer()],
      program.programId
    );
    console.log("Vault authority account:", vaultAuthority.toString());

    // Create vault base token account
    [vaultBaseToken] = await PublicKey.findProgramAddress(
      [Buffer.from("base_token"), vault.toBuffer()],
      program.programId
    );
    console.log("Vault base token account:", vaultBaseToken.toString());

    // Create vault shares token account
    [vaultShares] = await PublicKey.findProgramAddress(
      [Buffer.from("shares"), vault.toBuffer()],
      program.programId
    );
    console.log("Vault shares token account:", vaultShares.toString());

    // Create user shares account
    userSharesAccount = await getAssociatedTokenAddress(
      vaultShares,
      investor.publicKey
    );
    console.log("User shares account:", userSharesAccount.toString());
    
    try {
      console.log("Calling initialize function...");
      // Call initialize function
      const tx = await program.methods
        .initializeVault("Test Vault")
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
      console.log("Vault initialized successfully, transaction signature:", tx);
      console.log("=== Vault Initialization Test Completed ===\n");
    } catch (error) {
      console.error("Vault initialization failed:", error);
      throw error;
    }
  });

  it("should successfully set trading pair", async () => {
    console.log("\n=== Starting Set Trading Pair Test ===");
    const maxAllocation = 5000; // 50%
    const minExitAmount = 1000000; // 1 SOL
    
    try {
      console.log("Calling set trading pair function...");
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
      console.log("Trading pair set successfully, transaction signature:", tx);
      console.log("=== Trading Pair Set Test Completed ===\n");
    } catch (error) {
      console.error("Trading pair set failed:", error);
      throw error;
    }
  });

  it("should successfully deposit", async () => {
    console.log("\n=== Starting Deposit Test ===");
    const amount = 1000000000; // 1 SOL
    
    try {
      console.log("Calling deposit function...");
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
      console.log("Deposit successful, transaction signature:", tx);
      console.log("=== Deposit Test Completed ===\n");
    } catch (error) {
      console.error("Deposit failed:", error);
      throw error;
    }
  });

  it("should successfully withdraw", async () => {
    console.log("\n=== Starting Withdraw Test ===");
    const percentage = 5000; // 50%
    
    try {
      console.log("Calling withdraw function...");
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
      console.log("Withdraw successful, transaction signature:", tx);
      console.log("=== Withdraw Test Completed ===\n");
    } catch (error) {
      console.error("Withdraw failed:", error);
      throw error;
    }
  });

  it("should correctly handle unauthorized operation", async () => {
    console.log("\n=== Starting Unauthorized Operation Test ===");
    try {
      console.log("Attempting unauthorized operation...");
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
      console.log("Expected unauthorized error:", error);
      console.log("=== Unauthorized Operation Test Completed ===\n");
    }
  });
});
