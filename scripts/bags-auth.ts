#!/usr/bin/env tsx
/**
 * Bootstrap a Bags API key by signing an Ed25519 challenge with a local Solana
 * keypair. Writes the API key to disk and prints it for env paste.
 *
 * Usage:
 *   pnpm tsx scripts/bags-auth.ts                      # generate kp if missing, run flow
 *   pnpm tsx scripts/bags-auth.ts --keypair path.json  # use specific keypair
 *   pnpm tsx scripts/bags-auth.ts --mfa 123456         # complete MFA after init
 *
 * Outputs:
 *   stderr: BAGS_API_KEY=<key>           (paste into .env)
 *   file:   ~/.config/fee-optimizer-studio/bags-key.txt
 */

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const BAGS_BASE = "https://public-api-v2.bags.fm/api/v1";
const CONFIG_DIR = join(homedir(), ".config", "fee-optimizer-studio");
const DEFAULT_KP_PATH = join(CONFIG_DIR, "wallet.json");
const DEFAULT_KEY_PATH = join(CONFIG_DIR, "bags-key.txt");
const NONCE_CACHE_PATH = join(CONFIG_DIR, "last-nonce.json");
const KEY_NAME = "fee-optimizer-studio-dev";

type InitResponse = { success: true; response: { message: string; nonce: string } };
type CallbackSuccess = { success: true; response: { apiKey: string; keyId: string } };
type CallbackMfa = { success: true; response: { mfaRequired: true; authCode: string } };
type CallbackResponse = CallbackSuccess | CallbackMfa;
type ErrorResponse = { success: false; error: string };

function loadOrCreateKeypair(path: string): Keypair {
  if (!existsSync(dirname(path))) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  chmodSync(path, 0o600);
  console.error(`[bags-auth] generated new keypair at ${path}`);
  console.error(`[bags-auth] pubkey: ${kp.publicKey.toBase58()}`);
  return kp;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BAGS_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T | ErrorResponse;
  if (!res.ok || (json as ErrorResponse).success === false) {
    const err = (json as ErrorResponse).error ?? `HTTP ${res.status}`;
    throw new Error(`POST ${path} failed: ${err}`);
  }
  return json as T;
}

function persistApiKey(apiKey: string) {
  writeFileSync(DEFAULT_KEY_PATH, apiKey + "\n", { mode: 0o600 });
  chmodSync(DEFAULT_KEY_PATH, 0o600);
  console.error(`[bags-auth] saved api key → ${DEFAULT_KEY_PATH}`);
  console.error(`BAGS_API_KEY=${apiKey}`);
}

async function runInitFlow(kp: Keypair): Promise<void> {
  const address = kp.publicKey.toBase58();
  const init = await postJson<InitResponse>("/agent/v2/auth/init", { address });
  const messageBytes = bs58.decode(init.response.message);
  const sig = nacl.sign.detached(messageBytes, kp.secretKey);
  const signature = bs58.encode(sig);

  const callback = await postJson<CallbackResponse>("/agent/v2/auth/callback", {
    address,
    signature,
    nonce: init.response.nonce,
    keyName: KEY_NAME,
  });

  if ("apiKey" in callback.response) {
    persistApiKey(callback.response.apiKey);
    return;
  }

  // MFA path: cache authCode + nonce so user can rerun with --mfa <code>
  writeFileSync(NONCE_CACHE_PATH, JSON.stringify({
    authCode: callback.response.authCode,
    address,
    cachedAt: new Date().toISOString(),
  }), { mode: 0o600 });
  chmodSync(NONCE_CACHE_PATH, 0o600);
  console.error("[bags-auth] MFA required.");
  console.error(`[bags-auth] cached auth code → ${NONCE_CACHE_PATH}`);
  console.error("[bags-auth] check your registered MFA channel, then rerun:");
  console.error("  pnpm tsx scripts/bags-auth.ts --mfa <CODE>");
}

async function runMfaFlow(mfaCode: string): Promise<void> {
  if (!existsSync(NONCE_CACHE_PATH)) {
    throw new Error("no cached auth code; run without --mfa first");
  }
  const cached = JSON.parse(readFileSync(NONCE_CACHE_PATH, "utf8")) as {
    authCode: string;
  };
  const callback = await postJson<CallbackResponse>("/agent/v2/auth/callback", {
    authCode: cached.authCode,
    mfaCode,
    keyName: KEY_NAME,
  });
  if (!("apiKey" in callback.response)) {
    throw new Error("MFA callback did not return apiKey: " + JSON.stringify(callback.response));
  }
  persistApiKey(callback.response.apiKey);
}

function parseArgs(argv: string[]) {
  const out: { keypair?: string; mfa?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--keypair") out.keypair = argv[++i];
    else if (argv[i] === "--mfa") out.mfa = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mfa) {
    await runMfaFlow(args.mfa);
    return;
  }
  const kpPath = args.keypair ?? DEFAULT_KP_PATH;
  const kp = loadOrCreateKeypair(kpPath);
  await runInitFlow(kp);
}

main().catch((err) => {
  console.error("[bags-auth] FAILED:", err.message);
  process.exit(1);
});
