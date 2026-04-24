import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const schema = z.object({
  BAGS_API_KEY: z.string().min(1, "BAGS_API_KEY required (run scripts/bags-auth.ts)"),
  SOLANA_RPC_URL: z.string().url().default("https://api.mainnet-beta.solana.com"),
  GATING_ENABLED: z.enum(["0", "1"]).default("0"),
  FOSTUDIO_MINT: z.string().optional(),
  PRO_THRESHOLD: z.coerce.number().int().nonnegative().default(1),
});

function loadBagsKeyFallback(): string | undefined {
  const path = join(homedir(), ".config", "fee-optimizer-studio", "bags-key.txt");
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8").trim();
}

const raw = {
  BAGS_API_KEY: process.env.BAGS_API_KEY ?? loadBagsKeyFallback() ?? "",
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
  GATING_ENABLED: process.env.GATING_ENABLED,
  FOSTUDIO_MINT: process.env.FOSTUDIO_MINT,
  PRO_THRESHOLD: process.env.PRO_THRESHOLD,
};

export const env = schema.parse(raw);
