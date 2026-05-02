#!/usr/bin/env tsx
/**
 * F5 e2e spike — call Bags `/fee-share/admin/update-config`, sign locally,
 * submit, and report the on-chain signature.
 *
 * Prerequisites:
 *   1. The admin wallet's keypair is at $WALLET_PATH below as a 64-byte JSON
 *      array (the same shape `solana-keygen` writes).
 *   2. The mint passed in `--mint` already has fee-share configured on Bags
 *      and the keypair is its `fee-share/admin`. Verify with:
 *        `pnpm tsx -e 'import { bags } from "./app/lib/bags-client.server";
 *         bags.adminList("<pubkey>").then(console.log)'`
 *
 * Default mode is BUILD-ONLY: we fetch the unsigned tx, decode/sign locally,
 * print the signed payload, and STOP. No `sendTransaction` is called unless
 * `--submit` is passed. This guards the mainnet write behind an explicit
 * second confirmation in the CLI invocation.
 *
 * Flags:
 *   --mint <pubkey>         Required. The token whose fee-share is being changed.
 *   --split <w:bps,...>     Required. Comma-separated wallet:bps pairs summing to 10000.
 *                           Example: --split 86yLv3...PNxbPD:7000,6E9sQG...g8hvHmR:3000
 *   --submit                Pass to actually broadcast. Without it, build+sign only.
 *   --keypair <path>        Override default keypair path.
 *
 * Example:
 *   pnpm tsx scripts/spike-update-config.ts \
 *     --mint <new-token-mint> \
 *     --split 86yLv3...:7000,6E9sQG...:3000
 *   # Inspect output, then re-run with --submit when ready.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import bs58 from "bs58";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { bags } from "../app/lib/bags-client.server";

const DEFAULT_KEYPAIR = join(homedir(), ".config", "fee-optimizer-studio", "wallet.json");

const ARG = (name: string) => {
  const i = process.argv.findIndex((a) => a === `--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const HAS = (name: string) => process.argv.includes(`--${name}`);

function parseSplit(s: string): { wallets: string[]; bps: number[] } {
  const wallets: string[] = [];
  const bps: number[] = [];
  for (const pair of s.split(",")) {
    const [w, b] = pair.split(":");
    if (!w || !b) throw new Error(`bad split pair: "${pair}"`);
    const n = Number(b);
    if (!Number.isInteger(n) || n < 0 || n > 10000) {
      throw new Error(`bad basis points: "${b}"`);
    }
    wallets.push(w.trim());
    bps.push(n);
  }
  const sum = bps.reduce((a, b) => a + b, 0);
  if (sum !== 10000) throw new Error(`bps sum must be 10000, got ${sum}`);
  return { wallets, bps };
}

function loadKeypair(path: string): Keypair {
  const raw = readFileSync(path, "utf8");
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

async function main() {
  const mint = ARG("mint");
  const splitArg = ARG("split");
  const keypairPath = ARG("keypair") ?? DEFAULT_KEYPAIR;
  const willSubmit = HAS("submit");

  if (!mint || !splitArg) {
    console.error("Usage: spike-update-config.ts --mint <pubkey> --split <w:bps,...> [--submit]");
    process.exit(2);
  }

  const { wallets, bps } = parseSplit(splitArg);
  const payer = loadKeypair(keypairPath);
  console.log(`[spike] payer: ${payer.publicKey.toBase58()}`);
  console.log(`[spike] mint:  ${mint}`);
  console.log(`[spike] split:`);
  for (let i = 0; i < wallets.length; i++) {
    console.log(`         ${wallets[i]}: ${bps[i]} bps (${(bps[i] / 100).toFixed(2)}%)`);
  }

  // Pre-flight: prove we are admin so we don't burn a build call to discover it.
  const adminMints = await bags.adminList(payer.publicKey.toBase58());
  const isAdminForMint = adminMints.includes(mint);
  console.log(
    `[spike] admin precheck: payer admins ${adminMints.length} mint(s); ${
      isAdminForMint ? "INCLUDES" : "DOES NOT INCLUDE"
    } target mint`,
  );
  if (!isAdminForMint) {
    console.error(`[spike] ABORT: payer is not the fee-share admin for ${mint}`);
    process.exit(3);
  }

  console.log(`[spike] calling bags.updateConfigTx…`);
  const txs = await bags.updateConfigTx({
    baseMint: mint,
    claimersArray: wallets,
    basisPointsArray: bps,
    payer: payer.publicKey.toBase58(),
  });
  console.log(`[spike] received ${txs.length} unsigned tx(s)`);

  const signedB58: string[] = [];
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    const decoded = bs58.decode(tx.transaction);
    const versioned = VersionedTransaction.deserialize(decoded);
    versioned.sign([payer]);
    const sigCount = versioned.signatures.filter((s) => s.some((b) => b !== 0)).length;
    console.log(
      `[spike] tx ${i + 1}/${txs.length}: ${versioned.message.compiledInstructions.length} ix, ${sigCount} signature(s) populated, blockhash valid until ${tx.blockhash.lastValidBlockHeight}`,
    );
    signedB58.push(bs58.encode(versioned.serialize()));
  }

  if (!willSubmit) {
    console.log(`[spike] BUILD-ONLY mode (no --submit). Stopping before sendTransaction.`);
    console.log(`[spike] re-run with --submit to broadcast on mainnet.`);
    return;
  }

  console.log(`[spike] --submit set, broadcasting ${signedB58.length} signed tx(s)…`);
  for (let i = 0; i < signedB58.length; i++) {
    const sig = await bags.sendTransaction(signedB58[i]);
    console.log(`[spike] tx ${i + 1}: ${sig}`);
    console.log(`         https://solscan.io/tx/${sig}`);
  }
  console.log(`[spike] submit complete. budget: ${JSON.stringify(bags.rateLimit())}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
