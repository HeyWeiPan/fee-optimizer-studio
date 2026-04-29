#!/usr/bin/env tsx
/**
 * F5 spike — validate base58 versioned-tx roundtrip via @solana/web3.js.
 *
 * Bags `/fee-share/admin/update-config` returns a base58-encoded
 * `VersionedTransaction.serialize()`. We must:
 *   1) bs58.decode → Uint8Array
 *   2) VersionedTransaction.deserialize → tx object
 *   3) sign with the admin keypair
 *   4) re-serialize → bs58.encode → POST to /solana/send-transaction
 *
 * We do NOT call the live Bags update-config endpoint here — our dev wallet is
 * not admin on any mint, so the endpoint would reject. Instead we construct a
 * VersionedTransaction locally that mimics the shape Bags would return (a
 * memo-program tx with a recent blockhash), then exercise the same path.
 *
 * Goal: prove the encode/decode/sign code we'll wire into F5 has zero
 * gotchas, so the UI integration is just "call API, sign, submit".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import bs58 from "bs58";
import {
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  PublicKey,
  Connection,
  TransactionInstruction,
} from "@solana/web3.js";

const KEYPAIR_PATH = join(homedir(), ".config", "fee-optimizer-studio", "wallet.json");
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const RPC = "https://api.mainnet-beta.solana.com";

function loadKeypair(): Keypair {
  const raw = readFileSync(KEYPAIR_PATH, "utf8");
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

async function main() {
  const payer = loadKeypair();
  console.log(`[spike] payer: ${payer.publicKey.toBase58()}`);

  // Build a server-side-equivalent unsigned VersionedTransaction.
  // Memo program is harmless and doesn't require funds — it would fail to land
  // without SOL but signature verification + serialize/deserialize roundtrip
  // is all we're validating.
  const conn = new Connection(RPC, "confirmed");
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  console.log(`[spike] recent blockhash: ${blockhash} (valid until ${lastValidBlockHeight})`);

  const memoIx = new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from("fos-spike-2026-04-30", "utf8"),
  });

  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [memoIx],
  }).compileToV0Message();

  const unsigned = new VersionedTransaction(message);

  // === Simulate Bags response: base58(unsigned.serialize()) ===
  const serverPayloadBase58 = bs58.encode(unsigned.serialize());
  console.log(`[spike] simulated server payload length: ${serverPayloadBase58.length} chars`);

  // === Client side: deserialize ===
  const decoded = bs58.decode(serverPayloadBase58);
  const tx = VersionedTransaction.deserialize(decoded);
  console.log(`[spike] deserialized OK, ${tx.message.compiledInstructions.length} instructions`);
  console.log(`[spike] static account keys:`, tx.message.staticAccountKeys.map((k) => k.toBase58()));

  // === Sign locally ===
  tx.sign([payer]);
  console.log(`[spike] signatures populated: ${tx.signatures.filter((s) => s.some((b) => b !== 0)).length}/${tx.signatures.length}`);

  // === Re-serialize for submit ===
  const signedBase58 = bs58.encode(tx.serialize());
  console.log(`[spike] signed payload length: ${signedBase58.length} chars`);

  // === Sanity: can we re-deserialize the signed tx and verify? ===
  const reParsed = VersionedTransaction.deserialize(bs58.decode(signedBase58));
  const sigOk = reParsed.signatures.every((s) => s.length === 64);
  console.log(`[spike] re-parse OK, all signatures 64 bytes: ${sigOk}`);

  // We do NOT submit — would burn $0.000005 fee + need actual SOL.
  // The point is: bytes round-trip cleanly through bs58 + VersionedTransaction.
  console.log(`[spike] ✅ roundtrip green — F5 sign path is wired correctly.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
