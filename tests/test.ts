import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  ACCOUNT_SIZE,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMintToCheckedInstruction
} from "@solana/spl-token";
import {
  PublicKey,
  Keypair,
  Connection,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY
} from "@solana/web3.js";
import {
  Metaplex,
  irysStorage,
  keypairIdentity
} from "@metaplex-foundation/js";
import * as borsh from "borsh";
import * as fs from "fs";
import BN from "bn.js";
import { describe, it } from "mocha";
import OpenAI from "openai";

const openai = new OpenAI();

enum EscrowInstruction {
  InitEscrow,
  Exchange
}

class Assignable {
  constructor(properties) {
    Object.keys(properties).map((key) => {
      return (this[key] = properties[key]);
    });
  }
}

class Initialize extends Assignable {
  toBuffer() {
    return Buffer.from(borsh.serialize(InitializeSchema, this));
  }

  static fromBuffer(buffer: Buffer) {
    return borsh.deserialize(InitializeSchema, Initialize, buffer);
  }
}

const InitializeSchema = new Map([
  [
    Initialize,
    {
      kind: "struct",
      fields: [
        ["instruction", "u8"],
        ["sell_amount", "u64"],
        ["buy_amount", "u64"]
      ]
    }
  ]
]);

class Exchange extends Assignable {
  toBuffer() {
    return Buffer.from(borsh.serialize(InitializeSchema, this));
  }

  static fromBuffer(buffer: Buffer) {
    return borsh.deserialize(InitializeSchema, Initialize, buffer);
  }
}

const ExchangeSchema = new Map([
  [
    Exchange,
    {
      kind: "struct",
      fields: [
        ["instruction", "u8"],
        ["sell_amount", "u64"],
        ["buy_amount", "u64"]
      ]
    }
  ]
]);

