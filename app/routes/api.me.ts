import type { Route } from "./+types/api.me";
import { bags } from "../lib/bags-client.server";
import { lamportsToSol } from "../lib/format";

/**
 * F1 — Token enumerator for the connected wallet.
 *
 * Returns every token mint where `wallet` is fee-share admin, plus that token's
 * lifetime fees so the F1 list view can rank by accrual without re-querying.
 *
 * Rate budget: 1 + N calls (admin/list + lifetime-fees per mint). N is small
 * (typical creator owns 1-3 tokens). Consider adding a bulk endpoint later.
 */

export type MeToken = {
  mint: string;
  lifetimeFeesLamports: string;
  lifetimeFeesSol: number;
};

export type MeResponse = {
  wallet: string;
  tokens: MeToken[];
  rateLimit: { remaining: number; resetAt: number };
};

export async function loader({ request }: Route.LoaderArgs): Promise<MeResponse> {
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet");
  if (!wallet) {
    throw new Response("missing ?wallet=<pubkey>", { status: 400 });
  }

  const mints = await bags.adminList(wallet);

  // Sequential to respect rate budget; small N (1-5 typical). For larger N,
  // batch through a small concurrency window (e.g. 3) once we observe usage.
  const tokens: MeToken[] = [];
  for (const mint of mints) {
    const lamports = await bags.lifetimeFees(mint);
    tokens.push({
      mint,
      lifetimeFeesLamports: lamports.toString(),
      lifetimeFeesSol: lamportsToSol(lamports),
    });
  }

  // Rank by lifetime fees descending — most-active tokens float to the top.
  tokens.sort((a, b) => b.lifetimeFeesSol - a.lifetimeFeesSol);

  return {
    wallet,
    tokens,
    rateLimit: bags.rateLimit(),
  };
}
