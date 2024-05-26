import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  ACCOUNT_SIZE,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction
} from "@solana/spl-token";
import {
  PublicKey,
  Keypair,
  Connection,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram
} from "@solana/web3.js";
import * as fs from "fs";

import { describe, it } from "mocha";

describe("token-escrow test", () => {
  const connection = new Connection("http://localhost:8899", "confirmed");

  const payerKp = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(fs.readFileSync("/Users/deok/.config/solana/id.json", "utf-8"))
    )
  );
  const payer = payerKp.publicKey;

  const authorityKp = new Keypair();
  const takerKp = new Keypair();
  const sellMintKp = new Keypair();
  const buyMintKp = new Keypair();

  const authority = authorityKp.publicKey;
  const taker = takerKp.publicKey;
  const sellMint = sellMintKp.publicKey;
  const buyMint = buyMintKp.publicKey;

  const systemProgram = SystemProgram.programId;
  const tokenProgram = TOKEN_PROGRAM_ID;
  const escrowProgram = new PublicKey(
    "6U5mKXbakXsQWCA9FbccLXwaVmE9eivAMRswmVbmchJC"
  );

  const escrowAccount = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), authority.toBuffer(), sellMint.toBuffer()],
    escrowProgram
  );

  const authoritySellTokenAccount = getAssociatedTokenAddressSync(
    sellMint,
    authority
  );
  const authorityBuyTokenAccount = getAssociatedTokenAddressSync(
    buyMint,
    authority
  );

  const takerSellTokenAccount = getAssociatedTokenAddressSync(buyMint, taker);
  const takerBuyTokenAccount = getAssociatedTokenAddressSync(sellMint, taker);

  it("create Mint", async () => {
    let mint_lamports = await connection.getMinimumBalanceForRentExemption(
      MINT_SIZE
    );

    let sellMintCreateIx = SystemProgram.createAccount({
      fromPubkey: payer,
      lamports: mint_lamports,
      newAccountPubkey: sellMint,
      programId: tokenProgram,
      space: MINT_SIZE
    });

    let buyMintCreateIx = SystemProgram.createAccount({
      fromPubkey: payer,
      lamports: mint_lamports,
      newAccountPubkey: buyMint,
      programId: tokenProgram,
      space: MINT_SIZE
    });
    let sellMintInitialize = createInitializeMint2Instruction(
      sellMint,
      Math.floor(Math.random() * 10),
      payer,
      payer
    );
    let buyMintInitialize = createInitializeMint2Instruction(
      buyMint,
      Math.floor(Math.random() * 10),
      payer,
      payer
    );

    let tx = new Transaction()
      .add(sellMintCreateIx)
      .add(buyMintCreateIx)
      .add(sellMintInitialize)
      .add(buyMintInitialize);

    const txid = await sendAndConfirmTransaction(
      connection,
      tx,
      [payerKp, sellMintKp, buyMintKp],
      { skipPreflight: true }
    );

    console.log(
      "\n⬇ create & initilize mint txid ⬇ \n\n",
      txid,
      `\n\n ${"=".repeat(96)} \n`
    );
  });

  it("create Token Account", async () => {
    let account_lamports = await connection.getMinimumBalanceForRentExemption(
      ACCOUNT_SIZE
    );

    let authoritySellTokenAccountCreateIx =
      createAssociatedTokenAccountInstruction(
        payer,
        authoritySellTokenAccount,
        authority,
        sellMint
      );

    let authorityBuyTokenAccountCreateIx =
      createAssociatedTokenAccountInstruction(
        payer,
        authorityBuyTokenAccount,
        authority,
        buyMint
      );

    let takerBuyTokenAccountCreateIx = createAssociatedTokenAccountInstruction(
      payer,
      takerBuyTokenAccount,
      taker,
      sellMint
    );

    let takerSellTokenAccountCreateIx = createAssociatedTokenAccountInstruction(
      payer,
      takerSellTokenAccount,
      taker,
      buyMint
    );

    let tx = new Transaction()
      .add(authoritySellTokenAccountCreateIx)
      .add(authorityBuyTokenAccountCreateIx)
      .add(takerBuyTokenAccountCreateIx)
      .add(takerSellTokenAccountCreateIx);

    const txid = await sendAndConfirmTransaction(connection, tx, [payerKp], {
      skipPreflight: true
    });

    console.log(
      "\n⬇ create authority & taker ATA ⬇ \n\n",
      txid,
      `\n\n ${"=".repeat(96)} \n`
    );
  });
});