describe("token-escrow test", () => {
  const connection = new Connection("http://127.0.0.1:8899", "processed");

  const payerKp = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(fs.readFileSync("/Users/deok/.config/solana/id.json", "utf-8"))
    )
  );
  const payer = payerKp.publicKey;

  const metaplex = new Metaplex(connection);
  metaplex.use(
    irysStorage({
      address: "https://devnet.bundlr.network",
      providerUrl: "https://api.devnet.solana.com",
      timeout: 60000
    })
  );
  metaplex.use(keypairIdentity(payerKp));

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
  const associatedProgram = ASSOCIATED_TOKEN_PROGRAM_ID;
  const escrowProgram = new PublicKey(
    "6U5mKXbakXsQWCA9FbccLXwaVmE9eivAMRswmVbmchJC"
  );

  const [escrowAccount, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), authority.toBuffer(), sellMint.toBuffer()],
    escrowProgram
  );

  const escrowTokenAccount = getAssociatedTokenAddressSync(
    sellMint,
    escrowAccount,
    true
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

  const sellTokenDecimals = Math.floor(Math.random() * 10);
  const buyTokenDecimals = Math.floor(Math.random() * 10);

  let token1 = "";
  let token2 = "";
  let uribuy = "";
  let urisell = "";

  it("create Metadata", async () => {
    token1 = await openai.chat.completions
      .create({
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          {
            role: "user",
            content:
              "Create new symbol for crypto token in 6 chars related to solana. just give me 6 character ticker as answer"
          }
        ],
        model: "gpt-3.5-turbo"
      })
      .then((res) => {
        console.log(res.choices);
        return res.choices[0].message.content;
      });

    token2 = await openai.chat.completions
      .create({
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          {
            role: "user",
            content:
              "Create new symbol for crypto token in 6 chars related to solana. just give me 6 character ticker as answer"
          }
        ],
        model: "gpt-3.5-turbo"
      })
      .then((res) => {
        console.log(res.choices);
        return res.choices[0].message.content;
      });
    const sellResponse = await openai.images.generate({
      model: "dall-e-3",
      prompt: `round crypto symbol image with ticker ${token1}`,
      n: 1,
      size: "1024x1024"
    });

    let sell_image_url = sellResponse.data[0].url;

    const buyResponse = await openai.images.generate({
      model: "dall-e-3",
      prompt: `round crypto symbol image with ticker ${token2}`,
      n: 1,
      size: "1024x1024"
    });

    let buy_image_url = buyResponse.data[0].url;

    let { uri: uri1 } = await metaplex.nfts().uploadMetadata({
      name: token1,
      symbol: `$${token1}`,
      description: token1,
      image: sell_image_url
    });
    urisell = uri1;

    let { uri: uri2 } = await metaplex.nfts().uploadMetadata({
      name: token2,
      symbol: `$${token2}`,
      description: token2,
      image: buy_image_url
    });
    uribuy = uri2;
  });

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
      sellTokenDecimals,
      payer,
      payer
    );
    let buyMintInitialize = createInitializeMint2Instruction(
      buyMint,
      buyTokenDecimals,
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

  it("transfer sol to authority & taker", async () => {
    let transferIx1 = SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: authority,
      lamports: 10000000000
    });
    let transferIx2 = SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: taker,
      lamports: 10000000000
    });
    let tx = new Transaction().add(transferIx1).add(transferIx2);
    const txid = await sendAndConfirmTransaction(connection, tx, [payerKp], {
      skipPreflight: true
    });

    console.log(
      "\n⬇ Send SOL to authority ⬇ \n\n",
      txid,
      `\n\n ${"=".repeat(96)} \n`
    );
  });

  it("mint tokens to authority & taker", async () => {
    let mintToIx1 = createMintToCheckedInstruction(
      sellMint,
      authoritySellTokenAccount,
      payer,
      BigInt(Math.floor(Math.random() * 10000000000)),
      sellTokenDecimals
    );
    let mintToIx2 = createMintToCheckedInstruction(
      buyMint,
      takerSellTokenAccount,
      payer,
      BigInt(Math.floor(Math.random() * 10000000000)),
      buyTokenDecimals
    );

    let tx = new Transaction().add(mintToIx1).add(mintToIx2);

    const txid = await sendAndConfirmTransaction(connection, tx, [payerKp], {
      skipPreflight: true
    });

    console.log("\n⬇ Mint Tokens ⬇ \n\n", txid, `\n\n ${"=".repeat(96)} \n`);
  });

  it("create Metadata Account ", async () => {
    console.log(urisell, uribuy);
    const { response: response1 } = await metaplex
      .nfts()
      .createSft({
        uri: urisell,
        name: token1.slice(0, 6),
        symbol: `$${token1.slice(0, 6)}`,
        sellerFeeBasisPoints: 0,
        updateAuthority: payerKp,
        useExistingMint: sellMint,
        mintAuthority: payerKp
      })
      .catch((e) => {
        return { response: { signature: e.toString() } };
      })
      .then((res) => res);

    console.log(
      "\n⬇ Token Metadata Created ⬇ \n\n",
      response1.signature,
      `\n\n ${"=".repeat(96)} \n`
    );

    const { response: response2 } = await metaplex
      .nfts()

      .createSft({
        uri: uribuy,
        name: token2.slice(0, 6),
        symbol: `$${token2.slice(0, 6)}`,
        sellerFeeBasisPoints: 0,
        updateAuthority: payerKp,
        useExistingMint: buyMint,
        mintAuthority: payerKp
      })
      .catch((e) => {
        return { response: { signature: e.toString() } };
      })
      .then((res) => res);

    console.log(
      "\n⬇ Token Metadata Created ⬇ \n\n",
      response2.signature,
      `\n\n ${"=".repeat(96)} \n`
    );
  });

  it("initialize escrow", async () => {
    let initEscrowIx = new TransactionInstruction({
      keys: [
        { pubkey: sellMint, isSigner: false, isWritable: false },
        {
          pubkey: buyMint,
          isSigner: false,
          isWritable: false
        },
        { pubkey: authority, isSigner: true, isWritable: true },
        {
          pubkey: authoritySellTokenAccount,
          isSigner: false,
          isWritable: true
        },
        {
          pubkey: authorityBuyTokenAccount,
          isSigner: false,
          isWritable: false
        },
        { pubkey: escrowAccount, isSigner: false, isWritable: true },
        { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: systemProgram, isSigner: false, isWritable: false },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
        { pubkey: associatedProgram, isSigner: false, isWritable: false },
        { pubkey: escrowProgram, isSigner: false, isWritable: false }
      ],
      programId: escrowProgram,
      data: new Initialize({
        instruction: EscrowInstruction.InitEscrow,
        sell_amount: new BN(Math.floor(Math.random() * 10000000000)),
        buy_amount: new BN(Math.floor(Math.random() * 10000000000))
      }).toBuffer()
    });

    let tx = new Transaction().add(initEscrowIx);
    tx.feePayer = authority;

    const txid = await sendAndConfirmTransaction(
      connection,
      tx,
      [authorityKp],
      {
        skipPreflight: true
      }
    );

    console.log(
      "\n⬇ Initialize Escrow ⬇ \n\n",
      txid,
      `\n\n ${"=".repeat(96)} \n`
    );
  });

  // it("exchange", async () => {
  //   let exchangeIx = new TransactionInstruction({
  //     keys: [
  //       { pubkey: authority, isSigner: false, isWritable: true },
  //       { pubkey: taker, isSigner: true, isWritable: true },
  //       { pubkey: buyMint, isSigner: false, isWritable: false },
  //       { pubkey: sellMint, isSigner: false, isWritable: false },
  //       { pubkey: takerSellTokenAccount, isSigner: false, isWritable: true },
  //       ,
  //       { pubkey: takerBuyTokenAccount, isSigner: false, isWritable: true },
  //       { pubkey: authorityBuyTokenAccount, isSigner: false, isWritable: true },
  //       { pubkey: escrowAccount, isSigner: false, isWritable: true },
  //       { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
  //       { pubkey: tokenProgram, isSigner: false, isWritable: false }
  //     ],
  //     programId: escrowProgram,
  //     data: new Initialize({
  //       instruction: EscrowInstruction.Exchange,
  //       sell_amount: new BN(100000000000),
  //       buy_amount: new BN(1000000000)
  //     }).toBuffer()
  //   });

  //   let tx = new Transaction().add(exchangeIx);
  //   tx.feePayer = taker;

  //   const txid = await sendAndConfirmTransaction(connection, tx, [takerKp], {
  //     skipPreflight: true
  //   });

  //   console.log(
  //     "\n⬇ Exchange Escrow ⬇ \n\n",
  //     txid,
  //     `\n\n ${"=".repeat(96)} \n`
  //   );
  // });
});
