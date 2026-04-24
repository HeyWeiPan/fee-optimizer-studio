#!/usr/bin/env tsx
/**
 * Smoke test: verify Bags API key works by hitting Get Fee Share Admin List.
 *
 * Usage:
 *   pnpm tsx scripts/smoke-admin-list.ts <wallet_pubkey>
 *
 * Reads BAGS_API_KEY from env or from ~/.config/fee-optimizer-studio/bags-key.txt.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BAGS_BASE = "https://public-api-v2.bags.fm/api/v1";
const KEY_PATH = join(homedir(), ".config", "fee-optimizer-studio", "bags-key.txt");

function loadApiKey(): string {
  const fromEnv = process.env.BAGS_API_KEY;
  if (fromEnv) return fromEnv.trim();
  if (existsSync(KEY_PATH)) return readFileSync(KEY_PATH, "utf8").trim();
  throw new Error("no BAGS_API_KEY in env and no key file at " + KEY_PATH);
}

async function main() {
  const wallet = process.argv[2];
  if (!wallet) {
    console.error("usage: pnpm tsx scripts/smoke-admin-list.ts <wallet_pubkey>");
    process.exit(2);
  }
  const apiKey = loadApiKey();
  const url = `${BAGS_BASE}/fee-share/admin/list?wallet=${encodeURIComponent(wallet)}`;
  const res = await fetch(url, { headers: { "x-api-key": apiKey } });
  console.error(`[smoke] HTTP ${res.status}`);
  console.error(`[smoke] X-RateLimit-Remaining: ${res.headers.get("x-ratelimit-remaining") ?? "(missing)"}`);
  console.error(`[smoke] X-RateLimit-Reset: ${res.headers.get("x-ratelimit-reset") ?? "(missing)"}`);
  const text = await res.text();
  console.log(text);
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke] FAILED:", err.message);
  process.exit(1);
});
